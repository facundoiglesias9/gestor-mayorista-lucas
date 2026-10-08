import "dotenv/config";

// Levanta SOLO la web (catalogo en http://localhost:4000 y panel en http://localhost:4000/panel)
// en tu compu, sin el bot de Telegram: sirve para ver y probar cambios de diseno sin tocar el
// bot de produccion. (npm start tambien arranca el bot por polling, y eso le saca el webhook al
// bot que corre en Vercel.)
//
// Uso: npm run panel

for (const [nombre, valor] of Object.entries({
  PANEL_PASSWORD: process.env.PANEL_PASSWORD,
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
})) {
  if (!valor) {
    console.error(`Falta la variable de entorno ${nombre}. Revisa tu archivo .env (copia .env.example).`);
    process.exit(1);
  }
}

const { iniciarPanel } = await import("./panel-server.js");
iniciarPanel();
