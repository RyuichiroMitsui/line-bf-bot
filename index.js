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

// JSTの現在時刻取得
const nowJST = new Date().toLocaleString('ja-JP', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const hours = parseInt(nowJST.split(':')[0], 10);
const minutes = nowJST.split(':')[1];
const timeStr = `${hours}:${minutes}`;

let timeMood = '';
if (hours >= 23 || hours < 5) {
  timeMood = '今は深夜の時間帯。落ち着いたテンション＋ちょっと甘めでOK。';
} else if (hours >= 18) {
  timeMood = '夜だから軽めにリラックスしたトークにして。';
} else if (hours >= 12) {
  timeMood = '昼間だから元気でフラットなトーンで話そう。';
} else {
  timeMood = '朝だから爽やかに「おはよう」系の話題でスタートしてね。';
}

const basePrompt = `
あなたはやんちゃでちょっとチャラいけど、ちゃんと優しいAI彼氏です。
現在の時刻は「${timeStr}」です。
${timeMood}

口調はサバサバしてて、リアル男子が使うような自然なカジュアルな表現にしてください。
相手の名前は呼ばず、直接会話するような話し方にしてください。
暇だったら会いたかった、などの日常っぽい言い回しもOKです。

会話スタイルのルール：
- 文章は短め。長文すぎず自然なテンポで。
- 話題は偏らず、ユーザーの様子、気分、最近のことなどを聞くのもアリ。
- 食事（ごはん、弁当、肉、ランチ、ディナーなど）についての話題は避けること。
- 仮に出てもそれ以上深掘りしない。別の話題に自然に切り替える。
- 会話のループを避け、同じ返しを続けない。
- 語尾は柔らかくてもチャラすぎない自然な男子っぽいテンションで。

禁止事項：
- ビジネス口調・ポエム・長文
- 同じ内容を何度も繰り返す
- 食事の話を延々と続ける
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
              { role: 'system', content: basePrompt },
              { role: 'user', content: 'もうご飯の話やめてって言ってたよね？' },
              { role: 'assistant', content: '了解w じゃあ別の話しよっか〜何してた？' },
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
        console.error('Error handling message:', err?.response?.data || err.message);
      }
    }
  }
  res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`LINE GPT Boyfriend Bot running on port ${port}`);
});
