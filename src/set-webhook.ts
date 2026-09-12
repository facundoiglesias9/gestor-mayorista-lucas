import "dotenv/config";
import { Bot } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const url = process.argv[2];

if (!token) {
  console.error("Falta TELEGRAM_BOT_TOKEN en tu .env");
  process.exit(1);
}
if (!url) {
  console.error("Uso: npm run set-webhook -- https://tu-app.vercel.app/api/telegram-webhook");
  process.exit(1);
}

const bot = new Bot(token);
await bot.api.setWebhook(url, secret ? { secret_token: secret } : undefined);
console.log(`Webhook configurado: ${url}`);
console.log("A partir de ahora Telegram le manda los mensajes a Vercel. Si queres volver a correr el bot en tu PC (npm start), primero corre: npm run delete-webhook");
