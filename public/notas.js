// Seccion "Notas" del panel: notas sueltas tipo post-it. Cada nota se guarda sola mientras se
// escribe (un ratito despues de la ultima tecla) y al salir de ella. Usa api, escapeHtml,
// formatoFecha, plural, ponerSubtitulo, conCarga, mostrarToast y confirmar, de app.js (que carga
// despues: aca solo se usan dentro de funciones).

// Los nombres guardados en la base (amarillo, celeste...) se mantienen; en pantalla cada uno es un
// acento de neon (ver .nota-amarillo, etc. en styles.css).
const COLORES_NOTA = [
  ["amarillo", "Ámbar"],
  ["rosa", "Rosa"],
  ["verde", "Verde"],
  ["celeste", "Cian"],
  ["violeta", "Violeta"],
  ["naranja", "Naranja"],
];
const ICONO_CHINCHE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5h6l-1 5.5 3.5 3.5h-11L10 9z"/><path d="M12 12.5v8"/></svg>`;
const ICONO_NOTA_VACIA = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v9.5L14.5 20.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M20.5 14.5h-4.5a1.5 1.5 0 0 0-1.5 1.5v4.5"/></svg>`;
const ESPERA_GUARDADO_NOTA_MS = 700;

const estadoNotas = { lista: [], busqueda: "", pendientes: new Map() }; // pendientes: id -> temporizador

const grillaNotas = document.getElementById("notas-grilla");

