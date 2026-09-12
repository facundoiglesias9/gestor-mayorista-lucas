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
        <td data-etiqueta="Costo">${p.costo != null ? formatoMoneda(p.costo) : "-"}</td>
        <td data-etiqueta="Precio venta">${p.precio_venta != null ? formatoMoneda(p.precio_venta) : "-"}</td>
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
async function cargarVentas() {
  const form = document.getElementById("form-filtro-ventas");
  const datos = Object.fromEntries(new FormData(form));
  const params = new URLSearchParams(limpiarVacios(datos)).toString();
  try {
    const r = await api("GET", `/api/ventas${params ? "?" + params : ""}`);
    const cards = document.getElementById("ventas-resumen");
    const monedas = Object.keys(r.resumen);
    cards.innerHTML = monedas.length
      ? monedas
          .map(
            (m) => `
      <div class="card"><div class="label">Facturado (${m})</div><div class="valor">${formatoMoneda(r.resumen[m].facturado)}</div></div>
      <div class="card"><div class="label">Unidades (${m})</div><div class="valor">${r.resumen[m].unidades}</div></div>
      <div class="card"><div class="label">Ganancia est. (${m})</div><div class="valor">${formatoMoneda(r.resumen[m].ganancia_estimada)}</div></div>
    `
          )
          .join("")
      : `<div class="card"><div class="label">Ventas</div><div class="valor">0</div></div>`;

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

document.getElementById("form-filtro-ventas").addEventListener("submit", (ev) => {
  ev.preventDefault();
  cargarVentas();
});

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

// ---------- arranque ----------
iniciarLogin();
