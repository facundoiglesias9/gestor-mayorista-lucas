// Catalogo publico (para clientes): vanilla JS, sin build step. Lee /api/catalogo, que no pide
// clave y solo trae lo que un cliente puede ver (ver listarCatalogo en src/repo.ts).

// ---------- utilidades ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Minusculas y sin tildes, para buscar sin importar como se escriba ("dirección" = "direccion").
function normalizar(texto) {
  return String(texto ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const SIMBOLO_MONEDA = { USD: "U$D", ARS: "$" };

// Pesos sin decimales; dolares con 2 decimales si los tiene, nunca uno solo (igual que el panel).
function formatoPrecio(n, moneda) {
  const redondeado = (moneda === "ARS" ? Math.round(n) : Math.round(n * 100) / 100) || 0;
  const decimales = Number.isInteger(redondeado) ? 0 : 2;
  const num = redondeado.toLocaleString("es-AR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
  return `${SIMBOLO_MONEDA[moneda] ?? ""} ${num}`.trim();
}

// ---------- colores para el dibujo del equipo ----------
// Si una publicacion no tiene foto, se muestra un dibujo pintado del color que diga el nombre.
const COLORES = [
  // [palabras que lo identifican, nombre a mostrar, color]
  [["titanio natural", "natural titanium"], "Titanio natural", "#c2bcb2"],
  [["titanio negro", "black titanium"], "Titanio negro", "#3d3d3f"],
  [["titanio blanco", "white titanium"], "Titanio blanco", "#eceae6"],
  [["titanio azul", "blue titanium"], "Titanio azul", "#3f4b5c"],
  [["titanio desierto", "desert titanium", "desierto"], "Titanio desierto", "#c9b49a"],
  [["medianoche", "midnight"], "Medianoche", "#2b2f36"],
  [["blanco estelar", "starlight", "estelar"], "Blanco estelar", "#f0e9df"],
  [["grafito", "graphite"], "Grafito", "#4a4a4c"],
  [["gris espacial", "space gray", "space grey"], "Gris espacial", "#58585b"],
  [["negro", "black"], "Negro", "#2c2c2e"],
  [["blanco", "white"], "Blanco", "#f2f2f2"],
  [["plateado", "plata", "silver"], "Plata", "#e3e4e5"],
  [["dorado", "oro", "gold"], "Dorado", "#e8d3b0"],
  [["azul sierra", "sierra blue"], "Azul sierra", "#9bb5ce"],
  [["azul pacifico", "pacific blue"], "Azul pacífico", "#2f4f62"],
  [["azul", "blue"], "Azul", "#5b7fa6"],
  [["rojo", "red"], "Rojo", "#c8323c"],
  [["verde alpino", "alpine green"], "Verde alpino", "#55665a"],
  [["verde", "green"], "Verde", "#7d9c86"],
  [["rosa", "pink"], "Rosa", "#f0c4cc"],
  [["violeta", "morado", "purpura", "purple", "lila"], "Violeta", "#b7a6d6"],
  [["amarillo", "yellow"], "Amarillo", "#f3df7a"],
  [["coral"], "Coral", "#ee7762"],
];

// Busca palabras completas: "red" no tiene que saltar adentro de "Redmi".
function detectarColor(nombre) {
  const texto = normalizar(nombre);
  for (const [palabras, etiqueta, hex] of COLORES) {
    if (palabras.some((p) => new RegExp(`(^|[^a-z0-9])${p}([^a-z0-9]|$)`).test(texto))) return { etiqueta, hex };
  }
  return null;
}

// Tipo de equipo, para elegir que dibujo mostrar.
function tipoDeEquipo(p) {
  const texto = normalizar(`${p.nombre} ${p.categoria}`);
  if (/airpods|auricular|buds|earpods/.test(texto)) return "auriculares";
  if (/watch|reloj/.test(texto)) return "reloj";
  if (/ipad|tablet|\btab\b/.test(texto)) return "tablet";
  // Fundas y vidrios antes que cargadores: "Funda MagSafe" es una funda, no un cargador.
  if (/funda|vidrio|templado/.test(texto)) return "telefono";
  if (/cargador|cable|power ?bank|magsafe|adaptador/.test(texto)) return "cargador";
  if (/vaper|vape|elfbar|lost mary|ignite|\bpod\b/.test(texto)) return "vaper";
  if (/iphone|celular|samsung|motorola|xiaomi|redmi|galaxy/.test(texto)) return "telefono";
  return "caja";
}

// ---------- dibujos de los equipos (SVG) ----------
// Aclara (cantidad > 0) u oscurece (cantidad < 0) un color hex.
function ajustarColor(hex, cantidad) {
  const n = parseInt(hex.slice(1), 16);
  const canal = (c) => Math.round(cantidad > 0 ? c + (255 - c) * cantidad : c * (1 + cantidad));
  const r = canal((n >> 16) & 255), g = canal((n >> 8) & 255), b = canal(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function dibujoEquipo(p, idUnico) {
  const base = detectarColor(p.nombre)?.hex ?? "#3a3a3d";
  const claro = ajustarColor(base, 0.28);
  const oscuro = ajustarColor(base, -0.22);
  const grad = `<defs><linearGradient id="g${idUnico}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${claro}"/><stop offset="1" stop-color="${oscuro}"/></linearGradient></defs>`;
  const relleno = `url(#g${idUnico})`;
  const borde = `stroke="rgba(0,0,0,.16)" stroke-width="1.5"`;
  const lente = (cx, cy, r = 9) =>
    `<circle cx="${cx}" cy="${cy}" r="${r + 2.5}" fill="rgba(0,0,0,.18)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#1c1c1e"/><circle cx="${cx - r / 3}" cy="${cy - r / 3}" r="${r / 3.2}" fill="rgba(255,255,255,.28)"/>`;

  switch (tipoDeEquipo(p)) {
    case "telefono":
      return `<svg class="equipo" viewBox="0 0 120 240" aria-hidden="true">${grad}
        <rect x="4" y="4" width="112" height="232" rx="24" fill="${relleno}" ${borde}/>
        <rect x="9" y="9" width="102" height="222" rx="20" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.2"/>
        <rect x="13" y="13" width="50" height="50" rx="14" fill="rgba(255,255,255,.14)" stroke="rgba(0,0,0,.1)"/>
        ${lente(28, 28)}${lente(48, 48)}
        <circle cx="49" cy="27" r="3.4" fill="rgba(255,255,255,.75)"/>
      </svg>`;
    case "tablet":
      return `<svg class="equipo" viewBox="0 0 180 240" aria-hidden="true">${grad}
        <rect x="4" y="4" width="172" height="232" rx="18" fill="${relleno}" ${borde}/>
        <rect x="10" y="10" width="160" height="220" rx="13" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.2"/>
        ${lente(26, 26, 7)}
      </svg>`;
    case "reloj":
      return `<svg class="equipo" viewBox="0 0 140 240" aria-hidden="true">${grad}
        <rect x="38" y="4" width="64" height="70" rx="14" fill="${oscuro}" opacity=".85"/>
        <rect x="38" y="166" width="64" height="70" rx="14" fill="${oscuro}" opacity=".85"/>
        <rect x="14" y="62" width="112" height="116" rx="30" fill="${relleno}" ${borde}/>
        <rect x="24" y="72" width="92" height="96" rx="22" fill="#111113"/>
        <rect x="126" y="96" width="7" height="26" rx="3" fill="${oscuro}"/>
        <text x="70" y="128" text-anchor="middle" font-family="Inter, sans-serif" font-size="24" font-weight="600" fill="rgba(255,255,255,.85)">10:09</text>
      </svg>`;
    case "auriculares":
      return `<svg class="equipo" viewBox="0 0 200 180" aria-hidden="true"><defs><linearGradient id="g${idUnico}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e4e4e8"/></linearGradient></defs>
        <rect x="10" y="20" width="180" height="150" rx="56" fill="url(#g${idUnico})" stroke="rgba(0,0,0,.12)" stroke-width="1.5"/>
        <path d="M14 70 H186" stroke="rgba(0,0,0,.12)" stroke-width="1.5"/>
        <circle cx="100" cy="108" r="4" fill="rgba(0,0,0,.18)"/>
      </svg>`;
    case "cargador":
      return `<svg class="equipo" viewBox="0 0 160 240" aria-hidden="true"><defs><linearGradient id="g${idUnico}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e2e2e6"/></linearGradient></defs>
        <path d="M80 112 C80 170 40 170 40 214" fill="none" stroke="#f3f3f5" stroke-width="10" stroke-linecap="round"/>
        <path d="M80 112 C80 170 40 170 40 214" fill="none" stroke="rgba(0,0,0,.1)" stroke-width="11" stroke-linecap="round" opacity=".4"/>
        <rect x="30" y="20" width="100" height="100" rx="20" fill="url(#g${idUnico})" stroke="rgba(0,0,0,.12)" stroke-width="1.5"/>
        <rect x="68" y="56" width="24" height="10" rx="4" fill="rgba(0,0,0,.2)"/>
        <rect x="32" y="206" width="16" height="26" rx="4" fill="#d9d9de"/>
      </svg>`;
    case "vaper":
      return `<svg class="equipo" viewBox="0 0 90 240" aria-hidden="true">${grad}
        <rect x="27" y="4" width="36" height="38" rx="12" fill="#1c1c1e" opacity=".85"/>
        <rect x="12" y="34" width="66" height="200" rx="26" fill="${relleno}" ${borde}/>
        <rect x="20" y="44" width="10" height="170" rx="5" fill="rgba(255,255,255,.18)"/>
      </svg>`;
    default:
      return `<svg class="equipo" viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="g${idUnico}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dedee3"/></linearGradient></defs>
        <path d="M100 18 L178 58 L178 142 L100 182 L22 142 L22 58 Z" fill="url(#g${idUnico})" stroke="rgba(0,0,0,.12)" stroke-width="1.5"/>
        <path d="M22 58 L100 98 L178 58 M100 98 V182" fill="none" stroke="rgba(0,0,0,.12)" stroke-width="1.5"/>
      </svg>`;
  }
}

const ICONO_WHATSAPP = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5A11.8 11.8 0 0 0 12 0C5.4 0 .1 5.3.1 11.9c0 2.1.6 4.1 1.6 5.9L0 24l6.4-1.7a11.9 11.9 0 0 0 5.6 1.4h.1c6.6 0 11.9-5.3 11.9-11.9 0-3.2-1.2-6.2-3.5-8.3zM12 21.7c-1.8 0-3.5-.5-5-1.4l-.4-.2-3.8 1 1-3.7-.2-.4a9.8 9.8 0 0 1-1.5-5.2c0-5.4 4.4-9.9 9.9-9.9 2.6 0 5.1 1 7 2.9a9.8 9.8 0 0 1 2.9 7c0 5.5-4.4 9.9-9.9 9.9zm5.4-7.4c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1-.8 1-.9 1.2-.3.2-.6.1a8.1 8.1 0 0 1-4-3.5c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6a1.1 1.1 0 0 0-.8.4 3.4 3.4 0 0 0-1.1 2.5c0 1.5 1.1 2.9 1.2 3.1s2.1 3.2 5.1 4.5c1.9.8 2.6.9 3.6.7.6-.1 1.8-.7 2-1.5s.3-1.3.2-1.5c-.1-.1-.3-.2-.6-.3z" fill="currentColor"/></svg>`;
const ICONO_BUSCAR_VACIO = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/><path d="M8.5 11h5"/></svg>`;

const ICONO_FLECHA = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;
const ICONO_CERRAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

// ---------- estado ----------
const estado = { productos: [], tienda: null, dolar: null, categoria: "Todos", busqueda: "", orden: "destacados" };

function linkWhatsapp(texto) {
  return `https://wa.me/${estado.tienda.whatsapp}?text=${encodeURIComponent(texto)}`;
}

function buscarProducto(id) {
  return estado.productos.find((x) => x.id === id);
}

// ---------- memorias ----------
// Memoria elegida en cada producto (id -> indice). Arranca en la primera que haya en stock.
const memoriaElegida = new Map();

function indiceMemoria(p) {
  if (!memoriaElegida.has(p.id)) memoriaElegida.set(p.id, Math.max(p.memorias.findIndex((m) => m.disponible), 0));
  return memoriaElegida.get(p.id);
}

// ---------- bateria (equipos usados en stock) ----------
// En los usados, el cliente elige entre los equipos de ese modelo que hay en stock segun la
// bateria. Equipo elegido en cada producto: id -> indice en p.unidades.
const unidadElegida = new Map();

// Los equipos que se pueden elegir: los de la memoria elegida (o todos, si no hay memorias).
function unidadesVisibles(p) {
  if (!p.unidades?.length) return [];
  if (!p.memorias.length) return p.unidades;
  const capacidad = normalizar(p.memorias[indiceMemoria(p)].capacidad).replace(/\s/g, "");
  return p.unidades.filter((u) => !u.capacidad || normalizar(u.capacidad).replace(/\s/g, "") === capacidad);
}

// El equipo elegido; si el elegido no es de la memoria actual, el de mejor bateria.
function unidadActual(p) {
  const visibles = unidadesVisibles(p);
  return visibles.find((u) => p.unidades.indexOf(u) === unidadElegida.get(p.id)) ?? visibles[0] ?? null;
}

// ---------- precios ----------
// Precio que se muestra en la ficha: el del equipo elegido (si tiene), si no el de la memoria
// elegida, y si no hay memorias el de la publicacion.
function precioActual(p) {
  const unidad = unidadActual(p);
  if (unidad && unidad.precio != null) return { precio: unidad.precio, moneda: unidad.moneda };
  return { precio: p.memorias.length ? p.memorias[indiceMemoria(p)].precio : p.precio, moneda: p.moneda };
}

function aDolares(precio, moneda) {
  return precio != null && moneda === "ARS" && estado.dolar ? precio / estado.dolar : precio;
}

// Todos los precios posibles de una publicacion (memorias en stock y equipos usados).
function preciosPosibles(p) {
  const deMemorias = p.memorias.length
    ? p.memorias.filter((m) => m.disponible || !p.disponible).map((m) => ({ precio: m.precio, moneda: p.moneda }))
    : [{ precio: p.precio, moneda: p.moneda }];
  const deUnidades = (p.unidades ?? []).map((u) => ({ precio: u.precio, moneda: u.moneda }));
  return [...deMemorias, ...deUnidades].filter((x) => x.precio != null && !Number.isNaN(x.precio));
}

// Para la tarjeta: el mas barato, y si hay varios precios distintos se aclara "Desde".
function precioDesde(p) {
  const precios = preciosPosibles(p);
  if (!precios.length) return null;
  const minimo = precios.reduce((a, b) => (aDolares(b.precio, b.moneda) < aDolares(a.precio, a.moneda) ? b : a));
  const distintos = new Set(precios.map((x) => `${x.moneda}${x.precio}`)).size > 1;
  return { ...minimo, desde: distintos };
}

// Para ordenar por precio: el mas barato de lo que haya (en dolares, si hay cotizacion).
function precioParaOrdenar(p) {
  const precios = preciosPosibles(p).map((x) => aDolares(x.precio, x.moneda));
  return precios.length ? Math.min(...precios) : Infinity;
}

// Pila chiquita, llena segun el % (verde si esta muy bien, naranja si esta baja).
function iconoBateria(porcentaje) {
  const nivel = porcentaje >= 90 ? "alta" : porcentaje >= 80 ? "media" : "baja";
  const ancho = Math.max(2, Math.round((14 * porcentaje) / 100));
  return `<svg class="pila pila-${nivel}" viewBox="0 0 20 10" aria-hidden="true"><rect x="0.6" y="0.6" width="16.8" height="8.8" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="18.2" y="3.2" width="1.4" height="3.6" rx="0.6" fill="currentColor"/><rect x="2" y="2" width="${ancho}" height="6" rx="1.2" class="pila-carga"/></svg>`;
}

function productosFiltrados() {
  const terminos = normalizar(estado.busqueda).split(/\s+/).filter(Boolean);
  let lista = estado.productos.filter((p) => {
    if (estado.categoria !== "Todos" && p.categoria !== estado.categoria) return false;
    const texto = normalizar(
      [p.nombre, p.categoria, p.estado, p.detalle, ...p.memorias.map((m) => m.capacidad), ...p.fotos.map((f) => f.color), ...(p.unidades ?? []).map((u) => `${u.bateria}%`)]
        .filter(Boolean)
        .join(" ")
    );
    return terminos.every((t) => texto.includes(t));
  });
  if (estado.orden === "precio-asc") lista = [...lista].sort((a, b) => precioParaOrdenar(a) - precioParaOrdenar(b));
  if (estado.orden === "precio-desc") lista = [...lista].sort((a, b) => (precioParaOrdenar(b) === Infinity ? -1 : precioParaOrdenar(b)) - (precioParaOrdenar(a) === Infinity ? -1 : precioParaOrdenar(a)));
  if (estado.orden === "nombre") lista = [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  // "Destacados" es el orden que se armo en el panel, con lo que esta en stock primero.
  if (estado.orden === "destacados") lista = [...lista].sort((a, b) => Number(b.disponible) - Number(a.disponible) || estado.productos.indexOf(a) - estado.productos.indexOf(b));
  return lista;
}

// ---------- fotos y colores ----------
// Color elegido en cada producto (id -> indice de foto).
const colorElegido = new Map();

// Si el nombre del producto dice un color que tiene foto ("... naranja"), arranca en ese.
function colorInicial(p) {
  const nombre = normalizar(p.nombre);
  const i = p.fotos.findIndex((f) => {
    const palabras = normalizar(f.color).split(/\s+/).filter((w) => w.length > 2 && w !== "titanio");
    return palabras.length && palabras.every((w) => new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(nombre));
  });
  return Math.max(i, 0);
}

function fotoElegida(p) {
  if (!colorElegido.has(p.id)) colorElegido.set(p.id, colorInicial(p));
  return p.fotos[colorElegido.get(p.id)];
}

function mensajeWhatsapp(p) {
  const foto = p.fotos.length > 1 ? fotoElegida(p) : null;
  const memoria = p.memorias.length ? p.memorias[indiceMemoria(p)] : null;
  const unidad = unidadActual(p);
  const descripcion = `${p.nombre}${p.estado ? ` (${p.estado})` : ""}${memoria ? ` de ${memoria.capacidad}` : ""}${foto ? ` en ${foto.color}` : ""}${unidad ? ` con batería ${unidad.bateria}%` : ""}`;
  if (!p.disponible) return `Hola! Vi ${descripcion} en el catálogo, que figura sin stock. ¿Te va a volver a entrar?`;
  const { precio, moneda } = precioActual(p);
  return `Hola! Me interesa ${descripcion}${precio != null ? ` (${formatoPrecio(precio, moneda)})` : ""} que vi en el catálogo. ¿Está disponible?`;
}

// ---------- tarjetas de la grilla ----------
// La tarjeta es un resumen (foto, nombre, estado, memorias, colores y precio "desde"); todo lo
// que se elige va en la ficha, que se abre al tocarla.
function imagenProducto(p, idUnico) {
  const foto = p.fotos.length ? fotoElegida(p) : null;
  return foto
    ? `<img class="foto-producto" src="${foto.url}" alt="${escapeHtml(`${p.nombre} ${foto.color}`)}" loading="lazy" decoding="async" />`
    : dibujoEquipo(p, idUnico);
}

function insignias(p) {
  return `<div class="insignias">${p.estado ? `<span class="insignia insignia-estado" data-estado="${escapeHtml(normalizar(p.estado).replace(/[^a-z]+/g, "-"))}">${escapeHtml(p.estado)}</span>` : ""}${
    p.disponible ? "" : `<span class="insignia insignia-agotado">Sin stock</span>`
  }</div>`;
}

function resumenOpciones(p) {
  const lineas = [];
  if (p.memorias.length) {
    const disponibles = p.memorias.filter((m) => m.disponible || !p.disponible).map((m) => m.capacidad);
    if (disponibles.length) lineas.push(disponibles.join(" · "));
  }
  if (p.unidades?.length) {
    const baterias = p.unidades.map((u) => u.bateria);
    const min = Math.min(...baterias), max = Math.max(...baterias);
    const rango = `<span class="sin-corte">${min === max ? `${max}%` : `${min}–${max}%`}</span>`;
    lineas.push(`${iconoBateria(max)}<span>${p.unidades.length === 1 ? `Batería ${rango}` : `${p.unidades.length} equipos · batería ${rango}`}</span>`);
  }
  if (p.detalle) lineas.push(escapeHtml(p.detalle));
  return lineas.map((l) => `<span class="resumen-linea">${l.includes("<svg") ? l : escapeHtml(l)}</span>`).join("");
}

function puntosColores(p) {
  if (p.fotos.length < 2) return "";
  const max = 6;
  return `<div class="puntos-colores" aria-label="${p.fotos.length} colores">${p.fotos
    .slice(0, max)
    .map((f) => `<span class="punto" style="--color:${f.hex ?? "#c7c7cc"}" title="${escapeHtml(f.color)}"></span>`)
    .join("")}${p.fotos.length > max ? `<span class="puntos-mas">+${p.fotos.length - max}</span>` : ""}</div>`;
}

function htmlPrecioTarjeta(p) {
  const desde = precioDesde(p);
  if (!desde) return `<span class="precio-consultar">Consultar precio</span>`;
  return `${desde.desde ? `<span class="precio-desde">Desde</span>` : ""}<span class="precio-valor">${formatoPrecio(desde.precio, desde.moneda)}</span>${
    desde.moneda === "USD" && estado.dolar ? `<span class="precio-equivalente">≈ ${formatoPrecio(desde.precio * estado.dolar, "ARS")}</span>` : ""
  }`;
}

function tarjetaProducto(p, i) {
  return `
    <a class="producto${p.disponible ? "" : " agotado"}" href="#p-${p.id}" data-id="${p.id}" style="--i:${Math.min(i, 12)}" aria-label="${escapeHtml(`Ver ${p.nombre}${p.estado ? `, ${p.estado}` : ""}`)}">
      <div class="producto-imagen${p.fotos.length ? " con-foto" : ""}">
        ${imagenProducto(p, p.id)}
        ${insignias(p)}
      </div>
      <div class="producto-cuerpo">
        <span class="producto-categoria">${escapeHtml(p.categoria)}</span>
        <h2 class="producto-nombre">${escapeHtml(p.nombre)}</h2>
        <div class="producto-resumen">${resumenOpciones(p)}</div>
        ${puntosColores(p)}
        <div class="producto-pie">
          <div class="precio">${htmlPrecioTarjeta(p)}</div>
          <span class="producto-ver" aria-hidden="true">${ICONO_FLECHA}</span>
        </div>
      </div>
    </a>`;
}

// ---------- ficha del producto ----------
function htmlPrecio(p) {
  const { precio, moneda } = precioActual(p);
  return precio != null
    ? `<span class="precio-valor">${formatoPrecio(precio, moneda)}</span>${
        moneda === "USD" && estado.dolar ? `<span class="precio-equivalente">≈ ${formatoPrecio(precio * estado.dolar, "ARS")} al dólar blue</span>` : ""
      }`
    : `<span class="precio-consultar">Consultar precio</span>`;
}

// Botones de memoria ("128 GB · 256 GB · 512 GB"). Las que no hay quedan tachadas y no se
// pueden elegir (salvo que la publicacion entera este sin stock: ahi se ven todas igual).
function selectorMemorias(p) {
  if (!p.memorias.length) return "";
  const actual = indiceMemoria(p);
  return `<div class="opcion">
    <span class="opcion-titulo">Memoria</span>
    <div class="memorias" role="radiogroup" aria-label="Memoria">
      ${p.memorias
        .map((m, i) => {
          const agotada = !m.disponible && p.disponible;
          return `<button type="button" class="memoria${i === actual ? " activo" : ""}${agotada ? " agotada" : ""}" role="radio" aria-checked="${i === actual}" ${agotada ? 'disabled title="Sin stock"' : ""} data-indice="${i}">${escapeHtml(m.capacidad)}${agotada ? `<small>Sin stock</small>` : ""}</button>`;
        })
        .join("")}
    </div>
  </div>`;
}

function selectorColores(p) {
  if (p.fotos.length < 2) return "";
  const actual = colorElegido.get(p.id);
  return `<div class="opcion">
    <span class="opcion-titulo">Color <b class="color-nombre">${escapeHtml(p.fotos[actual].color)}</b></span>
    <div class="colores" role="radiogroup" aria-label="Colores">
      ${p.fotos
        .map(
          (f, i) =>
            `<button type="button" class="color${i === actual ? " activo" : ""}" role="radio" aria-checked="${i === actual}" aria-label="${escapeHtml(f.color)}" title="${escapeHtml(f.color)}" data-indice="${i}" style="--color:${f.hex ?? "#c7c7cc"}"></button>`
        )
        .join("")}
    </div>
  </div>`;
}

function selectorBaterias(p) {
  const visibles = unidadesVisibles(p);
  if (!visibles.length) return `<div class="opcion opcion-baterias" hidden></div>`;
  const actual = unidadActual(p);
  return `<div class="opcion opcion-baterias">
    <span class="opcion-titulo">Batería <small>Elegí el equipo según la condición de batería</small></span>
    <div class="baterias" role="radiogroup" aria-label="Batería">
      ${visibles
        .map((u) => {
          const i = p.unidades.indexOf(u);
          return `<button type="button" class="bateria${u === actual ? " activo" : ""}" role="radio" aria-checked="${u === actual}" data-unidad="${i}" title="Condición de batería ${u.bateria}%">${iconoBateria(u.bateria)}<span>${u.bateria}%</span>${
            u.precio != null && visibles.some((v) => v.precio !== u.precio) ? `<small>${formatoPrecio(u.precio, u.moneda)}</small>` : ""
          }</button>`;
        })
        .join("")}
    </div>
  </div>`;
}

function fichaProducto(p) {
  const foto = p.fotos.length ? fotoElegida(p) : null;
  return `
    <div class="ficha-cuerpo" data-id="${p.id}">
      <button type="button" class="ficha-cerrar" data-cerrar aria-label="Cerrar">${ICONO_CERRAR}</button>
      <div class="ficha-galeria">
        <div class="ficha-foto producto-imagen${foto ? " con-foto" : ""}${p.disponible ? "" : " agotado"}">
          ${imagenProducto(p, `f${p.id}`)}
          ${insignias(p)}
        </div>
      </div>
      <div class="ficha-info">
        <span class="producto-categoria">${escapeHtml(p.categoria)}</span>
        <h2 class="ficha-nombre" id="ficha-nombre">${escapeHtml(p.nombre)}</h2>
        ${p.detalle ? `<p class="ficha-detalle">${escapeHtml(p.detalle)}</p>` : ""}
        <div class="ficha-opciones">
          ${selectorMemorias(p)}
          ${selectorColores(p)}
          ${selectorBaterias(p)}
        </div>
        <div class="ficha-compra">
          <div class="precio ficha-precio">${htmlPrecio(p)}</div>
          <span class="disponibilidad${p.disponible ? "" : " agotado"}">${p.disponible ? "Disponible" : "Sin stock por ahora"}</span>
          ${
            estado.tienda.whatsapp
              ? `<a class="btn btn-whatsapp btn-grande btn-consultar" href="${linkWhatsapp(mensajeWhatsapp(p))}" target="_blank" rel="noopener">${ICONO_WHATSAPP}${p.disponible ? "Consultar por WhatsApp" : "Avisame cuando entre"}</a>`
              : ""
          }
        </div>
      </div>
    </div>`;
}

function fichaActual() {
  return document.querySelector("#ficha .ficha-cuerpo");
}

function refrescarPrecioYMensaje(p) {
  const ficha = fichaActual();
  const precio = ficha.querySelector(".ficha-precio");
  precio.innerHTML = htmlPrecio(p);
  precio.classList.remove("cambio");
  void precio.offsetWidth;
  precio.classList.add("cambio");
  const boton = ficha.querySelector(".btn-consultar");
  if (boton) boton.href = linkWhatsapp(mensajeWhatsapp(p));
}

function marcarActivo(botones, esActivo) {
  botones.forEach((b) => {
    const activo = esActivo(b);
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-checked", String(activo));
  });
}

function cambiarMemoria(p, indice) {
  if (memoriaElegida.get(p.id) === indice) return;
  memoriaElegida.set(p.id, indice);
  const ficha = fichaActual();
  marcarActivo(ficha.querySelectorAll(".memoria"), (b) => Number(b.dataset.indice) === indice);
  // Al cambiar de memoria cambian los equipos (baterias) que se pueden elegir.
  ficha.querySelector(".opcion-baterias").outerHTML = selectorBaterias(p);
  refrescarPrecioYMensaje(p);
}

function cambiarBateria(p, indiceUnidad) {
  if (unidadActual(p) === p.unidades[indiceUnidad]) return;
  unidadElegida.set(p.id, indiceUnidad);
  marcarActivo(fichaActual().querySelectorAll(".bateria"), (b) => Number(b.dataset.unidad) === indiceUnidad);
  refrescarPrecioYMensaje(p);
}

// Cambia la foto (en la ficha y en la tarjeta de atras) con un fundido corto, esperando a que la
// nueva ya este cargada (asi no se ve un hueco en blanco mientras baja).
function cambiarColor(p, indice) {
  if (colorElegido.get(p.id) === indice) return;
  colorElegido.set(p.id, indice);
  const foto = p.fotos[indice];
  const ficha = fichaActual();
  marcarActivo(ficha.querySelectorAll(".color"), (b) => Number(b.dataset.indice) === indice);
  ficha.querySelector(".color-nombre").textContent = foto.color;
  refrescarPrecioYMensaje(p);
  const imagenes = [ficha.querySelector(".foto-producto"), document.querySelector(`.producto[data-id="${p.id}"] .foto-producto`)].filter(Boolean);
  const nueva = new Image();
  nueva.onload = () => {
    imagenes.forEach((img) => img.classList.add("cambiando"));
    setTimeout(() => {
      imagenes.forEach((img) => {
        img.src = foto.url;
        img.alt = `${p.nombre} ${foto.color}`;
        img.classList.remove("cambiando");
      });
    }, 160);
  };
  nueva.src = foto.url;
}

// La ficha se maneja con la direccion (#p-ID): asi el boton "atras" del celular la cierra y el
// link se puede pasar. Si se abrio tocando una tarjeta, cerrar es volver atras; si se entro
// directo con el link, cerrar limpia la direccion.
const dialogoFicha = document.getElementById("ficha");
let fichaDesdeLaLista = false;

function idEnDireccion() {
  const m = /^#p-(\d+)$/.exec(location.hash);
  return m ? Number(m[1]) : null;
}

function abrirFicha(id) {
  const p = buscarProducto(id);
  if (!p) return;
  document.getElementById("ficha-contenido").innerHTML = fichaProducto(p);
  dialogoFicha.classList.remove("cerrando");
  if (!dialogoFicha.open) dialogoFicha.showModal();
  document.documentElement.classList.add("ficha-abierta");
  dialogoFicha.querySelector(".ficha-cerrar").focus({ preventScroll: true });
  document.title = `${p.nombre} · Catálogo`;
}

function ocultarFicha() {
  if (!dialogoFicha.open) return;
  document.documentElement.classList.remove("ficha-abierta");
  document.title = "Catálogo";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return dialogoFicha.close();
  dialogoFicha.classList.add("cerrando");
  setTimeout(() => {
    dialogoFicha.classList.remove("cerrando");
    if (idEnDireccion() == null) dialogoFicha.close();
  }, 220);
}

function cerrarFicha() {
  if (fichaDesdeLaLista) {
    fichaDesdeLaLista = false;
    history.back();
  } else {
    history.replaceState(null, "", location.pathname + location.search);
    ocultarFicha();
  }
}

function sincronizarFicha() {
  const id = idEnDireccion();
  if (id != null) return abrirFicha(id);
  fichaDesdeLaLista = false; // se cerro con "atras": la proxima vez arranca de cero
  ocultarFicha();
}

window.addEventListener("hashchange", sincronizarFicha);

dialogoFicha.addEventListener("cancel", (ev) => {
  ev.preventDefault(); // Escape: que cierre con la misma animacion y arregle la direccion
  cerrarFicha();
});

dialogoFicha.addEventListener("click", (ev) => {
  // clic en el fondo oscuro (afuera de la ficha) o en la X
  if (ev.target === dialogoFicha || ev.target.closest("[data-cerrar]")) return cerrarFicha();
  const ficha = fichaActual();
  const p = ficha && buscarProducto(Number(ficha.dataset.id));
  if (!p) return;
  const color = ev.target.closest(".color");
  if (color) return cambiarColor(p, Number(color.dataset.indice));
  const memoria = ev.target.closest(".memoria");
  if (memoria && !memoria.disabled) return cambiarMemoria(p, Number(memoria.dataset.indice));
  const bateria = ev.target.closest(".bateria");
  if (bateria) cambiarBateria(p, Number(bateria.dataset.unidad));
});

// ---------- dibujo de la pagina ----------
function dibujarCategorias() {
  const cuenta = { Todos: estado.productos.length };
  for (const p of estado.productos) cuenta[p.categoria] = (cuenta[p.categoria] ?? 0) + 1;
  const categorias = ["Todos", ...Object.keys(cuenta).filter((c) => c !== "Todos").sort((a, b) => cuenta[b] - cuenta[a] || a.localeCompare(b, "es"))];
  document.getElementById("categorias").innerHTML = categorias
    .map(
      (c) =>
        `<button type="button" class="chip${c === estado.categoria ? " activo" : ""}" role="tab" aria-selected="${c === estado.categoria}" data-categoria="${escapeHtml(c)}">${escapeHtml(c)}<span class="cantidad">${cuenta[c]}</span></button>`
    )
    .join("");
}

function dibujarProductos() {
  const lista = productosFiltrados();
  const grilla = document.getElementById("grilla");
  document.getElementById("resultado-info").textContent = estado.productos.length
    ? `${lista.length} ${lista.length === 1 ? "producto" : "productos"}${estado.categoria !== "Todos" ? ` en ${estado.categoria}` : ""}${estado.busqueda ? ` para "${estado.busqueda}"` : ""}`
    : "";
  if (!lista.length) {
    grilla.innerHTML = estado.productos.length
      ? `<div class="vacio">${ICONO_BUSCAR_VACIO}<strong>No encontramos nada con esa búsqueda</strong>Probá con otras palabras o mirá todo el catálogo.<br /><button type="button" class="btn btn-oscuro btn-chico" id="limpiar-filtros">Ver todo</button></div>`
      : `<div class="vacio">${ICONO_BUSCAR_VACIO}<strong>Por ahora no hay productos disponibles</strong>Escribinos y te avisamos cuando entre stock.</div>`;
    document.getElementById("limpiar-filtros")?.addEventListener("click", limpiarFiltros);
    return;
  }
  grilla.innerHTML = lista.map(tarjetaProducto).join("");
}

function mostrarEsqueleto() {
  const tarjeta = `
    <div class="producto esqueleto" aria-hidden="true">
      <div class="producto-imagen"><div class="esqueleto-bloque"></div></div>
      <div class="producto-cuerpo">
        <div class="esqueleto-bloque" style="width:35%;height:10px"></div>
        <div class="esqueleto-bloque" style="width:80%;height:16px;margin-top:6px"></div>
        <div class="esqueleto-bloque" style="width:50%;height:12px;margin-top:6px"></div>
        <div class="esqueleto-bloque" style="width:45%;height:22px;margin-top:22px"></div>
      </div>
    </div>`;
  document.getElementById("grilla").innerHTML = tarjeta.repeat(8);
}

function limpiarFiltros() {
  estado.categoria = "Todos";
  estado.busqueda = "";
  document.getElementById("buscar").value = "";
  dibujarCategorias();
  dibujarProductos();
}

// ---------- tema claro / oscuro ----------
const COLOR_BARRA_TEMA = { claro: "#f5f5f7", oscuro: "#0b0b0d" };

function aplicarTema(tema, conTransicion) {
  const raiz = document.documentElement;
  if (conTransicion && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    raiz.classList.add("tema-transicion");
    setTimeout(() => raiz.classList.remove("tema-transicion"), 450);
  }
  raiz.dataset.tema = tema;
  document.querySelector('meta[name="theme-color"]').setAttribute("content", COLOR_BARRA_TEMA[tema]);
  const boton = document.getElementById("cambiar-tema");
  const texto = tema === "oscuro" ? "Cambiar a fondo claro" : "Cambiar a fondo oscuro";
  boton.setAttribute("aria-label", texto);
  boton.title = texto;
}

aplicarTema(document.documentElement.dataset.tema === "oscuro" ? "oscuro" : "claro", false);

document.getElementById("cambiar-tema").addEventListener("click", () => {
  const nuevo = document.documentElement.dataset.tema === "oscuro" ? "claro" : "oscuro";
  aplicarTema(nuevo, true);
  try {
    localStorage.setItem("catalogo_tema", nuevo);
  } catch {
    /* sin almacenamiento (ej: navegacion privada): el cambio vale hasta recargar */
  }
});

// ---------- eventos ----------
document.getElementById("categorias").addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (!chip) return;
  estado.categoria = chip.dataset.categoria;
  dibujarCategorias();
  dibujarProductos();
  chip.scrollIntoView?.({ inline: "nearest", block: "nearest" });
});

// Tocar una tarjeta abre la ficha (el link cambia la direccion a #p-ID y eso la abre).
document.getElementById("grilla").addEventListener("click", (ev) => {
  if (ev.target.closest(".producto[href]")) fichaDesdeLaLista = true;
});

let temporizadorBusqueda;
document.getElementById("buscar").addEventListener("input", (ev) => {
  clearTimeout(temporizadorBusqueda);
  temporizadorBusqueda = setTimeout(() => {
    estado.busqueda = ev.target.value.trim();
    dibujarProductos();
  }, 160);
});

document.getElementById("orden").addEventListener("change", (ev) => {
  estado.orden = ev.target.value;
  dibujarProductos();
});

// La barra de busqueda queda pegada arriba al bajar; con sombra solo cuando ya esta pegada.
const herramientas = document.querySelector(".herramientas");
new IntersectionObserver(([e]) => herramientas.classList.toggle("pegada", e.intersectionRatio < 1), { rootMargin: "-62px 0px 0px 0px", threshold: [1] }).observe(
  herramientas
);

// ---------- arranque ----------
async function iniciar() {
  mostrarEsqueleto();
  try {
    const resp = await fetch("/api/catalogo");
    if (!resp.ok) throw new Error();
    const datos = await resp.json();
    estado.productos = datos.productos;
    estado.tienda = datos.tienda;
    estado.dolar = datos.dolar_blue_venta;

    const disponibles = datos.productos.filter((p) => p.disponible).length;
    document.getElementById("hero-etiqueta").textContent = `${disponibles} ${disponibles === 1 ? "producto disponible" : "productos disponibles"} hoy`;
    // Datos cortos debajo del titulo, solo de lo que de verdad hay en el catalogo.
    const datosHero = [
      datos.productos.some((p) => p.estado === "Sellado") ? "Equipos sellados" : null,
      datos.productos.some((p) => p.unidades?.length) ? "Usados: elegís según la batería" : null,
      estado.dolar ? `Dólar blue hoy ${formatoPrecio(estado.dolar, "ARS")}` : null,
    ].filter(Boolean);
    document.getElementById("hero-datos").innerHTML = datosHero.map((d) => `<li>${escapeHtml(d)}</li>`).join("");
    if (datos.tienda.whatsapp) {
      const link = linkWhatsapp("Hola! Vi el catálogo y quería hacer una consulta.");
      for (const id of ["whatsapp-barra", "whatsapp-flotante", "whatsapp-contacto"]) {
        const el = document.getElementById(id);
        el.href = link;
        el.classList.remove("oculto");
      }
      document.getElementById("contacto").classList.remove("oculto");
    }
    if (estado.dolar) {
      document.getElementById("pie-texto").textContent = `Precios en dólares convertidos al dólar blue (${formatoPrecio(estado.dolar, "ARS")}) como referencia. Precios sujetos a cambio sin previo aviso.`;
    }
    dibujarCategorias();
    dibujarProductos();
    if (idEnDireccion() != null) abrirFicha(idEnDireccion());
  } catch {
    document.getElementById("grilla").innerHTML = `<div class="vacio">${ICONO_BUSCAR_VACIO}<strong>No pudimos cargar el catálogo</strong>Probá recargar la página en un ratito.</div>`;
  }
}

iniciar();
