import "dotenv/config";

// Corre el bot por POLLING usando un token de Telegram y una base de Turso separadas de las de
// produccion, para poder probar cambios del "cerebro" (brain.ts) charlando de verdad por
// Telegram, sin arriesgar el webhook real ni ensuciar los datos reales del negocio (ventas,
// stock, etc.) con mensajes de prueba.
//
// Que hace falta en el .env:
//   TELEGRAM_BOT_TOKEN_TEST   -> token de un bot NUEVO creado con @BotFather, solo para esto.
//   TURSO_DATABASE_URL_TEST   -> URL de una base de Turso NUEVA (turso.tech), solo para esto.
//   TURSO_AUTH_TOKEN_TEST     -> token de esa base.
// OWNER_TELEGRAM_ID / OTROS_TELEGRAM_IDS se reusan (sos vos, tu ID de Telegram no cambia).
//
// Uso: npm run test-bot

const TOKEN_TEST = process.env.TELEGRAM_BOT_TOKEN_TEST;
const DB_URL_TEST = process.env.TURSO_DATABASE_URL_TEST;
const DB_TOKEN_TEST = process.env.TURSO_AUTH_TOKEN_TEST;

if (!TOKEN_TEST) {
  throw new Error(
    "Falta TELEGRAM_BOT_TOKEN_TEST en el .env. Cread un bot nuevo con @BotFather (solo para pruebas) y pegá su token ahi."
  );
}
if (!DB_URL_TEST || !DB_TOKEN_TEST) {
  throw new Error(
    "Falta TURSO_DATABASE_URL_TEST / TURSO_AUTH_TOKEN_TEST en el .env. Cread una base nueva en turso.tech (solo para pruebas) para no mezclar datos de prueba con los reales."
  );
}

// OJO con el orden: hay que pisar las variables ANTES de importar bot.js (que a su vez importa
// db.ts y lee TURSO_DATABASE_URL al cargarse). Por eso el import es dinamico, despues de esto.
process.env.TELEGRAM_BOT_TOKEN = TOKEN_TEST;
process.env.TURSO_DATABASE_URL = DB_URL_TEST;
process.env.TURSO_AUTH_TOKEN = DB_TOKEN_TEST;

const { bot } = await import("./bot.js");

console.log("Bot de PRUEBA corriendo por polling (token y base separados de produccion). Ctrl+C para cortar.");
bot.start();
