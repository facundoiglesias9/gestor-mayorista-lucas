import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { all } from "./db.js";

// La base ahora vive en Turso (nube), que ya es durable por si sola. Esto es una copia extra
// de tranquilidad: un volcado en JSON de todas las tablas a un archivo local, por si alguna
// vez hace falta mirar un estado viejo a mano.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupsDir = path.join(__dirname, "..", "backups");
const MAX_BACKUPS = 30;
const INTERVALO_MS = 6 * 60 * 60 * 1000; // cada 6 horas

const TABLAS = ["personas", "productos", "movimientos_stock", "prestamos", "pagos_prestamo", "canjes"];

export async function hacerBackup() {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  const datos: Record<string, any[]> = {};
  for (const tabla of TABLAS) {
    datos[tabla] = await all(`SELECT * FROM ${tabla}`);
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destino = path.join(backupsDir, `gestor-${timestamp}.json`);
  fs.writeFileSync(destino, JSON.stringify(datos, null, 2));

  const archivos = fs
    .readdirSync(backupsDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  while (archivos.length > MAX_BACKUPS) {
    const viejo = archivos.shift()!;
    fs.unlinkSync(path.join(backupsDir, viejo));
  }
  console.log(`Backup creado: ${destino}`);
}

export function iniciarBackupsAutomaticos() {
  hacerBackup();
  setInterval(hacerBackup, INTERVALO_MS);
}

// Permite correr `npm run backup` manualmente
const esEjecucionDirecta = process.argv[1] && process.argv[1].endsWith("backup.ts");
if (esEjecucionDirecta) {
  hacerBackup();
}
