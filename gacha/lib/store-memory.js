// メモリ保存（開発・テスト用）。再起動で消える。
function createStore() {
  let settings = null;
  const days = new Map();
  const spins = [];
  const byTimeDesc = (a, b) => b.created_at.localeCompare(a.created_at);
  const copy = (x) => JSON.parse(JSON.stringify(x));

  return {
    async getSettings() { return settings ? copy(settings) : null; },
    async saveSettings(s) { settings = copy(s); },
    async getDay(day) { return days.has(day) ? copy(days.get(day)) : null; },
    async saveDay(day, d) { days.set(day, copy(d)); },
    async listSpins(day) { return spins.filter((s) => s.business_day === day).sort(byTimeDesc).map(copy); },
    async listRecentSpins(limit) { return spins.slice().sort(byTimeDesc).slice(0, limit).map(copy); },
    async countsForDay(day) {
      const byPrize = {}; let total = 0;
      for (const s of spins) if (s.business_day === day) { total++; byPrize[s.prize_id] = (byPrize[s.prize_id] || 0) + 1; }
      return { total, byPrize };
    },
    async countByIp(day, ip) { return spins.filter((s) => s.business_day === day && s.ip_hash === ip).length; },
    async findSpin(day, { clientId, nickname }) {
      const hit = spins
        .filter((s) => s.business_day === day && ((clientId && s.client_id === clientId) || (nickname && s.nickname === nickname)))
        .sort(byTimeDesc)[0];
      return hit ? copy(hit) : null;
    },
    async insertSpin(row) { spins.push(copy(row)); },
    async setUsed(id, used) {
      const s = spins.find((x) => x.id === id);
      if (s) { s.used = used; s.used_at = used ? new Date().toISOString() : null; }
    },
    async deleteSpins(day, clientId) {
      let n = 0;
      for (let i = spins.length - 1; i >= 0; i--) {
        const s = spins[i];
        if (s.business_day === day && (!clientId || s.client_id === clientId)) { spins.splice(i, 1); n++; }
      }
      return n;
    },
  };
}

module.exports = { createStore };
