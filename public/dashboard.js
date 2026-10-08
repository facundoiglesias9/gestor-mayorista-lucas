// Resumen = dashboards: Ejecutivo (facturacion, ganancia, margen, objetivos), Ventas (ranking
// de productos, objetivo vs cumplimiento) y Financiero (ingresos, gastos, ganancia real y flujo
// de caja). Los datos llegan agrupados por dia (/api/dashboard) y aca se arman los periodos, las
// comparaciones y los graficos (ver graficos.js). Usa los helpers de app.js (api, formatos...).

const PERIODOS = {
  mes: { nombre: "Este mes", meses: 1 },
  "mes-anterior": { nombre: "Mes pasado", meses: 1 },
  "3m": { nombre: "Últimos 3 meses", meses: 3 },
  anio: { nombre: "Este año", meses: 12 },
  "12m": { nombre: "Últimos 12 meses", meses: 12 },
};
const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const dash = { datos: null, esquema: "ejecutivo", periodo: "mes", moneda: "USD", rankingPor: "unidades", tablas: new Set() };

try {
  const guardado = JSON.parse(localStorage.getItem("panel_dashboard") || "{}");
  if (["ejecutivo", "ventas", "financiero"].includes(guardado.esquema)) dash.esquema = guardado.esquema;
  if (PERIODOS[guardado.periodo]) dash.periodo = guardado.periodo;
  if (["USD", "ARS"].includes(guardado.moneda)) dash.moneda = guardado.moneda;
} catch {
  /* sin almacenamiento: arranca con lo de siempre */
}

function guardarPreferenciasDashboard() {
  try {
    localStorage.setItem("panel_dashboard", JSON.stringify({ esquema: dash.esquema, periodo: dash.periodo, moneda: dash.moneda }));
  } catch {
    /* no pasa nada */
  }
}

// ---------- fechas (siempre "AAAA-MM-DD", en hora local) ----------
function aFecha(s) {
  const [a, m, d] = s.split("-").map(Number);
  return new Date(a, m - 1, d);
}
function deFecha(f) {
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
}
function diasDelMes(anio, mes0) {
  return new Date(anio, mes0 + 1, 0).getDate();
}
// Corre una fecha k meses; si era fin de mes (o el dia no existe en el otro mes), queda en fin de mes.
function sumarMeses(s, k) {
  const f = aFecha(s);
  const finDeMes = f.getDate() === diasDelMes(f.getFullYear(), f.getMonth());
  const destino = new Date(f.getFullYear(), f.getMonth() + k, 1);
  const dim = diasDelMes(destino.getFullYear(), destino.getMonth());
  destino.setDate(finDeMes ? dim : Math.min(f.getDate(), dim));
  return deFecha(destino);
}
function inicioDeMes(s, k = 0) {
  const f = aFecha(s);
  return deFecha(new Date(f.getFullYear(), f.getMonth() + k, 1));
}
function finDeMes(s) {
  const f = aFecha(s);
  return deFecha(new Date(f.getFullYear(), f.getMonth() + 1, 0));
}

function rangoPeriodo(periodo, hoy) {
  let desde, hasta;
  if (periodo === "mes") [desde, hasta] = [inicioDeMes(hoy), hoy];
  if (periodo === "mes-anterior") [desde, hasta] = [inicioDeMes(hoy, -1), finDeMes(inicioDeMes(hoy, -1))];
  if (periodo === "3m") [desde, hasta] = [inicioDeMes(hoy, -2), hoy];
  if (periodo === "anio") [desde, hasta] = [`${hoy.slice(0, 4)}-01-01`, hoy];
  if (periodo === "12m") [desde, hasta] = [inicioDeMes(hoy, -11), hoy];
  const k = PERIODOS[periodo].meses;
  return { desde, hasta, antDesde: sumarMeses(desde, -k), antHasta: sumarMeses(hasta, -k) };
}

// Un rango de fechas dicho en criollo: "octubre 2026", "1 al 8 de octubre 2026",
// "1 ago – 8 oct 2026", "2025", "1 nov 2025 – 8 oct 2026".
const MESES_ABREV = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function textoRango(desde, hasta) {
  const a = aFecha(desde);
  const b = aFecha(hasta);
  const mesCompleto = a.getDate() === 1 && hasta === finDeMes(hasta);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    if (mesCompleto) return `${MESES_LARGOS[a.getMonth()]} ${a.getFullYear()}`;
    if (a.getDate() === b.getDate()) return `${b.getDate()} de ${MESES_LARGOS[b.getMonth()]} ${b.getFullYear()}`;
    return `${a.getDate()} al ${b.getDate()} de ${MESES_LARGOS[b.getMonth()]} ${b.getFullYear()}`;
  }
  if (a.getMonth() === 0 && a.getDate() === 1 && b.getMonth() === 11 && b.getDate() === 31 && a.getFullYear() === b.getFullYear()) return String(a.getFullYear());
  const lado = (f, conAnio) => `${f.getDate()} ${MESES_ABREV[f.getMonth()]}${conAnio ? ` ${f.getFullYear()}` : ""}`;
  const mismoAnio = a.getFullYear() === b.getFullYear();
  if (mesCompleto) return `${MESES_ABREV[a.getMonth()]}${mismoAnio ? "" : ` ${a.getFullYear()}`} – ${MESES_ABREV[b.getMonth()]} ${b.getFullYear()}`;
  return `${lado(a, !mismoAnio)} – ${lado(b, true)}`;
}

// El periodo elegido, con sus fechas reales (lo que se muestra en titulos y comparaciones).
function etiquetaPeriodo() {
  const r = rangoPeriodo(dash.periodo, dash.datos.hoy);
  return textoRango(r.desde, r.hasta);
}
function textoComparacion() {
  const r = rangoPeriodo(dash.periodo, dash.datos.hoy);
  return `vs. ${textoRango(r.antDesde, r.antHasta)}`;
}

// Los ultimos n meses (hasta el actual): [{ clave "2026-10", desde, hasta, corto "Oct", largo }]
function ultimosMeses(n, hoy) {
  const meses = [];
  for (let k = n - 1; k >= 0; k--) {
    const desde = inicioDeMes(hoy, -k);
    const f = aFecha(desde);
    meses.push({
      clave: desde.slice(0, 7),
      desde,
      hasta: k === 0 ? hoy : finDeMes(desde),
      corto: MESES_CORTOS[f.getMonth()],
      largo: `${MESES_LARGOS[f.getMonth()]} ${f.getFullYear()}${k === 0 ? " (en curso)" : ""}`,
    });
  }
  return meses;
}

// ---------- monedas ----------
// Todo se muestra en la moneda elegida (U$D o $). Lo que esta en la otra moneda se pasa con el
// dolar blue de hoy; si no hay cotizacion, eso queda afuera (y se avisa).
function aMoneda(monto, de) {
  if (monto == null) return null;
  if (de === dash.moneda) return monto;
  const dolar = dash.datos.dolar_blue_venta;
  if (!dolar) return null;
  return de === "USD" ? monto * dolar : monto / dolar;
}

