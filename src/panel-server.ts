import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as repo from "./repo.js";
import { toolDefinitions } from "./tools.js";
import * as sesion from "./sesion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PANEL_PORT = Number(process.env.PANEL_PORT ?? 4000);

// OJO: si falta configurar el login con Google NO se corta el arranque: api/index.ts (Vercel)
// carga esta app junto con el webhook del bot, y un error aca tiraria abajo tambien al bot. En ese
// caso el panel simplemente no deja entrar a nadie y el login muestra que variables faltan.
const faltanAlArrancar = sesion.faltaConfigurar();
if (faltanAlArrancar.length) console.warn(`Login del panel sin configurar (falta ${faltanAlArrancar.join(", ")}): nadie va a poder entrar.`);

// OJO: esta app NO registra la ruta del webhook de Telegram (eso pasa solo en api/index.ts,
// el entrypoint de Vercel). Si el webhook se registrara aca, grammy deshabilita bot.start()
// para siempre en este proceso (es una proteccion propia de la libreria para no correr el
// bot en los dos modos a la vez) y romperia el modo local con polling que usa index.ts.
export const app = express();
// Limite mas alto que el de fabrica (100 KB) para poder subir las fotos del catalogo.
app.use(express.json({ limit: "4mb" }));
// Para que req.ip sea la IP real de quien entra (en Vercel llega en el header X-Forwarded-For)
// y no la del proxy de Vercel, y req.secure diga si fue por https (para la cookie de sesion).
app.set("trust proxy", true);

// ---------- registro de lo que anda mal ----------
// Cada pedido a /api que tarda mas de 3 s queda anotado en Logs (Sistema) como aviso. El webhook
// de Telegram y el cron no: el bot mide sus propios tiempos.
const UMBRAL_LENTO_MS = 3000;
app.use("/api", (req, res, next) => {
  const inicio = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - inicio;
    if (ms < UMBRAL_LENTO_MS || req.path === "/telegram-webhook" || req.path.startsWith("/cron/")) return;
    void repo.registrarEvento({
      nivel: "aviso",
      origen: "panel",
      evento: `Respuesta lenta: ${req.method} ${rutaDe(req)} tardó ${(ms / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} s`,
      duracion_ms: ms,
      ruta: `${req.method} ${rutaDe(req)}`,
    });
  });
  next();
});

// La ruta completa sin los parametros (?dias=7...), sea cual sea el app.use donde se mire.
function rutaDe(req: express.Request) {
  return (req.originalUrl || req.url).split("?")[0];
}

// Avisos que se pueden repetir mucho (ej: una cuenta no autorizada, el dolar caido): como mucho uno
// cada tantos minutos por cada clave, para no llenar los Logs con lo mismo.
const ultimoAviso = new Map<string, number>();
function puedeAvisar(clave: string, cadaMs: number) {
  const ahora = Date.now();
  if (ahora - (ultimoAviso.get(clave) ?? 0) < cadaMs) return false;
  if (ultimoAviso.size > 2000) ultimoAviso.clear();
  ultimoAviso.set(clave, ahora);
  return true;
}

// ---------- autenticacion ----------
// El HTML/CSS/JS estatico se sirve libre (no tiene datos, es solo la pantalla). Para usar la
// API hay que haber entrado con una cuenta de Google permitida (ver sesion.ts): el navegador
// manda solo la cookie de sesion en cada pedido.
app.use("/api", async (req, res, next) => {
  // El webhook de Telegram (registrado aparte, en api/index.ts) no usa la sesion: Telegram se
  // autentica solo con su propio secretToken, verificado por grammy en su propio handler.
  if (req.path === "/telegram-webhook") return next();
  // El chequeo automatico del webhook (GitHub Actions, cada 30 min) tampoco: se autentica con su
  // propio CRON_SECRET, verificado en api/index.ts.
  if (req.path === "/cron/verificar-webhook") return next();
  // El catalogo y sus fotos son publicos a proposito (son para clientes): solo devuelven lo
  // que un cliente puede ver, ver listarCatalogo en repo.ts.
  if (req.path === "/catalogo" || req.path.startsWith("/catalogo/")) return next();
  // Entrar y salir (y preguntar si hay sesion) obviamente no pueden exigir sesion.
  if (req.path === "/sesion" || req.path.startsWith("/sesion/")) return next();
  let actual;
  try {
    actual = await sesion.leerSesion(req.headers.cookie);
  } catch (e) {
    // La base no contesto y esta instancia no sabe todavia quien es quien: 503 (no 401, que en la
    // pagina significa "volve a entrar" y echaria a la persona sin motivo).
    if (e instanceof sesion.BaseSinResponder) return res.status(503).json({ ok: false, error: e.message });
    throw e;
  }
  if (actual) {
    res.locals.usuario = actual.email;
    res.locals.rol = actual.rol;
    return next();
  }
  res.status(401).json({ ok: false, error: "Tenés que entrar con tu cuenta de Google." });
});

