import { Bot } from "grammy";
import { procesarMensaje } from "./brain.js";

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

const MAX_BYTES_IMAGEN = 5 * 1024 * 1024; // limite de la API de Anthropic para imagenes en base64

export const bot = new Bot(TOKEN);

bot.command("start", async (ctx) => {
  if (!estaAutorizado(ctx.from?.id)) return;
  await ctx.reply(
    "Hola! Soy tu cerebro de gestion. Contame lo que va pasando (compras, ventas, prestamos, prendas) y pregunta lo que necesites saber. Tambien podes mandarme fotos (capturas de un chat, comprobantes, productos)."
  );
});

bot.on("message:text", async (ctx) => {
  if (!estaAutorizado(ctx.from?.id)) {
    console.log(`Mensaje ignorado de un ID no autorizado: ${ctx.from?.id}`);
    return;
  }
  await ctx.replyWithChatAction("typing");
  try {
    const respuesta = await procesarMensaje(String(ctx.from!.id), nombreDe(ctx), ctx.message.text);
    await ctx.reply(respuesta);
  } catch (e: any) {
    console.error(e);
    await ctx.reply(`Algo fallo procesando eso: ${e.message ?? e}`);
  }
});

bot.on("message:photo", async (ctx) => {
  if (!estaAutorizado(ctx.from?.id)) {
    console.log(`Foto ignorada de un ID no autorizado: ${ctx.from?.id}`);
    return;
  }
  await ctx.replyWithChatAction("typing");
  try {
    const fotos = ctx.message.photo;
    const mejorFoto = fotos[fotos.length - 1]; // la de mayor resolucion
    if (mejorFoto.file_size && mejorFoto.file_size > MAX_BYTES_IMAGEN) {
      await ctx.reply("Esa imagen pesa demasiado, mandame una mas chica o comprimida.");
      return;
    }
    const archivo = await ctx.api.getFile(mejorFoto.file_id);
    const url = `https://api.telegram.org/file/bot${TOKEN}/${archivo.file_path}`;
    const respuestaHttp = await fetch(url);
    const buffer = Buffer.from(await respuestaHttp.arrayBuffer());
    const base64 = buffer.toString("base64");

    const respuesta = await procesarMensaje(String(ctx.from!.id), nombreDe(ctx), ctx.message.caption ?? "", {
      mediaType: "image/jpeg",
      base64,
    });
    await ctx.reply(respuesta);
  } catch (e: any) {
    console.error(e);
    await ctx.reply(`Algo fallo procesando esa imagen: ${e.message ?? e}`);
  }
});

bot.catch((err) => {
  console.error("Error del bot:", err);
});
