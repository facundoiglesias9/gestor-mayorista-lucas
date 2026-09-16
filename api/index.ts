import "dotenv/config";
import { webhookCallback } from "grammy";
import { app } from "../src/panel-server.js";
import { bot } from "../src/bot.js";
import { registrarLog } from "../src/repo.js";

// Punto de entrada para Vercel: la app de Express normal, mas la ruta del webhook de Telegram
// (aca SI se registra, porque en Vercel nunca se llama a bot.start() con polling — cada
// mensaje de Telegram prende esta funcion mediante un pedido HTTP).
const manejarWebhook = webhookCallback(bot, "express", { secretToken: process.env.TELEGRAM_WEBHOOK_SECRET });
const OWNER_ID = process.env.OWNER_TELEGRAM_ID;

// Chequeo periodico del webhook (lo llama un cron externo, ver .github/workflows). Si Telegram
// alguna vez pierde la configuracion del webhook (nos paso una vez y no quedo registrado en
// ningun lado, porque sin webhook no llega ni un mensaje al bot para poder loguear el problema),
// esto lo detecta, lo repone solo, y esta vez si lo deja anotado en Logs y avisa por Telegram.
app.get("/api/cron/verificar-webhook", async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ ok: false, error: "No autorizado." });
  }
  const urlEsperada = process.env.TELEGRAM_WEBHOOK_URL_ESPERADA;
  try {
    const info = await bot.api.getWebhookInfo();
    if (!urlEsperada || info.url === urlEsperada) {
      return res.json({ ok: true, reparado: false });
    }
    await bot.api.setWebhook(urlEsperada, process.env.TELEGRAM_WEBHOOK_SECRET ? { secret_token: process.env.TELEGRAM_WEBHOOK_SECRET } : undefined);
    const detalle = `El webhook de Telegram estaba mal (url="${info.url || "vacío"}") y se repuso automáticamente a "${urlEsperada}".`;
    await registrarLog({
      usuario_id: "sistema",
      usuario_nombre: "Chequeo automático",
      tipo: "error",
      entrada: "Chequeo periódico del webhook (cron)",
      salida: detalle,
    }).catch((e) => console.error("No se pudo guardar el log del cron:", e));
    if (OWNER_ID) {
      await bot.api.sendMessage(OWNER_ID, `⚠️ ${detalle}\n\nYa deberías poder volver a escribirme normal.`).catch((e) => console.error("No se pudo avisar por Telegram:", e));
    }
    return res.json({ ok: true, reparado: true, urlAnterior: info.url });
  } catch (e: any) {
    console.error("Error verificando/reparando el webhook:", e);
    return res.status(500).json({ ok: false, error: e.message ?? String(e) });
  }
});

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