// ---------- sesion (login con Google) ----------
// La pagina pregunta al cargar: si ya hay sesion entra directo; si no, muestra el login.
app.get("/api/sesion", async (req, res) => {
  let actual;
  try {
    actual = await sesion.leerSesion(req.headers.cookie);
  } catch (e) {
    if (e instanceof sesion.BaseSinResponder) return res.status(503).json({ ok: false, error: e.message });
    throw e;
  }
  res.json({
    ok: true,
    email: actual?.email ?? null,
    nombre: actual?.nombre ?? null,
    rol: actual?.rol ?? null,
    gestionaUsuarios: sesion.gestionaUsuarios(actual?.rol),
    googleClientId: sesion.googleClientId(),
    faltaConfigurar: sesion.faltaConfigurar(),
  });
});

// Freno contra los que prueban entrar a lo loco (codigos falsos o cuentas no autorizadas): despues
// de MAX_INTENTOS_FALLIDOS fallos desde una misma IP, esa IP no puede intentar de nuevo hasta que
// pasen 15 minutos desde el primer fallo. Asi tampoco se llena Logs ni se le pega sin fin a Google.
// (En Vercel vive en la memoria de cada instancia: no es perfecto, pero corta el abuso.)
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

const datosDelPedido = (req: express.Request) => `IP: ${req.ip ?? "desconocida"}\nNavegador: ${req.headers["user-agent"] ?? "-"}`;

// Recibe el codigo de un solo uso que Google le dio a la pagina y, si la cuenta esta permitida,
// deja la cookie de sesion.
app.post("/api/sesion/google", async (req, res) => {
  // Google pide este header en el modo popup: un formulario de otro sitio no lo puede mandar.
  if (req.headers["x-requested-with"] !== "XMLHttpRequest") return res.status(400).json({ ok: false, error: "Pedido inválido." });
  const faltan = sesion.faltaConfigurar();
  if (faltan.length) return res.status(503).json({ ok: false, error: `Falta configurar el login con Google en el servidor (${faltan.join(", ")}).` });
  const codigo = req.body?.code;
  if (typeof codigo !== "string" || !codigo) return res.status(400).json({ ok: false, error: "Falta el código de Google." });
  const ip = req.ip ?? "desconocida";
  if ((intentosVigentes(ip)?.cantidad ?? 0) >= MAX_INTENTOS_FALLIDOS) {
    if (puedeAvisar(`bloqueo:${ip}`, VENTANA_INTENTOS_MS)) {
      void repo.registrarEvento({ nivel: "error", origen: "seguridad", evento: `IP bloqueada 15 minutos por ${MAX_INTENTOS_FALLIDOS} intentos fallidos de entrar al panel`, detalle: datosDelPedido(req), ruta: "POST /api/sesion/google" });
    }
    return res.status(429).json({ ok: false, error: "Demasiados intentos fallidos. Esperá 15 minutos y probá de nuevo." });
  }
  let cuenta;
  try {
    cuenta = await sesion.cuentaDesdeCodigoGoogle(codigo);
  } catch (e: any) {
    anotarIntentoFallido(ip);
    // como mucho un aviso cada 10 minutos por IP: un robot mandando codigos falsos no llena Logs
    if (puedeAvisar(`google:${ip}`, 10 * 60 * 1000)) {
      void repo.registrarEvento({ nivel: "aviso", origen: "seguridad", evento: "Google no confirmó una cuenta al entrar al panel", detalle: `${datosDelPedido(req)}\n\n${String(e?.message ?? e)}`, ruta: "POST /api/sesion/google" });
    }
    return res.status(401).json({ ok: false, error: "Google no confirmó la cuenta. Probá de nuevo." });
  }
  let rol;
  try {
    rol = cuenta.verificado ? await sesion.rolDe(cuenta.email) : null;
  } catch (e) {
    if (e instanceof sesion.BaseSinResponder) return res.status(503).json({ ok: false, error: e.message });
    throw e;
  }
  if (!rol) {
    anotarIntentoFallido(ip);
    if (puedeAvisar(`cuenta:${cuenta.email}`, 10 * 60 * 1000)) {
      void repo.registrarEvento({ nivel: "aviso", origen: "seguridad", evento: `Intento de entrar al panel con una cuenta no autorizada: ${cuenta.email}`, detalle: datosDelPedido(req), ruta: "POST /api/sesion/google" });
    }
    return res.status(403).json({ ok: false, error: `La cuenta ${cuenta.email} no tiene permiso para entrar al panel.` });
  }
  intentosFallidos.delete(ip); // entro bien: se le perdonan los fallos anteriores
  res.setHeader("Set-Cookie", sesion.crearCookieSesion(cuenta, req.secure));
  void repo.registrarEvento({ nivel: "info", origen: "seguridad", evento: `Entró al panel: ${cuenta.email}`, detalle: datosDelPedido(req), usuario: cuenta.email, ruta: "POST /api/sesion/google" });
  void repo.registrarIngresoPanel(cuenta.email, cuenta.nombre).catch(() => {}); // para la columna "Ultimo ingreso" de Usuarios
  res.json({ ok: true, email: cuenta.email, nombre: cuenta.nombre, rol, gestionaUsuarios: sesion.gestionaUsuarios(rol) });
});

