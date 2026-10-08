// Graficos del panel (dashboards del Resumen): SVG hecho a mano, sin librerias. Cada grafico se
// dibuja con el ancho real de su contenedor y se redibuja solo si cambia (ResizeObserver).
// Reglas de diseno: marcas finas (barras de hasta 24px con la punta redondeada, lineas de 2px),
// grilla en lineas finitas y apagadas, un solo eje Y por grafico, textos en los colores de texto
// (nunca en el color de la serie) y tooltip al pasar el mouse o con el teclado.

const SVG_NS = "http://www.w3.org/2000/svg";

// ---------- escalas y numeros ----------
// Marcas "lindas" para el eje: 0, 2.000, 4.000... (de 1, 2, 2,5 o 5 por potencia de 10).
function marcasEje(minimo, maximo, cantidad = 4) {
  if (maximo === minimo) maximo = minimo + 1;
  const crudo = (maximo - minimo) / cantidad;
  const potencia = Math.pow(10, Math.floor(Math.log10(crudo)));
  const paso = [1, 2, 2.5, 5, 10].map((f) => f * potencia).find((p) => p >= crudo) ?? crudo;
  const desde = Math.floor(minimo / paso) * paso;
  const hasta = Math.ceil(maximo / paso) * paso;
  const marcas = [];
  for (let v = desde; v <= hasta + paso / 2; v += paso) marcas.push(Math.round(v * 1e6) / 1e6);
  return marcas;
}

function escala(dominio, rango) {
  const [d0, d1] = dominio;
  const [r0, r1] = rango;
  return (v) => (d1 === d0 ? r0 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));
}

// "12,5 mil", "1,2 M" para los ejes (en las tarjetas y tooltips va el numero completo).
function formatoCompacto(n, moneda) {
  const abs = Math.abs(n);
  const simbolo = moneda ? `${SIMBOLO_MONEDA[moneda] ?? ""} ` : "";
  const signo = n < 0 ? "−" : "";
  const num = (v, dec) => v.toLocaleString("es-AR", { maximumFractionDigits: dec });
  if (abs >= 1e6) return `${signo}${simbolo}${num(abs / 1e6, abs >= 1e7 ? 0 : 1)} M`;
  if (abs >= 1e3) return `${signo}${simbolo}${num(abs / 1e3, abs >= 1e4 ? 0 : 1)} mil`;
  return `${signo}${simbolo}${num(abs, 0)}`;
}

// ---------- tooltip (uno solo para todos los graficos) ----------
// Los nombres (productos, categorias) vienen de la base: se ponen con textContent, nunca como HTML.
function tooltipGrafico() {
  let t = document.getElementById("tooltip-grafico");
  if (!t) {
    t = document.createElement("div");
    t.id = "tooltip-grafico";
    t.setAttribute("role", "tooltip");
    document.body.appendChild(t);
  }
  return t;
}

// filas: [{ valor, etiqueta, clase (serie-1...) o color, tipo: "linea" | "barra" }]
function mostrarTooltip(ev, titulo, filas, pie) {
  const t = tooltipGrafico();
  t.replaceChildren();
  const cabeza = document.createElement("div");
  cabeza.className = "tt-titulo";
  cabeza.textContent = titulo;
  t.appendChild(cabeza);
  for (const f of filas) {
    const fila = document.createElement("div");
    fila.className = "tt-fila";
    const clave = document.createElement("span");
    clave.className = `tt-clave ${f.clase ?? ""} ${f.tipo === "barra" ? "tt-clave-barra" : ""}`;
    if (f.color) clave.style.setProperty("--c", f.color);
    const valor = document.createElement("strong");
    valor.textContent = f.valor;
    const etiqueta = document.createElement("span");
    etiqueta.className = "tt-etiqueta";
    etiqueta.textContent = f.etiqueta;
    fila.append(clave, valor, etiqueta);
    t.appendChild(fila);
  }
  if (pie) {
    const p = document.createElement("div");
    p.className = "tt-pie";
    p.textContent = pie;
    t.appendChild(p);
  }
  t.classList.add("visible");
  moverTooltip(ev);
}