// En los dashboards los montos van redondeados (U$D 8.625, no U$D 8.625,20).
function dinero(n) {
  return n == null ? "—" : formatoConSimbolo(Math.round(n), dash.moneda);
}
function dineroEje(n) {
  return formatoCompacto(n, dash.moneda);
}
// "2026-10-01" -> "01/10/26" (texto plano, para tablas y mensajes)
function fechaCorta(s) {
  const [a, m, d] = String(s).slice(0, 10).split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

function porcentaje(n, decimales = 1) {
  return n == null || !Number.isFinite(n) ? "—" : `${n.toLocaleString("es-AR", { maximumFractionDigits: decimales })}%`;
}

// ---------- calculos ----------
const filtroFechas = (desde, hasta) => (r) => r.fecha >= desde && r.fecha <= hasta;

// Todo lo de un rango de fechas, ya pasado a la moneda elegida.
function resumir(desde, hasta) {
  const d = dash.datos;
  const enRango = filtroFechas(desde, hasta);
  const r = {
    facturado: 0,
    facturadoConCosto: 0,
    costo: 0,
    unidades: 0,
    operaciones: 0,
    clientes: new Set(),
    productos: new Map(),
    categorias: new Map(),
    compras: 0,
    gastos: 0,
    gastosPorCategoria: new Map(),
    otorgados: 0,
    cobrados: 0,
    sinConvertir: 0,
  };
  for (const v of d.ventas) {
    if (!enRango(v)) continue;
    const facturado = aMoneda(v.facturado, v.moneda);
    const conCosto = aMoneda(v.facturado_con_costo, v.moneda);
    const costo = aMoneda(v.costo, v.costo_moneda);
    if (facturado == null || conCosto == null || costo == null) {
      r.sinConvertir++;
      continue;
    }
    r.facturado += facturado;
    r.facturadoConCosto += conCosto;
    r.costo += costo;
    r.unidades += v.unidades;
    r.operaciones += v.operaciones;
    if (v.cliente_id != null) r.clientes.add(v.cliente_id);
    const p = r.productos.get(v.producto_id) ?? { nombre: v.producto, categoria: v.categoria, unidades: 0, facturado: 0, ganancia: 0 };
    p.unidades += v.unidades;
    p.facturado += facturado;
    p.ganancia += conCosto - costo;
    r.productos.set(v.producto_id, p);
    const c = r.categorias.get(v.categoria) ?? { facturado: 0, conCosto: 0, costo: 0, unidades: 0 };
    c.facturado += facturado;
    c.conCosto += conCosto;
    c.costo += costo;
    c.unidades += v.unidades;
    r.categorias.set(v.categoria, c);
  }
  for (const c of d.compras) {
    if (!enRango(c)) continue;
    const monto = aMoneda(c.monto, c.moneda);
    if (monto == null) r.sinConvertir++;
    else r.compras += monto;
  }
  for (const g of d.gastos) {
    if (!enRango(g)) continue;
    const monto = aMoneda(g.monto, g.moneda);
    if (monto == null) {
      r.sinConvertir++;
      continue;
    }
    r.gastos += monto;
    r.gastosPorCategoria.set(g.categoria, (r.gastosPorCategoria.get(g.categoria) ?? 0) + monto);
  }
  for (const p of d.prestamos) {
    if (!enRango(p)) continue;
    const monto = aMoneda(p.monto, p.moneda);
    if (monto == null) r.sinConvertir++;
    else if (p.tipo === "otorgado") r.otorgados += monto;
    else r.cobrados += monto;
  }
  r.ganancia = r.facturadoConCosto - r.costo;
  r.margen = r.facturadoConCosto ? (r.ganancia / r.facturadoConCosto) * 100 : null;
  r.gananciaReal = r.ganancia - r.gastos;
  r.margenNeto = r.facturado ? (r.gananciaReal / r.facturado) * 100 : null;
  r.entradas = r.facturado + r.cobrados;
  r.salidas = r.compras + r.gastos + r.otorgados;
  r.flujo = r.entradas - r.salidas;
  r.ticket = r.operaciones ? r.facturado / r.operaciones : null;
  return r;
}

// Objetivo vigente en un mes: el ultimo que se cargo para ese mes o uno anterior.
function objetivoDelMes(clave) {
  let vigente = null;
  for (const o of dash.datos.objetivos) if (o.mes <= clave) vigente = o;
  if (!vigente) return null;
  return {
    facturacion: vigente.facturacion != null ? aMoneda(vigente.facturacion, vigente.moneda) : null,
    ganancia: vigente.ganancia != null ? aMoneda(vigente.ganancia, vigente.moneda) : null,
    unidades: vigente.unidades,
    original: vigente,
  };
}

// Objetivos de un periodo: la suma de los meses que toca, y cuanto "deberia" llevarse a hoy (el
// mes en curso cuenta proporcional a los dias que pasaron).
function objetivosDelPeriodo(desde, hasta) {
  const hoy = dash.datos.hoy;
  const total = { facturacion: 0, ganancia: 0, unidades: 0 };
  const esperado = { facturacion: 0, ganancia: 0, unidades: 0 };
  const hay = { facturacion: false, ganancia: false, unidades: false };
  let mes = inicioDeMes(desde);
  while (mes <= hasta) {
    const obj = objetivoDelMes(mes.slice(0, 7));
    const f = aFecha(mes);
    const dim = diasDelMes(f.getFullYear(), f.getMonth());
    const fin = finDeMes(mes);
    const transcurridos = fin <= hoy ? dim : mes > hoy ? 0 : aFecha(hoy).getDate();
    for (const k of ["facturacion", "ganancia", "unidades"]) {
      if (obj?.[k] == null) continue;
      hay[k] = true;
      total[k] += obj[k];
      esperado[k] += obj[k] * (transcurridos / dim);
    }
    mes = inicioDeMes(mes, 1);
  }
  return { total, esperado, hay };
}

function variacion(actual, anterior) {
  if (anterior == null || actual == null) return null;
  if (anterior === 0) return actual === 0 ? 0 : null;
  return ((actual - anterior) / Math.abs(anterior)) * 100;
}

// ---------- piezas de la pagina ----------
const ICONO_SUBE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14l5-5 5 5"/></svg>`;
const ICONO_BAJA = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>`;
const ICONO_TABLA = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/></svg>`;
const ICONO_GRAFICO = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11M12 20V5M19 20v-7"/></svg>`;
const ICONO_OBJETIVO = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" /></svg>`;
const ICONO_MAS = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;

// Variacion contra el periodo anterior: flecha + numero (el color dice si es bueno o malo,
// pero nunca solo: la flecha y el signo tambien).
// Para montos que pueden ser negativos (ganancia real, flujo de caja): si el periodo anterior
// fue negativo o cero, un "%" no dice nada, asi que se muestra la diferencia en plata.
function chipDiferencia(actual, anterior) {
  if (anterior != null && anterior > 0 && actual >= 0) return chipVariacion(variacion(actual, anterior));
  if (anterior == null) return chipVariacion(null);
  const diferencia = actual - anterior;
  if (Math.round(diferencia) === 0) return chipVariacion(0);
  const sube = diferencia > 0;
  return `<span class="variacion ${sube ? "buena" : "mala"}">${sube ? ICONO_SUBE : ICONO_BAJA}${sube ? "+" : "−"}${formatoCompacto(Math.abs(diferencia), dash.moneda)}</span>`;
}

function chipVariacion(valor, { invertido = false, puntos = false } = {}) {
  if (valor == null || !Number.isFinite(valor)) return `<span class="variacion neutra">Sin comparación</span>`;
  const redondeado = Math.round(valor * 10) / 10;
  if (redondeado === 0) return `<span class="variacion neutra">= igual</span>`;
  const sube = redondeado > 0;
  const bueno = invertido ? !sube : sube;
  const texto = `${sube ? "+" : "−"}${Math.abs(redondeado).toLocaleString("es-AR", { maximumFractionDigits: 1 })}${puntos ? " pp" : "%"}`;
  return `<span class="variacion ${bueno ? "buena" : "mala"}">${sube ? ICONO_SUBE : ICONO_BAJA}${texto}</span>`;
}

function tarjetaKpiDash({ etiqueta, valor, variacion: v, detalle, spark, clase = "serie-1", destacada = false, ayuda }) {
  return `<article class="dash-kpi${destacada ? " destacada" : ""} ${clase}">
    <div class="dash-kpi-cabeza"><span class="dash-kpi-etiqueta"${ayuda ? ` title="${escapeAttr(ayuda)}"` : ""}>${escapeHtml(etiqueta)}</span>${v ?? ""}</div>
    <div class="dash-kpi-valor">${valor}</div>
    <div class="dash-kpi-pie"><span class="dash-kpi-detalle">${detalle ?? ""}</span>${spark ?? ""}</div>
  </article>`;
}

// Tarjeta de un grafico, con boton para verlo como tabla (los mismos numeros, sin depender del color).
function tarjetaGrafico({ id, titulo, subtitulo, leyenda, acciones = "", clase = "", tabla = true }) {
  return `<section class="dash-tarjeta ${clase}" data-grafico="${id}">
    <header class="dash-tarjeta-cabeza">
      <div><h3>${escapeHtml(titulo)}</h3>${subtitulo ? `<p>${subtitulo}</p>` : ""}</div>
      <div class="dash-tarjeta-acciones">${acciones}${
        tabla
          ? `<button type="button" class="btn-icono btn-tabla" data-tabla="${id}" title="${dash.tablas.has(id) ? "Ver gráfico" : "Ver como tabla"}" aria-label="${dash.tablas.has(id) ? "Ver gráfico" : "Ver como tabla"}">${dash.tablas.has(id) ? ICONO_GRAFICO : ICONO_TABLA}</button>`
          : ""
      }</div>
    </header>
    ${leyenda ? `<div class="dash-leyenda">${leyenda}</div>` : ""}
    <div class="dash-grafico" id="grafico-${id}"></div>
  </section>`;
}

function itemLeyenda(texto, clase, tipo = "barra") {
  return `<span class="leyenda-item"><span class="clave-${tipo} ${clase}"></span>${escapeHtml(texto)}</span>`;
}

// Dibuja un grafico o su tabla, segun lo que se haya elegido en la tarjeta.
function pintar(id, dibujarGraficoFn, tabla) {
  const lugar = document.getElementById(`grafico-${id}`);
  if (!lugar) return;
  if (dash.tablas.has(id) && tabla) {
    lugar.innerHTML = `<div class="tabla-wrap dash-tabla"><table><thead><tr>${tabla.columnas
      .map((c, i) => `<th${i ? ' class="num"' : ""}>${escapeHtml(c)}</th>`)
      .join("")}</tr></thead><tbody>${tabla.filas
      .map((f) => `<tr>${f.map((celda, i) => `<td${i ? ' class="num"' : ' class="texto-fuerte"'} data-etiqueta="${escapeAttr(tabla.columnas[i])}">${escapeHtml(celda)}</td>`).join("")}</tr>`)
      .join("") || `<tr class="fila-vacia"><td colspan="${tabla.columnas.length}">Sin datos.</td></tr>`}</tbody></table></div>`;
    return;
  }
  dibujarGrafico(lugar, () => dibujarGraficoFn(lugar));
}

// ---------- Ejecutivo ----------
function dashboardEjecutivo() {
  const { hoy } = dash.datos;
  const rango = rangoPeriodo(dash.periodo, hoy);
  const actual = resumir(rango.desde, rango.hasta);
  const anterior = resumir(rango.antDesde, rango.antHasta);
  const meses = ultimosMeses(12, hoy);
  const porMes = meses.map((m) => resumir(m.desde, m.hasta));
  const objetivos = objetivosDelPeriodo(rango.desde, rango.hasta);
  const enPeriodo = new Set(meses.map((m, i) => (m.hasta >= rango.desde && m.desde <= rango.hasta ? i : -1)).filter((i) => i >= 0));
  const comparacion = textoComparacion();

  const cumplimiento = objetivos.hay.facturacion && objetivos.total.facturacion ? actual.facturado / objetivos.total.facturacion : null;
  const esperado = objetivos.hay.facturacion && objetivos.total.facturacion ? objetivos.esperado.facturacion / objetivos.total.facturacion : null;

  const kpis = [
    tarjetaKpiDash({
      etiqueta: "Facturación",
      valor: dinero(actual.facturado),
      variacion: chipVariacion(variacion(actual.facturado, anterior.facturado)),
      detalle: `${plural(actual.operaciones, "venta")} · ${comparacion}`,
      spark: sparkline(porMes.map((m) => m.facturado), "serie-1"),
      destacada: true,
    }),
    tarjetaKpiDash({
      etiqueta: "Ganancia bruta",
      valor: dinero(actual.ganancia),
      variacion: chipVariacion(variacion(actual.ganancia, anterior.ganancia)),
      detalle: "Ventas menos el costo de lo vendido",
      spark: sparkline(porMes.map((m) => m.ganancia), "serie-2"),
      clase: "serie-2",
    }),
    tarjetaKpiDash({
      etiqueta: "Margen bruto",
      valor: porcentaje(actual.margen),
      variacion: chipVariacion(actual.margen != null && anterior.margen != null ? actual.margen - anterior.margen : null, { puntos: true }),
      detalle: "Ganancia sobre lo facturado",
      spark: sparkline(porMes.map((m) => m.margen ?? 0), "serie-3"),
      clase: "serie-3",
    }),
    `<article class="dash-kpi dash-kpi-objetivo serie-1">
      <div class="dash-kpi-cabeza"><span class="dash-kpi-etiqueta">Objetivo de facturación</span></div>
      ${
        cumplimiento != null
          ? `<div class="objetivo-anillo">${anilloProgreso(cumplimiento, esperado)}<div><div class="dash-kpi-valor">${porcentaje(cumplimiento * 100, 0)}</div><div class="dash-kpi-detalle">${dinero(actual.facturado)} de ${dinero(objetivos.total.facturacion)}</div></div></div>
             <div class="dash-kpi-pie"><span class="dash-kpi-detalle">${estadoRitmo(cumplimiento, esperado)}</span></div>`
          : `<div class="dash-kpi-valor dash-kpi-vacio">Sin objetivo</div><div class="dash-kpi-pie"><button type="button" class="btn-link" data-accion="objetivos">${ICONO_OBJETIVO}Cargar objetivos</button></div>`
      }
    </article>`,
  ].join("");

  const ventasSinCosto = actual.facturado - actual.facturadoConCosto;
  const html = `
    <div class="dash-kpis">${kpis}</div>
    ${ventasSinCosto > 0.5 ? `<p class="dash-aviso">${dinero(ventasSinCosto)} de ventas son de productos sin costo cargado: no entran en la ganancia ni en el margen.</p>` : ""}
    <div class="dash-grilla dash-grilla-2-1">
      ${tarjetaGrafico({
        id: "ej-evolucion",
        titulo: "Facturación y ganancia",
        subtitulo: "Últimos 12 meses · resaltado el período elegido",
        leyenda: itemLeyenda("Facturación", "serie-1") + itemLeyenda("Ganancia bruta", "serie-2") + (dash.datos.objetivos.length ? itemLeyenda("Objetivo de facturación", "serie-objetivo", "linea") : ""),
      })}
      <section class="dash-tarjeta">
        <header class="dash-tarjeta-cabeza">
          <div><h3>Objetivos</h3><p>${escapeHtml(etiquetaPeriodo())} · la marquita es donde deberías estar hoy</p></div>
          <div class="dash-tarjeta-acciones"><button type="button" class="btn-chico btn-con-icono" data-accion="objetivos">${ICONO_LAPIZ}Editar</button></div>
        </header>
        <div class="medidores">
          ${medidor("Facturación", actual.facturado, objetivos.total.facturacion, objetivos.esperado.facturacion, objetivos.hay.facturacion, dinero)}
          ${medidor("Ganancia bruta", actual.ganancia, objetivos.total.ganancia, objetivos.esperado.ganancia, objetivos.hay.ganancia, dinero)}
          ${medidor("Unidades vendidas", actual.unidades, objetivos.total.unidades, objetivos.esperado.unidades, objetivos.hay.unidades, formatoNumero)}
        </div>
        ${proyeccionDelMes()}
      </section>
    </div>
    <div class="dash-grilla dash-grilla-2">
      ${tarjetaGrafico({ id: "ej-margen-cat", titulo: "Margen por categoría", subtitulo: `${escapeHtml(etiquetaPeriodo())} · ganancia y % de margen` })}
      ${tarjetaGrafico({ id: "ej-margen-mes", titulo: "Evolución del margen bruto", subtitulo: "Últimos 12 meses" })}
    </div>`;

  const dibujar = () => {
    const objetivosMes = meses.map((m) => objetivoDelMes(m.clave)?.facturacion ?? null);
    pintar(
      "ej-evolucion",
      (lugar) =>
        graficoColumnas(lugar, {
          titulo: "Facturación y ganancia por mes",
          categorias: meses.map((m) => m.corto),
          categoriasLargas: meses.map((m) => m.largo),
          series: [
            { nombre: "Facturación", clase: "serie-1", valores: porMes.map((m) => m.facturado) },
            { nombre: "Ganancia bruta", clase: "serie-2", valores: porMes.map((m) => m.ganancia) },
          ],
          objetivo: objetivosMes.some((v) => v != null) ? { nombre: "Objetivo", valores: objetivosMes } : null,
          resaltar: enPeriodo,
          formato: dinero,
          formatoEje: dineroEje,
          pie: (i) => (porMes[i].margen != null ? `Margen ${porcentaje(porMes[i].margen)}` : null),
          vacio: "Todavía no hay ventas registradas.",
        }),
      {
        columnas: ["Mes", "Facturación", "Ganancia bruta", "Margen", "Objetivo"],
        filas: meses.map((m, i) => [m.largo, dinero(porMes[i].facturado), dinero(porMes[i].ganancia), porcentaje(porMes[i].margen), objetivosMes[i] != null ? dinero(objetivosMes[i]) : "—"]),
      }
    );
    const categorias = [...actual.categorias.entries()]
      .map(([nombre, c]) => ({ nombre, ganancia: c.conCosto - c.costo, margen: c.conCosto ? ((c.conCosto - c.costo) / c.conCosto) * 100 : null, facturado: c.facturado }))
      .sort((a, b) => b.ganancia - a.ganancia);
    pintar(
      "ej-margen-cat",
      (lugar) =>
        graficoBarrasH(lugar, {
          clase: "serie-2",
          filas: categorias.map((c) => ({
            etiqueta: c.nombre,
            valor: c.ganancia,
            texto: `${dinero(c.ganancia)} · ${porcentaje(c.margen, 0)}`,
            detalle: [
              { valor: dinero(c.ganancia), etiqueta: "Ganancia bruta", clase: "serie-2", tipo: "barra" },
              { valor: porcentaje(c.margen), etiqueta: "Margen", clase: "serie-referencia" },
              { valor: dinero(c.facturado), etiqueta: "Facturación", clase: "serie-referencia" },
            ],
          })),
          vacio: "Sin ventas en este período.",
        }),
      { columnas: ["Categoría", "Facturación", "Ganancia bruta", "Margen"], filas: categorias.map((c) => [c.nombre, dinero(c.facturado), dinero(c.ganancia), porcentaje(c.margen)]) }
    );
    pintar(
      "ej-margen-mes",
      (lugar) =>
        graficoLineas(lugar, {
          titulo: "Margen bruto por mes",
          etiquetas: meses.map((m) => m.corto),
          etiquetasLargas: meses.map((m) => m.largo),
          series: [{ nombre: "Margen bruto", clase: "serie-3", area: true, valores: porMes.map((m) => (m.margen == null ? null : Math.round(m.margen * 10) / 10)), etiquetaFinal: null }],
          formato: (v) => porcentaje(v),
          formatoEje: (v) => `${v}%`,
          alto: 230,
          vacio: "Todavía no hay ventas con costo cargado.",
        }),
      { columnas: ["Mes", "Margen bruto"], filas: meses.map((m, i) => [m.largo, porcentaje(porMes[i].margen)]) }
    );
  };
  return { html, dibujar, sinConvertir: actual.sinConvertir };
}

function estadoRitmo(cumplido, esperado) {
  if (cumplido == null) return "";
  if (esperado == null || esperado <= 0) return "";
  const diferencia = (cumplido - esperado) * 100;
  if (cumplido >= 1) return `<span class="ritmo bueno">Objetivo cumplido</span>`;
  if (diferencia >= -2) return `<span class="ritmo bueno">Vas al ritmo (deberías llevar ${porcentaje(esperado * 100, 0)})</span>`;
  return `<span class="ritmo malo">${porcentaje(Math.abs(diferencia), 0)} abajo del ritmo esperado</span>`;
}

function medidor(nombre, valor, objetivo, esperado, hay, formato) {
  if (!hay || !objetivo) {
    return `<div class="medidor sin-objetivo"><div class="medidor-cabeza"><span>${escapeHtml(nombre)}</span><strong>${formato(valor)}</strong></div><div class="medidor-pista"></div><span class="medidor-detalle">Sin objetivo cargado</span></div>`;
  }
  const fraccion = valor / objetivo;
  const marca = esperado / objetivo;
  const estado = fraccion >= 1 ? "cumplido" : fraccion >= marca - 0.02 ? "en-ritmo" : "atrasado";
  return `<div class="medidor ${estado}">
    <div class="medidor-cabeza"><span>${escapeHtml(nombre)}</span><strong>${porcentaje(fraccion * 100, 0)}</strong></div>
    <div class="medidor-pista" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(fraccion * 100)}" aria-label="${escapeAttr(nombre)}">
      <span class="medidor-relleno" style="--ancho:${Math.min(100, fraccion * 100)}%"></span>
      ${marca > 0 && marca < 1 ? `<span class="medidor-marca" style="--pos:${marca * 100}%" title="Donde deberías estar hoy"></span>` : ""}
    </div>
    <span class="medidor-detalle">${formato(valor)} de ${formato(objetivo)}${fraccion >= 1 ? " · ¡cumplido!" : ` · faltan ${formato(Math.max(0, objetivo - valor))}`}</span>
  </div>`;
}

// Al ritmo de este mes, cuanto se factura a fin de mes.
function proyeccionDelMes() {
  const { hoy } = dash.datos;
  const desde = inicioDeMes(hoy);
  const mes = resumir(desde, hoy);
  const f = aFecha(hoy);
  const dim = diasDelMes(f.getFullYear(), f.getMonth());
  const dia = f.getDate();
  if (!mes.facturado || dia < 3) return `<p class="proyeccion">La proyección del mes aparece a partir del día 3.</p>`;
  const proyectado = (mes.facturado / dia) * dim;
  const obj = objetivoDelMes(hoy.slice(0, 7))?.facturacion;
  return `<div class="proyeccion"><span>Proyección de cierre de ${MESES_LARGOS[f.getMonth()]}</span><strong>${dinero(proyectado)}</strong>${
    obj ? `<span class="${proyectado >= obj ? "ritmo bueno" : "ritmo malo"}">${porcentaje((proyectado / obj) * 100, 0)} del objetivo</span>` : ""
  }</div>`;
}

// ---------- Ventas ----------
function dashboardVentas() {
  const { hoy } = dash.datos;
  const rango = rangoPeriodo(dash.periodo, hoy);
  const actual = resumir(rango.desde, rango.hasta);
  const anterior = resumir(rango.antDesde, rango.antHasta);
  const meses = ultimosMeses(12, hoy);
  const porMes = meses.map((m) => resumir(m.desde, m.hasta));
  const comparacion = textoComparacion();

  const kpis = [
    tarjetaKpiDash({
      etiqueta: "Ventas",
      valor: formatoNumero(actual.operaciones),
      variacion: chipVariacion(variacion(actual.operaciones, anterior.operaciones)),
      detalle: comparacion,
      spark: sparkline(porMes.map((m) => m.operaciones), "serie-1"),
      destacada: true,
    }),
    tarjetaKpiDash({
      etiqueta: "Unidades vendidas",
      valor: formatoNumero(actual.unidades),
      variacion: chipVariacion(variacion(actual.unidades, anterior.unidades)),
      detalle: `${plural(actual.productos.size, "producto distinto", "productos distintos")}`,
      spark: sparkline(porMes.map((m) => m.unidades), "serie-2"),
      clase: "serie-2",
    }),
    tarjetaKpiDash({
      etiqueta: "Ticket promedio",
      valor: actual.ticket != null ? dinero(actual.ticket) : "—",
      variacion: chipVariacion(variacion(actual.ticket, anterior.ticket)),
      detalle: "Facturación por venta",
      spark: sparkline(porMes.map((m) => m.ticket ?? 0), "serie-3"),
      clase: "serie-3",
    }),
    tarjetaKpiDash({
      etiqueta: "Clientes",
      valor: formatoNumero(actual.clientes.size),
      variacion: chipVariacion(variacion(actual.clientes.size, anterior.clientes.size)),
      detalle: "Con nombre en la venta",
      spark: sparkline(porMes.map((m) => m.clientes.size), "serie-4"),
      clase: "serie-4",
    }),
  ].join("");

  const ultimos6 = meses.slice(-6);
  const porMes6 = porMes.slice(-6);
  const html = `
    <div class="dash-kpis">${kpis}</div>
    <div class="dash-grilla dash-grilla-2">
      ${tarjetaGrafico({
        id: "ve-burnup",
        titulo: `Objetivo de ${MESES_LARGOS[aFecha(hoy).getMonth()]}`,
        subtitulo: "Facturación acumulada día a día",
        leyenda: itemLeyenda("Este mes", "serie-1", "linea") + itemLeyenda("Mes pasado", "serie-referencia", "linea") + (objetivoDelMes(hoy.slice(0, 7))?.facturacion ? itemLeyenda("Ritmo ideal", "serie-ideal", "linea") : ""),
        acciones: `<button type="button" class="btn-chico btn-con-icono" data-accion="objetivos">${ICONO_OBJETIVO}Objetivos</button>`,
      })}
      ${tarjetaGrafico({
        id: "ve-cumplimiento",
        titulo: "Objetivo vs. cumplimiento",
        subtitulo: "Facturación de los últimos 6 meses contra su objetivo",
        leyenda: itemLeyenda("Facturación", "serie-1") + itemLeyenda("Objetivo", "serie-objetivo", "linea"),
      })}
    </div>
    <div class="dash-grilla dash-grilla-2-1">
      ${tarjetaGrafico({
        id: "ve-ranking",
        titulo: "Productos más vendidos",
        subtitulo: `${escapeHtml(etiquetaPeriodo())} · top 10`,
        acciones: `<div class="segmentado segmentado-chico" role="tablist" aria-label="Ordenar ranking">
          <button type="button" role="tab" data-ranking="unidades" class="${dash.rankingPor === "unidades" ? "activo" : ""}" aria-selected="${dash.rankingPor === "unidades"}">Unidades</button>
          <button type="button" role="tab" data-ranking="facturado" class="${dash.rankingPor === "facturado" ? "activo" : ""}" aria-selected="${dash.rankingPor === "facturado"}">Facturación</button>
        </div>`,
      })}
      ${tarjetaGrafico({ id: "ve-categorias", titulo: "Ventas por categoría", subtitulo: `${escapeHtml(etiquetaPeriodo())} · facturación` })}
    </div>`;

  const dibujar = () => {
    // burn-up del mes en curso
    const f = aFecha(hoy);
    const dim = diasDelMes(f.getFullYear(), f.getMonth());
    const dia = f.getDate();
    const desdeMes = inicioDeMes(hoy);
    const desdeAnt = inicioDeMes(hoy, -1);
    const dimAnt = diasDelMes(f.getFullYear(), f.getMonth() - 1); // en enero, -1 es diciembre del año anterior
    const acumular = (desde, dias, hastaDia) => {
      const valores = [];
      let suma = 0;
      for (let d = 1; d <= dias; d++) {
        const fecha = `${desde.slice(0, 8)}${String(d).padStart(2, "0")}`;
        if (hastaDia != null && d > hastaDia) {
          valores.push(null);
          continue;
        }
        suma += resumir(fecha, fecha).facturado;
        valores.push(Math.round(suma * 100) / 100);
      }
      return valores;
    };
    const esteMes = acumular(desdeMes, dim, dia);
    const mesPasado = acumular(desdeAnt, Math.min(dim, dimAnt));
    while (mesPasado.length < dim) mesPasado.push(null);
    const objMes = objetivoDelMes(hoy.slice(0, 7))?.facturacion ?? null;
    const ideal = objMes ? Array.from({ length: dim }, (_, i) => Math.round(((objMes * (i + 1)) / dim) * 100) / 100) : null;
    pintar(
      "ve-burnup",
      (lugar) =>
        graficoLineas(lugar, {
          titulo: "Facturación acumulada del mes",
          etiquetas: Array.from({ length: dim }, (_, i) => String(i + 1)),
          etiquetasLargas: Array.from({ length: dim }, (_, i) => `Día ${i + 1}`),
          series: [{ nombre: "Este mes", clase: "serie-1", area: true, valores: esteMes, etiquetaFinal: dinero(esteMes[dia - 1] ?? 0) }],
          referencias: [{ nombre: "Mes pasado", clase: "serie-referencia", valores: mesPasado }, ...(ideal ? [{ nombre: "Ritmo ideal", clase: "serie-ideal", valores: ideal }] : [])],
          meta: objMes ? { nombre: "Objetivo", valor: objMes } : null,
          formato: dinero,
          formatoEje: dineroEje,
          vacio: "Todavía no hay ventas este mes ni el anterior.",
        }),
      {
        columnas: ["Día", "Este mes", "Mes pasado", ...(ideal ? ["Ritmo ideal"] : [])],
        filas: esteMes.map((v, i) => [String(i + 1), v == null ? "—" : dinero(v), mesPasado[i] == null ? "—" : dinero(mesPasado[i]), ...(ideal ? [dinero(ideal[i])] : [])]),
      }
    );
    const objetivos6 = ultimos6.map((m) => objetivoDelMes(m.clave)?.facturacion ?? null);
    pintar(
      "ve-cumplimiento",
      (lugar) =>
        graficoColumnas(lugar, {
          titulo: "Facturación contra objetivo por mes",
          categorias: ultimos6.map((m) => m.corto),
          categoriasLargas: ultimos6.map((m) => m.largo),
          series: [{ nombre: "Facturación", clase: "serie-1", valores: porMes6.map((m) => m.facturado) }],
          objetivo: { nombre: "Objetivo", valores: objetivos6 },
          formato: dinero,
          formatoEje: dineroEje,
          pie: (i) => (objetivos6[i] ? `Cumplimiento: ${porcentaje((porMes6[i].facturado / objetivos6[i]) * 100, 0)}` : "Sin objetivo cargado para ese mes"),
          vacio: "Todavía no hay ventas registradas.",
        }),
      {
        columnas: ["Mes", "Facturación", "Objetivo", "Cumplimiento"],
        filas: ultimos6.map((m, i) => [m.largo, dinero(porMes6[i].facturado), objetivos6[i] ? dinero(objetivos6[i]) : "—", objetivos6[i] ? porcentaje((porMes6[i].facturado / objetivos6[i]) * 100, 0) : "—"]),
      }
    );
    const ranking = [...actual.productos.values()].sort((a, b) => b[dash.rankingPor] - a[dash.rankingPor] || b.facturado - a.facturado).slice(0, 10);
    pintar(
      "ve-ranking",
      (lugar) =>
        graficoBarrasH(lugar, {
          numerar: true,
          clase: "serie-1",
          filas: ranking.map((p) => ({
            etiqueta: p.nombre,
            valor: p[dash.rankingPor],
            texto: dash.rankingPor === "unidades" ? `${formatoNumero(p.unidades)} u.` : dinero(p.facturado),
            detalle: [
              { valor: `${formatoNumero(p.unidades)} u.`, etiqueta: "Unidades", clase: "serie-1", tipo: "barra" },
              { valor: dinero(p.facturado), etiqueta: "Facturación", clase: "serie-referencia" },
              { valor: dinero(p.ganancia), etiqueta: "Ganancia bruta", clase: "serie-referencia" },
            ],
          })),
          vacio: "Sin ventas en este período.",
        }),
      { columnas: ["Producto", "Unidades", "Facturación", "Ganancia bruta"], filas: ranking.map((p) => [p.nombre, formatoNumero(p.unidades), dinero(p.facturado), dinero(p.ganancia)]) }
    );
    const segmentos = porciones([...actual.categorias.entries()].map(([nombre, c]) => ({ etiqueta: nombre, valor: c.facturado })));
    pintar(
      "ve-categorias",
      (lugar) =>
        graficoDona(lugar, {
          titulo: "Facturación por categoría",
          segmentos,
          centro: { valor: formatoCompacto(actual.facturado, dash.moneda), etiqueta: "facturado" },
          formato: dinero,
          vacio: "Sin ventas en este período.",
        }),
      { columnas: ["Categoría", "Facturación", "%"], filas: segmentos.map((s) => [s.etiqueta, dinero(s.valor), porcentaje((s.valor / (actual.facturado || 1)) * 100, 0)]) }
    );
  };
  return { html, dibujar, sinConvertir: actual.sinConvertir };
}

// Hasta 4 porciones con color + "Otros" en gris (mas porciones no se distinguen bien).
// El color sigue a la categoria (por su orden en todo el historial), no a su puesto en el periodo.
function porciones(items) {
  const lista = items.filter((s) => s.valor > 0).sort((a, b) => b.valor - a.valor);
  const principales = lista.slice(0, 4);
  const resto = lista.slice(4).reduce((a, s) => a + s.valor, 0);
  const orden = ordenCategorias();
  const libres = ["serie-1", "serie-2", "serie-3", "serie-4"];
  const usados = new Map();
  for (const s of principales) {
    const preferido = libres[orden.indexOf(s.etiqueta)];
    if (preferido && ![...usados.values()].includes(preferido)) usados.set(s.etiqueta, preferido);
  }
  for (const s of principales) {
    if (!usados.has(s.etiqueta)) usados.set(s.etiqueta, libres.find((c) => ![...usados.values()].includes(c)));
  }
  return [...principales.map((s) => ({ ...s, clase: usados.get(s.etiqueta) })), ...(resto > 0 ? [{ etiqueta: "Otros", valor: resto, clase: "serie-otros" }] : [])];
}

let cacheOrdenCategorias = null;
function ordenCategorias() {
  if (cacheOrdenCategorias) return cacheOrdenCategorias;
  const totales = new Map();
  for (const v of dash.datos.ventas) totales.set(v.categoria, (totales.get(v.categoria) ?? 0) + v.unidades);
  for (const g of dash.datos.gastos) totales.set(g.categoria, (totales.get(g.categoria) ?? 0) + 1);
  cacheOrdenCategorias = [...totales.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return cacheOrdenCategorias;
}

// ---------- Financiero ----------
function dashboardFinanciero() {
  const { hoy, posicion } = dash.datos;
  const rango = rangoPeriodo(dash.periodo, hoy);
  const actual = resumir(rango.desde, rango.hasta);
  const anterior = resumir(rango.antDesde, rango.antHasta);
  const meses = ultimosMeses(12, hoy);
  const porMes = meses.map((m) => resumir(m.desde, m.hasta));
  const enPeriodo = new Set(meses.map((m, i) => (m.hasta >= rango.desde && m.desde <= rango.hasta ? i : -1)).filter((i) => i >= 0));
  const comparacion = textoComparacion();

  const kpis = [
    tarjetaKpiDash({
      etiqueta: "Ingresos",
      valor: dinero(actual.entradas),
      variacion: chipVariacion(variacion(actual.entradas, anterior.entradas)),
      detalle: actual.cobrados ? `Ventas ${dinero(actual.facturado)} + cobros de préstamos ${dinero(actual.cobrados)}` : `Ventas · ${comparacion}`,
      spark: sparkline(porMes.map((m) => m.entradas), "estado-bueno"),
      clase: "estado-bueno",
      destacada: true,
    }),
    tarjetaKpiDash({
      etiqueta: "Gastos",
      valor: dinero(actual.gastos),
      variacion: chipVariacion(variacion(actual.gastos, anterior.gastos), { invertido: true }),
      detalle: `Operativos · además, compras de mercadería ${dinero(actual.compras)}`,
      spark: sparkline(porMes.map((m) => m.gastos), "estado-malo"),
      clase: "estado-malo",
    }),
    tarjetaKpiDash({
      etiqueta: "Ganancia real",
      valor: dinero(actual.gananciaReal),
      variacion: chipDiferencia(actual.gananciaReal, anterior.gananciaReal),
      detalle: `Margen neto ${porcentaje(actual.margenNeto)}`,
      spark: sparkline(porMes.map((m) => m.gananciaReal), "serie-2"),
      clase: "serie-2",
      ayuda: "Ganancia bruta (ventas menos costo de lo vendido) menos los gastos operativos.",
    }),
    tarjetaKpiDash({
      etiqueta: "Flujo de caja",
      valor: dinero(actual.flujo),
      variacion: chipDiferencia(actual.flujo, anterior.flujo),
      detalle: `Entró ${dinero(actual.entradas)} · salió ${dinero(actual.salidas)}`,
      spark: sparkline(porMes.map((m) => m.flujo), "serie-1"),
      ayuda: "Plata que entró (ventas y cobros de préstamos) menos la que salió (compras de mercadería, gastos y préstamos dados).",
    }),
  ].join("");

  const stock = sumarPorMoneda(posicion.stock, ["al_costo", "a_precio_venta", "unidades"]);
  const porCobrar = sumarPorMoneda(posicion.por_cobrar, ["monto"]);
  const gastosPeriodo = dash.datos.gastos.filter(filtroFechas(rango.desde, rango.hasta));

  const html = `
    <div class="dash-kpis">${kpis}</div>
    <div class="dash-grilla dash-grilla-2-1">
      ${tarjetaGrafico({
        id: "fi-cascada",
        titulo: "De las ventas a la ganancia real",
        subtitulo: `${escapeHtml(etiquetaPeriodo())}`,
        leyenda: itemLeyenda("Ventas", "serie-1") + itemLeyenda("Costos y gastos", "estado-malo") + itemLeyenda("Resultado", "serie-2"),
      })}
      ${tarjetaGrafico({ id: "fi-gastos-cat", titulo: "Gastos por categoría", subtitulo: `${escapeHtml(etiquetaPeriodo())} · operativos` })}
    </div>
    ${tarjetaGrafico({
      id: "fi-flujo",
      titulo: "Flujo de caja",
      subtitulo: "Últimos 12 meses · entradas, salidas y neto de cada mes (el saldo acumulado, en el detalle y la tabla)",
      leyenda: itemLeyenda("Entradas", "estado-bueno") + itemLeyenda("Salidas", "estado-malo") + itemLeyenda("Neto del mes", "serie-2", "linea"),
      clase: "ancho-completo",
    })}
    <section class="dash-tarjeta ancho-completo">
      <header class="dash-tarjeta-cabeza"><div><h3>Posición de hoy</h3><p>Lo que tenés invertido y lo que te deben</p></div></header>
      <div class="posicion">
        ${datoPosicion("Stock al costo", stock.al_costo, `${formatoNumero(stock.unidades)} unidades en stock`)}
        ${datoPosicion("Stock a precio de venta", stock.a_precio_venta, stock.al_costo ? `Ganancia potencial ${dinero(stock.a_precio_venta - stock.al_costo)}` : "")}
        ${datoPosicion("Préstamos por cobrar", porCobrar.monto, posicion.por_cobrar.reduce((a, p) => a + p.cantidad, 0) ? plural(posicion.por_cobrar.reduce((a, p) => a + p.cantidad, 0), "préstamo activo", "préstamos activos") : "Nadie te debe plata")}
        <div class="dato-posicion"><span>Canjes pendientes</span><strong>${formatoNumero(posicion.canjes_pendientes)}</strong><small>${posicion.canjes_pendientes ? "En Plan Canje" : "Ninguno"}</small></div>
      </div>
    </section>
    <section class="dash-tarjeta ancho-completo">
      <header class="dash-tarjeta-cabeza">
        <div><h3>Gastos del período</h3><p>${plural(gastosPeriodo.length, "gasto")} · ${escapeHtml(etiquetaPeriodo())}</p></div>
        <div class="dash-tarjeta-acciones"><button type="button" class="btn-primario btn-compacto" data-accion="gasto">${ICONO_MAS}Registrar gasto</button></div>
      </header>
      <div class="tabla-wrap"><table id="tabla-gastos"><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th class="num">Monto</th><th class="col-acciones"></th></tr></thead><tbody></tbody></table></div>
    </section>`;

  const dibujar = () => {
    pintar(
      "fi-cascada",
      (lugar) =>
        graficoCascada(lugar, {
          moneda: dash.moneda,
          pasos: [
            { etiqueta: "Ventas", corta: "Ventas", valor: actual.facturadoConCosto, tipo: "inicio", detalle: "Ventas con costo cargado" },
            { etiqueta: "Costo mercadería", corta: "Costo", valor: actual.costo, tipo: "resta", detalle: "Costo de lo vendido" },
            { etiqueta: "Ganancia bruta", corta: "Bruta", valor: actual.ganancia, tipo: "total", detalle: porcentaje(actual.margen) + " de margen" },
            { etiqueta: "Gastos", corta: "Gastos", valor: actual.gastos, tipo: "resta", detalle: "Gastos operativos" },
            { etiqueta: "Ganancia real", corta: "Real", valor: actual.ganancia - actual.gastos, tipo: "total", detalle: "Lo que te queda" },
          ],
          formato: dinero,
          formatoEje: dineroEje,
          vacio: "Sin ventas ni gastos en este período.",
        }),
      {
        columnas: ["Concepto", "Monto"],
        filas: [
          ["Ventas (con costo cargado)", dinero(actual.facturadoConCosto)],
          ["− Costo de mercadería", dinero(actual.costo)],
          ["= Ganancia bruta", dinero(actual.ganancia)],
          ["− Gastos operativos", dinero(actual.gastos)],
          ["= Ganancia real", dinero(actual.ganancia - actual.gastos)],
        ],
      }
    );
    const segmentos = porciones([...actual.gastosPorCategoria.entries()].map(([etiqueta, valor]) => ({ etiqueta, valor })));
    pintar(
      "fi-gastos-cat",
      (lugar) =>
        graficoDona(lugar, {
          titulo: "Gastos por categoría",
          segmentos,
          centro: { valor: formatoCompacto(actual.gastos, dash.moneda), etiqueta: "en gastos" },
          formato: dinero,
          vacio: "No hay gastos registrados en este período.",
        }),
      { columnas: ["Categoría", "Monto", "%"], filas: segmentos.map((s) => [s.etiqueta, dinero(s.valor), porcentaje((s.valor / (actual.gastos || 1)) * 100, 0)]) }
    );
    let acumulado = 0;
    const acumulados = porMes.map((m) => (acumulado += m.flujo));
    pintar(
      "fi-flujo",
      (lugar) =>
        graficoFlujo(lugar, {
          categorias: meses.map((m) => m.corto),
          categoriasLargas: meses.map((m) => m.largo),
          entradas: porMes.map((m) => m.entradas),
          salidas: porMes.map((m) => m.salidas),
          neto: porMes.map((m) => m.flujo),
          acumulado: acumulados,
          resaltar: enPeriodo,
          formato: dinero,
          formatoEje: dineroEje,
        }),
      {
        columnas: ["Mes", "Entradas", "Salidas", "Neto", "Saldo acumulado"],
        filas: meses.map((m, i) => [m.largo, dinero(porMes[i].entradas), dinero(porMes[i].salidas), dinero(porMes[i].flujo), dinero(acumulados[i])]),
      }
    );
    renderTabla(
      "tabla-gastos",
      gastosPeriodo,
      (g) => `<tr>
        <td data-etiqueta="Fecha">${escapeHtml(fechaCorta(g.fecha))}</td>
        <td data-etiqueta="Concepto" class="texto-fuerte">${escapeHtml(g.concepto)}${g.nota ? `<div class="texto-tenue">${escapeHtml(g.nota)}</div>` : ""}</td>
        <td data-etiqueta="Categoría"><span class="etiqueta">${escapeHtml(g.categoria)}</span></td>
        <td data-etiqueta="Monto" class="num">${formatoConSimbolo(g.monto, g.moneda)}</td>
        <td class="acciones"><button class="btn-icono peligro" title="Borrar gasto" aria-label="Borrar gasto ${escapeAttr(g.concepto)}" data-borrar-gasto="${g.id}">${ICONO_TACHO}</button></td>
      </tr>`,
      "No hay gastos en este período. Registralos acá o por Telegram (\"pagué 300 mil de alquiler\")."
    );
  };
  return { html, dibujar, sinConvertir: actual.sinConvertir };
}

function sumarPorMoneda(filas, campos) {
  const total = Object.fromEntries(campos.map((c) => [c, 0]));
  for (const f of filas) {
    for (const c of campos) {
      if (c === "unidades") total[c] += f[c] ?? 0;
      else total[c] += aMoneda(f[c] ?? 0, f.moneda) ?? 0;
    }
  }
  return total;
}

function datoPosicion(etiqueta, valor, detalle) {
  return `<div class="dato-posicion"><span>${escapeHtml(etiqueta)}</span><strong>${dinero(valor)}</strong><small>${detalle}</small></div>`;
}

// ---------- carga y dibujo ----------
async function cargarResumen() {
  const contenido = document.getElementById("dash-contenido");
  if (!dash.datos) contenido.innerHTML = esqueletoDashboard();
  else contenido.classList.add("recargando");
  try {
    dash.datos = await api("GET", "/api/dashboard");
    cacheOrdenCategorias = null;
    dibujarDashboard();
  } catch (e) {
    mostrarToast(e.message, true);
  } finally {
    contenido.classList.remove("recargando");
  }
}

function esqueletoDashboard() {
  return `<div class="dash-kpis">${'<article class="dash-kpi esqueleto"><div class="esqueleto-linea" style="width:40%"></div><div class="esqueleto-linea grande"></div><div class="esqueleto-linea" style="width:70%"></div></article>'.repeat(4)}</div>
    <div class="dash-grilla dash-grilla-2-1"><section class="dash-tarjeta esqueleto alto"></section><section class="dash-tarjeta esqueleto alto"></section></div>`;
}

function dibujarDashboard() {
  if (!dash.datos) return;
  ocultarTooltip();
  document.querySelectorAll("#dash-esquemas [data-esquema]").forEach((b) => {
    const activo = b.dataset.esquema === dash.esquema;
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-selected", String(activo));
  });
  document.querySelectorAll("#dash-moneda [data-moneda]").forEach((b) => {
    const activo = b.dataset.moneda === dash.moneda;
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-pressed", String(activo));
  });
  dibujarSelectorPeriodo();
  const vista = dash.esquema === "ventas" ? dashboardVentas() : dash.esquema === "financiero" ? dashboardFinanciero() : dashboardEjecutivo();
  const contenido = document.getElementById("dash-contenido");
  contenido.innerHTML = vista.html;
  contenido.dataset.esquema = dash.esquema;
  soltarGraficos();
  vista.dibujar();
  animarEntrada(contenido);
  // nota sobre monedas
  const dolar = dash.datos.dolar_blue_venta;
  const otra = dash.moneda === "USD" ? "pesos" : "dólares";
  document.getElementById("dash-nota").innerHTML = dolar
    ? `Todo en ${dash.moneda === "USD" ? "dólares" : "pesos"}: lo que está en ${otra} se pasa al dólar blue de hoy (${formatoConSimbolo(dolar, "ARS")}).`
    : `<span class="ritmo malo">Sin cotización del dólar ahora:</span> se muestran solo las operaciones en ${dash.moneda === "USD" ? "dólares" : "pesos"}${vista.sinConvertir ? ` (${plural(vista.sinConvertir, "registro")} en ${otra} quedan afuera)` : ""}.`;
}

function animarEntrada(contenedor) {
  if (sinAnimaciones()) return;
  contenedor.querySelectorAll(".dash-kpi, .dash-tarjeta").forEach((el, i) => {
    el.style.setProperty("--i", Math.min(i, 10));
    el.classList.add("entrando");
  });
}

// ---------- eventos ----------
document.getElementById("dash-esquemas").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-esquema]");
  if (!b || b.dataset.esquema === dash.esquema) return;
  dash.esquema = b.dataset.esquema;
  guardarPreferenciasDashboard();
  dibujarDashboard();
});
// ---------- selector de periodo (propio: el desplegable del navegador sale blanco en Windows) ----------
const selectorPeriodo = document.getElementById("dash-periodo");
const listaPeriodos = document.getElementById("dash-periodo-lista");

