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

async function agregarColumnaSiFalta(tabla: string, columna: string, definicion: string) {
  try {
    await db.execute(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
  } catch (e: any) {
    // Ya existe (esto corre en cada arranque, no solo la primera vez): se ignora.
    if (!/duplicate column/i.test(e.message ?? "")) throw e;
  }
}

export function asegurarTablas(): Promise<void> {
  if (!migracion) {
    migracion = (async () => {
      await db.executeMultiple(`
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

-- Respuestas fijas: si el mensaje contiene el disparador, se responde esto directo, sin
-- gastar de IA ni pasar por el cerebro. Para cosas tipo "horarios", "direccion", etc.
CREATE TABLE IF NOT EXISTS respuestas_predefinidas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  disparador TEXT NOT NULL,
  respuesta TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Evita que dos mensajes de la MISMA persona lleguen casi juntos (o un reintento de Telegram)
-- y se procesen en paralelo en dos instancias distintas de Vercel: la segunda pisaria el
-- historial que la primera todavia esta por guardar. Se pide el "turno" antes de procesar y se
-- libera al terminar; si quedo pegado por un crash, se puede volver a tomar despues de un rato
-- (ver intentarBloquear en repo.ts).
CREATE TABLE IF NOT EXISTS bloqueos_conversacion (
  usuario_id TEXT PRIMARY KEY,
  bloqueado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Pedidos que arma un CLIENTE (por WhatsApp) charlando con el bot restringido: nunca tocan
-- ventas/stock reales solos. Quedan "pendiente" hasta que el dueno o Lucas los aprueben (ahi si
-- se registra la venta de verdad) o los rechacen. Ver crearPedidoPendiente/aprobarPedidoPendiente
-- en repo.ts.
CREATE TABLE IF NOT EXISTS pedidos_pendientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_telefono TEXT NOT NULL,
  cliente_nombre TEXT,
  producto TEXT NOT NULL,
  cantidad INTEGER NOT NULL,
  precio_unitario REAL,
  moneda TEXT NOT NULL DEFAULT 'ARS',
  nota TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  resuelto_en TEXT
);

-- Registro de actividad del bot (para verlo desde el panel sin depender de logs de Vercel).
CREATE TABLE IF NOT EXISTS logs_bot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id TEXT,
  usuario_nombre TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('mensaje','respuesta_predefinida','error')),
  entrada TEXT,
  salida TEXT,
  herramientas_usadas TEXT,
  fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`);
      // Columna agregada despues de la version inicial de la tabla productos: en que moneda
      // estan cargados el costo y el precio de venta de ese producto.
      await agregarColumnaSiFalta("productos", "moneda", "TEXT NOT NULL DEFAULT 'USD'");
    })();
  }
  return migracion;
}