function moverTooltip(ev) {
  const t = tooltipGrafico();
  let x, y;
  if (ev.clientX != null && ev.type !== "focus" && ev.type !== "focusin") {
    x = ev.clientX;
    y = ev.clientY;
  } else {
    const r = ev.target.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top;
  }
  const ancho = t.offsetWidth;
  const alto = t.offsetHeight;
  let left = x + 16;
  if (left + ancho > window.innerWidth - 8) left = x - ancho - 16;
  let top = y - alto - 12;
  if (top < 8) top = y + 18;
  t.style.transform = `translate(${Math.max(8, left)}px, ${top}px)`;
}

function ocultarTooltip() {
  document.getElementById("tooltip-grafico")?.classList.remove("visible");
}

// Conecta las zonas sensibles (elementos con data-i) de un grafico con su tooltip.
function conectarTooltip(svg, contenido, alResaltar) {
  const activar = (ev) => {
    const zona = ev.target.closest("[data-i]");
    if (!zona) return;
    const i = Number(zona.dataset.i);
    const { titulo, filas, pie } = contenido(i);
    mostrarTooltip(ev, titulo, filas, pie);
    alResaltar?.(i);
  };
  svg.addEventListener("pointermove", (ev) => {
    if (!ev.target.closest("[data-i]")) return;
    activar(ev);
  });
  svg.addEventListener("focusin", activar);
  const salir = () => {
    ocultarTooltip();
    alResaltar?.(null);
  };
  svg.addEventListener("pointerleave", salir);
  svg.addEventListener("focusout", salir);
}

// ---------- helpers de dibujo ----------
function svgEl(nombre, attrs = {}) {
  const el = document.createElementNS(SVG_NS, nombre);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
}

// Barra vertical con la punta redondeada (4px) y la base recta. Si el valor es negativo, la
// punta va abajo.
function caminoBarra(x, y0, y1, ancho, radio = 4) {
  const alto = Math.abs(y1 - y0);
  const r = Math.min(radio, ancho / 2, alto);
  if (alto < 0.5) return "";
  if (y1 < y0) {
    // hacia arriba: base en y0, punta en y1
    return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + ancho - r} Q${x + ancho},${y1} ${x + ancho},${y1 + r} V${y0} Z`;
  }
  return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + ancho - r} Q${x + ancho},${y1} ${x + ancho},${y1 - r} V${y0} Z`;
}

function ejeY(svg, marcas, y, x0, x1, formato) {
  const g = svgEl("g", { class: "eje" });
  for (const v of marcas) {
    const yy = y(v);
    g.appendChild(svgEl("line", { x1: x0, x2: x1, y1: yy, y2: yy, class: v === 0 ? "grilla grilla-cero" : "grilla" }));
    const texto = svgEl("text", { x: x0 - 8, y: yy, class: "eje-texto", "text-anchor": "end", "dominant-baseline": "middle" });
    texto.textContent = formato(v);
    g.appendChild(texto);
  }
  svg.appendChild(g);
}

function ejeX(svg, etiquetas, xCentro, y, ancho) {
  const g = svgEl("g", { class: "eje" });
  // Si no entran todas, se muestra una cada tanto (siempre la ultima).
  const entran = Math.max(1, Math.floor(ancho / 44));
  const salto = Math.ceil(etiquetas.length / entran);
  etiquetas.forEach((et, i) => {
    if ((etiquetas.length - 1 - i) % salto !== 0) return;
    const texto = svgEl("text", { x: xCentro(i), y, class: "eje-texto", "text-anchor": "middle" });
    texto.textContent = et;
    g.appendChild(texto);
  });
  svg.appendChild(g);
}

function nuevoSvg(contenedor, alto) {
  const ancho = Math.max(240, contenedor.clientWidth);
  const svg = svgEl("svg", { width: ancho, height: alto, viewBox: `0 0 ${ancho} ${alto}`, class: "grafico-svg", role: "img", style: `width:${ancho}px;height:${alto}px` });
  contenedor.replaceChildren(svg);
  return { svg, ancho };
}

function vacio(contenedor, mensaje) {
  contenedor.innerHTML = `<div class="grafico-vacio">${escapeHtml(mensaje)}</div>`;
}