function dibujarSelectorPeriodo() {
  const hoy = dash.datos.hoy;
  document.getElementById("dash-periodo-nombre").textContent = PERIODOS[dash.periodo].nombre;
  document.getElementById("dash-periodo-rango").textContent = etiquetaPeriodo();
  listaPeriodos.innerHTML = Object.entries(PERIODOS)
    .map(([clave, p]) => {
      const r = rangoPeriodo(clave, hoy);
      const elegido = clave === dash.periodo;
      return `<li role="option" id="periodo-${clave}" data-periodo="${clave}" aria-selected="${elegido}" class="${elegido ? "elegido" : ""}">
        <span class="periodo-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
        <span class="periodo-textos"><strong>${escapeHtml(p.nombre)}</strong><small>${escapeHtml(textoRango(r.desde, r.hasta))}</small></span>
      </li>`;
    })
    .join("");
  document.getElementById("dash-hoy").textContent = `Datos al ${textoRango(hoy, hoy)} (hora de Argentina)`;
}

function abrirSelectorPeriodo() {
  listaPeriodos.hidden = false;
  selectorPeriodo.setAttribute("aria-expanded", "true");
  const elegido = listaPeriodos.querySelector('[aria-selected="true"]');
  listaPeriodos.setAttribute("aria-activedescendant", elegido?.id ?? "");
  marcarActivoPeriodo(elegido);
  listaPeriodos.focus();
}

