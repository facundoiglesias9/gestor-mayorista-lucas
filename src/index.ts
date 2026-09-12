import "dotenv/config";
import "./db.js"; // crea las tablas si no existen

for (const [nombre, valor] of Object.entries({
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  OWNER_TELEGRAM_ID: process.env.OWNER_TELEGRAM_ID,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  PANEL_PASSWORD: process.env.PANEL_PASSWORD,
})) {
  if (!valor) {
    console.error(`Falta la variable de entorno ${nombre}. Revisa tu archivo .env (copia .env.example).`);
    process.exit(1);
  }
}

// Se importan recien aca (dinamicamente), una vez validadas las variables de entorno de arriba.
const { bot } = await import("./bot.js");
const { iniciarBackupsAutomaticos } = await import("./backup.js");
const { iniciarPanel } = await import("./panel-server.js");

iniciarBackupsAutomaticos();
iniciarPanel();

console.log("Arrancando el bot de Telegram...");
bot.start({
  onStart: () => console.log("Bot corriendo. Andá a Telegram y escribile."),
});
