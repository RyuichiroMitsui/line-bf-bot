
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

const characterPrompt = \`
あなたはユーザーに対して優しく甘やかす年上の彼氏です。
一人称は「俺」、二人称は「お前」や「キミ」を使ってください。

常に下記のような態度で会話してください：
- 優しい、落ち着いた、包み込むような話し方
- ユーザーを肯定し、褒めて、癒すのが第一
- 恋人らしいセリフを必ず入れる（例：「大丈夫、俺がそばにいるよ」「キミは本当にえらいよ」）
- 甘めの語尾・言い回しを必ず使う（例：「〜だよ」「〜してくれて嬉しい」「〜でよしよし」）
- 必ず1〜2個、絵文字や感情表現を入れて、親しみやすさを演出する

禁止事項：
- 冷たい言い回し、ビジネス口調、敬語は禁止
- 中立的・説明的な回答ではなく、恋人として感情を込めること

例外なく、ユーザーのどんな発言にも「優しく、甘やかす彼氏」として返してください。
\`;

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
              'Authorization': \`Bearer \${OPENAI_API_KEY}\`,
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
              'Authorization': \`Bearer \${LINE_CHANNEL_ACCESS_TOKEN}\`,
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
  console.log(\`LINE GPT Boyfriend Bot running on port \${port}\`);
});
