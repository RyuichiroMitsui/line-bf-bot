// Supabase 保存（本番用）。service_role キーでサーバーからだけアクセスする。
const { createClient } = require('@supabase/supabase-js');

function createStore() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  const nowIso = () => new Date().toISOString();

  return {
    async getSettings() {
      const row = must(await sb.from('gacha_settings').select('data').eq('id', 1).maybeSingle());
      return row ? row.data : null;
    },
    async saveSettings(s) {
      must(await sb.from('gacha_settings').upsert({ id: 1, data: s, updated_at: nowIso() }));
    },
    async getDay(day) {
      const row = must(await sb.from('gacha_days').select('data').eq('business_day', day).maybeSingle());
      return row ? row.data : null;
    },
    async saveDay(day, d) {
      must(await sb.from('gacha_days').upsert({ business_day: day, data: d, updated_at: nowIso() }));
    },
    async listSpins(day) {
      return must(await sb.from('gacha_spins').select('*').eq('business_day', day).order('created_at', { ascending: false }).limit(1000));
    },
    async listRecentSpins(limit) {
      return must(await sb.from('gacha_spins').select('*').order('created_at', { ascending: false }).limit(limit));
    },
    async countsForDay(day) {
      const rows = must(await sb.from('gacha_spins').select('prize_id').eq('business_day', day).limit(5000));
      const byPrize = {};
      rows.forEach((r) => { byPrize[r.prize_id] = (byPrize[r.prize_id] || 0) + 1; });
      return { total: rows.length, byPrize };
    },
    async countByIp(day, ip) {
      const { count, error } = await sb.from('gacha_spins').select('id', { count: 'exact', head: true }).eq('business_day', day).eq('ip_hash', ip);
      if (error) throw new Error(error.message);
      return count || 0;
    },
    async findSpin(day, { clientId, nickname }) {
      if (clientId) {
        const rows = must(await sb.from('gacha_spins').select('*').eq('business_day', day).eq('client_id', clientId).order('created_at', { ascending: false }).limit(1));
        if (rows[0]) return rows[0];
      }
      if (nickname) {
        const rows = must(await sb.from('gacha_spins').select('*').eq('business_day', day).eq('nickname', nickname).order('created_at', { ascending: false }).limit(1));
        if (rows[0]) return rows[0];
      }
      return null;
    },
    async insertSpin(row) {
      must(await sb.from('gacha_spins').insert(row));
    },
    async setUsed(id, used) {
      must(await sb.from('gacha_spins').update({ used, used_at: used ? nowIso() : null }).eq('id', id));
    },
    async deleteSpins(day, clientId) {
      let q = sb.from('gacha_spins').delete({ count: 'exact' }).eq('business_day', day);
      if (clientId) q = q.eq('client_id', clientId);
      const { count, error } = await q;
      if (error) throw new Error(error.message);
      return count || 0;
    },
  };
}

module.exports = { createStore };
