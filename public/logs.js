// Logs: que pasa en todo el sistema (errores, avisos) y las conversaciones del bot. Usa los
// helpers de app.js (api, escapeHtml...) y los graficos de graficos.js.

// ---------- errores de esta misma pagina ----------
// Si algo se rompe en el navegador (un boton que no anda, un dato que no se dibuja), se manda a
// Logs como error de "Navegador". Como mucho 5 por carga de pagina, sin repetir el mismo.
const erroresWebEnviados = new Set();
function reportarErrorWeb(mensaje, detalle) {
  try {
    const auth = typeof authHeader === "function" ? authHeader() : null;
    if (!auth || erroresWebEnviados.size >= 5 || erroresWebEnviados.has(mensaje)) return;
    erroresWebEnviados.add(mensaje);
    fetch("/api/logs/web", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({ mensaje, detalle, url: location.pathname + location.hash, seccion: location.hash.slice(1) || "resumen" }),
    }).catch(() => {});
  } catch {
    /* reportar nunca tiene que romper nada */
  }
}
window.addEventListener("error", (ev) => {
  if (!ev.message) return;
  reportarErrorWeb(ev.message, `${ev.filename ?? ""}:${ev.lineno ?? ""}:${ev.colno ?? ""}\n${ev.error?.stack ?? ""}`);
});
window.addEventListener("unhandledrejection", (ev) => {
  const r = ev.reason;
  // Los errores de la API ya quedan anotados en el servidor.
  if (r?.message && /^(Error \d+|Sesion vencida)/.test(r.message)) return;
  reportarErrorWeb(String(r?.message ?? r ?? "Promesa rechazada"), r?.stack ?? "");
});

// ---------- estado ----------
const ORIGENES_LOG = {
  bot: "Bot",
  ia: "IA",
  herramienta: "Herramientas",
  panel: "Panel",
  web: "Navegador",
  telegram: "Telegram",
  cron: "Chequeo automático",
  dolar: "Dólar",
  catalogo: "Catálogo",
  seguridad: "Seguridad",
  base: "Base de datos",
};
const NIVELES_LOG = { error: "Error", aviso: "Aviso", info: "Info" };
const TIPOS_CONVERSACION = { mensaje: "Mensajes", respuesta_predefinida: "Respuestas fijas", error: "Errores" };

const logs = {
  vista: "sistema",
  dias: 1,
  nivel: "",
  origen: "",
  tipo: "",
  q: "",
  resumen: null,
  items: [],
  hayMas: false,
  vivo: null,
  pidiendo: 0,
};

try {
  const g = JSON.parse(localStorage.getItem("panel_logs") || "{}");
  if (["sistema", "bot"].includes(g.vista)) logs.vista = g.vista;
  if ([1, 7, 30].includes(g.dias)) logs.dias = g.dias;
} catch {
  /* sin almacenamiento */
}
function guardarPreferenciasLogs() {
  try {
    localStorage.setItem("panel_logs", JSON.stringify({ vista: logs.vista, dias: logs.dias }));
  } catch {
    /* no pasa nada */
  }
}

// ---------- fechas ----------
// Las fechas vienen "2026-10-08 14:32:05" en hora argentina; el "ahora" lo da el servidor.
function aMs(s) {
  const [d, h = "00:00:00"] = String(s).split(" ");
  const [a, m, dd] = d.split("-").map(Number);
  const [hh, mi, ss] = h.split(":").map(Number);
  return Date.UTC(a, m - 1, dd, hh, mi, ss || 0);
}
function haceCuanto(fecha) {
  if (!fecha || !logs.resumen) return "";
  const seg = Math.max(0, Math.round((aMs(logs.resumen.ahora) - aMs(fecha)) / 1000));
  if (seg < 60) return "recién";
  if (seg < 3600) return `hace ${Math.round(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.round(seg / 3600)} h`;
  const d = Math.round(seg / 86400);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}
