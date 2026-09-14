// Panel de Gestor Mayorista: vanilla JS, sin build step. Todo pega directo contra la API en /api/*.

// ---------- login (la clave se guarda en sessionStorage del navegador, se manda como header en cada llamada) ----------
function authHeader() {
  const clave = sessionStorage.getItem("panel_clave");
  return clave ? "Basic " + btoa("gestor:" + clave) : null;
}

async function probarClave(clave) {
  const resp = await fetch("/api/resumen", { headers: { Authorization: "Basic " + btoa("gestor:" + clave) } });
  return resp.ok;
}

async function iniciarLogin() {
  const claveGuardada = sessionStorage.getItem("panel_clave");
  if (claveGuardada && (await probarClave(claveGuardada))) {
    mostrarApp();
    return;
  }
  sessionStorage.removeItem("panel_clave");
  document.getElementById("login-overlay").classList.remove("oculto");
}

function mostrarApp() {
  document.getElementById("login-overlay").classList.add("oculto");
  document.getElementById("app-shell").classList.remove("oculto");
  cargarResumen();
  cargarListaPersonas();
  cargarListaProductos();
}

document.getElementById("form-login").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const clave = document.getElementById("login-clave").value;
  const ok = await probarClave(clave);
  if (ok) {
    sessionStorage.setItem("panel_clave", clave);
    mostrarApp();
  } else {
    document.getElementById("login-error").classList.remove("oculto");
  }
});

function mostrarToast(mensaje, esError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = mensaje;
  toast.className = esError ? "mostrar error" : "mostrar";
  setTimeout(() => (toast.className = ""), 3500);
}

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

function limpiarVacios(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === "" || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function formatoMoneda(n, moneda) {
  if (n == null) return "-";
  return `${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 })}${moneda ? " " + moneda : ""}`;
}

function estadoVacio(mensaje) {
  return `<div class="estado-vacio">${escapeHtml(mensaje)}</div>`;
}

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
  if (c.saldo_monto == null || c.saldo_monto === 0) return "-";
  const monto = formatoMoneda(Math.abs(c.saldo_monto), c.saldo_moneda);
  return c.saldo_monto > 0
    ? `<span class="a-favor-negocio">Te deben ${monto}</span>`
    : `<span class="a-favor-cliente">Les debés ${monto}</span>`;
}

// ---------- tabs ----------
const TITULOS_TAB = {
  resumen: "Resumen",
  stock: "Stock",
  ventas: "Ventas",
  prestamos: "Préstamos",
  prendas: "Plan Canje",
  empleados: "Empleados",
  bot: "Bot",
  logs: "Logs",
};

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("activo"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.add("oculto"));
    btn.classList.add("activo");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("oculto");
    document.getElementById("titulo-seccion").textContent = TITULOS_TAB[btn.dataset.tab] ?? "";
    cargarTab(btn.dataset.tab);
  });
});

