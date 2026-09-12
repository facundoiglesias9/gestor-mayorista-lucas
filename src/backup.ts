import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DB_PATH } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupsDir = path.join(__dirname, "..", "backups");
const MAX_BACKUPS = 30;
const INTERVALO_MS = 6 * 60 * 60 * 1000; // cada 6 horas

export function hacerBackup() {
  if (!fs.existsSync(DB_PATH)) return;
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destino = path.join(backupsDir, `gestor-${timestamp}.db`);
  fs.copyFileSync(DB_PATH, destino);

  const archivos = fs
    .readdirSync(backupsDir)
    .filter((f) => f.endsWith(".db"))
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
