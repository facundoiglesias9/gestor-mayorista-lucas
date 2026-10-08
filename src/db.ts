import { AsyncLocalStorage } from "node:async_hooks";
import { createClient, type Transaction } from "@libsql/client";
import { estadoYBateriaDelNombre } from "./equipos.js";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) throw new Error("Falta TURSO_DATABASE_URL en las variables de entorno.");

export const db = createClient({ url, authToken });

// ---------- transacciones ----------
// Las operaciones de varios pasos (una venta: crear producto + reponer + descontar + anotar el
// movimiento) van dentro de enTransaccion: o se guardan todos los pasos, o ninguno. Sin esto,
// si algo falla a la mitad (se corta la conexion, Vercel corta la funcion) el stock queda
// descuadrado. get/all/run de abajo usan solos la transaccion en curso, asi que las funciones de
// repo.ts no tienen que pasarla a mano.
// OJO: nada de llamadas lentas a otros servicios (ej: la IA) adentro de una transaccion, porque
// mientras dura nadie mas puede escribir en la base.

const transaccionActual = new AsyncLocalStorage<Transaction>();

export async function enTransaccion<T>(fn: () => Promise<T>): Promise<T> {
  // Si ya estamos adentro de una (ej: aprobar un pedido llama a registrar la venta), se reusa.
  if (transaccionActual.getStore()) return fn();
  await asegurarTablas();
  const tx = await db.transaction("write");
  try {
    const resultado = await transaccionActual.run(tx, fn);
    await tx.commit();
    return resultado;
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
}

// ---------- helpers de consulta (async, porque Turso es una base remota) ----------

async function ejecutar(sql: string, params: any[]) {
  await asegurarTablas();
  return (transaccionActual.getStore() ?? db).execute({ sql, args: params });
}

export async function get(sql: string, params: any[] = []): Promise<any | undefined> {
  const rs = await ejecutar(sql, params);
  return rs.rows[0] as any;
}

export async function all(sql: string, params: any[] = []): Promise<any[]> {
  const rs = await ejecutar(sql, params);
  return rs.rows as any[];
}

export async function run(sql: string, params: any[] = []): Promise<{ lastInsertRowid: number; changes: number }> {
  const rs = await ejecutar(sql, params);
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
    migracion = crearTablas().catch((e) => {
      // Si fallo (ej: un corte de red justo al arrancar), no nos quedamos con el error guardado
      // para siempre: el proximo pedido lo vuelve a intentar.
      migracion = null;
      throw e;
    });
  }
  return migracion;
}

async function crearTablas(): Promise<void> {
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

-- Fotos del catalogo publico: una por modelo y color (ej: "iPhone 17 Pro Max" + "Naranja
-- cosmico"). Van en la base y no en archivos porque en Vercel no hay disco donde guardarlas.
-- modelo_clave y color_clave son el modelo y el color normalizados (ver claveModelo en
-- repo.ts): con eso se emparejan con los productos y se evita cargar dos veces la misma foto.
CREATE TABLE IF NOT EXISTS fotos_catalogo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modelo TEXT NOT NULL,
  modelo_clave TEXT NOT NULL,
  color TEXT NOT NULL,
  color_clave TEXT NOT NULL,
  color_hex TEXT,
  mime TEXT NOT NULL,
  datos BLOB NOT NULL,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS fotos_catalogo_modelo_color ON fotos_catalogo (modelo_clave, color_clave);

-- Publicaciones del catalogo publico: lo que ven los clientes. Va aparte del stock a proposito
-- (el stock es la cuenta interna; el catalogo es la vidriera, que se arma desde el panel).
-- memorias es un JSON: [{ capacidad: "256 GB", precio: 1320, disponible: true }, ...]; si esta
-- vacio, el precio es el de la columna precio. visible = 0 la saca de la vista de los clientes
-- sin borrarla. disponible = 0 es "no lo tengo": se muestra como sin stock.
CREATE TABLE IF NOT EXISTS catalogo_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'Celulares',
  estado TEXT,
  detalle TEXT,
  precio REAL,
  moneda TEXT NOT NULL DEFAULT 'USD',
  memorias TEXT NOT NULL DEFAULT '[]',
  disponible INTEGER NOT NULL DEFAULT 1,
  visible INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Ajustes sueltos del sistema (clave/valor). Ej: si ya se armo el catalogo inicial.
CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT
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
  // Identifica QUIEN tiene tomado el bloqueo de una conversacion, para que cada mensaje
  // libere solo el suyo (ver intentarBloquear/liberarBloqueo en repo.ts).
  await agregarColumnaSiFalta("bloqueos_conversacion", "token", "TEXT");
  // Estados del catalogo: se unificaron en "Sellado", "Usado - como nuevo" y "Usado". Y la
  // bateria de los usados ahora sale del stock (el cliente la elige en el catalogo), asi que se
  // saca el "Bateria NN%" fijo que habia puesto el armado inicial en el detalle. Son idempotentes:
  // corren en cada arranque y despues de la primera vez no cambian nada.
  await db.executeMultiple(`
UPDATE catalogo_items SET estado = 'Sellado' WHERE estado IN ('Nuevo sellado', 'Nuevo');
UPDATE catalogo_items SET estado = 'Usado - como nuevo' WHERE estado = 'Seminuevo';
UPDATE catalogo_items SET detalle = NULL WHERE detalle GLOB 'Batería [0-9]*%';
`);
  // Estado y bateria de cada equipo del stock (Sellado / Usado - como nuevo / Usado, y el % de
  // bateria si es usado). Antes solo estaban escritos en el nombre ("Iphone 15 pro 128gb 79%"),
  // asi que la primera vez se completan leyendo los nombres. Una sola vez: despues se cargan a mano.
  await agregarColumnaSiFalta("productos", "estado", "TEXT");
  await agregarColumnaSiFalta("productos", "bateria", "INTEGER");
  await completarEstadoYBateriaDesdeNombres();
}

async function completarEstadoYBateriaDesdeNombres() {
  if ((await db.execute(`SELECT 1 FROM configuracion WHERE clave = 'stock_estado_bateria'`)).rows.length) return;
  const productos = await db.execute(`SELECT id, nombre FROM productos WHERE estado IS NULL AND bateria IS NULL`);
  const cambios: { sql: string; args: any[] }[] = [];
  for (const p of productos.rows) {
    const { estado, bateria } = estadoYBateriaDelNombre(String(p.nombre));
    if (estado == null && bateria == null) continue;
    cambios.push({
      sql: `UPDATE productos SET estado = ?, bateria = ? WHERE id = ? AND estado IS NULL AND bateria IS NULL`,
      args: [estado, bateria, p.id],
    });
  }
  // La marca va en la misma tanda: si algo falla, no queda marcado y se reintenta en el proximo arranque.
  cambios.push({ sql: `INSERT OR IGNORE INTO configuracion (clave, valor) VALUES ('stock_estado_bateria', datetime('now','localtime'))`, args: [] });
  await db.batch(cambios, "write");
}