// ---------- columnas agrupadas (ej: facturacion y ganancia por mes) ----------
// cfg: { categorias, series: [{ nombre, clase, valores }], formato, formatoEje, resaltar: Set(indices),
//        objetivo: { nombre, valores } (marca horizontal por categoria), alto }
function graficoColumnas(contenedor, cfg) {
  const valores = cfg.series.flatMap((s) => s.valores).concat(cfg.objetivo?.valores ?? []).filter((v) => v != null);
  if (!valores.length || valores.every((v) => v === 0)) return vacio(contenedor, cfg.vacio ?? "Sin datos en este período.");
  const alto = cfg.alto ?? 260;
  const { svg, ancho } = nuevoSvg(contenedor, alto);
  const m = { arriba: 12, abajo: 26, izq: 58, der: 8 };
  const marcas = marcasEje(Math.min(0, ...valores), Math.max(0, ...valores));
  const y = escala([marcas[0], marcas[marcas.length - 1]], [alto - m.abajo, m.arriba]);
  ejeY(svg, marcas, y, m.izq, ancho - m.der, cfg.formatoEje);
  const n = cfg.categorias.length;
  const banda = (ancho - m.izq - m.der) / n;
  const s = cfg.series.length;
  const anchoBarra = Math.max(4, Math.min(24, (banda * 0.62 - (s - 1) * 2) / s));
  const anchoGrupo = s * anchoBarra + (s - 1) * 2;
  const xCentro = (i) => m.izq + banda * i + banda / 2;

  const fondo = svgEl("g");
  const marcasG = svgEl("g", { class: "marcas" });
  svg.append(fondo, marcasG);
  const resaltes = [];
  for (let i = 0; i < n; i++) {
    const r = svgEl("rect", { x: m.izq + banda * i + 1, y: m.arriba, width: banda - 2, height: alto - m.abajo - m.arriba, rx: 6, class: "banda-resalte" });
    fondo.appendChild(r);
    resaltes.push(r);
    const atenuada = cfg.resaltar && !cfg.resaltar.has(i);
    const grupo = svgEl("g", { class: `grupo${atenuada ? " atenuado" : ""}` });
    cfg.series.forEach((serie, k) => {
      const v = serie.valores[i];
      if (v == null || v === 0) return;
      const x = xCentro(i) - anchoGrupo / 2 + k * (anchoBarra + 2);
      grupo.appendChild(svgEl("path", { d: caminoBarra(x, y(0), y(v), anchoBarra), class: `barra ${serie.clase}` }));
    });
    const obj = cfg.objetivo?.valores[i];
    if (obj != null && obj > 0) {
      const yy = y(obj);
      grupo.appendChild(svgEl("line", { x1: xCentro(i) - anchoGrupo / 2 - 5, x2: xCentro(i) + anchoGrupo / 2 + 5, y1: yy, y2: yy, class: "marca-objetivo" }));
    }
    marcasG.appendChild(grupo);
  }
  ejeX(svg, cfg.categorias, xCentro, alto - 6, ancho - m.izq);
  // zonas sensibles: toda la banda de cada categoria
  const zonas = svgEl("g");
  for (let i = 0; i < n; i++) {
    zonas.appendChild(svgEl("rect", { x: m.izq + banda * i, y: 0, width: banda, height: alto, class: "zona", "data-i": i, tabindex: 0 }));
  }
  svg.appendChild(zonas);
  svg.setAttribute("aria-label", cfg.titulo ?? "Gráfico de columnas");
  conectarTooltip(
    svg,
    (i) => ({
      titulo: cfg.categoriasLargas?.[i] ?? cfg.categorias[i],
      filas: [
        ...cfg.series.map((se) => ({ valor: se.valores[i] == null ? "—" : cfg.formato(se.valores[i]), etiqueta: se.nombre, clase: se.clase, tipo: "barra" })),
        ...(cfg.objetivo && cfg.objetivo.valores[i] != null ? [{ valor: cfg.formato(cfg.objetivo.valores[i]), etiqueta: cfg.objetivo.nombre, clase: "serie-objetivo" }] : []),
      ],
      pie: cfg.pie?.(i),
    }),
    (i) => resaltes.forEach((r, k) => r.classList.toggle("activo", k === i))
  );
}

