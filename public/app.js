// Panel de Gestor Mayorista: vanilla JS, sin build step. Todo pega directo contra la API en /api/*.

// ---------- utilidades ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

function limpiarVacios(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === "" || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

// Si el sistema pide "reducir movimiento", las animaciones hechas con JS (contadores, cierre
// de dialogos, scroll suave) tambien se saltean. Las de CSS las apaga styles.css.
function sinAnimaciones() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const NOMBRE_MONEDA = { USD: "Dólares", ARS: "Pesos" };
const SIMBOLO_MONEDA = { USD: "U$D", ARS: "$" };

function formatoNumero(n) {
  return Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

function formatoMoneda(n, moneda) {
  if (n == null) return "-";
  return `${formatoNumero(n)}${moneda ? " " + moneda : ""}`;
}

// Formato "a la argentina": simbolo adelante, ej "U$D 8.494,5" o "$ 606.049".
function formatoConSimbolo(n, moneda) {
  if (n == null) return "-";
  const simbolo = SIMBOLO_MONEDA[moneda];
  return simbolo ? `${simbolo} ${formatoNumero(n)}` : formatoNumero(n);
}

// "U$D 500 · $ 210.000" a partir de { USD: 500, ARS: 210000 } (saltea las monedas en 0).
function totalesPorMoneda(totales) {
  return Object.entries(totales)
    .filter(([, v]) => v)
    .map(([m, v]) => formatoConSimbolo(v, m))
    .join(" · ");
}

// La base guarda fechas como "2026-10-07 23:33:33" (hora local): se muestran "07/10/26 23:33".
// Se arma a mano (sin new Date) para no correr la hora por la zona horaria del navegador.
function formatoFecha(s, conHora = true) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s ?? ""));
  if (!m) return escapeHtml(s ?? "-");
  const [, anio, mes, dia, hh, mm] = m;
  const fecha = `${dia}/${mes}/${anio.slice(2)}`;
  return `<span class="fecha">${fecha}${conHora && hh ? `<small>${hh}:${mm}</small>` : ""}</span>`;
}

function plural(n, singular, pluralTexto = singular + "s") {
  return `${formatoNumero(n)} ${n === 1 ? singular : pluralTexto}`;
}

function ponerSubtitulo(id, texto) {
  const el = document.getElementById(id);
  if (el) el.textContent = texto;
}

const ICONO_LAPIZ = `<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
const ICONO_TACHO = `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;
const ICONO_OK = `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const ICONO_ERROR = `<svg viewBox="0 0 24 24"><path d="M12 7v6"/><path d="M12 17h.01"/></svg>`;
const ICONO_VACIO = `<svg viewBox="0 0 24 24"><path d="M3 13h5l2 3h4l2-3h5"/><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/></svg>`;
const ICONO_ANTERIOR = `<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>`;
const ICONO_SIGUIENTE = `<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>`;
const ICONOS_KPI = {
  productos: `<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>`,
  unidades: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  prestamos: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M9.5 9.5a2.5 2.5 0 0 1 2.5-1.5c1.4 0 2.5.9 2.5 2s-1.1 1.8-2.5 2c-1.4.2-2.5.9-2.5 2s1.1 2 2.5 2a2.5 2.5 0 0 0 2.5-1.5"/></svg>`,
  canjes: `<svg viewBox="0 0 24 24"><path d="M20.6 12.3 12.7 20a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1 0-2.8L10.9 2.5H18a2 2 0 0 1 2 2v7.1z"/><circle cx="15" cy="7" r="1.3"/></svg>`,
};

function estadoVacio(mensaje) {
  return `<div class="estado-vacio">${ICONO_VACIO}<span>${escapeHtml(mensaje)}</span></div>`;
}

// ---------- login (la clave se guarda en sessionStorage del navegador, se manda como header en cada llamada) ----------
// btoa solo acepta caracteres "latinos" de 1 byte: se pasa la clave a UTF-8 antes, asi una clave
// con tildes, ñ o emojis funciona igual que en el servidor (que la lee como UTF-8).
function headerConClave(clave) {
  const bytes = new TextEncoder().encode("gestor:" + clave);
  return "Basic " + btoa(String.fromCharCode(...bytes));
}

function authHeader() {
  const clave = sessionStorage.getItem("panel_clave");
  return clave ? headerConClave(clave) : null;
}

// Devuelve el codigo HTTP: 200 = clave correcta, 401 = incorrecta, 429 = demasiados intentos.
async function probarClave(clave) {
  const resp = await fetch("/api/resumen", { headers: { Authorization: headerConClave(clave) } });
  return resp.status;
}

async function iniciarLogin() {
  const overlay = document.getElementById("login-overlay");
  const claveGuardada = sessionStorage.getItem("panel_clave");
  if (claveGuardada && (await probarClave(claveGuardada).catch(() => 0)) === 200) {
    mostrarApp();
    return;
  }
  sessionStorage.removeItem("panel_clave");
  overlay.classList.remove("verificando");
  document.getElementById("login-clave").focus();
}

function mostrarApp() {
  const overlay = document.getElementById("login-overlay");
  overlay.classList.add("saliendo");
  setTimeout(() => overlay.classList.add("oculto"), sinAnimaciones() ? 0 : 450);
  document.getElementById("app-shell").classList.remove("oculto");
  cargarResumen();
  cargarListaPersonas();
  cargarListaProductos();
  actualizarBadgePedidos();
}

document.getElementById("form-login").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const clave = document.getElementById("login-clave").value;
  const error = document.getElementById("login-error");
  await conCarga(form.querySelector("button[type=submit]"), async () => {
    const estado = await probarClave(clave).catch(() => 0);
    if (estado === 200) {
      sessionStorage.setItem("panel_clave", clave);
      mostrarApp();
      return;
    }
    error.textContent =
      estado === 429
        ? "Demasiados intentos con clave incorrecta. Esperá 15 minutos y probá de nuevo."
        : estado === 401
          ? "Clave incorrecta."
          : "No me pude conectar con el servidor. Probá de nuevo.";
    error.classList.remove("oculto");
    form.classList.remove("sacudir");
    void form.offsetWidth; // reinicia la animacion si ya se habia sacudido antes
    form.classList.add("sacudir");
    document.getElementById("login-clave").select();
  });
});

// ---------- avisos (toast) ----------
let temporizadorToast = null;

function mostrarToast(mensaje, esError = false) {
  const toast = document.getElementById("toast");
  toast.innerHTML = `${esError ? ICONO_ERROR : ICONO_OK}<span>${escapeHtml(mensaje)}</span>`;
  toast.className = esError ? "error" : "ok";
  void toast.offsetWidth;
  toast.classList.add("mostrar");
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => toast.classList.remove("mostrar"), esError ? 5000 : 3200);
}

// ---------- llamadas a la API ----------
async function api(metodo, url, body) {
  const opciones = { method: metodo, headers: {} };
  const auth = authHeader();
  if (auth) opciones.headers["Authorization"] = auth;
  if (body !== undefined) {
    opciones.headers["Content-Type"] = "application/json";
    opciones.body = JSON.stringify(body);
  }
  const resp = await fetch(url, opciones);
  if (resp.status === 401) {
    sessionStorage.removeItem("panel_clave");
    location.reload();
    throw new Error("Sesion vencida, volve a entrar la clave.");
  }
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(datos.error ?? `Error ${resp.status}`);
  return datos;
}

