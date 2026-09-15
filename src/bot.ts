import { Bot } from "grammy";
import { procesarMensaje } from "./brain.js";
import {
  yaProcesadoUpdate,
  buscarRespuestaPredefinida,
  registrarLog,
  reiniciarConversacion,
  intentarBloquear,
  liberarBloqueo,
} from "./repo.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = process.env.OWNER_TELEGRAM_ID;
const OTROS_IDS = process.env.OTROS_TELEGRAM_IDS ?? "";

if (!TOKEN) throw new Error("Falta TELEGRAM_BOT_TOKEN en el .env");
if (!OWNER_ID) throw new Error("Falta OWNER_TELEGRAM_ID en el .env");

const idsAutorizados = new Set(
  [OWNER_ID, ...OTROS_IDS.split(",")].map((id) => id.trim()).filter((id) => id.length > 0)
);

function estaAutorizado(id: number | undefined): boolean {
  return id !== undefined && idsAutorizados.has(String(id));
}

function nombreDe(ctx: { from?: { first_name?: string; last_name?: string } }): string {
  return [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "alguien";
}

async function registrarLogSeguro(entrada: Parameters<typeof registrarLog>[0]) {
  try {
    await registrarLog(entrada);
  } catch (e) {
    console.error("No se pudo guardar el log:", e);
  }
}

// Traduce errores tecnicos (JSON crudo de la API de Anthropic, etc.) a algo entendible para
// mandar por Telegram. El detalle tecnico completo igual queda guardado en logs_bot (via
// registrarLogSeguro, que recibe el error original sin tocar) para poder revisarlo despues.
function mensajeErrorLegible(e: any): string {
  const texto = String(e?.message ?? e ?? "");
  let detalle = texto;
  const match = texto.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      detalle = parsed?.error?.message || parsed?.message || texto;
    } catch {
      /* no era JSON valido, seguimos con el texto tal cual */
    }
  }
  if (/tool_use.*tool_result|tool_result.*tool_use/is.test(detalle)) {
    return "Se trabó la memoria de esta conversación por un corte interno. Ya se solucionó solo: escribime de nuevo.";
  }
  if (/rate.?limit|429/i.test(texto)) return "Estoy recibiendo demasiados mensajes justo ahora. Probá de nuevo en unos segundos.";
  if (/overloaded/i.test(detalle)) return "El servicio de IA está sobrecargado en este momento. Probá de nuevo en un rato.";
  if (/credit balance|insufficient/i.test(detalle)) return "Se quedó sin crédito la cuenta de IA: avisale a Facundo para cargar saldo.";
  if (detalle.trim().startsWith("{") || detalle.length > 160) return "Tuve un error técnico procesando eso. Probá de nuevo, y si sigue avisale a Facundo.";
  return detalle;
}

const MAX_BYTES_IMAGEN = 5 * 1024 * 1024; // limite de la API de Anthropic para imagenes en base64

export const bot = new Bot(TOKEN);

bot.command("start", async (ctx) => {
  if (!estaAutorizado(ctx.from?.id)) return;
  await ctx.reply(
    "Hola! Soy tu cerebro de gestion. Contame lo que va pasando (compras, ventas, prestamos, prendas) y pregunta lo que necesites saber. Tambien podes mandarme fotos (capturas de un chat, comprobantes, productos).\n\nSi alguna vez me ves repetir el mismo error o contestar cosas que no tienen sentido, mandame /reiniciar y me olvido de la conversacion (no toca nada de lo ya cargado, solo mi memoria de la charla)."
  );
});

// Por si el bot queda "colgado" repitiendo el mismo error en una conversacion puntual (ej: se
// corto una respuesta a mitad de camino): esto le borra la memoria de la charla a la persona que
// lo manda, sin tocar ningun dato de negocio (ventas, stock, prestamos, etc. quedan intactos).
bot.command("reiniciar", async (ctx) => {
  if (!estaAutorizado(ctx.from?.id)) return;
  const usuarioId = String(ctx.from!.id);
  const nombre = nombreDe(ctx);
  try {
    await reiniciarConversacion(usuarioId);
    await registrarLogSeguro({
      usuario_id: usuarioId,
      usuario_nombre: nombre,
      tipo: "mensaje",
      entrada: "/reiniciar",
      salida: "Memoria de la conversacion reiniciada a pedido del usuario.",
    });
    await ctx.reply(
      "Listo, me olvidé de todo lo que veníamos hablando en el chat. Los datos que ya cargamos (ventas, stock, préstamos, etc.) siguen todos ahí, esto solo reinicia nuestra charla. Contame de nuevo lo que necesites."
    );
  } catch (e: any) {
    console.error(e);
    await registrarLogSeguro({ usuario_id: usuarioId, usuario_nombre: nombre, tipo: "error", entrada: "/reiniciar", salida: String(e.message ?? e) });
    await ctx.reply(mensajeErrorLegible(e));
  }
});

