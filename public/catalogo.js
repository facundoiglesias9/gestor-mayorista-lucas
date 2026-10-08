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

// ---------- datos que se sacan del nombre del producto ----------
// Los productos no tienen foto ni campos de color/capacidad: se deducen del nombre
// ("iPhone 13 128GB Azul 98%") para mostrarlos prolijos y para pintar el dibujo del equipo.
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

const ESTADOS = [
  [/\bsellad[oa]s?\b/, "Nuevo sellado"],
  [/\bsemi(\s?nuevo)?\b/, "Seminuevo"],
  [/\busad[oa]s?\b/, "Usado"],
  [/\bnuev[oa]s?\b/, "Nuevo"],
];

function detallesDelNombre(nombre) {
  const detalles = [];
  // Capacidad: "128GB", "1TB", o el numero solo si es una capacidad tipica ("Iphone 17 pro max 256").
  const capacidad = /(\d+)\s?(gb|tb)\b/i.exec(nombre) ?? (/iphone|ipad|galaxy|xiaomi|redmi|motorola/i.test(nombre) && /\b(64|128|256|512)\b/.exec(nombre));
  if (capacidad) detalles.push({ texto: `${capacidad[1]} ${(capacidad[2] ?? "gb").toUpperCase()}` });
  const estado = ESTADOS.find(([regex]) => regex.test(normalizar(nombre)));
  if (estado) detalles.push({ texto: estado[1] });
  const color = detectarColor(nombre);
  if (color) detalles.push({ texto: color.etiqueta, color: color.hex });
  const bateria = /\b(\d{2,3})\s?%/.exec(nombre);
  if (bateria && Number(bateria[1]) <= 100) detalles.push({ texto: `Batería ${bateria[1]}%` });
  return detalles;
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

// Para "Destacados": primero los iPhone, del modelo mas nuevo al mas viejo; despues el resto.
function puntajeDestacado(p) {
  const iphone = /iphone\s*(\d+)/i.exec(p.nombre);
  if (iphone) return 1000 + Number(iphone[1]) * 10 + (/pro max/i.test(p.nombre) ? 3 : /pro/i.test(p.nombre) ? 2 : /plus/i.test(p.nombre) ? 1 : 0);
  return tipoDeEquipo(p) === "telefono" ? 500 : 0;
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

// ---------- estado ----------
const estado = { productos: [], tienda: null, dolar: null, categoria: "Todos", busqueda: "", orden: "destacados" };

function linkWhatsapp(texto) {
  return `https://wa.me/${estado.tienda.whatsapp}?text=${encodeURIComponent(texto)}`;
}

function productosFiltrados() {
  const terminos = normalizar(estado.busqueda).split(/\s+/).filter(Boolean);
  let lista = estado.productos.filter((p) => {
    if (estado.categoria !== "Todos" && p.categoria !== estado.categoria) return false;
    const texto = normalizar(`${p.nombre} ${p.categoria} ${detallesDelNombre(p.nombre).map((d) => d.texto).join(" ")}`);
    return terminos.every((t) => texto.includes(t));
  });
  const precioOrden = (p) => (p.precio == null ? Infinity : p.moneda === "ARS" && estado.dolar ? p.precio / estado.dolar : p.precio);
  if (estado.orden === "precio-asc") lista = [...lista].sort((a, b) => precioOrden(a) - precioOrden(b));
  if (estado.orden === "precio-desc") lista = [...lista].sort((a, b) => (precioOrden(b) === Infinity ? -1 : precioOrden(b)) - (precioOrden(a) === Infinity ? -1 : precioOrden(a)));
  if (estado.orden === "nombre") lista = [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  if (estado.orden === "destacados") lista = [...lista].sort((a, b) => puntajeDestacado(b) - puntajeDestacado(a) || a.nombre.localeCompare(b.nombre, "es"));
  return lista;
}

// ---------- fotos y colores ----------
// Color elegido en cada tarjeta (id de producto -> indice de foto).
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
  return `Hola! Me interesa ${p.nombre}${foto ? ` en ${foto.color}` : ""}${p.precio != null ? ` (${formatoPrecio(p.precio, p.moneda)})` : ""} que vi en el catálogo. ¿Está disponible?`;
}

function selectorColores(p) {
  if (p.fotos.length < 2) return "";
  const actual = colorElegido.get(p.id);
  return `<div class="colores" role="radiogroup" aria-label="Colores">
    ${p.fotos
      .map(
        (f, i) =>
          `<button type="button" class="color${i === actual ? " activo" : ""}" role="radio" aria-checked="${i === actual}" aria-label="${escapeHtml(f.color)}" title="${escapeHtml(f.color)}" data-producto="${p.id}" data-indice="${i}" style="--color:${f.hex ?? "#c7c7cc"}"></button>`
      )
      .join("")}
    <span class="color-nombre">${escapeHtml(p.fotos[actual].color)}</span>
  </div>`;
}

// Cambia la foto de una tarjeta con un fundido corto, esperando a que la nueva ya este cargada
// (asi no se ve un hueco en blanco mientras baja).
function cambiarColor(idProducto, indice) {
  const p = estado.productos.find((x) => x.id === idProducto);
  if (!p || colorElegido.get(idProducto) === indice) return;
  colorElegido.set(idProducto, indice);
  const tarjeta = document.querySelector(`.producto[data-id="${idProducto}"]`);
  const img = tarjeta.querySelector(".foto-producto");
  const foto = p.fotos[indice];
  tarjeta.querySelectorAll(".color").forEach((b, i) => {
    b.classList.toggle("activo", i === indice);
    b.setAttribute("aria-checked", String(i === indice));
  });
  tarjeta.querySelector(".color-nombre").textContent = foto.color;
  const boton = tarjeta.querySelector(".btn-consultar");
  if (boton) boton.href = linkWhatsapp(mensajeWhatsapp(p));
  const nueva = new Image();
  nueva.onload = () => {
    img.classList.add("cambiando");
    setTimeout(() => {
      img.src = foto.url;
      img.alt = `${p.nombre} ${foto.color}`;
      img.classList.remove("cambiando");
    }, 160);
  };
  nueva.src = foto.url;
}

// ---------- dibujo de la pagina ----------
function tarjetaProducto(p, i) {
  const detalles = detallesDelNombre(p.nombre);
  const foto = p.fotos.length ? fotoElegida(p) : null;
  const precio =
    p.precio != null
      ? `<span class="precio-valor">${formatoPrecio(p.precio, p.moneda)}</span>${
          p.moneda === "USD" && estado.dolar ? `<span class="precio-equivalente">≈ ${formatoPrecio(p.precio * estado.dolar, "ARS")}</span>` : ""
        }`
      : `<span class="precio-consultar">Consultar precio</span>`;
  const mensaje = mensajeWhatsapp(p);
  return `
    <article class="producto" data-id="${p.id}" style="--i:${Math.min(i, 12)}">
      <div class="producto-imagen${foto ? " con-foto" : ""}">
        ${
          foto
            ? `<img class="foto-producto" src="${foto.url}" alt="${escapeHtml(`${p.nombre} ${foto.color}`)}" loading="lazy" decoding="async" />`
            : dibujoEquipo(p, p.id)
        }
        ${p.pocas_unidades ? `<span class="insignia">Últimas unidades</span>` : ""}
      </div>
      <div class="producto-cuerpo">
        <span class="producto-categoria">${escapeHtml(p.categoria)}</span>
        <h2 class="producto-nombre">${escapeHtml(p.nombre)}</h2>
        ${
          detalles.length
            ? `<div class="producto-detalles">${detalles
                .map((d) => `<span class="detalle">${d.color ? `<span class="punto-color" style="background:${d.color}"></span>` : ""}${escapeHtml(d.texto)}</span>`)
                .join("")}</div>`
            : ""
        }
        ${selectorColores(p)}
        <span class="disponibilidad">Disponible</span>
        <div class="producto-pie">
          <div class="precio">${precio}</div>
          ${
            estado.tienda.whatsapp
              ? `<a class="btn btn-whatsapp btn-consultar" href="${linkWhatsapp(mensaje)}" target="_blank" rel="noopener" title="Consultar por WhatsApp" aria-label="Consultar ${escapeHtml(p.nombre)} por WhatsApp">${ICONO_WHATSAPP}</a>`
              : ""
          }
        </div>
      </div>
    </article>`;
}

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
    <article class="producto esqueleto" aria-hidden="true">
      <div class="producto-imagen"><div class="esqueleto-bloque"></div></div>
      <div class="producto-cuerpo">
        <div class="esqueleto-bloque" style="width:35%;height:10px"></div>
        <div class="esqueleto-bloque" style="width:80%;height:16px;margin-top:6px"></div>
        <div class="esqueleto-bloque" style="width:50%;height:12px;margin-top:6px"></div>
        <div class="esqueleto-bloque" style="width:45%;height:22px;margin-top:22px"></div>
      </div>
    </article>`;
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
});

document.getElementById("grilla").addEventListener("click", (ev) => {
  const boton = ev.target.closest(".color");
  if (boton) cambiarColor(Number(boton.dataset.producto), Number(boton.dataset.indice));
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

    document.getElementById("hero-etiqueta").textContent = `${datos.productos.length} productos disponibles hoy`;
    if (datos.tienda.whatsapp) {
      const link = linkWhatsapp("Hola! Vi el catálogo y quería hacer una consulta.");
      for (const id of ["whatsapp-barra", "whatsapp-flotante"]) {
        const el = document.getElementById(id);
        el.href = link;
        el.classList.remove("oculto");
      }
    }
    if (estado.dolar) {
      document.getElementById("pie-texto").textContent = `Precios en dólares convertidos al dólar blue (${formatoPrecio(estado.dolar, "ARS")}) como referencia. Precios sujetos a cambio sin previo aviso.`;
    }
    dibujarCategorias();
    dibujarProductos();
  } catch {
    document.getElementById("grilla").innerHTML = `<div class="vacio">${ICONO_BUSCAR_VACIO}<strong>No pudimos cargar el catálogo</strong>Probá recargar la página en un ratito.</div>`;
  }
}

iniciar();