app.post("/api/sesion/salir", (req, res) => {
  res.setHeader("Set-Cookie", sesion.cookieBorrada(req.secure));
  res.json({ ok: true });
});

// Errores que no son "dato mal cargado" sino algo roto (la base no responde, un bug): van a Logs
// como error y con su detalle tecnico. Los de validacion ("ya existe ese producto") como aviso.
function esFallaInterna(e: any) {
  return e instanceof TypeError || e instanceof ReferenceError || e instanceof SyntaxError || /libsql|sqlite|fetch failed|ECONN|ETIMEDOUT/i.test(`${e?.name} ${e?.code} ${e?.message}`);
}

function envolver(handler: (req: express.Request, res: express.Response) => any) {
  return async (req: express.Request, res: express.Response) => {
    try {
      const resultado = await handler(req, res);
      res.json(resultado ?? { ok: true });
    } catch (e: any) {
      const interna = esFallaInterna(e);
      await repo.registrarEvento({
        nivel: interna ? "error" : "aviso",
        origen: "panel",
        evento: `${interna ? "Falló" : "Rechazado"}: ${req.method} ${rutaDe(req)} — ${String(e?.message ?? e).slice(0, 200)}`,
        detalle: interna ? e : req.body && Object.keys(req.body).length ? `Datos enviados: ${JSON.stringify(req.body).slice(0, 1500)}` : null,
        usuario: res.locals.usuario ?? null, // el mail de quien estaba en el panel
        ruta: `${req.method} ${rutaDe(req)}`,
      });
      res.status(interna ? 500 : 400).json({ ok: false, error: e.message ?? String(e) });
    }
  };
}

// ---------- usuarios del panel (duenos y admins) ----------
// Agregan, editan o sacan a quien puede entrar con su cuenta de Google, sin tocar Vercel. A los
// duenos (PANEL_EMAILS) no los toca nadie desde aca: ni siquiera estan en la tabla.
function soloGestionUsuarios(_req: express.Request, res: express.Response, next: express.NextFunction) {
  if (sesion.gestionaUsuarios(res.locals.rol)) return next();
  res.status(403).json({ ok: false, error: "Solo los dueños y los admins pueden manejar los usuarios." });
}

function mailDelPedido(req: express.Request) {
  return String(req.params.email ?? "").trim().toLowerCase();
}

app.get(
  "/api/usuarios",
  soloGestionUsuarios,
  envolver(async () => {
    const duenos = sesion.emailsDuenos();
    const ingresos = await repo.ingresosPanel(duenos);
    return {
      duenos: duenos.map((email) => {
        const ingreso = ingresos.find((i) => i.email === email);
        return { email, nombre_google: ingreso?.nombre ?? null, ultimo_ingreso: ingreso?.ultimo_ingreso ?? null };
      }),
      usuarios: await repo.listarUsuariosPanel(),
    };
  })
);

app.post(
  "/api/usuarios",
  soloGestionUsuarios,
  envolver(async (req, res) => {
    if (sesion.esDueno(String(req.body?.email ?? ""))) throw new Error("Ese mail es de un dueño: ya puede entrar siempre.");
    const resultado = await repo.agregarUsuarioPanel({ email: req.body?.email, nombre: req.body?.nombre, rol: req.body?.rol, agregado_por: res.locals.usuario });
    sesion.olvidarUsuariosEnCache();
    void repo.registrarEvento({ nivel: "info", origen: "seguridad", evento: `Usuario agregado al panel: ${resultado.email} (${resultado.rol})`, usuario: res.locals.usuario, ruta: "POST /api/usuarios" });
    return resultado;
  })
);