function cerrarSelectorPeriodo(devolverFoco = true) {
  if (listaPeriodos.hidden) return;
  listaPeriodos.hidden = true;
  selectorPeriodo.setAttribute("aria-expanded", "false");
  if (devolverFoco) selectorPeriodo.focus();
}

function marcarActivoPeriodo(li) {
  listaPeriodos.querySelectorAll("li").forEach((x) => x.classList.toggle("activo", x === li));
  if (li) listaPeriodos.setAttribute("aria-activedescendant", li.id);
}

function elegirPeriodo(clave) {
  cerrarSelectorPeriodo();
  if (!PERIODOS[clave] || clave === dash.periodo) return;
  dash.periodo = clave;
  guardarPreferenciasDashboard();
  dibujarDashboard();
}

selectorPeriodo.addEventListener("click", () => (listaPeriodos.hidden ? abrirSelectorPeriodo() : cerrarSelectorPeriodo()));
selectorPeriodo.addEventListener("keydown", (ev) => {
  if (["ArrowDown", "ArrowUp", "Enter", " "].includes(ev.key)) {
    ev.preventDefault();
    abrirSelectorPeriodo();
  }
});
listaPeriodos.addEventListener("click", (ev) => {
  const li = ev.target.closest("li[data-periodo]");
  if (li) elegirPeriodo(li.dataset.periodo);
});
listaPeriodos.addEventListener("pointermove", (ev) => {
  const li = ev.target.closest("li[data-periodo]");
  if (li) marcarActivoPeriodo(li);
});
listaPeriodos.addEventListener("keydown", (ev) => {
  const items = [...listaPeriodos.querySelectorAll("li")];
  const actual = items.findIndex((x) => x.classList.contains("activo"));
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    const siguiente = items[(actual + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    marcarActivoPeriodo(siguiente);
  } else if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    if (items[actual]) elegirPeriodo(items[actual].dataset.periodo);
  } else if (ev.key === "Escape" || ev.key === "Tab") {
    ev.preventDefault();
    cerrarSelectorPeriodo();
  }
});
document.addEventListener("pointerdown", (ev) => {
  if (!ev.target.closest("#dash-periodo-caja")) cerrarSelectorPeriodo(false);
});
document.getElementById("dash-moneda").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-moneda]");
  if (!b || b.dataset.moneda === dash.moneda) return;
  dash.moneda = b.dataset.moneda;
  guardarPreferenciasDashboard();
  dibujarDashboard();
});

