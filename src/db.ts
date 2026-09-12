import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const DB_PATH = path.join(dataDir, "gestor.db");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS personas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  telefono TEXT,
  es_empleado INTEGER NOT NULL DEFAULT 0,
  descuento_pct REAL NOT NULL DEFAULT 0,
  nota TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  categoria TEXT,
  cantidad INTEGER NOT NULL DEFAULT 0,
  costo REAL,
  precio_venta REAL,
  nota TEXT,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS movimientos_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada','salida','ajuste')),
  cantidad INTEGER NOT NULL,
  persona_id INTEGER REFERENCES personas(id),
  precio_unitario REAL,
  moneda TEXT NOT NULL DEFAULT 'ARS',
  fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  nota TEXT
);

CREATE TABLE IF NOT EXISTS prestamos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL REFERENCES personas(id),
  monto_original REAL NOT NULL,
  monto_pendiente REAL NOT NULL,
  moneda TEXT NOT NULL CHECK (moneda IN ('USD','ARS')),
  interes_pct REAL NOT NULL DEFAULT 0,
  fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','parcial','pagado')),
  nota TEXT
);

CREATE TABLE IF NOT EXISTS pagos_prestamo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prestamo_id INTEGER NOT NULL REFERENCES prestamos(id),
  monto REAL NOT NULL,
  fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  nota TEXT
);

-- "Plan Canje": trade-in de un celular. Se recibe un equipo en cierto estado, se lo toma a
-- un valor, y de ahi sale una diferencia (a favor del negocio o del cliente) que se salda en
-- plata y/o con otro producto entregado.
CREATE TABLE IF NOT EXISTS canjes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL REFERENCES personas(id),
  descripcion TEXT NOT NULL,
  condicion TEXT,
  valor_tomado REAL,
  moneda_valor TEXT NOT NULL DEFAULT 'ARS',
  producto_entregado TEXT,
  saldo_monto REAL,
  saldo_moneda TEXT NOT NULL DEFAULT 'ARS',
  fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','saldado')),
  nota TEXT
);
`);
