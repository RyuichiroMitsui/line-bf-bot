// 抽選ロジック（サーバーと管理画面で共通）。ブラウザでは window.GachaLogic、Node では require で使う。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GachaLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var JST = 'Asia/Tokyo';
  var LEVELS = { strong: '強め', normal: 'ふつう', weak: '控えめ', off: '配布停止' };
  var LIDX = { weak: 0, normal: 1, strong: 2 };
  var WEATHER = {
    sunny: { f: 1, t: '晴れ' }, cloudy: { f: 0.95, t: 'くもり' }, rain: { f: 0.8, t: '雨' }, snow: { f: 0.7, t: '雪' },
  };
  // w = [控えめ, ふつう, 強め] の重み。強めは9割が大当たり、控えめは5%・10% OFFがほぼ全部。
  var DEFAULT_PRIZES = [
    { id: 'p5', name: '5% OFF', sub: 'お会計から5%引き', w: [70, 15, 0], cap: 0, big: false, ico: 'p-pct', enabled: true },
    { id: 'p10', name: '10% OFF', sub: 'お会計から10%引き', w: [25, 30, 0], cap: 0, big: false, ico: 'p-pct', enabled: true },
    { id: 'p30', name: '30% OFF', sub: 'お会計から30%引き', w: [4, 30, 4], cap: 0, big: false, ico: 'p-pct', enabled: true },
    { id: 'y1500', name: '1,500円 OFF', sub: 'お会計から1,500円引き', w: [1, 15, 6], cap: 0, big: false, ico: 'p-yen', enabled: true },
    { id: 'btl', name: '焼酎ボトル1本 無料', sub: '対象の焼酎ボトル1本をサービス', w: [0, 7, 55], cap: 5, big: true, ico: 'p-bottle', enabled: true },
    { id: 'teq', name: 'テキーラ30杯 サービス', sub: 'グループで30ショットまで', w: [0, 3, 35], cap: 2, big: true, ico: 'p-shots', enabled: true },
  ];
  var DEFAULT_SETTINGS = {
    prizes: DEFAULT_PRIZES,
    default_level: 'normal',       // その日の設定がないときの強さ
    daily_total_cap: 60,           // 1営業日の配布上限（枚）
    allow_repeat: false,           // 同じ人が何回も回せる（テスト用）
    closed_msg: '本日のガチャはお休みです。また次回！',
    group_size: 2.5,               // 予約1組あたりの平均人数
    strong_pct: 50,                // 見込み÷いつも がこの%未満 → 強め
    weak_pct: 90,                  // この%以上 → 控えめ
    baseline_default: 20,          // いつもの来客（人）の初期値
  };
  var DEFAULT_DAY = { reservations: 0, guests: 0, baseline: null, weather: 'sunny', override: 'auto', caps: {}, total_cap: null, note: '' };

  function jstParts(d) {
    var f = new Intl.DateTimeFormat('ja-JP', { timeZone: JST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' });
    var out = {};
    f.formatToParts(d).forEach(function (x) { out[x.type] = x.value; });
    return out;
  }
  function bizDay(d, cutoff) {
    d = d || new Date(); cutoff = (cutoff === undefined || cutoff === null) ? 6 : Number(cutoff);
    var p = jstParts(new Date(d.getTime() - cutoff * 3600e3));
    return p.year + '-' + p.month + '-' + p.day;
  }
  function shiftDay(day, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day); if (!m) return day;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3] + n); var d = new Date(t);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function fmtTs(ms) {
    var p = jstParts(new Date(ms));
    return p.year + '/' + p.month + '/' + p.day + ' ' + p.hour + ':' + p.minute + ':' + p.second + '（' + p.weekday + '）';
  }
  function fmtDayJa(day) {
    var a = String(day).split('-'); if (a.length !== 3) return day;
    var w = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])).getUTCDay()];
    return a[0] + '年' + (+a[1]) + '月' + (+a[2]) + '日（' + w + '）';
  }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function normalizePrize(p) {
    p = p || {};
    var w = p.w || [];
    return {
      id: String(p.id || ''), name: String(p.name || '景品').slice(0, 40), sub: String(p.sub || '').slice(0, 60),
      w: [Math.max(0, num(w[0], 0)), Math.max(0, num(w[1], 0)), Math.max(0, num(w[2], 0))],
      cap: Math.max(0, Math.floor(num(p.cap, 0))), big: !!p.big, ico: p.ico || (p.big ? 'p-bottle' : 'p-pct'), enabled: p.enabled !== false,
    };
  }
  function normalizeSettings(s) {
    var out = {}; var k;
    for (k in DEFAULT_SETTINGS) out[k] = DEFAULT_SETTINGS[k];
    for (k in (s || {})) if (s[k] !== undefined) out[k] = s[k];
    if (!Array.isArray(out.prizes) || !out.prizes.length) out.prizes = DEFAULT_PRIZES;
    out.prizes = out.prizes.map(normalizePrize);
    if (!LEVELS[out.default_level]) out.default_level = 'normal';
    out.daily_total_cap = Math.max(0, Math.floor(num(out.daily_total_cap, 60)));
    out.allow_repeat = !!out.allow_repeat;
    out.closed_msg = String(out.closed_msg || DEFAULT_SETTINGS.closed_msg).slice(0, 120);
    out.group_size = Math.max(1, num(out.group_size, 2.5));
    out.strong_pct = Math.max(0, num(out.strong_pct, 50));
    out.weak_pct = Math.max(0, num(out.weak_pct, 90));
    out.baseline_default = Math.max(1, num(out.baseline_default, 20));
    return out;
  }
  function normalizeDay(d) {
    d = d || {};
    var caps = {}; var src = d.caps || {};
    Object.keys(src).forEach(function (k) { var v = src[k]; if (v === '' || v === null || v === undefined) return; caps[k] = Math.max(0, Math.floor(num(v, 0))); });
    return {
      reservations: Math.max(0, Math.floor(num(d.reservations, 0))),
      guests: Math.max(0, Math.floor(num(d.guests, 0))),
      baseline: (d.baseline === '' || d.baseline === null || d.baseline === undefined) ? null : Math.max(1, num(d.baseline, 1)),
      weather: WEATHER[d.weather] ? d.weather : 'sunny',
      override: (d.override === 'auto' || LEVELS[d.override]) ? d.override : 'auto',
      caps: caps,
      total_cap: (d.total_cap === '' || d.total_cap === null || d.total_cap === undefined) ? null : Math.max(0, Math.floor(num(d.total_cap, 0))),
      note: String(d.note || '').slice(0, 200),
    };
  }
  function computeLevel(day, settings) {
    settings = normalizeSettings(settings); day = normalizeDay(day);
    if (day.override && day.override !== 'auto') {
      return { level: day.override, pct: null, reason: day.override === 'off' ? '手動で「配布停止」にしています' : '手動で「' + LEVELS[day.override] + '」にしています' };
    }
    var w = WEATHER[day.weather] || WEATHER.sunny;
    var expect = day.reservations * settings.group_size + day.guests;
    var base = Math.max(1, day.baseline || settings.baseline_default);
    var pct = Math.round(expect * w.f / base * 100);
    var level = 'normal';
    if (pct < settings.strong_pct) level = 'strong'; else if (pct >= settings.weak_pct) level = 'weak';
    var reason = '見込み ' + expect.toFixed(0) + '人（予約' + day.reservations + '組×' + settings.group_size + '人＋来客' + day.guests + '人）× 天気' + w.t + '（×' + w.f + '）÷ いつも' + base + '人 ＝ ' + pct + '%';
    reason += level === 'strong' ? ' → 空いているので強めに配る' : level === 'weak' ? ' → 入りが良いので控えめに' : ' → ふつう';
    return { level: level, pct: pct, reason: reason };
  }
  function capFor(prize, day) {
    var o = day && day.caps ? day.caps[prize.id] : undefined;
    return (o === undefined || o === null || o === '') ? prize.cap : Math.max(0, Math.floor(num(o, 0)));
  }
  function totalCapFor(settings, day) {
    var o = day ? day.total_cap : null;
    return (o === undefined || o === null || o === '') ? settings.daily_total_cap : Math.max(0, Math.floor(num(o, 0)));
  }
  function activePrizes(settings, day, counts) {
    counts = counts || {};
    return settings.prizes.filter(function (p) { return p.enabled; }).map(function (p) {
      var cap = capFor(p, day); var n = counts[p.id] || 0;
      var o = {}; for (var k in p) o[k] = p[k];
      o.capEff = cap; o.n = n; o.capped = cap > 0 && n >= cap;
      return o;
    });
  }
  function probTable(settings, day, counts, level) {
    var i = LIDX[level]; if (i === undefined) return [];
    var list = activePrizes(settings, day, counts);
    var tot = list.reduce(function (s, p) { return s + (p.capped ? 0 : p.w[i]); }, 0);
    return list.map(function (p) { p.pct = tot ? Math.round((p.capped ? 0 : p.w[i]) / tot * 100) : 0; return p; });
  }
  function pickPrize(settings, day, counts, level, rand) {
    rand = rand || Math.random;
    var i = LIDX[level]; if (i === undefined) return null;
    var list = activePrizes(settings, day, counts).filter(function (p) { return !p.capped; });
    if (!list.length) return null;
    var tot = list.reduce(function (s, p) { return s + p.w[i]; }, 0);
    if (!tot) return list[0];
    var r = rand() * tot;
    for (var k = 0; k < list.length; k++) { r -= list[k].w[i]; if (r < 0) return list[k]; }
    return list[list.length - 1];
  }
  return {
    LEVELS: LEVELS, LIDX: LIDX, WEATHER: WEATHER, DEFAULT_PRIZES: DEFAULT_PRIZES, DEFAULT_SETTINGS: DEFAULT_SETTINGS, DEFAULT_DAY: DEFAULT_DAY,
    bizDay: bizDay, shiftDay: shiftDay, fmtTs: fmtTs, fmtDayJa: fmtDayJa,
    normalizeSettings: normalizeSettings, normalizeDay: normalizeDay, normalizePrize: normalizePrize,
    computeLevel: computeLevel, capFor: capFor, totalCapFor: totalCapFor, activePrizes: activePrizes, probTable: probTable, pickPrize: pickPrize,
  };
});