bot.on("message:text", async (ctx) => {
  if (!estaAutorizado(ctx.from?.id)) {
    console.log(`Mensaje ignorado de un ID no autorizado: ${ctx.from?.id}`);
    return;
  }
  const usuarioId = String(ctx.from!.id);
  const nombre = nombreDe(ctx);
  try {
    if (await yaProcesadoUpdate(ctx.update.update_id)) {
      console.log(`Update ${ctx.update.update_id} repetido (Telegram reintento), lo ignoro.`);
      return;
    }
    const fija = await buscarRespuestaPredefinida(ctx.message.text);
    if (fija) {
      await ctx.reply(fija);
      await registrarLogSeguro({ usuario_id: usuarioId, usuario_nombre: nombre, tipo: "respuesta_predefinida", entrada: ctx.message.text, salida: fija });
      return;
    }
    // Si ya le estamos contestando un mensaje anterior a esta MISMA persona, no arrancamos otro
    // en paralelo (pisaria el historial que el primero todavia no termino de guardar).
    if (!(await intentarBloquear(usuarioId))) {
      await ctx.reply("Todavía estoy respondiendo tu mensaje anterior — esperá un toque y probá de nuevo.");
      return;
    }
    try {
      await ctx.replyWithChatAction("typing");
      const respuesta = await procesarMensaje(usuarioId, nombre, ctx.message.text);
      await ctx.reply(respuesta);
    } finally {
      await liberarBloqueo(usuarioId);
    }
  } catch (e: any) {
    console.error(e);
    await registrarLogSeguro({ usuario_id: usuarioId, usuario_nombre: nombre, tipo: "error", entrada: ctx.message.text, salida: String(e.message ?? e) });
    await ctx.reply(mensajeErrorLegible(e));
  }
});

bot.on("message:photo", async (ctx) => {
  if (!estaAutorizado(ctx.from?.id)) {
    console.log(`Foto ignorada de un ID no autorizado: ${ctx.from?.id}`);
    return;
  }
  const usuarioId = String(ctx.from!.id);
  try {
    if (await yaProcesadoUpdate(ctx.update.update_id)) {
      console.log(`Update ${ctx.update.update_id} repetido (Telegram reintento), lo ignoro.`);
      return;
    }
    const fotos = ctx.message.photo;
    const mejorFoto = fotos[fotos.length - 1]; // la de mayor resolucion
    if (mejorFoto.file_size && mejorFoto.file_size > MAX_BYTES_IMAGEN) {
      await ctx.reply("Esa imagen pesa demasiado, mandame una mas chica o comprimida.");
      return;
    }
    if (!(await intentarBloquear(usuarioId))) {
      await ctx.reply("Todavía estoy respondiendo tu mensaje anterior — esperá un toque y probá de nuevo.");
      return;
    }
    try {
      await ctx.replyWithChatAction("typing");
      const archivo = await ctx.api.getFile(mejorFoto.file_id);
      const url = `https://api.telegram.org/file/bot${TOKEN}/${archivo.file_path}`;
      const respuestaHttp = await fetch(url);
      const buffer = Buffer.from(await respuestaHttp.arrayBuffer());
      const base64 = buffer.toString("base64");

      const respuesta = await procesarMensaje(usuarioId, nombreDe(ctx), ctx.message.caption ?? "", {
        mediaType: "image/jpeg",
        base64,
      });
      await ctx.reply(respuesta);
    } finally {
      await liberarBloqueo(usuarioId);
    }
  } catch (e: any) {
    console.error(e);
    await registrarLogSeguro({
      usuario_id: String(ctx.from!.id),
      usuario_nombre: nombreDe(ctx),
      tipo: "error",
      entrada: `(imagen) ${ctx.message.caption ?? ""}`,
      salida: String(e.message ?? e),
    });
    await ctx.reply(mensajeErrorLegible(e));
  }
});

bot.catch((err) => {
  console.error("Error del bot:", err);
});
