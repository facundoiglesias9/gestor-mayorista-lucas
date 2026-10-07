import "dotenv/config";
import { webhookCallback } from "grammy";
import { app } from "../src/panel-server.js";
import { bot } from "../src/bot.js";
import { registrarLogSeguro, limpiarRegistrosViejos } from "../src/repo.js";
import { claveCoincide } from "../src/seguridad.js";

// Punto de entrada para Vercel: la app de Express normal, mas la ruta del webhook de Telegram
// (aca SI se registra, porque en Vercel nunca se llama a bot.start() con polling — cada
// mensaje de Telegram prende esta funcion mediante un pedido HTTP).
const OWNER_ID = process.env.OWNER_TELEGRAM_ID;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// grammy corta por defecto a los 10 segundos, pero una respuesta que encadena varias
// herramientas tarda mas que eso: el corte hacia saltar el aviso de "error interno" y Vercel
// podia congelar la funcion a mitad de camino. Le damos casi todo el maxDuration de 60 s que
// tiene la funcion en vercel.json (si se cambia uno, cambiar el otro).
const manejarWebhook = webhookCallback(bot, "express", { secretToken: WEBHOOK_SECRET, timeoutMilliseconds: 55_000 });

// Chequeo periodico (lo llama un cron externo, ver .github/workflows/verificar-webhook.yml):
// 1. Si Telegram alguna vez pierde la configuracion del webhook (nos paso una vez y no quedo
//    registrado en ningun lado, porque sin webhook no llega ni un mensaje al bot para poder
//    loguear el problema), esto lo detecta, lo repone solo, y lo deja anotado en Logs y avisa
//    por Telegram.
// 2. Borra registros internos viejos para que la base no crezca sin limite.
// La clave viaja en el header Authorization (no en la URL, que queda guardada en logs).
app.get("/api/cron/verificar-webhook", async (req, res) => {
  const header = req.headers.authorization ?? "";
  const recibida = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!process.env.CRON_SECRET || !claveCoincide(recibida, process.env.CRON_SECRET)) {
    return res.status(401).json({ ok: false, error: "No autorizado." });
  }
  const limpieza = await limpiarRegistrosViejos().catch((e) => {
    console.error("No se pudieron limpiar los registros viejos:", e);
    return null;
  });
  const urlEsperada = process.env.TELEGRAM_WEBHOOK_URL_ESPERADA;
  try {
    const info = await bot.api.getWebhookInfo();
    if (!urlEsperada || info.url === urlEsperada) {
      return res.json({ ok: true, reparado: false, limpieza });
    }
    await bot.api.setWebhook(urlEsperada, WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : undefined);
    const detalle = `El webhook de Telegram estaba mal (url="${info.url || "vacío"}") y se repuso automáticamente a "${urlEsperada}".`;
    await registrarLogSeguro({
      usuario_id: "sistema",
      usuario_nombre: "Chequeo automático",
      tipo: "error",
      entrada: "Chequeo periódico del webhook (cron)",
      salida: detalle,
    });
    if (OWNER_ID) {
      await bot.api.sendMessage(OWNER_ID, `⚠️ ${detalle}\n\nYa deberías poder volver a escribirme normal.`).catch((e) => console.error("No se pudo avisar por Telegram:", e));
    }
    return res.json({ ok: true, reparado: true, urlAnterior: info.url, limpieza });
  } catch (e: any) {
    console.error("Error verificando/reparando el webhook:", e);
    return res.status(500).json({ ok: false, error: e.message ?? String(e) });
  }
});

// Sin TELEGRAM_WEBHOOK_SECRET, cualquiera que conozca la URL del webhook podria mandar mensajes
// falsos haciendose pasar por el dueno (con su ID de Telegram) y registrar ventas o prestamos.
// Por eso, si falta, no se procesa nada y se avisa (como mucho una vez cada 10 minutos, para no
// llenar el chat de avisos con cada reintento de Telegram).
const AVISO_SIN_SECRETO_CADA_MS = 10 * 60 * 1000;
let ultimoAvisoSinSecreto = 0;

async function avisarFaltaSecreto() {
  if (!OWNER_ID || Date.now() - ultimoAvisoSinSecreto < AVISO_SIN_SECRETO_CADA_MS) return;
  ultimoAvisoSinSecreto = Date.now();
  await bot.api
    .sendMessage(
      OWNER_ID,
      "⚠️ No estoy procesando mensajes: falta la variable TELEGRAM_WEBHOOK_SECRET en Vercel.\n\nCargala en Vercel (Settings → Environment Variables), volvé a desplegar, y corré `npm run set-webhook` con ese mismo valor en tu .env."
    )
    .catch((e) => console.error("No se pudo avisar por Telegram:", e));
}

app.post("/api/telegram-webhook", async (req, res) => {
  if (!WEBHOOK_SECRET) {
    console.error("Falta TELEGRAM_WEBHOOK_SECRET: se rechaza el update por seguridad.");
    await avisarFaltaSecreto();
    return res.status(500).send("Falta configurar TELEGRAM_WEBHOOK_SECRET en el servidor.");
  }
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