function cargarTab(tab) {
  if (tab === "resumen") cargarResumen();
  if (tab === "stock") cargarProductos();
  if (tab === "ventas") cargarVentas();
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

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

// ---------- resumen ----------
async function cargarResumen() {
  try {
    const r = await api("GET", "/api/resumen");
    const cards = document.getElementById("resumen-cards");
    const totalProductos = r.productos.length;
    const unidadesTotales = r.productos.reduce((acc, p) => acc + p.cantidad, 0);
    cards.innerHTML = `
      <div class="card"><div class="label">Productos distintos</div><div class="valor">${totalProductos}</div></div>
      <div class="card"><div class="label">Unidades en stock</div><div class="valor">${unidadesTotales}</div></div>
      <div class="card"><div class="label">Préstamos activos</div><div class="valor">${r.prestamos_activos.length}</div></div>
      <div class="card"><div class="label">Canjes pendientes</div><div class="valor">${r.canjes_pendientes.length}</div></div>
    `;
    document.getElementById("resumen-prestamos").innerHTML = r.prestamos_activos.length
      ? `<div class="tabla-wrap"><table><thead><tr><th>Persona</th><th>Pendiente</th><th>Moneda</th><th>Estado</th></tr></thead><tbody>${r.prestamos_activos
          .map((p) => `<tr><td data-etiqueta="Persona">${escapeHtml(p.persona_nombre)}</td><td data-etiqueta="Pendiente">${formatoMoneda(p.monto_pendiente)}</td><td data-etiqueta="Moneda">${p.moneda}</td><td data-etiqueta="Estado">${pillEstadoPrestamo(p.estado)}</td></tr>`)
          .join("")}</tbody></table></div>`
      : estadoVacio("No hay préstamos activos.");
    document.getElementById("resumen-prendas").innerHTML = r.canjes_pendientes.length
      ? `<div class="tabla-wrap"><table><thead><tr><th>Persona</th><th>Celular</th><th>Saldo</th></tr></thead><tbody>${r.canjes_pendientes
          .map((c) => `<tr><td data-etiqueta="Persona">${escapeHtml(c.persona_nombre)}</td><td data-etiqueta="Celular">${escapeHtml(c.descripcion)}</td><td data-etiqueta="Saldo">${textoSaldo(c)}</td></tr>`)
          .join("")}</tbody></table></div>`
      : estadoVacio("No hay canjes pendientes.");
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

// ---------- stock ----------
const ICONO_LAPIZ = `<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
const ICONO_TACHO = `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;

let productosCache = [];

async function cargarProductos() {
  try {
    productosCache = await api("GET", "/api/productos");
    const tbody = document.querySelector("#tabla-productos tbody");
    tbody.innerHTML = productosCache.length
      ? productosCache
          .map(
            (p) => `
      <tr data-id="${p.id}">
        <td data-etiqueta="Nombre">${escapeHtml(p.nombre)}</td>
        <td data-etiqueta="Categoria">${escapeHtml(p.categoria ?? "-")}</td>
        <td data-etiqueta="Cantidad" class="${p.cantidad < 0 ? "negativo" : ""}">${p.cantidad}</td>
        <td data-etiqueta="Costo">${p.costo != null ? formatoConSimbolo(p.costo, p.moneda) : "-"}</td>
        <td data-etiqueta="Precio venta">${p.precio_venta != null ? formatoConSimbolo(p.precio_venta, p.moneda) : "-"}</td>
        <td><button class="btn-icono" title="Editar" onclick="editarProducto(${p.id})">${ICONO_LAPIZ}</button></td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="6">${estadoVacio("Todavía no cargaste ningún producto.")}</td></tr>`;
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

function abrirDialogoProducto() {
  const form = document.getElementById("form-producto");
  form.reset();
  form.elements.id.value = "";
  document.getElementById("titulo-dialogo-producto").textContent = "Agregar stock";
  document.getElementById("boton-guardar-producto").textContent = "Generar stock";
  document.getElementById("dialogo-producto").showModal();
}

function editarProducto(id) {
  const p = productosCache.find((x) => x.id === id);
  if (!p) return;
  const form = document.getElementById("form-producto");
  form.reset();
  form.elements.id.value = p.id;
  form.elements.nombre.value = p.nombre;
  form.elements.categoria.value = p.categoria ?? "";
  form.elements.cantidad.value = p.cantidad;
  form.elements.costo.value = p.costo ?? "";
  form.elements.precio_venta.value = p.precio_venta ?? "";
  form.elements.moneda.value = p.moneda ?? "USD";
  document.getElementById("titulo-dialogo-producto").textContent = "Editar producto";
  document.getElementById("boton-guardar-producto").textContent = "Guardar cambios";
  document.getElementById("dialogo-producto").showModal();
}

document.getElementById("form-producto").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target));
  const id = datos.id;
  delete datos.id;
  const body = limpiarVacios({ ...datos, cantidad: Number(datos.cantidad) });
  try {
    if (id) {
      await api("PUT", `/api/productos/${id}`, body);
      mostrarToast("Producto actualizado.");
    } else {
      await api("POST", "/api/productos", body);
      mostrarToast("Stock generado.");
    }
    ev.target.reset();
    document.getElementById("dialogo-producto").close();
    cargarProductos();
    cargarListaProductos();
  } catch (e) {
    mostrarToast(e.message, true);
  }
});

// ---------- ventas ----------
document.getElementById("form-venta").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target));
  try {
    await api(
      "POST",
      "/api/ventas",
      limpiarVacios({ ...datos, cantidad: Number(datos.cantidad), precio_unitario: datos.precio_unitario ? Number(datos.precio_unitario) : undefined })
    );
    ev.target.reset();
    document.getElementById("dialogo-venta").close();
    mostrarToast("Venta generada.");
    cargarVentas();
    cargarListaProductos();
  } catch (e) {
    mostrarToast(e.message, true);
  }
});
const NOMBRE_MONEDA = { USD: "Dólares", ARS: "Pesos" };
const SIMBOLO_MONEDA = { USD: "U$D", ARS: "$" };
let ultimaCotizacionDolar = null; // { blue: {compra, venta, fechaActualizacion}, cripto: {...} }