function horaCorta(fecha) {
  return String(fecha).slice(11, 16);
}
function tituloDia(fecha) {
  const dia = String(fecha).slice(0, 10);
  const hoy = logs.resumen ? String(logs.resumen.ahora).slice(0, 10) : "";
  const ayer = hoy ? new Date(aMs(`${hoy} 12:00:00`) - 86400000).toISOString().slice(0, 10) : "";
  if (dia === hoy) return "Hoy";
  if (dia === ayer) return "Ayer";
  const [a, m, d] = dia.split("-").map(Number);
  return `${d} de ${MESES_LARGOS[m - 1]}${String(a) !== hoy.slice(0, 4) ? ` ${a}` : ""}`;
}
function segundos(ms) {
  return `${(ms / 1000).toLocaleString("es-AR", { maximumFractionDigits: ms < 10000 ? 1 : 0 })} s`;
}
function textoPeriodo() {
  return logs.dias === 1 ? "las últimas 24 h" : `los últimos ${logs.dias} días`;
}

// ---------- carga ----------
async function cargarLogs({ conservarLista = false } = {}) {
  const pedido = ++logs.pidiendo;
  const lista = document.getElementById("logs-lista");
  if (!conservarLista) lista.innerHTML = esqueletoLogs();
  else lista.classList.add("recargando");
  try {
    const [resumen, items] = await Promise.all([api("GET", `/api/logs/resumen?dias=${logs.dias}`), pedirItems()]);
    if (pedido !== logs.pidiendo) return; // llego una respuesta vieja
    logs.resumen = resumen;
    logs.items = items;
    logs.hayMas = items.length === TAMANO_PAGINA_LOGS;
    dibujarLogs();
  } catch (e) {
    mostrarToast(e.message, true);
  } finally {
    lista.classList.remove("recargando");
  }
}

const TAMANO_PAGINA_LOGS = 50;

function pedirItems(antesDeId) {
  const p = new URLSearchParams({ dias: String(logs.dias), limite: String(TAMANO_PAGINA_LOGS) });
  if (logs.q) p.set("q", logs.q);
  if (antesDeId) p.set("antes_de_id", String(antesDeId));
  if (logs.vista === "sistema") {
    if (logs.nivel) p.set("nivel", logs.nivel);
    if (logs.origen) p.set("origen", logs.origen);
    return api("GET", `/api/logs/sistema?${p}`);
  }
  if (logs.tipo) p.set("tipo", logs.tipo);
  return api("GET", `/api/logs?${p}`);
}

