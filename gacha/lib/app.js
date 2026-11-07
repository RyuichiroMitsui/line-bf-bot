// Express アプリ本体。抽選・記録・コード発行はすべてサーバー側で行う。
const express = require('express');
const crypto = require('crypto');
const L = require('../public/assets/logic.js');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function pickStore() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return require('./store-supabase').createStore();
  console.warn('[gacha] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定のため、メモリ保存で動作します（再起動で消えます）');
  return require('./store-memory').createStore();
}

function createApp(opts = {}) {
  const store = opts.store || pickStore();
  const SECRET = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'dev-secret-change-me';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
  const CUTOFF = Number(process.env.BUSINESS_DAY_CUTOFF_HOUR ?? 6);
  const IP_DAILY_LIMIT = Number(process.env.IP_DAILY_LIMIT || 40);

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  const hmac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest();
  const makeCode = (id, nick, ts, prizeId) => {
    const d = hmac(`${id}|${nick}|${ts}|${prizeId}`);
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += A[d[i] % 32];
    return 'DNS-' + out;
  };
  const ipHash = (req) => crypto.createHash('sha256').update(SECRET + '|' + (req.ip || '')).digest('hex').slice(0, 16);
  const today = () => L.bizDay(new Date(), CUTOFF);

  function parseCookies(req) {
    const out = {};
    String(req.headers.cookie || '').split(';').forEach((p) => {
      const i = p.indexOf('='); if (i < 0) return;
      out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    });
    return out;
  }
  function adminToken() {
    const exp = Date.now() + 30 * 864e5;
    return `${exp}.${hmac('admin|' + exp).toString('base64url')}`;
  }
  function isAdmin(req) {
    const t = parseCookies(req).gacha_admin; if (!t) return false;
    const [exp, sig] = t.split('.'); if (!exp || !sig || Number(exp) < Date.now()) return false;
    const expect = hmac('admin|' + exp).toString('base64url');
    return sig.length === expect.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
  }
  function requireAdmin(req, res, next) {
    if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized', message: 'ログインしてください' });
    next();
  }
  function setAdminCookie(req, res, clear) {
    const secure = (req.headers['x-forwarded-proto'] || req.protocol) === 'https';
    res.setHeader('Set-Cookie', `gacha_admin=${clear ? '' : adminToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 30 * 86400}${secure ? '; Secure' : ''}`);
  }
  function fail(res, e) {
    console.error(e);
    res.status(500).json({ error: 'server', message: 'サーバーでエラーが起きました。少し待ってもう一度お試しください。' });
  }
  function toTicket(r) {
    return {
      id: r.id, nick: r.nickname, prize: r.prize_name, sub: r.prize_sub || '', big: !!r.big, ico: r.ico || 'p-pct',
      ts: new Date(r.created_at).getTime(), day: r.business_day, code: r.code, used: !!r.used, level: r.level,
    };
  }
  // その営業日の設定と、実際に使う強さ。設定がない日は「初期値の強さ」を使う（空欄＝強め、にはしない）
  async function loadDay(day) {
    const settings = L.normalizeSettings(await store.getSettings());
    const row = await store.getDay(day);
    const d = L.normalizeDay(row || {});
    let level, reason;
    if (row) { const r = L.computeLevel(d, settings); level = r.level; reason = r.reason; }
    else { level = settings.default_level; reason = 'この日の設定はまだありません。初期値の「' + L.LEVELS[level] + '」で配っています'; }
    return { settings, day: d, level, reason, hasRow: !!row };
  }

  /* ---------- お客さん向け ---------- */
  app.get('/api/status', async (req, res) => {
    try {
      const day = today();
      const { settings, level } = await loadDay(day);
      const closed = level === 'off';
      res.json({ day, dayLabel: L.fmtDayJa(day), open: !closed, message: closed ? settings.closed_msg : '' });
    } catch (e) { fail(res, e); }
  });

  app.post('/api/spin', async (req, res) => {
    try {
      const body = req.body || {};
      const nick = String(body.nickname || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 12);
      const clientId = String(body.clientId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || null;
      if (!nick) return res.status(400).json({ error: 'nickname', message: 'ニックネームを入れてください' });
      const day = today();
      const { settings, day: d, level } = await loadDay(day);
      if (level === 'off') return res.status(409).json({ error: 'closed', message: settings.closed_msg });
      if (!settings.allow_repeat) {
        const prev = await store.findSpin(day, { clientId, nickname: nick });
        if (prev) return res.json({ ticket: toTicket(prev), again: true });
      }
      const ip = ipHash(req);
      if (IP_DAILY_LIMIT > 0 && (await store.countByIp(day, ip)) >= IP_DAILY_LIMIT) {
        return res.status(429).json({ error: 'limit', message: '本日の回数上限に達しました' });
      }
      const counts = await store.countsForDay(day);
      const totalCap = L.totalCapFor(settings, d);
      if (totalCap > 0 && counts.total >= totalCap) return res.status(409).json({ error: 'soldout', message: '本日分のクーポンは配布終了しました。また次回！' });
      const prize = L.pickPrize(settings, d, counts.byPrize, level);
      if (!prize) return res.status(409).json({ error: 'soldout', message: 'ただいま配布できる景品がありません' });
      const id = crypto.randomUUID();
      const ts = Date.now();
      const row = {
        id, business_day: day, nickname: nick, client_id: clientId, prize_id: prize.id, prize_name: prize.name, prize_sub: prize.sub || '',
        big: !!prize.big, ico: prize.ico, level, code: makeCode(id, nick, ts, prize.id), used: false, ip_hash: ip, created_at: new Date(ts).toISOString(),
      };
      await store.insertSpin(row);
      res.json({ ticket: toTicket(row), again: false });
    } catch (e) { fail(res, e); }
  });

  app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req) }));

  /* ---------- 店舗向け ---------- */
  app.post('/api/admin/login', (req, res) => {
    const pw = String((req.body && req.body.password) || '');
    if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'no_password', message: 'サーバーに ADMIN_PASSWORD が設定されていません' });
    const a = crypto.createHash('sha256').update(pw).digest();
    const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
    if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'bad_password', message: 'パスワードが違います' });
    setAdminCookie(req, res, false);
    res.json({ ok: true });
  });
  app.post('/api/admin/logout', (req, res) => { setAdminCookie(req, res, true); res.json({ ok: true }); });

  app.get('/api/admin/overview', requireAdmin, async (req, res) => {
    try {
      const day = DAY_RE.test(String(req.query.day || '')) ? String(req.query.day) : today();
      const info = await loadDay(day);
      const [spins, counts] = await Promise.all([store.listSpins(day), store.countsForDay(day)]);
      res.json({
        today: today(), businessDay: day, day: info.day, level: info.level, reason: info.reason, hasRow: info.hasRow,
        settings: info.settings, counts, spins: spins.map(toTicket),
        prob: L.probTable(info.settings, info.day, counts.byPrize, info.level),
      });
    } catch (e) { fail(res, e); }
  });
  app.get('/api/admin/spins', requireAdmin, async (req, res) => {
    try { res.json({ spins: (await store.listRecentSpins(500)).map(toTicket) }); } catch (e) { fail(res, e); }
  });
  app.put('/api/admin/settings', requireAdmin, async (req, res) => {
    try {
      const s = L.normalizeSettings(req.body || {});
      s.prizes = s.prizes.map((p) => ({ ...p, id: p.id || ('x' + crypto.randomBytes(4).toString('hex')) }));
      await store.saveSettings(s);
      res.json({ ok: true, settings: s });
    } catch (e) { fail(res, e); }
  });
  app.put('/api/admin/day/:day', requireAdmin, async (req, res) => {
    try {
      const day = req.params.day;
      if (!DAY_RE.test(day)) return res.status(400).json({ error: 'bad_day', message: '日付の形式が違います' });
      const settings = L.normalizeSettings(await store.getSettings());
      const d = L.normalizeDay(req.body || {});
      const r = L.computeLevel(d, settings);
      d.level = r.level; d.business_day = day; d.updated_at = new Date().toISOString();
      await store.saveDay(day, d);
      res.json({ ok: true, day: d, level: r.level, reason: r.reason });
    } catch (e) { fail(res, e); }
  });
  app.post('/api/admin/spins/:id/used', requireAdmin, async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: 'bad_id' });
      await store.setUsed(id, !!(req.body && req.body.used));
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  app.delete('/api/admin/day/:day/spins', requireAdmin, async (req, res) => {
    try {
      const day = req.params.day;
      if (!DAY_RE.test(day)) return res.status(400).json({ error: 'bad_day', message: '日付の形式が違います' });
      const clientId = req.query.clientId ? String(req.query.clientId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : null;
      const deleted = await store.deleteSpins(day, clientId);
      res.json({ ok: true, deleted });
    } catch (e) { fail(res, e); }
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
  return app;
}

module.exports = { createApp };