app.put(
  "/api/usuarios/:email",
  soloGestionUsuarios,
  envolver(async (req, res) => {
    const email = mailDelPedido(req);
    if (sesion.esDueno(email)) throw new Error("A un dueño no se lo puede cambiar desde el panel.");
    const resultado = await repo.editarUsuarioPanel(email, { nombre: req.body?.nombre, rol: req.body?.rol });
    sesion.olvidarUsuariosEnCache();
    if (resultado.rol !== resultado.rol_anterior) {
      void repo.registrarEvento({ nivel: "info", origen: "seguridad", evento: `Rol cambiado en el panel: ${email} (${resultado.rol_anterior} → ${resultado.rol})`, usuario: res.locals.usuario, ruta: "PUT /api/usuarios" });
    }
    return resultado;
  })
);

app.delete(
  "/api/usuarios/:email",
  soloGestionUsuarios,
  envolver(async (req, res) => {
    const email = mailDelPedido(req);
    if (sesion.esDueno(email)) throw new Error("A un dueño no se lo puede sacar desde el panel.");
    const resultado = await repo.quitarUsuarioPanel(email);
    sesion.olvidarUsuariosEnCache();
    void repo.registrarEvento({ nivel: "info", origen: "seguridad", evento: `Usuario quitado del panel: ${email}`, usuario: res.locals.usuario, ruta: "DELETE /api/usuarios" });
    return resultado;
  })
);

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
app.get("/api/canjes/:id/pagos", envolver((req) => repo.listarPagosDeCanje(Number(req.params.id))));
app.post("/api/canjes/:id/pagos", envolver((req) => repo.registrarPagoCanjePorId(Number(req.params.id), req.body ?? {})));
app.delete("/api/canjes/:id/pagos/:pagoId", envolver((req) => repo.anularPagoCanje(Number(req.params.id), Number(req.params.pagoId))));

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
  try {
    const [blueResp, criptoResp] = await Promise.all([
      fetch("https://dolarapi.com/v1/dolares/blue"),
      fetch("https://dolarapi.com/v1/dolares/cripto"),
    ]);
    if (!blueResp.ok || !criptoResp.ok) throw new Error(`dolarapi.com respondió ${blueResp.status}/${criptoResp.status}`);
    const datos = { blue: await blueResp.json(), cripto: await criptoResp.json() };
    dolarCache = { data: datos, ts: Date.now() };
    return datos;
  } catch (e: any) {
    if (puedeAvisar("dolar", 30 * 60 * 1000)) {
      await repo.registrarEvento({ nivel: "aviso", origen: "dolar", evento: "No se pudo obtener la cotización del dólar", detalle: e });
    }
    throw new Error("No se pudo obtener la cotización del dólar.");
  }
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
    // Que Vercel lo guarde un ratito: si muchos clientes entran a la vez (ej: desde una publicidad),
    // no le pegan todos a la base. Corto a proposito: lo que se cambia en el panel (ocultar una
    // publicacion, un precio) tiene que verse en el catalogo enseguida. Con estos valores, a mas
    // tardar en 30 s (10 de copia fresca + 20 sirviendo la vieja mientras se renueva). El navegador
    // no guarda nada (max-age=0): al recargar siempre pregunta.
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=10, stale-while-revalidate=20");
    res.json({
      tienda: {
        whatsapp: (process.env.CATALOGO_WHATSAPP || "").replace(/\D/g, "") || null,
        // usuario de Instagram sin la @ (ni la direccion entera, si la pegaron asi)
        instagram: (process.env.CATALOGO_INSTAGRAM || "").trim().replace(/^.*instagram\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "") || null,
      },
      dolar_blue_venta: dolar?.blue?.venta ?? null,
      productos,
    });
  } catch (e: any) {
    await repo.registrarEvento({ nivel: "error", origen: "catalogo", evento: "El catálogo público no pudo cargar", detalle: e, ruta: "GET /api/catalogo" });
    res.status(500).json({ ok: false, error: "No se pudo cargar el catálogo." });
  }
});

// ---------- notas (post-it) ----------
app.get("/api/notas", envolver(() => repo.listarNotas()));
app.post("/api/notas", envolver((req) => repo.crearNota(req.body ?? {})));
app.put("/api/notas/:id", envolver((req) => repo.actualizarNota(Number(req.params.id), req.body ?? {})));
app.delete("/api/notas/:id", envolver((req) => repo.borrarNota(Number(req.params.id))));

