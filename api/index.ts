import "dotenv/config";
import { webhookCallback } from "grammy";
import { app } from "../src/panel-server.js";
import { bot } from "../src/bot.js";

// Punto de entrada para Vercel: la app de Express normal, mas la ruta del webhook de Telegram
// (aca SI se registra, porque en Vercel nunca se llama a bot.start() con polling — cada
// mensaje de Telegram prende esta funcion mediante un pedido HTTP).
app.post("/api/telegram-webhook", webhookCallback(bot, "express", { secretToken: process.env.TELEGRAM_WEBHOOK_SECRET }));

export default app;