// ---------- lineas (ej: objetivo del mes: acumulado real vs ritmo ideal) ----------
// cfg: { etiquetas, series: [{ nombre, clase, valores (null = todavia no) , area }],
//        referencias: [{ nombre, clase, valores }] (punteadas), meta: { nombre, valor }, formato, formatoEje }
function graficoLineas(contenedor, cfg) {
  const todas = [...cfg.series, ...(cfg.referencias ?? [])];
  const valores = todas.flatMap((s) => s.valores).concat(cfg.meta?.valor ?? []).filter((v) => v != null);
  if (!valores.length || valores.every((v) => v === 0)) return vacio(contenedor, cfg.vacio ?? "Sin datos en este período.");
  const alto = cfg.alto ?? 260;
  const { svg, ancho } = nuevoSvg(contenedor, alto);
  const m = { arriba: 16, abajo: 26, izq: 58, der: 58 };
  const marcas = marcasEje(Math.min(0, ...valores), Math.max(...valores));
  const y = escala([marcas[0], marcas[marcas.length - 1]], [alto - m.abajo, m.arriba]);
  ejeY(svg, marcas, y, m.izq, ancho - m.der, cfg.formatoEje);
  const n = cfg.etiquetas.length;
  const x = escala([0, Math.max(1, n - 1)], [m.izq + 6, ancho - m.der - 6]);

  if (cfg.meta?.valor) {
    const yy = y(cfg.meta.valor);
    svg.appendChild(svgEl("line", { x1: m.izq, x2: ancho - m.der, y1: yy, y2: yy, class: "linea-meta" }));
    const texto = svgEl("text", { x: ancho - m.der + 6, y: yy, class: "eje-texto texto-meta", "dominant-baseline": "middle" });
    texto.textContent = cfg.meta.nombre;
    svg.appendChild(texto);
  }
  const camino = (vals) => {
    let d = "";
    vals.forEach((v, i) => {
      if (v == null) return;
      d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    });
    return d;
  };
  for (const ref of cfg.referencias ?? []) {
    svg.appendChild(svgEl("path", { d: camino(ref.valores), class: `linea linea-referencia ${ref.clase ?? ""}` }));
  }
  for (const serie of cfg.series) {
    const puntos = serie.valores.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
    if (!puntos.length) continue;
    if (serie.area) {
      const d = `M${puntos[0][0]},${y(0)} ` + puntos.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join(" ") + ` L${puntos[puntos.length - 1][0]},${y(0)} Z`;
      svg.appendChild(svgEl("path", { d, class: `area ${serie.clase}` }));
    }
    svg.appendChild(svgEl("path", { d: camino(serie.valores), class: `linea ${serie.clase}` }));
    const [ux, uy] = puntos[puntos.length - 1];
    svg.appendChild(svgEl("circle", { cx: ux, cy: uy, r: 4.5, class: `punto ${serie.clase}` }));
    if (serie.etiquetaFinal) {
      const texto = svgEl("text", { x: Math.min(ux + 9, ancho - 4), y: uy - 10, class: "texto-final", "text-anchor": ux + 60 > ancho ? "end" : "start" });
      texto.textContent = serie.etiquetaFinal;
      svg.appendChild(texto);
    }
  }
  ejeX(svg, cfg.etiquetas, x, alto - 6, ancho - m.izq - m.der);

  // cruz que sigue al mouse y se pega al dia mas cercano
  const cruz = svgEl("line", { y1: m.arriba, y2: alto - m.abajo, class: "cruz" });
  svg.appendChild(cruz);
  const zonas = svgEl("g");
  const paso = n > 1 ? x(1) - x(0) : ancho;
  for (let i = 0; i < n; i++) {
    zonas.appendChild(svgEl("rect", { x: x(i) - paso / 2, y: 0, width: paso, height: alto, class: "zona", "data-i": i, tabindex: i === n - 1 ? 0 : -1 }));
  }
  svg.appendChild(zonas);
  svg.setAttribute("aria-label", cfg.titulo ?? "Gráfico de líneas");
  conectarTooltip(
    svg,
    (i) => ({
      titulo: cfg.etiquetasLargas?.[i] ?? cfg.etiquetas[i],
      filas: todas
        .filter((s) => s.valores[i] != null)
        .map((s) => ({ valor: cfg.formato(s.valores[i]), etiqueta: s.nombre, clase: s.clase ?? "serie-referencia" })),
      pie: cfg.pie?.(i),
    }),
    (i) => {
      cruz.classList.toggle("visible", i != null);
      if (i != null) cruz.setAttribute("x1", x(i)), cruz.setAttribute("x2", x(i));
    }
  );
}

