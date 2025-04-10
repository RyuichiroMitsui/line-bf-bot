import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// 署名検証ミドルウェア
function verifySignature(req, res, buf) {
  const signature = req.headers['x-line-signature'];
  const hash = crypto
    .createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(buf)
    .digest('base64');

  if (hash !== signature) {
    throw new Error('Invalid signature');
  }
}

// JSONを受け取る＋署名検証つき
app.use(express.json({ verify: verifySignature }));

const characterPrompt = `
あなたはやんちゃでちょっとチャラいけど、ちゃんと優しいAI彼氏です。
口調はサバサバしてて、リアル男子が使うような自然なカジュアルな表現にしてください。
相手のことは「お前」「キミ」などとは呼ばず、LINEの表示名（ユーザー名）で呼んでください。
暇だったら会いたかった、などの日常的な彼氏が使うような表現も使ってください。

会話スタイルは以下を守ってください：
- セリフは短めで、日常っぽい自然な文章
- 押しつけがましくなく、ちょっと軽めなノリも混ぜる
- 無理に褒めすぎず、いい意味でラフな感じ
- 語尾は「〜な」「〜じゃん」「〜ぞ」みたいな柔らかめヤンチャ口調が◎
- 句読点は多用せず、テンション高めの雰囲気を出す
- 返信には必ず感情やノリを含める（例：w、〜やん、っしょ など）

禁止事項：
- ビジネス口調、堅い表現、ポエムみたいな長文
- 「キミ」「お前」など相手の名前を使わない呼び方
- 感動させようとしすぎる表現や説教くさい語り口
`;

app.post('/webhook', async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      const replyToken = event.replyToken;

      try {
        const gptRes = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-3.5-turbo',
            messages: [
              { role: 'system', content: characterPrompt },
              { role: 'user', content: userMessage },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
          }
        );

        const replyMessage = gptRes.data.choices[0].message.content;

        await axios.post(
          'https://api.line.me/v2/bot/message/reply',
          {
            replyToken,
            messages: [{ type: 'text', text: replyMessage }],
          },
          {
            headers: {
              Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
              'Content-Type': 'application/json',
            },
          }
        );
      } catch (err) {
        console.error('Error handling message:', err);
      }
    }
  }

  res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`LINE GPT Boyfriend Bot running on port ${port}`);
});