async function cargarMasLogs(boton) {
  const ultimo = logs.items[logs.items.length - 1];
  if (!ultimo) return;
  conCarga(boton, async () => {
    try {
      const mas = await pedirItems(ultimo.id);
      logs.items = logs.items.concat(mas);
      logs.hayMas = mas.length === TAMANO_PAGINA_LOGS;
      dibujarLista();
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
}

function esqueletoLogs() {
  return `<div class="logs-esqueleto">${'<div class="esqueleto-linea"></div>'.repeat(6)}</div>`;
}

// ---------- dibujo ----------
function dibujarLogs() {
  document.querySelectorAll("#logs-vistas [data-vista]").forEach((b) => {
    const activo = b.dataset.vista === logs.vista;
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-selected", String(activo));
  });
  document.querySelectorAll("#logs-dias [data-dias]").forEach((b) => {
    const activo = Number(b.dataset.dias) === logs.dias;
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-pressed", String(activo));
  });
  dibujarSalud();
  dibujarKpisLogs();
  dibujarGraficosLogs();
  dibujarFiltrosLogs();
  dibujarLista();
}

// Arriba de todo: ¿anda todo bien? Errores del periodo y el ultimo chequeo automatico.
function dibujarSalud() {
  const r = logs.resumen;
  const errores = r.por_nivel.error;
  const chequeo = r.ultimo_chequeo_webhook;
  let estadoChequeo = "";
  if (chequeo?.fecha) {
    const minutos = Math.round((Date.now() - new Date(chequeo.fecha).getTime()) / 60000);
    const viejo = minutos > 75;
    const texto = minutos < 1 ? "recién" : minutos < 60 ? `hace ${minutos} min` : `hace ${Math.round(minutos / 60)} h`;
    estadoChequeo = `<span class="salud-chip ${viejo || chequeo.estado === "error" ? "malo" : "bueno"}" title="Cada 30 minutos se revisa que Telegram le siga mandando los mensajes al bot">${
      viejo ? "El chequeo automático no corre desde" : chequeo.estado === "reparado" ? "Chequeo automático (reparó el webhook)" : chequeo.estado === "error" ? "El último chequeo automático falló" : "Chequeo automático OK"
    } · ${texto}</span>`;
  } else {
    estadoChequeo = `<span class="salud-chip neutro" title="Cada 30 minutos se revisa que Telegram le siga mandando los mensajes al bot">Chequeo automático: todavía sin datos</span>`;
  }
  const el = document.getElementById("logs-salud");
  if (errores) {
    el.className = "logs-salud malo";
    el.innerHTML = `<div class="salud-icono">${ICONO_ALERTA_LOG}</div>
      <div class="salud-texto"><strong>${plural(errores, "error", "errores")} en ${textoPeriodo()}</strong>
      <span>${r.ultimo_error ? `Último: <b></b> · ${escapeHtml(haceCuanto(r.ultimo_error.fecha))}` : ""}</span></div>
      <div class="salud-acciones">${estadoChequeo}<button type="button" class="btn-chico" data-ver-errores>Ver errores</button></div>`;
    const b = el.querySelector(".salud-texto b");
    if (b) b.textContent = `${ORIGENES_LOG[r.ultimo_error.origen] ?? r.ultimo_error.origen} — ${r.ultimo_error.evento}`;
  } else {
    el.className = "logs-salud bueno";
    el.innerHTML = `<div class="salud-icono">${ICONO_OK_LOG}</div>
      <div class="salud-texto"><strong>Todo funcionando</strong><span>Sin errores en ${textoPeriodo()}${r.por_nivel.aviso ? ` · ${plural(r.por_nivel.aviso, "aviso")} para revisar` : ""}</span></div>
      <div class="salud-acciones">${estadoChequeo}</div>`;
  }
}

const ICONO_OK_LOG = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 10"/></svg>`;
const ICONO_ALERTA_LOG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/></svg>`;

function dibujarKpisLogs() {
  const r = logs.resumen;
  // las tendencias, con los baldes vacios en 0 (asi se ven aunque haya pocos datos)
  const baldes = baldesLogs();
  const porBalde = new Map(r.serie.map((x) => [x.balde, x]));
  const mensajesPorBalde = new Map(r.bot_serie.map((x) => [x.balde, x.mensajes]));
  const serie = baldes.map((b) => porBalde.get(b.clave) ?? { errores: 0, avisos: 0 });
  const tile = (etiqueta, valor, detalle, clase, valores) =>
    `<article class="dash-kpi ${clase}"><div class="dash-kpi-cabeza"><span class="dash-kpi-etiqueta">${escapeHtml(etiqueta)}</span></div>
      <div class="dash-kpi-valor">${valor}</div><div class="dash-kpi-pie"><span class="dash-kpi-detalle">${detalle}</span>${valores ? sparkline(valores, clase) : ""}</div></article>`;
  document.getElementById("logs-kpis").innerHTML = [
    tile("Errores", formatoNumero(r.por_nivel.error), `En ${textoPeriodo()}`, "estado-malo", serie.map((x) => x.errores)),
    tile("Avisos", formatoNumero(r.por_nivel.aviso), "Cosas para revisar, no rompen nada", "serie-4", serie.map((x) => x.avisos)),
    tile("Mensajes al bot", formatoNumero(r.bot.mensajes), `${plural(r.bot.usuarios, "persona", "personas")}${r.bot.errores ? ` · ${plural(r.bot.errores, "con error", "con error")}` : ""}`, "serie-1", baldes.map((b) => mensajesPorBalde.get(b.clave) ?? 0)),
    tile(
      "Respuesta del bot",
      r.bot.duracion_media_ms != null ? segundos(r.bot.duracion_media_ms) : "—",
      r.bot.duracion_max_ms != null ? `Promedio · la más lenta ${segundos(r.bot.duracion_max_ms)}` : "Todavía sin mediciones",
      "serie-2",
      null
    ),
  ].join("");
}

// Los baldes del grafico: cada hora (24 h) o cada dia (7/30 dias), con los vacios en 0.
function baldesLogs() {
  const r = logs.resumen;
  const fin = aMs(r.ahora);
  const baldes = [];
  if (logs.dias === 1) {
    for (let k = 23; k >= 0; k--) {
      const t = new Date(fin - k * 3600000).toISOString();
      baldes.push({ clave: `${t.slice(0, 10)} ${t.slice(11, 13)}`, corto: `${t.slice(11, 13)} h`, largo: `${tituloDia(t.slice(0, 10))} · ${t.slice(11, 13)}:00 a ${t.slice(11, 13)}:59` });
    }
  } else {
    for (let k = logs.dias - 1; k >= 0; k--) {
      const t = new Date(fin - k * 86400000).toISOString().slice(0, 10);
      const [, m, d] = t.split("-").map(Number);
      baldes.push({ clave: t, corto: `${d}/${m}`, largo: tituloDia(t) });
    }
  }
  return baldes;
}

function dibujarGraficosLogs() {
  const r = logs.resumen;
  const baldes = baldesLogs();
  const sistema = logs.vista === "sistema";
  document.getElementById("logs-titulo-grafico").textContent = sistema ? "Errores y avisos" : "Mensajes al bot";
  document.getElementById("logs-sub-grafico").textContent = logs.dias === 1 ? "Por hora, últimas 24 h" : `Por día, últimos ${logs.dias} días`;
  document.getElementById("logs-leyenda").innerHTML = sistema ? itemLeyenda("Errores", "estado-malo") + itemLeyenda("Avisos", "serie-4") : "";
  const lugar = document.getElementById("logs-grafico");
  if (sistema) {
    const por = new Map(r.serie.map((x) => [x.balde, x]));
    dibujarGrafico(lugar, () =>
      graficoColumnas(lugar, {
        titulo: "Errores y avisos",
        categorias: baldes.map((b) => b.corto),
        categoriasLargas: baldes.map((b) => b.largo),
        series: [
          { nombre: "Errores", clase: "estado-malo", valores: baldes.map((b) => por.get(b.clave)?.errores ?? 0) },
          { nombre: "Avisos", clase: "serie-4", valores: baldes.map((b) => por.get(b.clave)?.avisos ?? 0) },
        ],
        formato: (v) => formatoNumero(v),
        formatoEje: (v) => (Number.isInteger(v) ? String(v) : ""),
        alto: 260,
        vacio: `Sin errores ni avisos en ${textoPeriodo()}.`,
      })
    );
  } else {
    const por = new Map(r.bot_serie.map((x) => [x.balde, x.mensajes]));
    dibujarGrafico(lugar, () =>
      graficoColumnas(lugar, {
        titulo: "Mensajes al bot",
        categorias: baldes.map((b) => b.corto),
        categoriasLargas: baldes.map((b) => b.largo),
        series: [{ nombre: "Mensajes", clase: "serie-1", valores: baldes.map((b) => por.get(b.clave) ?? 0) }],
        formato: (v) => formatoNumero(v),
        formatoEje: (v) => (Number.isInteger(v) ? String(v) : ""),
        alto: 260,
        vacio: `Nadie le escribió al bot en ${textoPeriodo()}.`,
      })
    );
  }
  const origenes = r.por_origen.filter((o) => o.errores + o.avisos > 0);
  const lugarOrigenes = document.getElementById("logs-origenes");
  graficoBarrasH(lugarOrigenes, {
    clase: "serie-4",
    filas: origenes.map((o) => ({
      etiqueta: ORIGENES_LOG[o.origen] ?? o.origen,
      valor: o.errores + o.avisos,
      texto: [o.errores ? plural(o.errores, "error", "errores") : "", o.avisos ? plural(o.avisos, "aviso") : ""].filter(Boolean).join(" · "),
      detalle: [
        { valor: formatoNumero(o.errores), etiqueta: "Errores", clase: "estado-malo", tipo: "barra" },
        { valor: formatoNumero(o.avisos), etiqueta: "Avisos", clase: "serie-4", tipo: "barra" },
      ],
    })),
    vacio: "Nada para revisar: ninguna parte del sistema tuvo errores ni avisos.",
  });
  // vienen ordenados con los que tuvieron errores primero; esos se pintan de coral
  lugarOrigenes.querySelectorAll(".ranking-barra").forEach((barra, i) => {
    if (origenes[i]?.errores) barra.classList.replace("serie-4", "estado-malo");
  });
  lugarOrigenes.querySelectorAll(".ranking li").forEach((li, i) => {
    li.dataset.origen = origenes[i].origen;
    li.title = "Ver solo esto";
  });
}

function dibujarFiltrosLogs() {
  const r = logs.resumen;
  const sistema = logs.vista === "sistema";
  document.getElementById("logs-titulo-lista").textContent = sistema ? "Eventos del sistema" : "Conversaciones del bot";
  const chips = document.getElementById("logs-chips");
  if (sistema) {
    const total = r.por_nivel.error + r.por_nivel.aviso + r.por_nivel.info;
    const opciones = [
      ["", "Todos", total],
      ["error", "Errores", r.por_nivel.error],
      ["aviso", "Avisos", r.por_nivel.aviso],
      ["info", "Info", r.por_nivel.info],
    ];
    chips.innerHTML = opciones
      .map(([v, t, n]) => `<button type="button" class="filtro-chip nivel-${v || "todos"}${logs.nivel === v ? " activo" : ""}" data-nivel="${v}" aria-pressed="${logs.nivel === v}">${t}<span>${n}</span></button>`)
      .join("");
    const origenes = r.por_origen;
    document.getElementById("logs-origenes-filtro").innerHTML = origenes.length
      ? `<span class="logs-origen-titulo">Origen</span>${[["", "Todos"], ...origenes.map((o) => [o.origen, ORIGENES_LOG[o.origen] ?? o.origen])]
          .map(([v, t]) => `<button type="button" class="origen-chip${logs.origen === v ? " activo" : ""}" data-origen="${escapeAttr(v)}" aria-pressed="${logs.origen === v}">${escapeHtml(t)}</button>`)
          .join("")}`
      : "";
  } else {
    chips.innerHTML = [["", "Todas"], ...Object.entries(TIPOS_CONVERSACION)]
      .map(([v, t]) => `<button type="button" class="filtro-chip tipo-${v || "todos"}${logs.tipo === v ? " activo" : ""}" data-tipo="${v}" aria-pressed="${logs.tipo === v}">${t}</button>`)
      .join("");
    document.getElementById("logs-origenes-filtro").innerHTML = "";
  }
}

function dibujarLista() {
  const lista = document.getElementById("logs-lista");
  const sistema = logs.vista === "sistema";
  const filtros = [logs.q && `"${logs.q}"`, sistema && logs.nivel && NIVELES_LOG[logs.nivel], sistema && logs.origen && (ORIGENES_LOG[logs.origen] ?? logs.origen), !sistema && logs.tipo && TIPOS_CONVERSACION[logs.tipo]]
    .filter(Boolean)
    .join(" · ");
  document.getElementById("logs-sub-lista").textContent = `${logs.items.length}${logs.hayMas ? "+" : ""} en ${textoPeriodo()}${filtros ? ` · ${filtros}` : ""}`;
  document.getElementById("logs-mas").classList.toggle("oculto", !logs.hayMas);
  if (!logs.items.length) {
    lista.innerHTML = estadoVacio(
      filtros ? "No hay nada con esos filtros." : sistema ? `No hubo eventos en ${textoPeriodo()}. Cuando algo falle o haya que revisar algo, aparece acá.` : `Nadie le escribió al bot en ${textoPeriodo()}.`
    );
    return;
  }
  let diaActual = "";
  const partes = [];
  for (const item of logs.items) {
    const dia = String(item.fecha).slice(0, 10);
    if (dia !== diaActual) {
      diaActual = dia;
      partes.push(`<h4 class="logs-dia">${escapeHtml(tituloDia(item.fecha))}</h4>`);
    }
    partes.push(sistema ? filaEvento(item) : filaConversacion(item));
  }
  lista.innerHTML = partes.join("");
}

function filaEvento(e) {
  const meta = [e.usuario, e.ruta, e.duracion_ms != null ? segundos(e.duracion_ms) : null].filter(Boolean);
  return `<article class="evento nivel-${e.nivel}" data-id="${e.id}">
    <span class="evento-marca" aria-hidden="true"></span>
    <div class="evento-cuerpo">
      <div class="evento-linea">
        <span class="evento-nivel">${NIVELES_LOG[e.nivel] ?? e.nivel}</span>
        <span class="evento-origen">${escapeHtml(ORIGENES_LOG[e.origen] ?? e.origen)}</span>
        <p class="evento-texto">${escapeHtml(e.evento)}</p>
        <time class="evento-hora" title="${escapeAttr(e.fecha)}">${horaCorta(e.fecha)}</time>
      </div>
      ${meta.length ? `<div class="evento-meta">${meta.map((m) => `<span>${escapeHtml(m)}</span>`).join("")}</div>` : ""}
      ${
        e.detalle
          ? `<details class="evento-detalle"><summary>Detalle técnico</summary><div class="evento-detalle-caja"><pre>${escapeHtml(e.detalle)}</pre>
              <button type="button" class="btn-chico btn-copiar" data-copiar="${e.id}">Copiar</button></div></details>`
          : ""
      }
    </div>
  </article>`;
}

function iniciales(nombre) {
  return (
    String(nombre ?? "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join("") || "?"
  );
}

// Los errores de la IA llegan como JSON crudo ('500 {"type":"error",...}'): se muestra el mensaje.
function salidaLegible(c) {
  const texto = String(c.salida ?? "—");
  if (c.tipo !== "error") return texto;
  const m = /^(\d{3})?\s*(\{[\s\S]*\})\s*$/.exec(texto.trim());
  if (!m) return texto;
  try {
    const j = JSON.parse(m[2]);
    const mensaje = j?.error?.message ?? j?.message;
    return mensaje ? `Error de la IA${m[1] ? ` (HTTP ${m[1]})` : ""}: ${mensaje}` : texto;
  } catch {
    return texto;
  }
}

function filaConversacion(c) {
  const error = c.tipo === "error";
  const fija = c.tipo === "respuesta_predefinida";
  return `<article class="conversacion${error ? " con-error" : ""}" data-id="${c.id}">
    <header class="conversacion-cabeza">
      <span class="avatar" aria-hidden="true">${escapeHtml(iniciales(c.usuario_nombre))}</span>
      <strong>${escapeHtml(c.usuario_nombre ?? "Sin nombre")}</strong>
      <time title="${escapeAttr(c.fecha)}">${horaCorta(c.fecha)}</time>
      ${c.duracion_ms != null ? `<span class="conversacion-dato">${segundos(c.duracion_ms)}</span>` : ""}
      ${fija ? `<span class="conversacion-dato fija">Respuesta fija</span>` : ""}
      ${error ? `<span class="conversacion-dato error">Error</span>` : ""}
    </header>
    <div class="burbuja usuario">${escapeHtml(c.entrada ?? "—")}</div>
    <div class="burbuja ${error ? "error" : "bot"}">${escapeHtml(salidaLegible(c))}</div>
    ${
      c.herramientas_usadas?.length
        ? `<div class="conversacion-herramientas"><span>Usó:</span>${c.herramientas_usadas.map((h) => `<code>${escapeHtml(h)}</code>`).join("")}</div>`
        : ""
    }
  </article>`;
}

// ---------- eventos ----------
document.getElementById("logs-vistas").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-vista]");
  if (!b || b.dataset.vista === logs.vista) return;
  logs.vista = b.dataset.vista;
  guardarPreferenciasLogs();
  cargarLogs();
});
document.getElementById("logs-dias").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-dias]");
  if (!b || Number(b.dataset.dias) === logs.dias) return;
  logs.dias = Number(b.dataset.dias);
  guardarPreferenciasLogs();
  cargarLogs();
});
document.getElementById("logs-actualizar").addEventListener("click", () => cargarLogs({ conservarLista: true }));
document.getElementById("logs-mas").addEventListener("click", (ev) => cargarMasLogs(ev.currentTarget));

document.getElementById("logs-chips").addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  if ("nivel" in b.dataset) logs.nivel = b.dataset.nivel;
  if ("tipo" in b.dataset) logs.tipo = b.dataset.tipo;
  cargarLogs({ conservarLista: true });
});
document.getElementById("logs-origenes-filtro").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-origen]");
  if (!b) return;
  logs.origen = b.dataset.origen;
  cargarLogs({ conservarLista: true });
});
document.getElementById("logs-origenes").addEventListener("click", (ev) => {
  const li = ev.target.closest("li[data-origen]");
  if (!li) return;
  logs.vista = "sistema";
  logs.origen = li.dataset.origen;
  cargarLogs({ conservarLista: true });
  document.querySelector(".logs-registro")?.scrollIntoView({ behavior: sinAnimaciones() ? "auto" : "smooth", block: "start" });
});
document.getElementById("logs-salud").addEventListener("click", (ev) => {
  if (!ev.target.closest("[data-ver-errores]")) return;
  logs.vista = "sistema";
  logs.nivel = "error";
  logs.origen = "";
  cargarLogs({ conservarLista: true });
  document.querySelector(".logs-registro")?.scrollIntoView({ behavior: sinAnimaciones() ? "auto" : "smooth", block: "start" });
});

let temporizadorBusquedaLogs;
document.getElementById("logs-q").addEventListener("input", (ev) => {
  clearTimeout(temporizadorBusquedaLogs);
  temporizadorBusquedaLogs = setTimeout(() => {
    logs.q = ev.target.value.trim();
    cargarLogs({ conservarLista: true });
  }, 300);
});

document.getElementById("logs-lista").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-copiar]");
  if (!b) return;
  const item = logs.items.find((x) => String(x.id) === b.dataset.copiar);
  if (!item) return;
  const texto = [`[${item.fecha}] ${NIVELES_LOG[item.nivel] ?? item.nivel} · ${ORIGENES_LOG[item.origen] ?? item.origen}`, item.evento, item.ruta, item.usuario, "", item.detalle].filter((x) => x != null).join("\n");
  try {
    await navigator.clipboard.writeText(texto);
    b.textContent = "Copiado";
    setTimeout(() => (b.textContent = "Copiar"), 1600);
  } catch {
    mostrarToast("No se pudo copiar.", true);
  }
});

// En vivo: cada 20 s, solo mientras se esta mirando Logs y la pestaña del navegador esta visible.
document.getElementById("logs-vivo").addEventListener("click", (ev) => {
  const boton = ev.currentTarget;
  const prender = !logs.vivo;
  boton.setAttribute("aria-pressed", String(prender));
  boton.classList.toggle("activo", prender);
  if (prender) {
    logs.vivo = setInterval(() => {
      const enLogs = !document.getElementById("tab-logs").classList.contains("oculto");
      if (enLogs && document.visibilityState === "visible") cargarLogs({ conservarLista: true });
    }, 20000);
  } else {
    clearInterval(logs.vivo);
    logs.vivo = null;
  }
});