// ---------- flujo de caja: entradas arriba, salidas abajo y el saldo acumulado ----------
// cfg: { categorias, entradas, salidas (positivas, se dibujan para abajo), neto (linea), acumulado (solo
//        en el detalle: en la misma escala aplastaria las barras), formato, formatoEje, resaltar }
function graficoFlujo(contenedor, cfg) {
  const valores = [...cfg.entradas, ...cfg.salidas.map((v) => -v), ...cfg.neto];
  if (valores.every((v) => !v)) return vacio(contenedor, cfg.vacio ?? "Sin movimientos de plata en este período.");
  const alto = cfg.alto ?? 280;
  const { svg, ancho } = nuevoSvg(contenedor, alto);
  const m = { arriba: 12, abajo: 26, izq: 58, der: 8 };
  const marcas = marcasEje(Math.min(0, ...valores), Math.max(0, ...valores));
  const y = escala([marcas[0], marcas[marcas.length - 1]], [alto - m.abajo, m.arriba]);
  ejeY(svg, marcas, y, m.izq, ancho - m.der, cfg.formatoEje);
  const n = cfg.categorias.length;
  const banda = (ancho - m.izq - m.der) / n;
  const anchoBarra = Math.max(4, Math.min(20, banda * 0.5));
  const xCentro = (i) => m.izq + banda * i + banda / 2;
  const fondo = svgEl("g");
  svg.appendChild(fondo);
  const resaltes = [];
  for (let i = 0; i < n; i++) {
    const r = svgEl("rect", { x: m.izq + banda * i + 1, y: m.arriba, width: banda - 2, height: alto - m.abajo - m.arriba, rx: 6, class: "banda-resalte" });
    fondo.appendChild(r);
    resaltes.push(r);
    const g = svgEl("g", { class: `grupo${cfg.resaltar && !cfg.resaltar.has(i) ? " atenuado" : ""}` });
    const x0 = xCentro(i) - anchoBarra / 2;
    // 2px de aire entre la barra de arriba y la de abajo
    if (cfg.entradas[i]) g.appendChild(svgEl("path", { d: caminoBarra(x0, y(0) - 1, y(cfg.entradas[i]), anchoBarra), class: "barra estado-bueno" }));
    if (cfg.salidas[i]) g.appendChild(svgEl("path", { d: caminoBarra(x0, y(0) + 1, y(-cfg.salidas[i]), anchoBarra), class: "barra estado-malo" }));
    svg.appendChild(g);
  }
  // neto de cada mes
  let d = "";
  cfg.neto.forEach((v, i) => (d += `${d ? "L" : "M"}${xCentro(i).toFixed(1)},${y(v).toFixed(1)} `));
  svg.appendChild(svgEl("path", { d, class: "linea serie-2" }));
  cfg.neto.forEach((v, i) => svg.appendChild(svgEl("circle", { cx: xCentro(i), cy: y(v), r: 4, class: "punto serie-2" })));
  ejeX(svg, cfg.categorias, xCentro, alto - 6, ancho - m.izq);
  const zonas = svgEl("g");
  for (let i = 0; i < n; i++) zonas.appendChild(svgEl("rect", { x: m.izq + banda * i, y: 0, width: banda, height: alto, class: "zona", "data-i": i, tabindex: 0 }));
  svg.appendChild(zonas);
  svg.setAttribute("aria-label", "Flujo de caja por mes");
  conectarTooltip(
    svg,
    (i) => ({
      titulo: cfg.categoriasLargas?.[i] ?? cfg.categorias[i],
      filas: [
        { valor: cfg.formato(cfg.entradas[i]), etiqueta: "Entradas", clase: "estado-bueno", tipo: "barra" },
        { valor: cfg.formato(cfg.salidas[i]), etiqueta: "Salidas", clase: "estado-malo", tipo: "barra" },
        { valor: cfg.formato(cfg.neto[i]), etiqueta: "Neto del mes", clase: "serie-2" },
        { valor: cfg.formato(cfg.acumulado[i]), etiqueta: "Saldo acumulado", clase: "serie-referencia" },
      ],
    }),
    (i) => resaltes.forEach((r, k) => r.classList.toggle("activo", k === i))
  );
}

