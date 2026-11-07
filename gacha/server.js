// ローカル開発用サーバー。本番（Vercel）では api/index.js が使われ、public/ は静的配信される。
const path = require('path');
const express = require('express');
const { createApp } = require('./lib/app');

const app = createApp();
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`[gacha] http://localhost:${port}  (管理画面: /admin)`);
});