// Formato "a la argentina": simbolo adelante, ej "U$D 8.494,5" o "$ 606.049".
function formatoConSimbolo(n, moneda) {
  if (n == null) return "-";
  const num = Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
  const simbolo = SIMBOLO_MONEDA[moneda];
  return simbolo ? `${simbolo} ${num}` : num;
}

function formatoGanancia(valor, moneda) {
  if (valor == null) return "-";
  const clase = valor > 0 ? "a-favor-negocio" : valor < 0 ? "a-favor-cliente" : "";
  return `<span class="${clase}">${formatoConSimbolo(valor, moneda)}</span>`;
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
      <span class="dolar-actualizado">Actualizado ${actualizado.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>
    `;
  } catch (e) {
    ultimaCotizacionDolar = null;
    cont.innerHTML = `<div class="dolar-info"><strong>Cotización del dólar</strong><span class="negativo">No se pudo obtener.</span></div>`;
  }
}

async function cargarVentas() {
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
          <div><div class="label">Facturado</div><div class="valor">${formatoConSimbolo(s.facturado, m)}</div></div>
          <div><div class="label">Unidades</div><div class="valor">${s.unidades}</div></div>
          <div><div class="label">Ganancia est.</div><div class="valor">${formatoGanancia(s.ganancia_estimada, m)}</div></div>
        </div>
      </div>`;
          })
          .join("")
      : `<div class="panel-moneda"><div class="panel-moneda-header">Sin ventas</div></div>`;

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
            <div class="valor">${formatoConSimbolo(facturadoTotalUSD, "USD")}</div>
            <div class="valor-secundario">≈ ${formatoConSimbolo(facturadoTotalUSD * promedio, "ARS")}</div>
          </div>
          <div>
            <div class="label">Ganancia equiv.</div>
            <div class="valor">${formatoGanancia(gananciaTotalUSD, "USD")}</div>
            <div class="valor-secundario">≈ ${formatoConSimbolo(gananciaTotalUSD * promedio, "ARS")}</div>
          </div>
        </div>
        <div class="panel-moneda-nota">Usando el dólar blue promedio (${formatoConSimbolo(promedio, "ARS")}) para convertir.</div>
      </div>`;
    }

    paneles.innerHTML = html;

    const tbody = document.querySelector("#tabla-ventas tbody");
    tbody.innerHTML = r.detalle
      .map(
        (v) => `<tr>
        <td data-etiqueta="Fecha">${v.fecha}</td>
        <td data-etiqueta="Producto">${escapeHtml(v.producto_nombre)}</td>
        <td data-etiqueta="Cantidad">${v.cantidad}</td>
        <td data-etiqueta="Cliente">${escapeHtml(v.persona_nombre ?? "-")}</td>
        <td data-etiqueta="Precio unit.">${v.precio_unitario ?? "-"}</td>
        <td data-etiqueta="Moneda">${v.moneda}</td>
        <td data-etiqueta="Nota">${escapeHtml(v.nota ?? "")}</td>
      </tr>`
      )
      .join("");
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

// ---------- prestamos ----------
async function cargarPrestamos() {
  try {
    const prestamos = await api("GET", "/api/prestamos");
    const tbody = document.querySelector("#tabla-prestamos tbody");
    tbody.innerHTML = prestamos
      .map(
        (p) => `
      <tr data-id="${p.id}">
        <td data-etiqueta="#">${p.id}</td>
        <td data-etiqueta="Persona">${escapeHtml(p.persona_nombre)}</td>
        <td data-etiqueta="Original">${formatoMoneda(p.monto_original)}</td>
        <td data-etiqueta="Pendiente" class="${p.monto_pendiente < 0 ? "negativo" : ""}">${formatoMoneda(p.monto_pendiente)}</td>
        <td data-etiqueta="Moneda">${p.moneda}</td>
        <td data-etiqueta="Estado">${pillEstadoPrestamo(p.estado)}</td>
        <td data-etiqueta="Fecha">${p.fecha}</td>
        <td data-etiqueta="Pago">
          ${
            p.estado !== "pagado"
              ? `<input class="c-pago" type="number" step="0.01" placeholder="Monto" style="width:80px" />
                 <button class="btn-chico pago" onclick="pagarPrestamo(${p.id}, this)">Pagar</button>`
              : "-"
          }
        </td>
      </tr>`
      )
      .join("");
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

async function pagarPrestamo(id, boton) {
  const fila = boton.closest("tr");
  const monto = Number(fila.querySelector(".c-pago").value);
  if (!monto || monto <= 0) return mostrarToast("Poné un monto valido.", true);
  try {
    await api("POST", `/api/prestamos/${id}/pagos`, { monto });
    mostrarToast("Pago registrado.");
    cargarPrestamos();
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

document.getElementById("form-prestamo").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target));
  try {
    await api("POST", "/api/prestamos", limpiarVacios({ ...datos, monto: Number(datos.monto) }));
    ev.target.reset();
    document.getElementById("dialogo-prestamo").close();
    mostrarToast("Préstamo generado.");
    cargarPrestamos();
    cargarListaPersonas();
  } catch (e) {
    mostrarToast(e.message, true);
  }
});

// ---------- plan canje ----------
let canjesCache = [];

async function cargarPrendas() {
  try {
    canjesCache = await api("GET", "/api/canjes");
    const tbody = document.querySelector("#tabla-prendas tbody");
    tbody.innerHTML = canjesCache.length
      ? canjesCache
          .map(
            (c) => `
      <tr data-id="${c.id}">
        <td data-etiqueta="Persona">${escapeHtml(c.persona_nombre)}</td>
        <td data-etiqueta="Celular">${escapeHtml(c.descripcion)}</td>
        <td data-etiqueta="Estado del equipo">${escapeHtml(c.condicion ?? "-")}</td>
        <td data-etiqueta="Valor tomado">${c.valor_tomado != null ? formatoMoneda(c.valor_tomado, c.moneda_valor) : "-"}</td>
        <td data-etiqueta="Entregado">${escapeHtml(c.producto_entregado ?? "-")}</td>
        <td data-etiqueta="Saldo">${textoSaldo(c)}</td>
        <td data-etiqueta="Situación">${pillEstadoCanje(c.estado)}</td>
        <td data-etiqueta="Fecha">${c.fecha}</td>
        <td><button class="btn-icono" title="Editar" onclick="editarCanje(${c.id})">${ICONO_LAPIZ}</button></td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="9">${estadoVacio("Todavía no registraste ningún canje.")}</td></tr>`;
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

function abrirDialogoCanje() {
  const form = document.getElementById("form-canje");
  form.reset();
  form.elements.id.value = "";
  document.getElementById("titulo-dialogo-canje").textContent = "Nuevo canje";
  document.getElementById("boton-guardar-canje").textContent = "Generar canje";
  document.getElementById("dialogo-canje").showModal();
}

function editarCanje(id) {
  const c = canjesCache.find((x) => x.id === id);
  if (!c) return;
  const form = document.getElementById("form-canje");
  form.reset();
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
  document.getElementById("dialogo-canje").showModal();
}

document.getElementById("form-canje").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target));
  const id = datos.id;
  delete datos.id;
  const body = limpiarVacios({
    ...datos,
    valor_tomado: datos.valor_tomado ? Number(datos.valor_tomado) : undefined,
    saldo_monto: datos.saldo_monto !== "" && datos.saldo_monto != null ? Number(datos.saldo_monto) : undefined,
  });
  try {
    if (id) {
      await api("PUT", `/api/canjes/${id}`, body);
      mostrarToast("Canje actualizado.");
    } else {
      await api("POST", "/api/canjes", body);
      mostrarToast("Canje generado.");
    }
    ev.target.reset();
    document.getElementById("dialogo-canje").close();
    cargarPrendas();
    cargarListaPersonas();
  } catch (e) {
    mostrarToast(e.message, true);
  }
});

// ---------- empleados ----------
async function cargarEmpleados() {
  try {
    const empleados = await api("GET", "/api/empleados");
    const tbody = document.querySelector("#tabla-empleados tbody");
    tbody.innerHTML = empleados
      .map(
        (e) => `<tr><td data-etiqueta="Nombre">${escapeHtml(e.nombre)}</td><td data-etiqueta="Telefono">${escapeHtml(e.telefono ?? "-")}</td><td data-etiqueta="Descuento">${e.descuento_pct}%</td></tr>`
      )
      .join("");
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

document.getElementById("form-empleado").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target));
  try {
    await api("POST", "/api/empleados", limpiarVacios(datos));
    ev.target.reset();
    document.getElementById("dialogo-empleado").close();
    mostrarToast("Usuario generado.");
    cargarEmpleados();
    cargarListaPersonas();
  } catch (e) {
    mostrarToast(e.message, true);
  }
});

// ---------- bot: estado de conexion ----------
async function cargarEstadoSistema() {
  const cont = document.getElementById("estado-cards");
  cont.innerHTML = `<div class="card"><div class="label">Cargando</div><div class="valor">…</div></div>`;
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
      <div class="card"><div class="label">Hora del servidor</div><div class="valor valor-chico">${new Date(r.hora_servidor).toLocaleString("es-AR")}</div></div>
    `;
    if (ultimoError) {
      cont.innerHTML += `<div class="card card-ancho"><div class="label">Último error del webhook</div><div class="valor valor-chico negativo">${ultimoError}</div></div>`;
    }
  } catch (e) {
    cont.innerHTML = `<div class="card"><div class="label">Error</div><div class="valor valor-chico negativo">${escapeHtml(e.message)}</div></div>`;
  }
}