// ---------- cascada: de la facturacion a la ganancia real ----------
// cfg: { pasos: [{ etiqueta, valor, tipo: "inicio" | "resta" | "total" }], formato, formatoEje }
function graficoCascada(contenedor, cfg) {
  if (!cfg.pasos.some((p) => p.valor)) return vacio(contenedor, cfg.vacio ?? "Sin datos en este período.");
  const alto = cfg.alto ?? 280;
  const { svg, ancho } = nuevoSvg(contenedor, alto);
  const m = { arriba: 26, abajo: 26, izq: 58, der: 8 };
  // tramos: [desde, hasta] de cada columna
  let corriente = 0;
  const tramos = cfg.pasos.map((p) => {
    if (p.tipo === "inicio" || p.tipo === "total") {
      corriente = p.valor;
      return [0, p.valor];
    }
    const desde = corriente;
    corriente -= p.valor;
    return [desde, corriente];
  });
  const extremos = tramos.flat();
  const marcas = marcasEje(Math.min(0, ...extremos), Math.max(0, ...extremos));
  const y = escala([marcas[0], marcas[marcas.length - 1]], [alto - m.abajo, m.arriba]);
  ejeY(svg, marcas, y, m.izq, ancho - m.der, cfg.formatoEje);
  const n = cfg.pasos.length;
  const banda = (ancho - m.izq - m.der) / n;
  const anchoBarra = Math.min(48, banda * 0.56);
  const xCentro = (i) => m.izq + banda * i + banda / 2;
  tramos.forEach(([a, b], i) => {
    const p = cfg.pasos[i];
    const x0 = xCentro(i) - anchoBarra / 2;
    const clase = p.tipo === "resta" ? "estado-malo" : p.tipo === "total" ? (b < 0 ? "estado-malo" : "serie-2") : "serie-1";
    const arriba = Math.max(a, b);
    const abajo = Math.min(a, b);
    // las restas cuelgan del total anterior: punta redondeada abajo
    const camino = p.tipo === "resta" ? caminoBarra(x0, y(arriba), y(abajo), anchoBarra) : caminoBarra(x0, y(0), y(b), anchoBarra);
    if (camino) svg.appendChild(svgEl("path", { d: camino, class: `barra ${clase}` }));
    if (i < n - 1) {
      const yy = y(b);
      svg.appendChild(svgEl("line", { x1: x0 + anchoBarra, x2: xCentro(i + 1) - anchoBarra / 2, y1: yy, y2: yy, class: "conector" }));
    }
    // Si las columnas son angostas (celular), solo se rotulan la primera y la ultima: el resto
    // esta en el detalle y en la tabla.
    if (banda >= 84 || i === 0 || i === n - 1) {
      const texto = svgEl("text", { x: xCentro(i), y: y(arriba) - 8, class: "texto-valor", "text-anchor": "middle" });
      texto.textContent = `${p.tipo === "resta" ? "−" : ""}${formatoCompacto(Math.abs(p.valor), cfg.moneda)}`;
      svg.appendChild(texto);
    }
  });
  ejeX(svg, cfg.pasos.map((p) => (banda < 96 && p.corta ? p.corta : p.etiqueta)), xCentro, alto - 6, Math.max(ancho - m.izq, n * 90));
  const zonas = svgEl("g");
  for (let i = 0; i < n; i++) zonas.appendChild(svgEl("rect", { x: m.izq + banda * i, y: 0, width: banda, height: alto, class: "zona", "data-i": i, tabindex: 0 }));
  svg.appendChild(zonas);
  svg.setAttribute("aria-label", "Cascada de la facturación a la ganancia real");
  conectarTooltip(svg, (i) => ({
    titulo: cfg.pasos[i].etiqueta,
    filas: [{ valor: `${cfg.pasos[i].tipo === "resta" ? "−" : ""}${cfg.formato(cfg.pasos[i].valor)}`, etiqueta: cfg.pasos[i].detalle ?? "", clase: cfg.pasos[i].tipo === "resta" ? "estado-malo" : cfg.pasos[i].tipo === "total" ? "serie-2" : "serie-1", tipo: "barra" }],
  }));
}

