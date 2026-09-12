import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) throw new Error("Falta TURSO_DATABASE_URL en las variables de entorno.");

export const db = createClient({ url, authToken });

// ---------- helpers de consulta (async, porque Turso es una base remota) ----------

export async function get(sql: string, params: any[] = []): Promise<any | undefined> {
  await asegurarTablas();
  const rs = await db.execute({ sql, args: params });
  return rs.rows[0] as any;
}

export async function all(sql: string, params: any[] = []): Promise<any[]> {
  await asegurarTablas();
  const rs = await db.execute({ sql, args: params });
  return rs.rows as any[];
}

export async function run(sql: string, params: any[] = []): Promise<{ lastInsertRowid: number; changes: number }> {
  await asegurarTablas();
  const rs = await db.execute({ sql, args: params });
  return { lastInsertRowid: Number(rs.lastInsertRowid ?? 0), changes: rs.rowsAffected };
}

// ---------- esquema ----------

let migracion: Promise<void> | null = null;

export function asegurarTablas(): Promise<void> {
  if (!migracion) {
    migracion = db.executeMultiple(`
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

-- Historial de conversacion con el cerebro, guardado en la base (no en memoria del proceso):
-- en Vercel cada mensaje puede caer en una instancia de funcion distinta, asi que la memoria
-- de RAM no sobrevive entre un mensaje y el siguiente. Esto si.
CREATE TABLE IF NOT EXISTS conversaciones (
  usuario_id TEXT PRIMARY KEY,
  historial TEXT NOT NULL DEFAULT '[]',
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Para no procesar dos veces el mismo mensaje de Telegram si llega reintentado (ej: la
-- funcion tardo de mas y Telegram reenvia el update).
CREATE TABLE IF NOT EXISTS updates_procesados (
  update_id INTEGER PRIMARY KEY,
  procesado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`);
  }
  return migracion;
}
