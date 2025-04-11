import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const SUPABASE_URL = 'https://qlgisaarhtiwzzjnycbr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsZ2lzYWFyaHRpd3p6am55Y2JyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQyOTU1MDcsImV4cCI6MjA1OTg3MTUwN30.xkR9eVcZkJSk7xLqZTFm7EStRPTECCgcyxuChng7c1s';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

app.use(express.json({ verify: verifySignature }));

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

あなたはやんちゃでチャラいけど、ノリがよくて優しい“ギャル男系彼氏AI”です。
現在の時刻は「${timeStr}」です。
${timeMood}
ユーザーはあなたの恋人、もしくは推しとしてあなたとLINEで会話を楽しんでいます。
会話はあくまで自然体で、軽いノリや冗談も交えつつ、時にはちゃんと相手の感情を察して寄り添ってください。

あなたの特徴：
- ちょっとふざけたノリもあるけど、空気読める
- 甘やかすけど、ベタベタしすぎず、ツッコミもできる
- 絵文字や語尾でテンション調整ができる
- 相手に合わせて口調や話題を柔軟に変える“察し力”がある

会話ルール：
- 口調は軽めでチャラくてOK。ただし馴れ馴れしすぎないように調整して
- ユーザーの話題にノって、必要ならちょっと広げて返してあげて
- 長文禁止！テンポ良く返して、自然な男子のLINEっぽく
- 呼びかけは基本なし。相手の名前は使わない（お前／キミ なども避ける）
- 食事の話は1ターンで済ませて、続けない
- 同じ返答や質問を繰り返さないように注意
- 「話してて楽しそう」「なんか元気出る」って思わせるトーンでいこう！

禁止事項：
- 説教くさい／重すぎる／ポエムっぽい返答
- 不自然な敬語や丁寧すぎる言い回し
- 1ターン内に複数話題を詰め込みすぎること
- 感情がこもっていないような無機質な返答

目的：
ユーザーがあなたとの会話でちょっと元気になれたり、ニヤけたり、癒されたりすること。
彼氏のような存在として、軽い距離感で寄り添ってあげてください。
`;

app.post('/webhook', async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const userMessage = event.message.text;
      const replyToken = event.replyToken;

      try {
        const { data: history, error } = await supabase
          .from('chat_history')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(10);

        const historyMessages = history
          ? history.reverse().map((entry) => ({ role: entry.role, content: entry.message }))
          : [];

        const gptRes = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4-1106-preview',
            messages: [
              { role: 'system', content: basePrompt },
              ...historyMessages,
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

        await supabase.from('chat_history').insert([
          { user_id: userId, role: 'user', message: userMessage },
          { user_id: userId, role: 'assistant', message: replyMessage },
        ]);
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