// ---------- dona (parte de un todo, hasta 6 porciones) ----------
// cfg: { segmentos: [{ etiqueta, valor, clase }], centro: { valor, etiqueta }, formato }
function graficoDona(contenedor, cfg) {
  const total = cfg.segmentos.reduce((a, s) => a + s.valor, 0);
  if (!total) return vacio(contenedor, cfg.vacio ?? "Sin datos en este período.");
  contenedor.innerHTML = `<div class="dona"><div class="dona-grafico"></div><ul class="dona-leyenda"></ul></div>`;
  const lugar = contenedor.querySelector(".dona-grafico");
  const lado = 188;
  const svg = svgEl("svg", { width: lado, height: lado, viewBox: `0 0 ${lado} ${lado}`, class: "grafico-svg", role: "img", "aria-label": cfg.titulo ?? "Gráfico de dona" });
  lugar.appendChild(svg);
  const r = 78;
  const grosor = 18;
  const c = lado / 2;
  let angulo = -Math.PI / 2;
  const arcos = [];
  cfg.segmentos.forEach((s, i) => {
    const fraccion = s.valor / total;
    const a0 = angulo;
    const a1 = angulo + fraccion * Math.PI * 2;
    angulo = a1;
    const grande = a1 - a0 > Math.PI ? 1 : 0;
    const punto = (a, rr) => [c + rr * Math.cos(a), c + rr * Math.sin(a)];
    let d;
    if (fraccion >= 0.9999) {
      d = `M${c},${c - r} A${r},${r} 0 1 1 ${c - 0.01},${c - r} Z`;
    } else {
      const [x0, y0] = punto(a0, r);
      const [x1, y1] = punto(a1, r);
      d = `M${x0},${y0} A${r},${r} 0 ${grande} 1 ${x1},${y1}`;
    }
    const arco = svgEl("path", { d, class: `arco ${s.clase}`, "stroke-width": grosor, "data-i": i, tabindex: 0 });
    svg.appendChild(arco);
    arcos.push(arco);
  });
  const centro = svgEl("text", { x: c, y: c - 4, class: "dona-valor", "text-anchor": "middle", "dominant-baseline": "middle" });
  centro.textContent = cfg.centro.valor;
  const sub = svgEl("text", { x: c, y: c + 18, class: "dona-sub", "text-anchor": "middle" });
  sub.textContent = cfg.centro.etiqueta;
  svg.append(centro, sub);
  const leyenda = contenedor.querySelector(".dona-leyenda");
  cfg.segmentos.forEach((s, i) => {
    const li = document.createElement("li");
    li.dataset.i = i;
    const clave = document.createElement("span");
    clave.className = `clave-barra ${s.clase}`;
    const nombre = document.createElement("span");
    nombre.className = "leyenda-nombre";
    nombre.textContent = s.etiqueta;
    const pct = document.createElement("span");
    pct.className = "leyenda-pct";
    pct.textContent = `${Math.round((s.valor / total) * 100)}%`;
    const valor = document.createElement("strong");
    valor.textContent = cfg.formato(s.valor);
    li.append(clave, nombre, valor, pct);
    leyenda.appendChild(li);
  });
  const resaltar = (i) => {
    arcos.forEach((a, k) => a.classList.toggle("apagado", i != null && k !== i));
    leyenda.querySelectorAll("li").forEach((li, k) => li.classList.toggle("activo", k === i));
  };
  const contenido = (i) => ({
    titulo: cfg.segmentos[i].etiqueta,
    filas: [{ valor: cfg.formato(cfg.segmentos[i].valor), etiqueta: `${Math.round((cfg.segmentos[i].valor / total) * 100)}% del total`, clase: cfg.segmentos[i].clase, tipo: "barra" }],
  });
  conectarTooltip(svg, contenido, resaltar);
  leyenda.addEventListener("pointermove", (ev) => {
    const li = ev.target.closest("li");
    if (li) resaltar(Number(li.dataset.i));
  });
  leyenda.addEventListener("pointerleave", () => resaltar(null));
}

