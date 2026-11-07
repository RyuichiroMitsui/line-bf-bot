# DENSE クーポンガチャ（本番版）

Instagram ストーリーズのリンクから開く「ニックネームを入れてガチャを回す → 当たり券をスクショして来店」のアプリです。
Vercel（サーバー）＋ Supabase（保存）で動きます。抽選・記録・確認コードの発行はすべてサーバー側なので、お客さんはログイン不要で誰でも回せ、スクショの加工では通りません。

| 画面 | URL | 内容 |
|---|---|---|
| ガチャ画面（お客さん） | `/` | ニックネーム → ガチャ → 当たり券（景品・ニックネーム・日時・確認コード） |
| 管理画面（店舗） | `/admin` | パスワードでログイン。営業日ごとの状況・強さ・上限、結果ログ、景品と確率 |

## 1. Supabase の準備（5分）

1. https://supabase.com でプロジェクトを作る（無料枠でOK）
2. 左メニュー **SQL Editor** → `supabase/schema.sql` の中身を貼り付けて **Run**
3. **Project Settings → API** で次の2つを控える
   - `Project URL` → `SUPABASE_URL`
   - `service_role` キー → `SUPABASE_SERVICE_ROLE_KEY`（**絶対に公開しない**。サーバーだけで使います）

## 2. Vercel にデプロイ（5分）

1. https://vercel.com → **Add New → Project** → この GitHub リポジトリ `line-bf-bot` を選ぶ
2. **Root Directory** を `gacha` にする（Edit を押して選択）
3. **Environment Variables** に以下を入れる（`.env.example` と同じ）

   | 名前 | 値 |
   |---|---|
   | `SUPABASE_URL` | SupabaseのProject URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabaseのservice_roleキー |
   | `ADMIN_PASSWORD` | 管理画面のパスワード（好きな文字列） |
   | `SESSION_SECRET` | 長いランダムな文字列（32文字以上推奨） |
   | `BUSINESS_DAY_CUTOFF_HOUR` | `6`（朝6時までは前日扱い） |

4. **Deploy** → `https://xxxx.vercel.app` ができます
   - ガチャ画面 `https://xxxx.vercel.app/` → ストーリーズのリンクに貼る
   - 管理画面 `https://xxxx.vercel.app/admin`
5. 独自ドメインを付けたい場合は Vercel の **Domains** から追加できます

## 3. 毎日の使い方

1. 営業前に `/admin` を開き、**その日の予約組数・今いる来客・天気**を入れて「この日の設定を保存」
   - 自動で「強め／ふつう／控えめ」が決まります（手動で切替・配布停止もできます）
   - 景品ごとの「この日の上限」と「配布上限（全体）」もここで決められます。空欄なら共通の初期値
   - 先の日付を選んで前もって設定しておくこともできます
2. お客さんがスクショを見せたら、ログでニックネームかコードを検索 → 合っていれば「使用済み」
3. 営業中に混んできたら「控えめ」に、空いてきたら「強め」に切り替えて保存

## 仕組みのポイント

- **確認コード** `DNS-XXXXXX` はサーバーの秘密鍵から作るので、偽造できません。管理画面のログと照合できます
- **1人1日1回**：端末ID とニックネームの両方で判定（管理画面の「テスト用：何回も回せる」で解除可）
- **上限**：景品ごとの枚数上限（日ごとに上書き可）と、1日の配布上限。上限に達した景品は出ず、下の景品に繰り下がります
- **営業日**：朝6時で切り替わり（深夜営業対応）。`BUSINESS_DAY_CUTOFF_HOUR` で変更できます
- **店舗ログイン中はガチャ画面にテスト用リセット**（自分の今日の結果を消す）が出ます。お客さんには出ません
- 1つのIPあたり1日40回までに制限しています（環境変数 `IP_DAILY_LIMIT` で変更）

## ローカルで試す

```bash
cd gacha
npm install
cp .env.example .env   # ADMIN_PASSWORD だけ入れればメモリ保存で動きます（Supabase未設定なら再起動で消える）
npm run dev            # http://localhost:3000  管理画面 /admin
```

## ファイル構成

```
gacha/
  api/index.js            Vercel のサーバーレス関数（/api/* すべて）
  lib/app.js              API本体（抽選・記録・ログイン）
  lib/store-supabase.js   Supabase 保存
  lib/store-memory.js     メモリ保存（開発用）
  public/index.html       ガチャ画面
  public/admin.html       管理画面
  public/assets/logic.js  抽選ロジック（サーバーと管理画面で共通）
  public/assets/app.css   共通スタイル
  supabase/schema.sql     テーブル定義
  server.js               ローカル開発用サーバー
```