document.getElementById("dash-contenido").addEventListener("click", async (ev) => {
  const tabla = ev.target.closest("[data-tabla]");
  if (tabla) {
    const id = tabla.dataset.tabla;
    dash.tablas.has(id) ? dash.tablas.delete(id) : dash.tablas.add(id);
    return dibujarDashboard();
  }
  const ranking = ev.target.closest("[data-ranking]");
  if (ranking && ranking.dataset.ranking !== dash.rankingPor) {
    dash.rankingPor = ranking.dataset.ranking;
    return dibujarDashboard();
  }
  const accion = ev.target.closest("[data-accion]");
  if (accion?.dataset.accion === "objetivos") return abrirDialogoObjetivos();
  if (accion?.dataset.accion === "gasto") return abrirDialogoGasto();
  const borrar = ev.target.closest("[data-borrar-gasto]");
  if (borrar) {
    const gasto = dash.datos.gastos.find((g) => g.id === Number(borrar.dataset.borrarGasto));
    if (!gasto) return;
    const ok = await confirmar({ titulo: "¿Borrar este gasto?", mensaje: `${gasto.concepto} · ${formatoConSimbolo(gasto.monto, gasto.moneda)} del ${fechaCorta(gasto.fecha)}.`, textoBoton: "Borrar", peligro: true });
    if (!ok) return;
    conCarga(borrar, async () => {
      try {
        await api("DELETE", `/api/gastos/${gasto.id}`);
        mostrarToast("Gasto borrado.");
        cargarResumen();
      } catch (e) {
        mostrarToast(e.message, true);
      }
    });
  }
});