// ---------- barras horizontales (rankings) ----------
// cfg: { filas: [{ etiqueta, valor, texto, detalle }], clase, formato, numerar }
function graficoBarrasH(contenedor, cfg) {
  if (!cfg.filas.length) return vacio(contenedor, cfg.vacio ?? "Sin datos en este período.");
  const maximo = Math.max(...cfg.filas.map((f) => Math.abs(f.valor)), 1);
  contenedor.innerHTML = `<ol class="ranking${cfg.numerar ? " numerado" : ""}">${cfg.filas
    .map(
      (f, i) => `<li data-i="${i}" tabindex="0">
        ${cfg.numerar ? `<span class="ranking-pos">${i + 1}</span>` : ""}
        <div class="ranking-cuerpo">
          <div class="ranking-cabeza"><span class="ranking-nombre"></span><strong class="ranking-valor"></strong></div>
          <div class="ranking-pista"><span class="ranking-barra ${f.valor < 0 ? "estado-malo" : cfg.clase}" style="--ancho:${Math.max(1.5, (Math.abs(f.valor) / maximo) * 100)}%"></span></div>
        </div>
      </li>`
    )
    .join("")}</ol>`;
  contenedor.querySelectorAll(".ranking li").forEach((li, i) => {
    li.querySelector(".ranking-nombre").textContent = cfg.filas[i].etiqueta;
    li.querySelector(".ranking-valor").textContent = cfg.filas[i].texto;
  });
  const lista = contenedor.querySelector(".ranking");
  conectarTooltip(lista, (i) => ({ titulo: cfg.filas[i].etiqueta, filas: cfg.filas[i].detalle ?? [] }));
}

// ---------- chiquitos para las tarjetas ----------
// Tendencia de los ultimos meses: gris, con el ultimo punto en el color de acento.
function sparkline(valores, clase = "serie-1") {
  const v = valores.map((x) => x ?? 0);
  if (v.length < 2 || v.every((x) => x === 0)) return "";
  const ancho = 84, alto = 28;
  const min = Math.min(...v), max = Math.max(...v);
  const x = escala([0, v.length - 1], [2, ancho - 5]);
  const y = escala([min, max === min ? min + 1 : max], [alto - 4, 4]);
  const d = v.map((val, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(" ");
  const area = `${d} L${x(v.length - 1)},${alto} L${x(0)},${alto} Z`;
  return `<svg class="sparkline" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}" aria-hidden="true">
    <path d="${area}" class="sparkline-area ${clase}"/><path d="${d}" class="sparkline-linea"/>
    <circle cx="${x(v.length - 1)}" cy="${y(v[v.length - 1])}" r="3" class="punto ${clase}"/></svg>`;
}

// Anillo de progreso (objetivo cumplido), con una marquita donde "deberia" estar hoy.
function anilloProgreso(fraccion, esperado, clase = "serie-1") {
  const r = 30, c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraccion));
  const marca = esperado != null ? Math.max(0, Math.min(1, esperado)) * Math.PI * 2 - Math.PI / 2 : null;
  return `<svg class="anillo" viewBox="0 0 76 76" width="76" height="76" aria-hidden="true">
    <circle cx="38" cy="38" r="${r}" class="anillo-pista"/>
    <circle cx="38" cy="38" r="${r}" class="anillo-relleno ${clase}" stroke-dasharray="${(f * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 38 38)"/>
    ${marca != null ? `<line x1="${38 + (r - 7) * Math.cos(marca)}" y1="${38 + (r - 7) * Math.sin(marca)}" x2="${38 + (r + 7) * Math.cos(marca)}" y2="${38 + (r + 7) * Math.sin(marca)}" class="anillo-marca"/>` : ""}
  </svg>`;
}

// ---------- redibujar al cambiar el tamano ----------
const graficosVivos = new Map();
const observadorTamano = new ResizeObserver((entradas) => {
  for (const e of entradas) {
    const g = graficosVivos.get(e.target);
    if (!g || Math.abs(g.ancho - e.contentRect.width) < 2) continue;
    g.ancho = e.contentRect.width;
    g.dibujar();
  }
});

// Dibuja un grafico y lo deja "vivo" (se redibuja si cambia el ancho de su lugar).
function dibujarGrafico(contenedor, dibujar) {
  if (!contenedor) return;
  graficosVivos.set(contenedor, { dibujar, ancho: contenedor.clientWidth });
  observadorTamano.observe(contenedor);
  dibujar();
}

// Antes de redibujar un dashboard entero: suelta los graficos que ya no estan en la pagina.
function soltarGraficos() {
  for (const contenedor of graficosVivos.keys()) {
    if (!contenedor.isConnected) {
      observadorTamano.unobserve(contenedor);
      graficosVivos.delete(contenedor);
    }
  }
}
