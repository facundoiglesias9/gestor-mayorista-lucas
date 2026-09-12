import "dotenv/config";
import { Bot } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Falta TELEGRAM_BOT_TOKEN en tu .env");
  process.exit(1);
}

const bot = new Bot(token);
await bot.api.deleteWebhook();
console.log("Webhook eliminado. Ahora podes correr el bot local con: npm start");