// ---------- dialogo: objetivos ----------
function abrirDialogoObjetivos() {
  abrirDialogo("dialogo-objetivos");
  const form = document.getElementById("form-objetivos");
  const mes = dash.datos.hoy.slice(0, 7);
  form.elements.mes.value = mes;
  completarObjetivos(mes);
}

function completarObjetivos(mes) {
  const form = document.getElementById("form-objetivos");
  const vigente = objetivoDelMes(mes)?.original;
  form.elements.moneda.value = vigente?.moneda ?? "USD";
  form.elements.facturacion.value = vigente?.facturacion ?? "";
  form.elements.ganancia.value = vigente?.ganancia ?? "";
  form.elements.unidades.value = vigente?.unidades ?? "";
  document.getElementById("objetivos-vigente").textContent = vigente
    ? vigente.mes === mes
      ? "Este mes ya tiene objetivos propios: los vas a reemplazar."
      : `Ahora rigen los que cargaste en ${MESES_LARGOS[Number(vigente.mes.slice(5)) - 1]} ${vigente.mes.slice(0, 4)}.`
    : "Todavía no cargaste objetivos.";
}

document.getElementById("form-objetivos").elements.mes.addEventListener("change", (ev) => {
  if (/^\d{4}-\d{2}$/.test(ev.target.value)) completarObjetivos(ev.target.value);
});

document.getElementById("form-objetivos").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target));
  conCarga(ev.submitter, async () => {
    try {
      await api("PUT", "/api/objetivos", datos);
      mostrarToast("Objetivos guardados.");
      cerrarDialogo("dialogo-objetivos");
      cargarResumen();
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
});

// ---------- dialogo: gasto ----------
function abrirDialogoGasto() {
  abrirDialogo("dialogo-gasto");
  const form = document.getElementById("form-gasto");
  form.elements.fecha.value = dash.datos.hoy;
  const select = form.elements.categoria;
  if (select.options.length <= 1) {
    for (const c of dash.datos.categorias_gasto) select.add(new Option(c, c));
  }
  form.elements.concepto.focus();
}

document.getElementById("form-gasto").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target));
  const body = limpiarVacios({ ...datos, monto: Number(datos.monto) });
  conCarga(ev.submitter, async () => {
    try {
      const r = await api("POST", "/api/gastos", body);
      mostrarToast(`Gasto registrado (${r.gasto.categoria}).`);
      cerrarDialogo("dialogo-gasto");
      cargarResumen();
    } catch (e) {
      mostrarToast(e.message, true);
    }
  });
});
