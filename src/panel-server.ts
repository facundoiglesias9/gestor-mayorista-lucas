import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as repo from "./repo.js";
import { toolDefinitions } from "./tools.js";
import { claveCoincide } from "./seguridad.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PANEL_PORT = Number(process.env.PANEL_PORT ?? 4000);
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;

if (!PANEL_PASSWORD) throw new Error("Falta PANEL_PASSWORD en el .env");

// OJO: esta app NO registra la ruta del webhook de Telegram (eso pasa solo en api/index.ts,
// el entrypoint de Vercel). Si el webhook se registrara aca, grammy deshabilita bot.start()
// para siempre en este proceso (es una proteccion propia de la libreria para no correr el
// bot en los dos modos a la vez) y romperia el modo local con polling que usa index.ts.
export const app = express();
// Limite mas alto que el de fabrica (100 KB) para poder subir las fotos del catalogo.
app.use(express.json({ limit: "4mb" }));
// Para que req.ip sea la IP real de quien entra (en Vercel llega en el header X-Forwarded-For)
// y no la del proxy de Vercel: la usa el freno de intentos fallidos de abajo.
app.set("trust proxy", true);

// ---------- autenticacion ----------
// El HTML/CSS/JS estatico se sirve libre (no tiene datos, es solo la pantalla). La propia
// pagina pide la clave con un formulario propio y la manda como header Authorization en
// cada llamada a la API; solo /api/* exige esa clave.

// Freno contra probar claves a lo loco: despues de MAX_INTENTOS_FALLIDOS claves incorrectas
// desde una misma IP, esa IP queda bloqueada hasta que pasen 15 minutos desde el primer fallo.
// (En Vercel esto vive en la memoria de cada instancia, asi que no es perfecto, pero igual
// vuelve impractico probar miles de claves.)
const MAX_INTENTOS_FALLIDOS = 10;
const VENTANA_INTENTOS_MS = 15 * 60 * 1000;
const intentosFallidos = new Map<string, { cantidad: number; desde: number }>();

function intentosVigentes(ip: string) {
  const registro = intentosFallidos.get(ip);
  if (registro && Date.now() - registro.desde > VENTANA_INTENTOS_MS) {
    intentosFallidos.delete(ip);
    return undefined;
  }
  return registro;
}

function anotarIntentoFallido(ip: string) {
  // Para que el mapa no crezca sin limite si llegan intentos desde muchisimas IPs distintas.
  if (intentosFallidos.size > 5000) intentosFallidos.clear();
  const registro = intentosVigentes(ip);
  if (registro) registro.cantidad++;
  else intentosFallidos.set(ip, { cantidad: 1, desde: Date.now() });
}

// El header es "Basic base64(usuario:clave)". Se corta en el PRIMER ":" (el usuario no tiene),
// asi una clave que tenga ":" adentro no se rompe.
function claveDelHeader(header: string | undefined): string | null {
  if (!header?.startsWith("Basic ")) return null;
  const decodificado = Buffer.from(header.slice(6), "base64").toString("utf8");
  const dosPuntos = decodificado.indexOf(":");
  return dosPuntos === -1 ? null : decodificado.slice(dosPuntos + 1);
}

app.use("/api", (req, res, next) => {
  // El webhook de Telegram (registrado aparte, en api/index.ts) no manda esta clave: Telegram
  // se autentica solo con su propio secretToken, verificado por grammy en su propio handler.
  if (req.path === "/telegram-webhook") return next();
  // El chequeo automatico del webhook (GitHub Actions, cada 30 min) tampoco tiene la clave del
  // panel: se autentica con su propio CRON_SECRET, verificado en api/index.ts.
  if (req.path === "/cron/verificar-webhook") return next();
  // El catalogo y sus fotos son publicos a proposito (son para clientes): solo devuelven lo
  // que un cliente puede ver, ver listarCatalogo en repo.ts.
  if (req.path === "/catalogo" || req.path.startsWith("/catalogo/")) return next();
  const ip = req.ip ?? "desconocida";
  if ((intentosVigentes(ip)?.cantidad ?? 0) >= MAX_INTENTOS_FALLIDOS) {
    return res.status(429).json({ ok: false, error: "Demasiados intentos con clave incorrecta. Esperá 15 minutos y probá de nuevo." });
  }
  const clave = claveDelHeader(req.headers.authorization);
  if (clave !== null && claveCoincide(clave, PANEL_PASSWORD)) return next();
  anotarIntentoFallido(ip);
  res.status(401).json({ ok: false, error: "Clave incorrecta o faltante." });
});

function envolver(handler: (req: express.Request) => any) {
  return async (req: express.Request, res: express.Response) => {
    try {
      const resultado = await handler(req);
      res.json(resultado ?? { ok: true });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message ?? String(e) });
    }
  };
}

// ---------- productos ----------
app.get("/api/productos", envolver(() => repo.listarProductos()));
app.post("/api/productos", envolver((req) => repo.agregarProducto(req.body)));
app.put("/api/productos/:id", envolver((req) => repo.actualizarProductoPorId(Number(req.params.id), req.body)));