// Mientras corre una accion, el boton muestra un spinner y no se puede volver a apretar (asi
// un doble clic no registra dos veces la misma venta).
async function conCarga(boton, fn) {
  if (!boton) return fn();
  if (boton.classList.contains("cargando")) return;
  boton.classList.add("cargando");
  boton.disabled = true;
  try {
    return await fn();
  } finally {
    boton.classList.remove("cargando");
    boton.disabled = false;
  }
}

// ---------- dialogos ----------
function abrirDialogo(id) {
  const dialogo = document.getElementById(id);
  dialogo.querySelector("form")?.reset();
  dialogo.classList.remove("cerrando");
  dialogo.showModal();
}

// Cierra con una animacion corta de salida (el <dialog> nativo se cierra de golpe).
function cerrarDialogo(idOElemento) {
  const dialogo = typeof idOElemento === "string" ? document.getElementById(idOElemento) : idOElemento;
  if (!dialogo.open || dialogo.classList.contains("cerrando")) return;
  if (sinAnimaciones()) return dialogo.close();
  dialogo.classList.add("cerrando");
  setTimeout(() => {
    dialogo.classList.remove("cerrando");
    dialogo.close();
  }, 170);
}

// Escape y clic afuera del dialogo tambien cierran con animacion.
document.querySelectorAll("dialog").forEach((dialogo) => {
  dialogo.addEventListener("cancel", (ev) => {
    ev.preventDefault();
    cerrarDialogo(dialogo);
  });
  let presionoAfuera = false;
  const estaAfuera = (ev) => {
    const r = dialogo.getBoundingClientRect();
    return ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
  };
  dialogo.addEventListener("mousedown", (ev) => (presionoAfuera = ev.target === dialogo && estaAfuera(ev)));
  dialogo.addEventListener("click", (ev) => {
    if (presionoAfuera && ev.target === dialogo && estaAfuera(ev)) cerrarDialogo(dialogo);
    presionoAfuera = false;
  });
});

// Confirmacion propia (en vez de confirm()/prompt() del navegador). Devuelve una promesa:
// false si se cancela; true (o { motivo } si se pidio motivo) si se acepta.
function confirmar({ titulo, mensaje, textoBoton = "Confirmar", peligro = false, pedirMotivo = false }) {
  const dialogo = document.getElementById("dialogo-confirmar");
  const form = document.getElementById("form-confirmar");
  const aceptar = document.getElementById("confirmar-aceptar");
  const cancelar = document.getElementById("confirmar-cancelar");
  form.reset();
  document.getElementById("confirmar-titulo").textContent = titulo;
  document.getElementById("confirmar-mensaje").textContent = mensaje ?? "";
  document.getElementById("confirmar-motivo").classList.toggle("oculto", !pedirMotivo);
  aceptar.textContent = textoBoton;
  aceptar.classList.toggle("btn-peligro", peligro);
  dialogo.classList.remove("cerrando");
  dialogo.showModal();
  (pedirMotivo ? form.elements.motivo : aceptar).focus();

  return new Promise((resolve) => {
    let resuelto = false;
    const terminar = (valor) => {
      if (resuelto) return;
      resuelto = true;
      form.removeEventListener("submit", alAceptar);
      cancelar.removeEventListener("click", alCancelar);
      dialogo.removeEventListener("close", alCerrar);
      cerrarDialogo(dialogo);
      resolve(valor);
    };
    const alAceptar = (ev) => {
      ev.preventDefault();
      terminar(pedirMotivo ? { motivo: form.elements.motivo.value.trim() } : true);
    };
    const alCancelar = () => terminar(false);
    const alCerrar = () => terminar(false); // Escape o clic afuera
    form.addEventListener("submit", alAceptar);
    cancelar.addEventListener("click", alCancelar);
    dialogo.addEventListener("close", alCerrar);
  });
}

// ---------- tablas paginadas (10 por pagina) ----------
// Cada tabla guarda sus datos completos y en que pagina esta; al recargar los datos (ej:
// despues de editar algo) se queda en la misma pagina, salvo que ya no exista.
const POR_PAGINA = 10;
const estadoTablas = {};

function renderTabla(idTabla, items, renderFila, mensajeVacio) {
  const estado = (estadoTablas[idTabla] ??= { pagina: 1 });
  Object.assign(estado, { items, renderFila, mensajeVacio });
  dibujarTabla(idTabla);
}

function dibujarTabla(idTabla) {
  const estado = estadoTablas[idTabla];
  const tabla = document.getElementById(idTabla);
  const totalPaginas = Math.max(1, Math.ceil(estado.items.length / POR_PAGINA));
  estado.pagina = Math.min(Math.max(estado.pagina, 1), totalPaginas);
  const desde = (estado.pagina - 1) * POR_PAGINA;
  const visibles = estado.items.slice(desde, desde + POR_PAGINA);
  const columnas = tabla.querySelectorAll("thead th").length;
  tabla.querySelector("tbody").innerHTML = visibles.length
    ? visibles.map(estado.renderFila).join("")
    : `<tr class="fila-vacia"><td colspan="${columnas}">${estadoVacio(estado.mensajeVacio)}</td></tr>`;
  dibujarPaginador(idTabla, tabla, estado.pagina, totalPaginas, estado.items.length, desde, visibles.length);
}

// Numeros de pagina a mostrar: siempre la primera, la ultima, y las vecinas de la actual
// (ej: 1 … 4 5 6 … 12). null = "…". Si el "…" taparia una sola pagina, se muestra esa pagina.
function paginasVisibles(actual, total) {
  const visible = (p) => p === 1 || p === total || Math.abs(p - actual) <= 1;
  const paginas = [];
  for (let p = 1; p <= total; p++) {
    if (visible(p) || (visible(p - 1) && visible(p + 1))) paginas.push(p);
    else if (paginas[paginas.length - 1] !== null) paginas.push(null);
  }
  return paginas;
}

function dibujarPaginador(idTabla, tabla, actual, totalPaginas, totalItems, desde, cantidadVisible) {
  const wrap = tabla.closest(".tabla-wrap");
  let paginador = wrap.nextElementSibling?.classList.contains("paginador") ? wrap.nextElementSibling : null;
  // Con una sola pagina no hace falta paginador.
  if (totalPaginas <= 1) {
    paginador?.remove();
    return;
  }
  if (!paginador) {
    paginador = document.createElement("div");
    paginador.className = "paginador";
    wrap.after(paginador);
  }
  const botones = paginasVisibles(actual, totalPaginas)
    .map((p) =>
      p === null
        ? `<span class="pagina-puntos">…</span>`
        : `<button type="button" class="pagina-btn${p === actual ? " actual" : ""}" ${p === actual ? 'aria-current="page"' : ""} onclick="irAPagina('${idTabla}', ${p})">${p}</button>`
    )
    .join("");
  paginador.innerHTML = `
    <span class="paginador-info">Mostrando <strong>${desde + 1}–${desde + cantidadVisible}</strong> de <strong>${formatoNumero(totalItems)}</strong></span>
    <div class="paginador-botones">
      <button type="button" class="pagina-btn" aria-label="Página anterior" ${actual === 1 ? "disabled" : ""} onclick="irAPagina('${idTabla}', ${actual - 1})">${ICONO_ANTERIOR}</button>
      ${botones}
      <button type="button" class="pagina-btn" aria-label="Página siguiente" ${actual === totalPaginas ? "disabled" : ""} onclick="irAPagina('${idTabla}', ${actual + 1})">${ICONO_SIGUIENTE}</button>
    </div>`;
}

