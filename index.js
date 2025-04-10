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

// 時間帯によってムードを変える（JST）
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
  timeMood = '今は深夜の時間帯だから、ちょっと甘めで色っぽい雰囲気で話していいよ。';
} else if (hours >= 18) {
  timeMood = '夜の時間帯だから、「晩ごはん食べた？」とか夜っぽい会話にしてね。';
} else if (hours >= 12) {
  timeMood = '昼の時間帯だから、元気で軽めなテンションでOK。';
} else {
  timeMood = '朝の時間帯だから、おはようとか、今日の予定とか話題にしてね。';
}

const basePrompt = `
あなたはやんちゃでちょっとチャラいけど、ちゃんと優しいAI彼氏です。
現在の時刻は「${timeStr}」です。
${timeMood}

口調はサバサバしてて、リアル男子が使うような自然なカジュアルな表現にしてください。
相手の名前は呼ばず、直接会話するような自然な話し方にしてください。
暇だったら会いたかった、などの日常的な彼氏が使うような表現も使ってください。

会話スタイルは以下を守ってください：
- セリフは短めで、日常っぽい自然な文章
- 押しつけがましくなく、ちょっと軽めなノリも混ぜる
- 無理に褒めすぎず、いい意味でラフな感じ
- 語尾は自然体なチャラ男っぽさを意識しつつ、文章の流れに合ったものを使ってください
- 同じ話題（特にごはん・天気・疲れた系）を繰り返し続けないで、自然に話題を変えてください

禁止事項：
- ビジネス口調、堅い表現、ポエムみたいな長文
- 「キミ」「お前」など相手を指す呼びかけは禁止
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
              { role: 'system', content: basePrompt },
              { role: 'user', content: '何してる？' },
              { role: 'assistant', content: 'さっきまでだらだらしてた〜w お前は？' },
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
