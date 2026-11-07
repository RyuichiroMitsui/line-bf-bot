// Vercel のサーバーレス関数。vercel.json の rewrite で /api/* がすべてここに来る。
const { createApp } = require('../lib/app');

module.exports = createApp();