function irAPagina(idTabla, pagina) {
  estadoTablas[idTabla].pagina = pagina;
  dibujarTabla(idTabla);
  // Si la tabla quedo arriba fuera de la vista (se estaba mirando el final), se sube hasta ella.
  const wrap = document.getElementById(idTabla).closest(".tabla-wrap");
  const arriba = wrap.getBoundingClientRect().top;
  if (arriba < 80) window.scrollBy({ top: arriba - 90, behavior: sinAnimaciones() ? "auto" : "smooth" });
}

// La primera vez que se abre una tabla, mientras llegan los datos se ven filas "esqueleto"
// (en vez de una tabla vacia que de golpe se llena). Si ya tenia datos, se dejan esos.
function mostrarEsqueleto(idTabla, filas = 5) {
  const tabla = document.getElementById(idTabla);
  const tbody = tabla.querySelector("tbody");
  if (tbody.children.length) return;
  const columnas = tabla.querySelectorAll("thead th").length;
  tbody.innerHTML = Array.from(
    { length: filas },
    () => `<tr class="fila-esqueleto">${"<td><span class=\"esqueleto\"></span></td>".repeat(columnas)}</tr>`
  ).join("");
}

// ---------- numeros que "cuentan" hasta su valor ----------
// Arranca desde el ultimo valor mostrado (la primera vez desde 0), asi al volver a una seccion
// sin cambios los numeros no se reanimian, y si algo cambio se ve el salto.
const ultimosValores = new Map();

function animarContadores(contenedor) {
  contenedor.querySelectorAll("[data-contar]").forEach((el) => {
    const valor = Number(el.dataset.contar);
    const moneda = el.dataset.moneda || null;
    const clave = el.dataset.clave;
    const formatear = (v) => (moneda ? formatoConSimbolo(v, moneda) : formatoNumero(v));
    const desde = ultimosValores.get(clave) ?? 0;
    ultimosValores.set(clave, valor);
    if (sinAnimaciones() || desde === valor) {
      el.textContent = formatear(valor);
      return;
    }
    const inicio = performance.now();
    const duracion = 750;
    const paso = (ahora) => {
      const t = Math.min((ahora - inicio) / duracion, 1);
      const suavizado = 1 - Math.pow(1 - t, 3);
      el.textContent = t < 1 ? formatear(Math.round(desde + (valor - desde) * suavizado)) : formatear(valor);
      if (t < 1) requestAnimationFrame(paso);
    };
    el.textContent = formatear(desde);
    requestAnimationFrame(paso);
  });
}

function contador(clave, valor, moneda) {
  return `<span data-contar="${Number(valor) || 0}" data-clave="${clave}"${moneda ? ` data-moneda="${moneda}"` : ""}>${moneda ? formatoConSimbolo(0, moneda) : "0"}</span>`;
}

// ---------- etiquetas de estado ----------
// Etiquetas en criollo para estados que en la base de datos son valores tecnicos (snake_case).
const ETIQUETAS_ESTADO_PRESTAMO = { activo: "Activo", parcial: "Pago parcial", pagado: "Pagado" };
const ETIQUETAS_ESTADO_CANJE = { pendiente: "Pendiente", saldado: "Saldado" };

function pillEstadoPrestamo(estado) {
  return `<span class="estado-pill estado-${estado}">${ETIQUETAS_ESTADO_PRESTAMO[estado] ?? estado}</span>`;
}

function pillEstadoCanje(estado) {
  const clase = estado === "saldado" ? "estado-pagado" : "estado-activo";
  return `<span class="estado-pill ${clase}">${ETIQUETAS_ESTADO_CANJE[estado] ?? estado}</span>`;
}

// saldo_monto: positivo = a favor del negocio (te tienen que dar), negativo = a favor del cliente (les debes).
function textoSaldo(c) {
  if (c.saldo_monto == null || c.saldo_monto === 0) return `<span class="texto-tenue">-</span>`;
  const monto = formatoConSimbolo(Math.abs(c.saldo_monto), c.saldo_moneda);
  return c.saldo_monto > 0
    ? `<span class="a-favor-negocio">Te deben ${monto}</span>`
    : `<span class="a-favor-cliente">Les debés ${monto}</span>`;
}

// ---------- secciones y menu ----------
const TITULOS_TAB = {
  resumen: "Resumen",
  stock: "Stock",
  ventas: "Ventas",
  pedidos: "Pedidos",
  prestamos: "Préstamos",
  prendas: "Plan Canje",
  empleados: "Empleados",
  bot: "Bot",
  logs: "Logs",
};

function irATab(tab) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("activo", b.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("oculto", p.id !== `tab-${tab}`));
  const titulo = document.getElementById("titulo-seccion");
  titulo.textContent = TITULOS_TAB[tab] ?? "";
  titulo.classList.remove("cambiando");
  void titulo.offsetWidth;
  titulo.classList.add("cambiando");
  window.scrollTo({ top: 0 });
  cargarTab(tab);
  cerrarMenu();
}

document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => irATab(btn.dataset.tab)));

// ---------- menu hamburguesa desplegable ----------
function abrirMenu() {
  document.getElementById("tabs").classList.add("abierto");
  document.getElementById("menu-backdrop").classList.add("visible");
  document.getElementById("btn-menu").classList.add("abierto");
  document.getElementById("btn-menu").setAttribute("aria-expanded", "true");
}

function cerrarMenu() {
  document.getElementById("tabs").classList.remove("abierto");
  document.getElementById("menu-backdrop").classList.remove("visible");
  document.getElementById("btn-menu").classList.remove("abierto");
  document.getElementById("btn-menu").setAttribute("aria-expanded", "false");
}

document.getElementById("btn-menu").addEventListener("click", () => {
  document.getElementById("tabs").classList.contains("abierto") ? cerrarMenu() : abrirMenu();
});
document.getElementById("menu-backdrop").addEventListener("click", cerrarMenu);
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") cerrarMenu();
});

function cargarTab(tab) {
  if (tab === "resumen") cargarResumen();
  if (tab === "stock") cargarProductos();
  if (tab === "ventas") cargarVentas();
  if (tab === "pedidos") cargarPedidos();
  if (tab === "prestamos") cargarPrestamos();
  if (tab === "prendas") cargarPrendas();
  if (tab === "empleados") cargarEmpleados();
  if (tab === "bot") {
    cargarEstadoSistema();
    cargarInfoBot();
    cargarRespuestas();
  }
  if (tab === "logs") cargarLogs();
}

async function cargarListaPersonas() {
  try {
    const personas = await api("GET", "/api/personas");
    const datalist = document.getElementById("lista-personas");
    datalist.innerHTML = personas.map((p) => `<option value="${escapeAttr(p.nombre)}">`).join("");
  } catch {}
}

async function cargarListaProductos() {
  try {
    const productos = await api("GET", "/api/productos");
    const datalist = document.getElementById("lista-productos");
    datalist.innerHTML = productos.map((p) => `<option value="${escapeAttr(p.nombre)}">`).join("");
  } catch {}
}

// ---------- resumen ----------
function tarjetaKpi(icono, etiqueta, clave, valor, detalle) {
  return `
    <div class="card">
      <div class="card-cabecera"><div class="label">${etiqueta}</div><div class="card-icono">${ICONOS_KPI[icono]}</div></div>
      <div class="valor">${contador(clave, valor)}</div>
      <div class="detalle" title="${escapeAttr(detalle)}">${escapeHtml(detalle)}</div>
    </div>`;
}