// ---------- personas / empleados ----------
app.get("/api/personas", envolver(() => repo.listarPersonas()));
app.put("/api/personas/:id", envolver((req) => repo.actualizarPersonaPorId(Number(req.params.id), req.body)));
app.get("/api/empleados", envolver(() => repo.listarEmpleados()));
app.post("/api/empleados", envolver((req) => repo.agregarEmpleado(req.body)));

// ---------- prestamos ----------
app.get("/api/prestamos", envolver(() => repo.listarPrestamos()));
app.post("/api/prestamos", envolver((req) => repo.registrarPrestamo(req.body)));
app.put("/api/prestamos/:id", envolver((req) => repo.actualizarPrestamoPorId(Number(req.params.id), req.body)));
app.post("/api/prestamos/:id/pagos", envolver((req) => repo.registrarPagoPrestamoPorId(Number(req.params.id), req.body.monto, req.body.nota)));
app.get("/api/prestamos/:id/pagos", envolver((req) => repo.listarPagosDePrestamo(Number(req.params.id))));

// ---------- plan canje ----------
app.get("/api/canjes", envolver(() => repo.listarCanjes()));
app.post("/api/canjes", envolver((req) => repo.agregarCanje(req.body)));
app.put("/api/canjes/:id", envolver((req) => repo.actualizarCanjePorId(Number(req.params.id), req.body)));

// ---------- pedidos pendientes (clientes por WhatsApp) ----------
app.get("/api/pedidos", envolver((req) => repo.listarPedidosPendientes(req.query.pendientes === "1")));
app.post("/api/pedidos/:id/aprobar", envolver((req) => repo.aprobarPedidoPendiente(Number(req.params.id))));
app.post("/api/pedidos/:id/rechazar", envolver((req) => repo.rechazarPedidoPendiente(Number(req.params.id), req.body?.motivo)));

// ---------- ventas / resumen ----------
app.post("/api/ventas", envolver((req) => repo.registrarVenta(req.body)));
app.delete("/api/ventas/:id", envolver((req) => repo.anularVenta({ venta_id: Number(req.params.id) })));
app.get(
  "/api/ventas",
  envolver(async (req) => {
    const filtros = {
      desde: typeof req.query.desde === "string" ? req.query.desde : undefined,
      hasta: typeof req.query.hasta === "string" ? req.query.hasta : undefined,
      nombre_producto: typeof req.query.producto === "string" ? req.query.producto : undefined,
      nombre_cliente: typeof req.query.cliente === "string" ? req.query.cliente : undefined,
    };
    const [ventas, detalle] = await Promise.all([repo.consultarVentas(filtros), repo.listarMovimientosVenta(filtros)]);
    return {
      resumen: ventas.resumen_por_moneda,
      detalle,
    };
  })
);
app.get("/api/resumen", envolver(() => repo.consultarEstadoGeneral()));

// ---------- cotizacion del dolar (blue y cripto/USDT), con cache de 60s ----------
let dolarCache: { data: any; ts: number } | null = null;

async function obtenerDolar() {
  if (dolarCache && Date.now() - dolarCache.ts < 60_000) return dolarCache.data;
  const [blueResp, criptoResp] = await Promise.all([
    fetch("https://dolarapi.com/v1/dolares/blue"),
    fetch("https://dolarapi.com/v1/dolares/cripto"),
  ]);
  if (!blueResp.ok || !criptoResp.ok) throw new Error("No se pudo obtener la cotización del dólar.");
  const datos = { blue: await blueResp.json(), cripto: await criptoResp.json() };
  dolarCache = { data: datos, ts: Date.now() };
  return datos;
}

app.get("/api/dolar", envolver(() => obtenerDolar()));

// ---------- dashboards del Resumen, gastos y objetivos ----------
app.get(
  "/api/dashboard",
  envolver(async () => {
    const [datos, dolar] = await Promise.all([repo.datosDashboard(), obtenerDolar().catch(() => null)]);
    return { ...datos, dolar_blue_venta: dolar?.blue?.venta ?? null, categorias_gasto: repo.CATEGORIAS_GASTO };
  })
);
app.get("/api/gastos", envolver((req) => repo.listarGastos({ desde: req.query.desde as string, hasta: req.query.hasta as string })));
app.post("/api/gastos", envolver((req) => repo.registrarGasto(req.body)));
app.delete("/api/gastos/:id", envolver((req) => repo.anularGasto({ gasto_id: Number(req.params.id) })));
app.get("/api/objetivos", envolver(() => repo.listarObjetivos()));
app.put("/api/objetivos", envolver((req) => repo.guardarObjetivos(req.body)));

