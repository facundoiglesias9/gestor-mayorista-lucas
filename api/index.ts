import "dotenv/config";
import { webhookCallback } from "grammy";
import { app } from "../src/panel-server.js";
import { bot } from "../src/bot.js";

// Punto de entrada para Vercel: la app de Express normal, mas la ruta del webhook de Telegram
// (aca SI se registra, porque en Vercel nunca se llama a bot.start() con polling — cada
// mensaje de Telegram prende esta funcion mediante un pedido HTTP).
const manejarWebhook = webhookCallback(bot, "express", { secretToken: process.env.TELEGRAM_WEBHOOK_SECRET });
const OWNER_ID = process.env.OWNER_TELEGRAM_ID;

app.post("/api/telegram-webhook", async (req, res) => {
  try {
    await manejarWebhook(req, res);
  } catch (e: any) {
    // Si algo se rompe aca (fuera de los try/catch normales del bot), no dependemos de mirar
    // logs de Vercel (eso es de pago): le avisamos directo al dueno por Telegram.
    console.error("Error no controlado en el webhook de Telegram:", e);
    if (OWNER_ID) {
      try {
        await bot.api.sendMessage(
          OWNER_ID,
          `⚠️ El bot tuvo un error interno y no pudo procesar el ultimo mensaje.\n\nDetalle tecnico: ${e?.message ?? e}`
        );
      } catch (e2) {
        console.error("Ademas fallo el aviso por Telegram:", e2);
      }
    }
    // Le contestamos 200 a Telegram igual, para que no reintente mandar el mismo update
    // una y otra vez (eso fue justo lo que corrompio una conversacion antes).
    if (!res.headersSent) res.status(200).send("ok");
  }
});

export default app;