// ---------- respuestas predefinidas ----------
app.get("/api/respuestas", envolver(() => repo.listarRespuestasPredefinidas()));
app.post("/api/respuestas", envolver((req) => repo.agregarRespuestaPredefinida(req.body)));
app.put("/api/respuestas/:id", envolver((req) => repo.actualizarRespuestaPredefinidaPorId(Number(req.params.id), req.body)));
app.delete("/api/respuestas/:id", envolver((req) => repo.eliminarRespuestaPredefinidaPorId(Number(req.params.id))));

// ---------- logs ----------
const numeroQuery = (v: unknown) => (v == null || v === "" ? undefined : Number(v));
// Conversaciones del bot
app.get(
  "/api/logs",
  envolver((req) =>
    repo.listarLogs({
      limite: numeroQuery(req.query.limite),
      tipo: req.query.tipo as string,
      q: req.query.q as string,
      antes_de_id: numeroQuery(req.query.antes_de_id),
      dias: numeroQuery(req.query.dias),
    })
  )
);
// Eventos del sistema (errores, avisos, info) y el resumen de la cabecera
app.get(
  "/api/logs/sistema",
  envolver((req) =>
    repo.listarEventos({
      nivel: req.query.nivel as string,
      origen: req.query.origen as string,
      q: req.query.q as string,
      dias: numeroQuery(req.query.dias),
      antes_de_id: numeroQuery(req.query.antes_de_id),
      limite: numeroQuery(req.query.limite),
    })
  )
);
app.get("/api/logs/resumen", envolver((req) => repo.resumenLogs(numeroQuery(req.query.dias))));
// Errores de la pagina del panel (los manda el navegador): como mucho 20 por hora por conexion.
app.post(
  "/api/logs/web",
  envolver(async (req) => {
    const ip = req.ip ?? "desconocida";
    const cuenta = (contadorErroresWeb.get(ip) ?? []).filter((t) => Date.now() - t < 60 * 60 * 1000);
    if (cuenta.length >= 20) return { ok: true, ignorado: true };
    cuenta.push(Date.now());
    contadorErroresWeb.set(ip, cuenta);
    const b = req.body ?? {};
    await repo.registrarEvento({
      nivel: "error",
      origen: "web",
      evento: `Error en la página del panel: ${String(b.mensaje ?? "sin mensaje").slice(0, 200)}`,
      detalle: [`Página: ${String(b.url ?? "-").slice(0, 200)}`, `Navegador: ${req.headers["user-agent"] ?? "-"}`, String(b.detalle ?? "").slice(0, 3000)].join("\n"),
      ruta: String(b.seccion ?? "").slice(0, 60) || null,
    });
    return { ok: true };
  })
);
const contadorErroresWeb = new Map<string, number[]>();

// ---------- backup (descarga de todos los datos del negocio en un JSON) ----------
// Sirve tambien estando en Vercel, donde no se pueden guardar archivos de backup automaticos.
app.get("/api/backup", async (_req, res) => {
  try {
    const datos = await repo.exportarTodo();
    const fecha = repo.hoyEnArgentina();
    res.setHeader("Content-Disposition", `attachment; filename="backup-gestor-${fecha}.json"`);
    res.json(datos);
  } catch (e: any) {
    await repo.registrarEvento({ nivel: "error", origen: "panel", evento: "No se pudo descargar el backup", detalle: e, ruta: "GET /api/backup" });
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
      await repo.registrarEvento({ nivel: "aviso", origen: "telegram", evento: "No se pudo consultar el estado del webhook de Telegram", detalle: e });
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
  } catch (e: any) {
    await repo.registrarEvento({ nivel: "error", origen: "catalogo", evento: `No se pudo servir la foto #${req.params.id} del catálogo`, detalle: e, ruta: "GET /api/catalogo/fotos" });
    res.status(500).end();
  }
});

// ---------- publicaciones del catalogo (panel, con clave) ----------
app.get("/api/catalogo-items", envolver(() => repo.listarItemsCatalogo()));
app.get("/api/catalogo-items/detectar", envolver((req) => repo.detectarMarcaYModelo(String(req.query.nombre ?? ""))));
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
// Paginas legales del catalogo (los links estan al pie)
app.get("/terminos", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "terminos.html")));
app.get("/privacidad", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "privacidad.html")));
app.use(express.static(path.join(__dirname, "..", "public")));

export function iniciarPanel() {
  app.listen(PANEL_PORT, "0.0.0.0", () => {
    console.log(`Catalogo en http://localhost:${PANEL_PORT} y panel en http://localhost:${PANEL_PORT}/panel (y en tu red local en ese mismo puerto).`);
  });
}