function tarjetaEstado(titulo, ok, textoExtra) {
  const punto = ok ? `<span class="punto-estado punto-ok"></span>` : `<span class="punto-estado punto-mal"></span>`;
  const texto = textoExtra ?? (ok ? "Andando bien" : "Con problemas");
  return `<div class="card"><div class="label">${titulo}</div><div class="valor valor-chico">${punto}${escapeHtml(texto)}</div></div>`;
}

// ---------- bot: como funciona ----------
async function cargarInfoBot() {
  try {
    const r = await api("GET", "/api/bot-info");
    document.getElementById("info-modelo").textContent = r.modelo;
    document.getElementById("lista-herramientas").innerHTML = r.herramientas
      .map((h) => `<div class="herramienta"><strong>${escapeHtml(h.nombre)}</strong><span>${escapeHtml(h.descripcion)}</span></div>`)
      .join("");
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

// ---------- bot: respuestas predefinidas ----------
let respuestasCache = [];

async function cargarRespuestas() {
  try {
    respuestasCache = await api("GET", "/api/respuestas");
    const tbody = document.querySelector("#tabla-respuestas tbody");
    tbody.innerHTML = respuestasCache.length
      ? respuestasCache
          .map(
            (r) => `
      <tr data-id="${r.id}">
        <td data-etiqueta="Disparador">${escapeHtml(r.disparador)}</td>
        <td data-etiqueta="Respuesta">${escapeHtml(r.respuesta)}</td>
        <td data-etiqueta="Activa">${r.activo ? "Sí" : "No"}</td>
        <td>
          <button class="btn-icono" title="Editar" onclick="editarRespuesta(${r.id})">${ICONO_LAPIZ}</button>
          <button class="btn-icono" title="Eliminar" onclick="eliminarRespuesta(${r.id})">${ICONO_TACHO}</button>
        </td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="4">${estadoVacio("Todavía no cargaste ninguna respuesta predefinida.")}</td></tr>`;
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

function abrirDialogoRespuesta() {
  const form = document.getElementById("form-respuesta");
  form.reset();
  form.elements.id.value = "";
  form.elements.activo.checked = true;
  document.getElementById("titulo-dialogo-respuesta").textContent = "Nueva respuesta";
  document.getElementById("boton-guardar-respuesta").textContent = "Generar respuesta";
  document.getElementById("dialogo-respuesta").showModal();
}

function editarRespuesta(id) {
  const r = respuestasCache.find((x) => x.id === id);
  if (!r) return;
  const form = document.getElementById("form-respuesta");
  form.reset();
  form.elements.id.value = r.id;
  form.elements.disparador.value = r.disparador;
  form.elements.respuesta.value = r.respuesta;
  form.elements.activo.checked = !!r.activo;
  document.getElementById("titulo-dialogo-respuesta").textContent = "Editar respuesta";
  document.getElementById("boton-guardar-respuesta").textContent = "Guardar cambios";
  document.getElementById("dialogo-respuesta").showModal();
}

async function eliminarRespuesta(id) {
  try {
    await api("DELETE", `/api/respuestas/${id}`);
    mostrarToast("Respuesta eliminada.");
    cargarRespuestas();
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

document.getElementById("form-respuesta").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const id = form.elements.id.value;
  const body = {
    disparador: form.elements.disparador.value,
    respuesta: form.elements.respuesta.value,
    activo: form.elements.activo.checked,
  };
  try {
    if (id) {
      await api("PUT", `/api/respuestas/${id}`, body);
      mostrarToast("Respuesta actualizada.");
    } else {
      await api("POST", "/api/respuestas", body);
      mostrarToast("Respuesta generada.");
    }
    form.reset();
    document.getElementById("dialogo-respuesta").close();
    cargarRespuestas();
  } catch (e) {
    mostrarToast(e.message, true);
  }
});

// ---------- logs ----------
const ETIQUETAS_TIPO_LOG = { mensaje: "Mensaje", respuesta_predefinida: "Respuesta fija", error: "Error" };

async function cargarLogs() {
  try {
    const logs = await api("GET", "/api/logs?limite=150");
    const tbody = document.querySelector("#tabla-logs tbody");
    tbody.innerHTML = logs.length
      ? logs
          .map(
            (l) => `
      <tr>
        <td data-etiqueta="Fecha">${l.fecha}</td>
        <td data-etiqueta="Usuario">${escapeHtml(l.usuario_nombre ?? "-")}</td>
        <td data-etiqueta="Tipo"><span class="estado-pill ${l.tipo === "error" ? "estado-vendida" : "estado-pagado"}">${ETIQUETAS_TIPO_LOG[l.tipo] ?? l.tipo}</span></td>
        <td data-etiqueta="Mensaje" class="celda-texto">${escapeHtml(l.entrada ?? "-")}</td>
        <td data-etiqueta="Respuesta" class="celda-texto">${escapeHtml(l.salida ?? "-")}</td>
        <td data-etiqueta="Herramientas">${l.herramientas_usadas.length ? escapeHtml(l.herramientas_usadas.join(", ")) : "-"}</td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="6">${estadoVacio("Todavía no hay actividad registrada.")}</td></tr>`;
  } catch (e) {
    mostrarToast(e.message, true);
  }
}

// ---------- arranque ----------
iniciarLogin();