// ---------- catalogo publico (pagina /catalogo, para clientes, sin clave) ----------
app.get("/api/catalogo", async (_req, res) => {
  try {
    const [productos, dolar] = await Promise.all([repo.listarCatalogo(), obtenerDolar().catch(() => null)]);
    // Que Vercel lo guarde 60 s: si muchos clientes entran a la vez, no le pegan todos a la base.
    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300");
    res.json({
      tienda: {
        whatsapp: (process.env.CATALOGO_WHATSAPP || "").replace(/\D/g, "") || null,
      },
      dolar_blue_venta: dolar?.blue?.venta ?? null,
      productos,
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: "No se pudo cargar el catálogo." });
  }
});

// ---------- respuestas predefinidas ----------
app.get("/api/respuestas", envolver(() => repo.listarRespuestasPredefinidas()));
app.post("/api/respuestas", envolver((req) => repo.agregarRespuestaPredefinida(req.body)));
app.put("/api/respuestas/:id", envolver((req) => repo.actualizarRespuestaPredefinidaPorId(Number(req.params.id), req.body)));
app.delete("/api/respuestas/:id", envolver((req) => repo.eliminarRespuestaPredefinidaPorId(Number(req.params.id))));

// ---------- logs ----------
app.get("/api/logs", envolver((req) => repo.listarLogs(req.query.limite ? Number(req.query.limite) : undefined)));

// ---------- backup (descarga de todos los datos del negocio en un JSON) ----------
// Sirve tambien estando en Vercel, donde no se pueden guardar archivos de backup automaticos.
app.get("/api/backup", async (_req, res) => {
  try {
    const datos = await repo.exportarTodo();
    const fecha = repo.hoyEnArgentina();
    res.setHeader("Content-Disposition", `attachment; filename="backup-gestor-${fecha}.json"`);
    res.json(datos);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message ?? String(e) });
  }
});

// ---------- info del bot (para la pantalla "Como funciona") ----------
app.get(
  "/api/bot-info",
  envolver(() => ({
    herramientas: toolDefinitions.map((t) => ({ nombre: t.name, descripcion: t.description })),
    modelo: process.env.CLAUDE_MODEL || "claude-sonnet-5",
  }))
);

// ---------- estado / diagnostico ----------
app.get(
  "/api/estado-sistema",
  envolver(async () => {
    const baseOk = await repo.chequearConexionDb();

    let webhook: any = null;
    let webhookError: string | null = null;
    try {
      const resp = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
      const datos = await resp.json();
      webhook = datos.result ?? null;
    } catch (e: any) {
      webhookError = e.message ?? String(e);
    }

    return {
      base_de_datos: baseOk,
      webhook,
      webhook_error: webhookError,
      anthropic_configurado: !!process.env.ANTHROPIC_API_KEY,
      secreto_webhook_configurado: !!process.env.TELEGRAM_WEBHOOK_SECRET,
      hora_servidor: new Date().toISOString(),
    };
  })
);

// Foto de un producto del catalogo (publica). La url cambia cuando se reemplaza la foto, asi que
// se puede guardar en cache "para siempre".
app.get("/api/catalogo/fotos/:id", async (req, res) => {
  try {
    const foto = await repo.obtenerFotoCatalogo(Number(req.params.id));
    if (!foto) return res.status(404).end();
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.type(foto.mime).send(foto.datos);
  } catch {
    res.status(500).end();
  }
});

// ---------- publicaciones del catalogo (panel, con clave) ----------
app.get("/api/catalogo-items", envolver(() => repo.listarItemsCatalogo()));
app.post("/api/catalogo-items", envolver((req) => repo.crearItemCatalogo(req.body)));
app.put("/api/catalogo-items/:id", envolver((req) => repo.actualizarItemCatalogo(Number(req.params.id), req.body ?? {})));
app.delete("/api/catalogo-items/:id", envolver((req) => repo.eliminarItemCatalogo(Number(req.params.id))));
app.post("/api/catalogo-items/:id/mover", envolver((req) => repo.moverItemCatalogo(Number(req.params.id), req.body?.direccion === "arriba" ? "arriba" : "abajo")));

// ---------- fotos del catalogo (panel, con clave) ----------
app.get("/api/fotos-catalogo", envolver(() => repo.estadoFotosCatalogo()));
app.post("/api/fotos-catalogo", envolver((req) => repo.guardarFotoCatalogo(req.body)));
app.delete("/api/fotos-catalogo/:id", envolver((req) => repo.eliminarFotoCatalogo(Number(req.params.id))));

// ---------- frontend estatico ----------
// La pagina principal ("/", public/index.html) es el catalogo para clientes; el panel interno
// esta en /panel. /catalogo era la direccion vieja del catalogo: redirige a la principal para
// que no se rompan los links que ya se hayan pasado. (En Vercel lo mismo lo hace vercel.json.)
app.get("/panel", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "panel.html")));
app.get("/catalogo", (_req, res) => res.redirect(302, "/"));
app.use(express.static(path.join(__dirname, "..", "public")));

export function iniciarPanel() {
  app.listen(PANEL_PORT, "0.0.0.0", () => {
    console.log(`Catalogo en http://localhost:${PANEL_PORT} y panel en http://localhost:${PANEL_PORT}/panel (y en tu red local en ese mismo puerto).`);
  });
}