async function cargarResumen() {
  mostrarEsqueleto("tabla-resumen-prestamos", 3);
  mostrarEsqueleto("tabla-resumen-canjes", 3);
  try {
    const r = await api("GET", "/api/resumen");
    const cards = document.getElementById("resumen-cards");
    const unidades = r.productos.reduce((acc, p) => acc + p.cantidad, 0);
    const sinStock = r.productos.filter((p) => p.cantidad <= 0).length;

    // Valor de venta del stock, por moneda (solo productos con precio de venta cargado).
    const valorStock = {};
    for (const p of r.productos) {
      if (p.precio_venta != null && p.cantidad > 0) valorStock[p.moneda ?? "USD"] = (valorStock[p.moneda ?? "USD"] ?? 0) + p.precio_venta * p.cantidad;
    }
    const pendientePrestamos = {};
    for (const p of r.prestamos_activos) pendientePrestamos[p.moneda] = (pendientePrestamos[p.moneda] ?? 0) + p.monto_pendiente;
    const teDeben = {};
    const lesDebes = {};
    for (const c of r.canjes_pendientes) {
      if (!c.saldo_monto) continue;
      const destino = c.saldo_monto > 0 ? teDeben : lesDebes;
      destino[c.saldo_moneda] = (destino[c.saldo_moneda] ?? 0) + Math.abs(c.saldo_monto);
    }

    const detalleCanjes = [
      totalesPorMoneda(teDeben) && `Te deben ${totalesPorMoneda(teDeben)}`,
      totalesPorMoneda(lesDebes) && `Debés ${totalesPorMoneda(lesDebes)}`,
    ]
      .filter(Boolean)
      .join(" · ");

    cards.innerHTML = [
      tarjetaKpi("productos", "Productos distintos", "kpi-productos", r.productos.length, sinStock ? `${plural(sinStock, "producto")} sin stock` : "Todos con stock"),
      tarjetaKpi("unidades", "Unidades en stock", "kpi-unidades", unidades, totalesPorMoneda(valorStock) ? `Valor de venta: ${totalesPorMoneda(valorStock)}` : "Sin precios de venta cargados"),
      tarjetaKpi("prestamos", "Préstamos activos", "kpi-prestamos", r.prestamos_activos.length, totalesPorMoneda(pendientePrestamos) ? `Pendiente: ${totalesPorMoneda(pendientePrestamos)}` : "Nadie te debe plata"),
      tarjetaKpi("canjes", "Canjes pendientes", "kpi-canjes", r.canjes_pendientes.length, detalleCanjes || "Sin saldos pendientes"),
    ].join("");
    animarContadores(cards);

    ponerSubtitulo("sub-resumen-prestamos", r.prestamos_activos.length ? plural(r.prestamos_activos.length, "préstamo activo", "préstamos activos") : "");
    renderTabla(
      "tabla-resumen-prestamos",
      r.prestamos_activos,
      (p) => `<tr>
        <td data-etiqueta="Persona" class="texto-fuerte">${escapeHtml(p.persona_nombre)}</td>
        <td data-etiqueta="Pendiente" class="num">${formatoConSimbolo(p.monto_pendiente, p.moneda)}</td>
        <td data-etiqueta="Estado">${pillEstadoPrestamo(p.estado)}</td>
      </tr>`,
      "No hay préstamos activos."
    );

    ponerSubtitulo("sub-resumen-canjes", r.canjes_pendientes.length ? plural(r.canjes_pendientes.length, "canje pendiente", "canjes pendientes") : "");
    renderTabla(
      "tabla-resumen-canjes",
      r.canjes_pendientes,
      (c) => `<tr>
        <td data-etiqueta="Persona" class="texto-fuerte">${escapeHtml(c.persona_nombre)}</td>
        <td data-etiqueta="Celular">${escapeHtml(c.descripcion)}</td>
        <td data-etiqueta="Saldo" class="num">${textoSaldo(c)}</td>
      </tr>`,
      "No hay canjes pendientes."
    );
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

// ---------- stock ----------
let productosCache = [];

async function cargarProductos() {
  mostrarEsqueleto("tabla-productos");
  try {
    productosCache = await api("GET", "/api/productos");
    const unidades = productosCache.reduce((acc, p) => acc + p.cantidad, 0);
    ponerSubtitulo("sub-stock", productosCache.length ? `${plural(productosCache.length, "producto")} · ${plural(unidades, "unidad", "unidades")}` : "");
    renderTabla(
      "tabla-productos",
      productosCache,
      (p) => `
      <tr data-id="${p.id}">
        <td data-etiqueta="Nombre" class="texto-fuerte">${escapeHtml(p.nombre)}</td>
        <td data-etiqueta="Categoría">${p.categoria ? `<span class="etiqueta">${escapeHtml(p.categoria)}</span>` : `<span class="texto-tenue">-</span>`}</td>
        <td data-etiqueta="Cantidad" class="num ${p.cantidad <= 0 ? "negativo" : ""}">${formatoNumero(p.cantidad)}</td>
        <td data-etiqueta="Costo" class="num">${p.costo != null ? formatoConSimbolo(p.costo, p.moneda) : `<span class="texto-tenue">-</span>`}</td>
        <td data-etiqueta="Precio venta" class="num">${p.precio_venta != null ? formatoConSimbolo(p.precio_venta, p.moneda) : `<span class="texto-tenue">-</span>`}</td>
        <td class="acciones"><button class="btn-icono" title="Editar" aria-label="Editar ${escapeAttr(p.nombre)}" onclick="editarProducto(${p.id})">${ICONO_LAPIZ}</button></td>
      </tr>`,
      "Todavía no cargaste ningún producto."
    );
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

function abrirDialogoProducto() {
  abrirDialogo("dialogo-producto");
  const form = document.getElementById("form-producto");
  form.elements.id.value = "";
  document.getElementById("titulo-dialogo-producto").textContent = "Agregar stock";
  document.getElementById("boton-guardar-producto").textContent = "Generar stock";
}

function editarProducto(id) {
  const p = productosCache.find((x) => x.id === id);
  if (!p) return;
  abrirDialogo("dialogo-producto");
  const form = document.getElementById("form-producto");
  form.elements.id.value = p.id;
  form.elements.nombre.value = p.nombre;
  form.elements.categoria.value = p.categoria ?? "";
  form.elements.cantidad.value = p.cantidad;
  form.elements.costo.value = p.costo ?? "";
  form.elements.precio_venta.value = p.precio_venta ?? "";
  form.elements.moneda.value = p.moneda ?? "USD";
  document.getElementById("titulo-dialogo-producto").textContent = "Editar producto";
  document.getElementById("boton-guardar-producto").textContent = "Guardar cambios";
}

document.getElementById("form-producto").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target));
  const id = datos.id;
  delete datos.id;
  const body = limpiarVacios({ ...datos, cantidad: Number(datos.cantidad) });
  conCarga(ev.submitter, async () => {
    try {
      if (id) {
        await api("PUT", `/api/productos/${id}`, body);
        mostrarToast("Producto actualizado.");
      } else {
        await api("POST", "/api/productos", body);
        mostrarToast("Stock generado.");
      }
      cerrarDialogo("dialogo-producto");
      cargarProductos();
      cargarListaProductos();
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
});

// ---------- ventas ----------
document.getElementById("form-venta").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target));
  conCarga(ev.submitter, async () => {
    try {
      await api(
        "POST",
        "/api/ventas",
        limpiarVacios({ ...datos, cantidad: Number(datos.cantidad), precio_unitario: datos.precio_unitario ? Number(datos.precio_unitario) : undefined })
      );
      cerrarDialogo("dialogo-venta");
      mostrarToast("Venta generada.");
      cargarVentas();
      cargarListaProductos();
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
});

let ultimaCotizacionDolar = null; // { blue: {compra, venta, fechaActualizacion}, cripto: {...} }

function formatoGanancia(clave, valor, moneda) {
  if (valor == null) return "-";
  const clase = valor > 0 ? "a-favor-negocio" : valor < 0 ? "a-favor-cliente" : "";
  return `<span class="${clase}">${contador(clave, valor, moneda)}</span>`;
}

function filaDolar(etiqueta, d) {
  return `
      <div class="dolar-fila">
        <div class="dolar-icono">$</div>
        <div class="dolar-info">
          <strong>${etiqueta}</strong>
          <span>Compra ${formatoConSimbolo(d.compra, "ARS")} · Venta ${formatoConSimbolo(d.venta, "ARS")}</span>
        </div>
      </div>`;
}

async function cargarDolar() {
  const cont = document.getElementById("widget-dolar");
  try {
    const d = await api("GET", "/api/dolar");
    ultimaCotizacionDolar = d;
    const actualizado = new Date(d.blue.fechaActualizacion);
    cont.innerHTML = `
      ${filaDolar("Dólar blue", d.blue)}
      ${filaDolar("Dólar cripto (USDT)", d.cripto)}
      <span class="dolar-actualizado"><span class="punto-estado punto-ok"></span>Actualizado ${actualizado.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>
    `;
  } catch (e) {
    ultimaCotizacionDolar = null;
    cont.innerHTML = `
      <div class="dolar-fila">
        <div class="dolar-icono">$</div>
        <div class="dolar-info"><strong>Cotización del dólar</strong><span class="negativo">No se pudo obtener ahora. Se reintenta al volver a entrar.</span></div>
      </div>`;
  }
}

async function cargarVentas() {
  mostrarEsqueleto("tabla-ventas");
  try {
    const [r] = await Promise.all([api("GET", "/api/ventas"), cargarDolar()]);
    const paneles = document.getElementById("ventas-paneles");
    const monedas = Object.keys(r.resumen);

    let html = monedas.length
      ? monedas
          .map((m) => {
            const s = r.resumen[m];
            return `
      <div class="panel-moneda">
        <div class="panel-moneda-header">${NOMBRE_MONEDA[m] ?? m} <span class="etiqueta-moneda">${m}</span></div>
        <div class="panel-moneda-stats">
          <div><div class="label">Facturado</div><div class="valor">${contador(`ventas-${m}-facturado`, s.facturado, m)}</div></div>
          <div><div class="label">Unidades</div><div class="valor">${contador(`ventas-${m}-unidades`, s.unidades)}</div></div>
          <div><div class="label">Ganancia est.</div><div class="valor">${formatoGanancia(`ventas-${m}-ganancia`, s.ganancia_estimada, m)}</div></div>
        </div>
      </div>`;
          })
          .join("")
      : `<div class="panel-moneda">${estadoVacio("Todavía no hay ventas registradas.")}</div>`;

    if (monedas.includes("USD") && monedas.includes("ARS") && ultimaCotizacionDolar) {
      const promedio = (ultimaCotizacionDolar.blue.compra + ultimaCotizacionDolar.blue.venta) / 2;
      const facturadoTotalUSD = r.resumen.USD.facturado + r.resumen.ARS.facturado / promedio;
      const gananciaTotalUSD = r.resumen.USD.ganancia_estimada + r.resumen.ARS.ganancia_estimada / promedio;
      html += `
      <div class="panel-moneda panel-combinado">
        <div class="panel-moneda-header">Total combinado <span class="etiqueta-moneda">≈USD / ≈ARS</span></div>
        <div class="panel-moneda-stats">
          <div>
            <div class="label">Facturado equiv.</div>
            <div class="valor">${contador("ventas-comb-facturado", facturadoTotalUSD, "USD")}</div>
            <div class="valor-secundario">≈ ${formatoConSimbolo(Math.round(facturadoTotalUSD * promedio), "ARS")}</div>
          </div>
          <div>
            <div class="label">Ganancia equiv.</div>
            <div class="valor">${formatoGanancia("ventas-comb-ganancia", gananciaTotalUSD, "USD")}</div>
            <div class="valor-secundario">≈ ${formatoConSimbolo(Math.round(gananciaTotalUSD * promedio), "ARS")}</div>
          </div>
        </div>
        <div class="panel-moneda-nota">Usando el dólar blue promedio (${formatoConSimbolo(promedio, "ARS")}) para convertir.</div>
      </div>`;
    }

    paneles.innerHTML = html;
    animarContadores(paneles);

    ponerSubtitulo("sub-ventas", r.detalle.length ? plural(r.detalle.length, "venta registrada", "ventas registradas") : "");
    renderTabla(
      "tabla-ventas",
      r.detalle,
      (v) => `<tr>
        <td data-etiqueta="Fecha">${formatoFecha(v.fecha)}</td>
        <td data-etiqueta="Producto" class="texto-fuerte">${escapeHtml(v.producto_nombre)}</td>
        <td data-etiqueta="Cantidad" class="num">${formatoNumero(v.cantidad)}</td>
        <td data-etiqueta="Cliente">${v.persona_nombre ? escapeHtml(v.persona_nombre) : `<span class="texto-tenue">-</span>`}</td>
        <td data-etiqueta="Precio unit." class="num">${v.precio_unitario != null ? formatoConSimbolo(v.precio_unitario, v.moneda) : `<span class="texto-tenue">-</span>`}</td>
        <td data-etiqueta="Total" class="num texto-fuerte">${v.precio_unitario != null ? formatoConSimbolo(v.precio_unitario * v.cantidad, v.moneda) : `<span class="texto-tenue">-</span>`}</td>
        <td data-etiqueta="Nota" class="celda-texto texto-tenue">${escapeHtml(v.nota ?? "")}</td>
      </tr>`,
      "Todavía no hay ventas registradas."
    );
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

// ---------- pedidos pendientes (clientes por WhatsApp) ----------
const ETIQUETAS_ESTADO_PEDIDO = { pendiente: "Pendiente", aprobado: "Aprobado", rechazado: "Rechazado" };
function pillEstadoPedido(estado) {
  const clase = estado === "aprobado" ? "estado-pagado" : estado === "rechazado" ? "estado-rechazado" : "estado-activo";
  return `<span class="estado-pill ${clase}">${ETIQUETAS_ESTADO_PEDIDO[estado] ?? estado}</span>`;
}

async function actualizarBadgePedidos() {
  try {
    const pendientes = await api("GET", "/api/pedidos?pendientes=1");
    const badge = document.getElementById("badge-pedidos");
    if (pendientes.length) {
      badge.textContent = pendientes.length;
      badge.classList.remove("oculto");
    } else {
      badge.classList.add("oculto");
    }
  } catch {
    /* si falla, no pasa nada grave: se vuelve a intentar la proxima vez que se abra el panel */
  }
}

async function cargarPedidos() {
  mostrarEsqueleto("tabla-pedidos");
  try {
    const pedidos = await api("GET", "/api/pedidos");
    const pendientes = pedidos.filter((p) => p.estado === "pendiente").length;
    ponerSubtitulo("sub-pedidos", pedidos.length ? `${plural(pedidos.length, "pedido")} · ${plural(pendientes, "pendiente")}` : "");
    renderTabla(
      "tabla-pedidos",
      pedidos,
      (p) => `
      <tr>
        <td data-etiqueta="Fecha">${formatoFecha(p.creado_en)}</td>
        <td data-etiqueta="Cliente" class="texto-fuerte">${escapeHtml(p.cliente_nombre ?? p.cliente_telefono)}</td>
        <td data-etiqueta="Producto">${escapeHtml(p.producto)}</td>
        <td data-etiqueta="Cantidad" class="num">${formatoNumero(p.cantidad)}</td>
        <td data-etiqueta="Precio est." class="num">${p.precio_unitario != null ? formatoConSimbolo(p.precio_unitario, p.moneda) : `<span class="texto-tenue">-</span>`}</td>
        <td data-etiqueta="Estado">${pillEstadoPedido(p.estado)}</td>
        <td class="acciones">${
          p.estado === "pendiente"
            ? `<div class="acciones-fila">
                <button class="btn-chico guardar" onclick="aprobarPedido(${p.id}, this)">Aprobar</button>
                <button class="btn-chico rechazar" onclick="rechazarPedido(${p.id}, this)">Rechazar</button>
              </div>`
            : `<span class="texto-tenue">-</span>`
        }</td>
      </tr>`,
      "Todavía no hay pedidos de clientes."
    );
    actualizarBadgePedidos();
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

async function aprobarPedido(id, boton) {
  const ok = await confirmar({
    titulo: "¿Aprobar este pedido?",
    mensaje: "Se va a registrar como venta real y se descuenta del stock.",
    textoBoton: "Aprobar pedido",
  });
  if (!ok) return;
  await conCarga(boton, async () => {
    try {
      await api("POST", `/api/pedidos/${id}/aprobar`);
      mostrarToast("Pedido aprobado y registrado como venta.");
      cargarPedidos();
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
}

async function rechazarPedido(id, boton) {
  const respuesta = await confirmar({
    titulo: "¿Rechazar este pedido?",
    mensaje: "El pedido queda marcado como rechazado. No se toca el stock.",
    textoBoton: "Rechazar pedido",
    peligro: true,
    pedirMotivo: true,
  });
  if (!respuesta) return;
  await conCarga(boton, async () => {
    try {
      await api("POST", `/api/pedidos/${id}/rechazar`, { motivo: respuesta.motivo });
      mostrarToast("Pedido rechazado.");
      cargarPedidos();
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
}

// ---------- prestamos ----------
function celdaPendiente(p) {
  const pagado = p.monto_original > 0 ? Math.min(Math.max(1 - p.monto_pendiente / p.monto_original, 0), 1) : 0;
  return `<div class="progreso">
    <span class="progreso-texto ${p.monto_pendiente < 0 ? "negativo" : ""}">${formatoConSimbolo(p.monto_pendiente, p.moneda)}</span>
    <div class="progreso-barra" title="Pagado: ${Math.round(pagado * 100)}%"><span style="width:${(pagado * 100).toFixed(1)}%"></span></div>
    <span class="progreso-pie">${Math.round(pagado * 100)}% pagado</span>
  </div>`;
}

async function cargarPrestamos() {
  mostrarEsqueleto("tabla-prestamos");
  try {
    const prestamos = await api("GET", "/api/prestamos");
    const activos = prestamos.filter((p) => p.estado !== "pagado");
    const pendiente = {};
    for (const p of activos) pendiente[p.moneda] = (pendiente[p.moneda] ?? 0) + p.monto_pendiente;
    ponerSubtitulo(
      "sub-prestamos",
      prestamos.length ? `${plural(activos.length, "activo")}${activos.length ? ` · pendiente ${totalesPorMoneda(pendiente)}` : ""}` : ""
    );
    renderTabla(
      "tabla-prestamos",
      prestamos,
      (p) => `
      <tr data-id="${p.id}">
        <td data-etiqueta="#" class="num texto-tenue">${p.id}</td>
        <td data-etiqueta="Persona" class="texto-fuerte">${escapeHtml(p.persona_nombre)}</td>
        <td data-etiqueta="Original" class="num">${formatoConSimbolo(p.monto_original, p.moneda)}</td>
        <td data-etiqueta="Pendiente">${celdaPendiente(p)}</td>
        <td data-etiqueta="Estado">${pillEstadoPrestamo(p.estado)}</td>
        <td data-etiqueta="Fecha">${formatoFecha(p.fecha, false)}</td>
        <td data-etiqueta="Pago">
          ${
            p.estado !== "pagado"
              ? `<div class="pago-inline">
                   <input class="c-pago" type="number" step="0.01" placeholder="Monto" aria-label="Monto del pago" />
                   <button class="btn-chico pago" onclick="pagarPrestamo(${p.id}, this)">Pagar</button>
                 </div>`
              : `<span class="texto-tenue">-</span>`
          }
        </td>
      </tr>`,
      "Todavía no registraste ningún préstamo."
    );
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

async function pagarPrestamo(id, boton) {
  const fila = boton.closest("tr");
  const monto = Number(fila.querySelector(".c-pago").value);
  if (!monto || monto <= 0) return mostrarToast("Poné un monto válido.", true);
  await conCarga(boton, async () => {
    try {
      await api("POST", `/api/prestamos/${id}/pagos`, { monto });
      mostrarToast("Pago registrado.");
      cargarPrestamos();
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
}

document.getElementById("form-prestamo").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target));
  conCarga(ev.submitter, async () => {
    try {
      await api("POST", "/api/prestamos", limpiarVacios({ ...datos, monto: Number(datos.monto) }));
      cerrarDialogo("dialogo-prestamo");
      mostrarToast("Préstamo generado.");
      cargarPrestamos();
      cargarListaPersonas();
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
});

// ---------- plan canje ----------
let canjesCache = [];

async function cargarPrendas() {
  mostrarEsqueleto("tabla-prendas");
  try {
    canjesCache = await api("GET", "/api/canjes");
    const pendientes = canjesCache.filter((c) => c.estado === "pendiente").length;
    ponerSubtitulo("sub-prendas", canjesCache.length ? `${plural(canjesCache.length, "canje")} · ${plural(pendientes, "pendiente")}` : "");
    renderTabla(
      "tabla-prendas",
      canjesCache,
      (c) => `
      <tr data-id="${c.id}">
        <td data-etiqueta="Persona" class="texto-fuerte">${escapeHtml(c.persona_nombre)}</td>
        <td data-etiqueta="Celular">${escapeHtml(c.descripcion)}</td>
        <td data-etiqueta="Estado del equipo">${c.condicion ? escapeHtml(c.condicion) : `<span class="texto-tenue">-</span>`}</td>
        <td data-etiqueta="Valor tomado" class="num">${c.valor_tomado != null ? formatoConSimbolo(c.valor_tomado, c.moneda_valor) : `<span class="texto-tenue">-</span>`}</td>
        <td data-etiqueta="Entregado">${c.producto_entregado ? escapeHtml(c.producto_entregado) : `<span class="texto-tenue">-</span>`}</td>
        <td data-etiqueta="Saldo" class="num">${textoSaldo(c)}</td>
        <td data-etiqueta="Situación">${pillEstadoCanje(c.estado)}</td>
        <td data-etiqueta="Fecha">${formatoFecha(c.fecha, false)}</td>
        <td class="acciones"><button class="btn-icono" title="Editar" aria-label="Editar canje" onclick="editarCanje(${c.id})">${ICONO_LAPIZ}</button></td>
      </tr>`,
      "Todavía no registraste ningún canje."
    );
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

function abrirDialogoCanje() {
  abrirDialogo("dialogo-canje");
  document.getElementById("form-canje").elements.id.value = "";
  document.getElementById("titulo-dialogo-canje").textContent = "Nuevo canje";
  document.getElementById("boton-guardar-canje").textContent = "Generar canje";
}

function editarCanje(id) {
  const c = canjesCache.find((x) => x.id === id);
  if (!c) return;
  abrirDialogo("dialogo-canje");
  const form = document.getElementById("form-canje");
  form.elements.id.value = c.id;
  form.elements.persona.value = c.persona_nombre;
  form.elements.descripcion.value = c.descripcion;
  form.elements.condicion.value = c.condicion ?? "";
  form.elements.valor_tomado.value = c.valor_tomado ?? "";
  form.elements.moneda_valor.value = c.moneda_valor;
  form.elements.producto_entregado.value = c.producto_entregado ?? "";
  form.elements.saldo_monto.value = c.saldo_monto ?? "";
  form.elements.saldo_moneda.value = c.saldo_moneda;
  form.elements.nota.value = c.nota ?? "";
  document.getElementById("titulo-dialogo-canje").textContent = "Editar canje";
  document.getElementById("boton-guardar-canje").textContent = "Guardar cambios";
}

document.getElementById("form-canje").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target));
  const id = datos.id;
  delete datos.id;
  const body = limpiarVacios({
    ...datos,
    valor_tomado: datos.valor_tomado ? Number(datos.valor_tomado) : undefined,
    saldo_monto: datos.saldo_monto !== "" && datos.saldo_monto != null ? Number(datos.saldo_monto) : undefined,
  });
  conCarga(ev.submitter, async () => {
    try {
      if (id) {
        await api("PUT", `/api/canjes/${id}`, body);
        mostrarToast("Canje actualizado.");
      } else {
        await api("POST", "/api/canjes", body);
        mostrarToast("Canje generado.");
      }
      cerrarDialogo("dialogo-canje");
      cargarPrendas();
      cargarListaPersonas();
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
});

// ---------- empleados ----------
async function cargarEmpleados() {
  mostrarEsqueleto("tabla-empleados");
  try {
    const empleados = await api("GET", "/api/empleados");
    ponerSubtitulo("sub-empleados", empleados.length ? `${plural(empleados.length, "persona", "personas")} con precio amigo` : "");
    renderTabla(
      "tabla-empleados",
      empleados,
      (e) => `<tr>
        <td data-etiqueta="Nombre" class="texto-fuerte">${escapeHtml(e.nombre)}</td>
        <td data-etiqueta="Teléfono">${e.telefono ? escapeHtml(e.telefono) : `<span class="texto-tenue">-</span>`}</td>
        <td data-etiqueta="Descuento" class="num"><span class="estado-pill estado-info">${formatoNumero(e.descuento_pct)}%</span></td>
      </tr>`,
      "Todavía no cargaste ningún empleado."
    );
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

document.getElementById("form-empleado").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target));
  conCarga(ev.submitter, async () => {
    try {
      await api("POST", "/api/empleados", limpiarVacios(datos));
      cerrarDialogo("dialogo-empleado");
      mostrarToast("Usuario generado.");
      cargarEmpleados();
      cargarListaPersonas();
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
});

// ---------- bot: estado de conexion ----------
function tarjetaCargando(titulo) {
  return `<div class="card"><div class="label">${titulo}</div><div class="valor valor-chico"><span class="esqueleto" style="width:60%"></span></div></div>`;
}

async function cargarEstadoSistema() {
  const cont = document.getElementById("estado-cards");
  if (!cont.children.length) {
    cont.innerHTML = ["Base de datos (Turso)", "Webhook de Telegram", "Claude configurado", "Clave del webhook", "Hora del servidor"]
      .map(tarjetaCargando)
      .join("");
  }
  try {
    const r = await api("GET", "/api/estado-sistema");
    const webhookOk = !!r.webhook?.url && !r.webhook_error;
    const webhookTexto = r.webhook?.url ? "Activo" : "Sin configurar";
    const ultimoError = r.webhook?.last_error_message
      ? `${escapeHtml(r.webhook.last_error_message)} (${new Date(r.webhook.last_error_date * 1000).toLocaleString("es-AR")})`
      : null;
    cont.innerHTML = `
      ${tarjetaEstado("Base de datos (Turso)", r.base_de_datos)}
      ${tarjetaEstado("Webhook de Telegram", webhookOk, webhookTexto)}
      ${tarjetaEstado("Claude configurado", r.anthropic_configurado)}
      ${tarjetaEstado("Clave del webhook", r.secreto_webhook_configurado, r.secreto_webhook_configurado ? "Configurada" : "Falta TELEGRAM_WEBHOOK_SECRET")}
      <div class="card"><div class="label">Hora del servidor</div><div class="valor valor-chico">${new Date(r.hora_servidor).toLocaleString("es-AR")}</div></div>
    `;
    if (ultimoError) {
      cont.innerHTML += `<div class="card card-ancho"><div class="label">Último error del webhook</div><div class="valor valor-chico negativo">${ultimoError}</div></div>`;
    }
  } catch (e) {
    cont.innerHTML = `<div class="card card-ancho"><div class="label">Error</div><div class="valor valor-chico negativo">${escapeHtml(e.message)}</div></div>`;
  }
}

function tarjetaEstado(titulo, ok, textoExtra) {
  const punto = ok ? `<span class="punto-estado punto-ok"></span>` : `<span class="punto-estado punto-mal"></span>`;
  const texto = textoExtra ?? (ok ? "Andando bien" : "Con problemas");
  return `<div class="card"><div class="label">${titulo}</div><div class="valor valor-chico">${punto}${escapeHtml(texto)}</div></div>`;
}

// ---------- backup: descarga un JSON con todos los datos del negocio ----------
async function descargarBackup(boton) {
  await conCarga(boton, async () => {
    try {
      const resp = await fetch("/api/backup", { headers: { Authorization: authHeader() } });
      if (!resp.ok) {
        const datos = await resp.json().catch(() => ({}));
        throw new Error(datos.error ?? `Error ${resp.status}`);
      }
      const nombre = /filename="([^"]+)"/.exec(resp.headers.get("Content-Disposition") ?? "")?.[1] ?? "backup-gestor.json";
      const url = URL.createObjectURL(await resp.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = nombre;
      link.click();
      URL.revokeObjectURL(url);
      mostrarToast("Backup descargado.");
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
}

// ---------- bot: como funciona ----------
async function cargarInfoBot() {
  try {
    const r = await api("GET", "/api/bot-info");
    document.getElementById("info-modelo").textContent = r.modelo;
    document.getElementById("cantidad-herramientas").textContent = r.herramientas.length;
    document.getElementById("lista-herramientas").innerHTML = r.herramientas
      .map(
        (h, i) =>
          `<div class="herramienta" style="animation-delay:${Math.min(i, 12) * 25}ms"><strong>${escapeHtml(h.nombre)}</strong><span>${escapeHtml(h.descripcion)}</span></div>`
      )
      .join("");
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

// ---------- bot: respuestas predefinidas ----------
let respuestasCache = [];

async function cargarRespuestas() {
  mostrarEsqueleto("tabla-respuestas", 3);
  try {
    respuestasCache = await api("GET", "/api/respuestas");
    const activas = respuestasCache.filter((r) => r.activo).length;
    ponerSubtitulo("sub-respuestas", respuestasCache.length ? `${plural(respuestasCache.length, "respuesta")} · ${plural(activas, "activa")}` : "");
    renderTabla(
      "tabla-respuestas",
      respuestasCache,
      (r) => `
      <tr data-id="${r.id}">
        <td data-etiqueta="Disparador"><span class="chip-codigo">${escapeHtml(r.disparador)}</span></td>
        <td data-etiqueta="Respuesta" class="celda-texto">${escapeHtml(r.respuesta)}</td>
        <td data-etiqueta="Activa">${r.activo ? `<span class="estado-pill estado-pagado">Activa</span>` : `<span class="estado-pill estado-neutro">Pausada</span>`}</td>
        <td class="acciones">
          <div class="acciones-fila">
            <button class="btn-icono" title="Editar" aria-label="Editar respuesta" onclick="editarRespuesta(${r.id})">${ICONO_LAPIZ}</button>
            <button class="btn-icono peligro" title="Eliminar" aria-label="Eliminar respuesta" onclick="eliminarRespuesta(${r.id}, this)">${ICONO_TACHO}</button>
          </div>
        </td>
      </tr>`,
      "Todavía no cargaste ninguna respuesta predefinida."
    );
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

function abrirDialogoRespuesta() {
  abrirDialogo("dialogo-respuesta");
  const form = document.getElementById("form-respuesta");
  form.elements.id.value = "";
  form.elements.activo.checked = true;
  document.getElementById("titulo-dialogo-respuesta").textContent = "Nueva respuesta";
  document.getElementById("boton-guardar-respuesta").textContent = "Generar respuesta";
}

function editarRespuesta(id) {
  const r = respuestasCache.find((x) => x.id === id);
  if (!r) return;
  abrirDialogo("dialogo-respuesta");
  const form = document.getElementById("form-respuesta");
  form.elements.id.value = r.id;
  form.elements.disparador.value = r.disparador;
  form.elements.respuesta.value = r.respuesta;
  form.elements.activo.checked = !!r.activo;
  document.getElementById("titulo-dialogo-respuesta").textContent = "Editar respuesta";
  document.getElementById("boton-guardar-respuesta").textContent = "Guardar cambios";
}

async function eliminarRespuesta(id, boton) {
  const r = respuestasCache.find((x) => x.id === id);
  const ok = await confirmar({
    titulo: "¿Eliminar esta respuesta?",
    mensaje: r ? `El bot va a dejar de contestar "${r.disparador}" con la respuesta fija.` : "",
    textoBoton: "Eliminar",
    peligro: true,
  });
  if (!ok) return;
  await conCarga(boton, async () => {
    try {
      await api("DELETE", `/api/respuestas/${id}`);
      mostrarToast("Respuesta eliminada.");
      cargarRespuestas();
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
}

document.getElementById("form-respuesta").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const id = form.elements.id.value;
  const body = {
    disparador: form.elements.disparador.value,
    respuesta: form.elements.respuesta.value,
    activo: form.elements.activo.checked,
  };
  conCarga(ev.submitter, async () => {
    try {
      if (id) {
        await api("PUT", `/api/respuestas/${id}`, body);
        mostrarToast("Respuesta actualizada.");
      } else {
        await api("POST", "/api/respuestas", body);
        mostrarToast("Respuesta generada.");
      }
      cerrarDialogo("dialogo-respuesta");
      cargarRespuestas();
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
});

// ---------- logs ----------
const ETIQUETAS_TIPO_LOG = { mensaje: "Mensaje", respuesta_predefinida: "Respuesta fija", error: "Error" };
const CLASE_TIPO_LOG = { mensaje: "estado-info", respuesta_predefinida: "estado-fija", error: "estado-error" };

// Traduce errores tecnicos (de la API de Anthropic, de Telegram, etc.) a una frase entendible
// para alguien que no sabe de programacion. Si no reconoce el patron, arma un mensaje generico
// y deja el texto original plegado abajo por si hay que mandarmelo para que lo revise.
function formatearError(mensajeCrudo) {
  const texto = String(mensajeCrudo ?? "");
  if (!texto) return { amigable: "-", tecnico: null };

  // Los errores de la API de Anthropic vienen como '400 {"type":"error","error":{"message":"..."}}':
  // intentamos sacar el mensaje de adentro de ese JSON.
  let detalle = texto;
  const match = texto.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      detalle = parsed?.error?.message || parsed?.message || texto;
    } catch {
      /* no era JSON valido, seguimos con el texto tal cual */
    }
  }

  let amigable;
  if (/tool_use.*tool_result|tool_result.*tool_use/is.test(detalle)) {
    amigable = "Se trabó la memoria de esta conversación por un corte interno. Ya se solucionó: escribí de nuevo.";
  } else if (/rate.?limit|429/i.test(texto)) {
    amigable = "El asistente está recibiendo demasiados mensajes justo ahora. Probá de nuevo en unos segundos.";
  } else if (/overloaded/i.test(detalle)) {
    amigable = "El servicio de IA está sobrecargado en este momento. Probá de nuevo en un rato.";
  } else if (/credit balance|insufficient/i.test(detalle)) {
    amigable = "Se quedó sin crédito la cuenta de IA: hay que cargar saldo.";
  } else if (detalle.trim().startsWith("{") || detalle.length > 160) {
    amigable = "Hubo un error técnico procesando este mensaje. Probá de nuevo, y si sigue avisame.";
  } else {
    amigable = detalle;
  }
  return { amigable, tecnico: texto };
}

function celdaRespuestaLog(l) {
  if (l.tipo !== "error") return escapeHtml(l.salida ?? "-");
  const { amigable, tecnico } = formatearError(l.salida);
  const detalle =
    tecnico && tecnico !== amigable
      ? `<details class="detalle-tecnico"><summary>Ver detalle técnico</summary><pre>${escapeHtml(tecnico)}</pre></details>`
      : "";
  return `<span class="texto-error">${escapeHtml(amigable)}</span>${detalle}`;
}

async function cargarLogs() {
  mostrarEsqueleto("tabla-logs");
  try {
    const logs = await api("GET", "/api/logs?limite=150");
    const errores = logs.filter((l) => l.tipo === "error").length;
    ponerSubtitulo("sub-logs", logs.length ? `Últimos ${plural(logs.length, "registro")}${errores ? ` · ${plural(errores, "error", "errores")}` : ""}` : "");
    renderTabla(
      "tabla-logs",
      logs,
      (l) => `
      <tr>
        <td data-etiqueta="Fecha">${formatoFecha(l.fecha)}</td>
        <td data-etiqueta="Usuario" class="texto-fuerte">${escapeHtml(l.usuario_nombre ?? "-")}</td>
        <td data-etiqueta="Tipo"><span class="estado-pill ${CLASE_TIPO_LOG[l.tipo] ?? "estado-neutro"}">${ETIQUETAS_TIPO_LOG[l.tipo] ?? l.tipo}</span></td>
        <td data-etiqueta="Mensaje" class="celda-texto">${escapeHtml(l.entrada ?? "-")}</td>
        <td data-etiqueta="Respuesta" class="celda-texto">${celdaRespuestaLog(l)}</td>
        <td data-etiqueta="Herramientas">${
          l.herramientas_usadas.length
            ? l.herramientas_usadas.map((h) => `<span class="chip-codigo">${escapeHtml(h)}</span>`).join(" ")
            : `<span class="texto-tenue">-</span>`
        }</td>
      </tr>`,
      "Todavía no hay actividad registrada."
    );
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

// ---------- arranque ----------
iniciarLogin();