function normalizarNota(texto) {
  return String(texto ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function ordenarNotas() {
  estadoNotas.lista.sort((a, b) => Number(b.fijada) - Number(a.fijada) || String(b.creado_en).localeCompare(String(a.creado_en)) || b.id - a.id);
}

async function cargarNotas() {
  try {
    estadoNotas.lista = await api("GET", "/api/notas");
    ordenarNotas();
    dibujarNotas();
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

function subtituloNotas() {
  const conTexto = estadoNotas.lista.filter((n) => n.texto.trim());
  const fijadas = conTexto.filter((n) => n.fijada).length;
  ponerSubtitulo("sub-notas", conTexto.length ? `${plural(conTexto.length, "nota")}${fijadas ? ` · ${plural(fijadas, "fijada")}` : ""}` : "");
}

function tarjetaNota(n, i = 0) {
  return `<article class="nota nota-${n.color}${n.fijada ? " fijada" : ""}" data-id="${n.id}" style="--i:${Math.min(i, 10)}">
    <header class="nota-cabecera">
      <span class="nota-punto" aria-hidden="true"></span>
      <span class="nota-fecha">${formatoFecha(n.actualizado_en)}</span>
      <span class="nota-chip-fijada">Fijada</span>
      <div class="nota-acciones">
        <button type="button" class="nota-boton nota-fijar" data-accion="fijar" aria-pressed="${n.fijada}" title="${n.fijada ? "Desfijar" : "Fijar arriba"}" aria-label="${n.fijada ? "Desfijar nota" : "Fijar nota arriba"}">${ICONO_CHINCHE}</button>
        <button type="button" class="nota-boton nota-borrar" data-accion="borrar" title="Borrar nota" aria-label="Borrar nota">${ICONO_TACHO}</button>
      </div>
    </header>
    <textarea class="nota-texto" placeholder="Escribí algo…" aria-label="Texto de la nota" maxlength="5000">${escapeHtml(n.texto)}</textarea>
    <footer class="nota-pie">
      <div class="nota-colores" role="radiogroup" aria-label="Color de la nota">${COLORES_NOTA.map(
        ([c, nombre]) =>
          `<button type="button" class="nota-color nota-color-${c}${c === n.color ? " activo" : ""}" role="radio" aria-checked="${c === n.color}" data-color="${c}" title="${nombre}" aria-label="${nombre}"></button>`
      ).join("")}</div>
      <span class="nota-estado" aria-live="polite"></span>
    </footer>
  </article>`;
}

function dibujarNotas() {
  subtituloNotas();
  const termino = normalizarNota(estadoNotas.busqueda.trim());
  const lista = estadoNotas.lista.filter((n) => !termino || normalizarNota(n.texto).includes(termino));
  if (!estadoNotas.lista.length) {
    grillaNotas.innerHTML = `<div class="notas-vacio">${ICONO_NOTA_VACIA}<strong>Todavía no hay notas</strong><span>Tocá «Nueva nota» para pegar la primera: un recordatorio, un pendiente, un número de teléfono…</span></div>`;
    return;
  }
  if (!lista.length) {
    grillaNotas.innerHTML = `<div class="notas-vacio"><strong>No hay notas con «${escapeHtml(estadoNotas.busqueda.trim())}»</strong></div>`;
    return;
  }
  grillaNotas.innerHTML = lista.map((n, i) => tarjetaNota(n, i)).join("");
  ajustarAltosNotas();
  // Si la letra termina de cargar despues, el texto ocupa otro alto: se vuelve a medir.
  document.fonts?.ready.then(ajustarAltosNotas);
}

function ajustarAltosNotas() {
  grillaNotas.querySelectorAll(".nota-texto").forEach(ajustarAltoNota);
}

// El cuadro de texto crece con lo que se escribe (sin barra de desplazamiento adentro).
function ajustarAltoNota(area) {
  area.style.height = "auto";
  area.style.height = `${area.scrollHeight}px`;
}

function notaDe(el) {
  const tarjeta = el.closest(".nota");
  return { tarjeta, nota: tarjeta && estadoNotas.lista.find((n) => n.id === Number(tarjeta.dataset.id)) };
}

// "guardando" (punto que late), "guardado" (tilde) o "error"; null lo esconde.
function mostrarEstadoNota(tarjeta, tipo) {
  const estado = tarjeta?.querySelector(".nota-estado");
  if (!estado) return;
  const textos = { guardando: "Guardando", guardado: "Guardado", error: "No se guardó" };
  estado.className = `nota-estado${tipo ? ` visible ${tipo}` : ""}`;
  if (tipo) estado.textContent = textos[tipo];
}

async function guardarTextoNota(id, texto) {
  clearTimeout(estadoNotas.pendientes.get(id));
  estadoNotas.pendientes.delete(id);
  const nota = estadoNotas.lista.find((n) => n.id === id);
  if (!nota || nota.texto === texto) return;
  const tarjeta = () => grillaNotas.querySelector(`.nota[data-id="${id}"]`);
  mostrarEstadoNota(tarjeta(), "guardando");
  try {
    const guardada = await api("PUT", `/api/notas/${id}`, { texto });
    nota.texto = guardada.texto;
    nota.actualizado_en = guardada.actualizado_en;
    const t = tarjeta();
    if (t) t.querySelector(".nota-fecha").innerHTML = formatoFecha(guardada.actualizado_en);
    mostrarEstadoNota(t, "guardado");
    setTimeout(() => {
      const actual = tarjeta()?.querySelector(".nota-estado");
      if (actual?.classList.contains("guardado")) mostrarEstadoNota(tarjeta(), null);
    }, 1600);
    subtituloNotas();
  } catch (e) {
    mostrarEstadoNota(tarjeta(), "error");
    mostrarToast(e.message, true);
  }
}

async function nuevaNota(boton) {
  await conCarga(boton, async () => {
    try {
      // Va rotando de color, asi las notas seguidas no quedan todas iguales.
      const color = COLORES_NOTA[estadoNotas.lista.length % COLORES_NOTA.length][0];
      const nota = await api("POST", "/api/notas", { color });
      estadoNotas.lista.push(nota);
      ordenarNotas();
      estadoNotas.busqueda = "";
      document.getElementById("buscar-notas").value = "";
      dibujarNotas();
      const tarjeta = grillaNotas.querySelector(`.nota[data-id="${nota.id}"]`);
      tarjeta?.classList.add("recien-pegada");
      tarjeta?.querySelector(".nota-texto").focus();
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
}

async function borrarNotaPanel(tarjeta, nota, { sinPreguntar = false } = {}) {
  if (!sinPreguntar && nota.texto.trim()) {
    const resumen = nota.texto.trim().length > 90 ? `${nota.texto.trim().slice(0, 90)}…` : nota.texto.trim();
    const ok = await confirmar({ titulo: "¿Borrar esta nota?", mensaje: `«${resumen}»`, textoBoton: "Borrar", peligro: true });
    if (!ok) return;
  }
  clearTimeout(estadoNotas.pendientes.get(nota.id));
  estadoNotas.pendientes.delete(nota.id);
  try {
    await api("DELETE", `/api/notas/${nota.id}`);
  } catch (e) {
    return mostrarToast(e.message, true);
  }
  estadoNotas.lista = estadoNotas.lista.filter((n) => n.id !== nota.id);
  subtituloNotas();
  // Se despega con una animacion corta y recien ahi se saca.
  tarjeta.classList.add("despegando");
  setTimeout(() => {
    tarjeta.remove();
    if (!grillaNotas.querySelector(".nota")) dibujarNotas();
  }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220);
}

async function cambiarColorNota(tarjeta, nota, color) {
  if (nota.color === color) return;
  const anterior = nota.color;
  const pintar = (c) => {
    tarjeta.classList.remove(`nota-${nota.color}`);
    nota.color = c;
    tarjeta.classList.add(`nota-${c}`);
    tarjeta.querySelectorAll(".nota-color").forEach((b) => {
      const activo = b.dataset.color === c;
      b.classList.toggle("activo", activo);
      b.setAttribute("aria-checked", String(activo));
    });
  };
  pintar(color);
  try {
    await api("PUT", `/api/notas/${nota.id}`, { color });
  } catch (e) {
    pintar(anterior);
    mostrarToast(e.message, true);
  }
}

async function fijarNota(nota) {
  try {
    const guardada = await api("PUT", `/api/notas/${nota.id}`, { fijada: !nota.fijada });
    nota.fijada = guardada.fijada;
    ordenarNotas();
    dibujarNotas();
    grillaNotas.querySelector(`.nota[data-id="${nota.id}"]`)?.classList.add("recien-pegada");
    mostrarToast(nota.fijada ? "Nota fijada arriba." : "Nota desfijada.");
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

// ---------- eventos ----------
document.getElementById("btn-nueva-nota").addEventListener("click", (ev) => nuevaNota(ev.currentTarget));

// Atajo: "N" en la seccion Notas crea una nota (si no se esta escribiendo en otro lado). Ojo: el
// autocompletado de Chrome (ej. la clave guardada del panel) dispara "keydown" sin tecla (key
// undefined), por eso se compara sin llamar a nada sobre ev.key.
document.addEventListener("keydown", (ev) => {
  if ((ev.key !== "n" && ev.key !== "N") || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (document.getElementById("tab-notas").classList.contains("oculto") || document.querySelector("dialog[open]")) return;
  if (ev.target.closest?.("input, textarea, select, [contenteditable]")) return;
  ev.preventDefault();
  nuevaNota(document.getElementById("btn-nueva-nota"));
});

// Al cambiar el ancho (girar el celular, achicar la ventana) cambia cuantas lineas ocupa cada nota.
let anchoGrillaNotas = 0;
new ResizeObserver(([entrada]) => {
  const ancho = Math.round(entrada.contentRect.width);
  if (ancho === anchoGrillaNotas) return;
  anchoGrillaNotas = ancho;
  ajustarAltosNotas();
}).observe(grillaNotas);

let temporizadorBuscarNotas;
document.getElementById("buscar-notas").addEventListener("input", (ev) => {
  clearTimeout(temporizadorBuscarNotas);
  temporizadorBuscarNotas = setTimeout(() => {
    estadoNotas.busqueda = ev.target.value;
    dibujarNotas();
  }, 150);
});

grillaNotas.addEventListener("input", (ev) => {
  const area = ev.target.closest(".nota-texto");
  if (!area) return;
  ajustarAltoNota(area);
  const { nota } = notaDe(area);
  if (!nota) return;
  clearTimeout(estadoNotas.pendientes.get(nota.id));
  estadoNotas.pendientes.set(nota.id, setTimeout(() => guardarTextoNota(nota.id, area.value), ESPERA_GUARDADO_NOTA_MS));
});

// Al salir de una nota se guarda lo que falte. Una nota nueva que se deja vacia se borra sola.
grillaNotas.addEventListener("focusout", (ev) => {
  const area = ev.target.closest?.(".nota-texto");
  if (!area) return;
  const { tarjeta, nota } = notaDe(area);
  if (!nota || ev.relatedTarget?.closest?.(".nota") === tarjeta) return;
  if (!area.value.trim() && !nota.texto.trim()) return borrarNotaPanel(tarjeta, nota, { sinPreguntar: true });
  if (estadoNotas.pendientes.has(nota.id) || area.value !== nota.texto) guardarTextoNota(nota.id, area.value);
});

grillaNotas.addEventListener("click", (ev) => {
  const { tarjeta, nota } = notaDe(ev.target);
  if (!nota) return;
  const color = ev.target.closest(".nota-color");
  if (color) return cambiarColorNota(tarjeta, nota, color.dataset.color);
  const accion = ev.target.closest("[data-accion]")?.dataset.accion;
  if (accion === "borrar") return borrarNotaPanel(tarjeta, nota);
  if (accion === "fijar") return fijarNota(nota);
});
