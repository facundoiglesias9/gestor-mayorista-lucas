import { get, all, run } from "./db.js";
import { inferirCategoria } from "./categorizador.js";

// Esta es la UNICA capa que toca la base de datos. Tanto el cerebro (Claude, via tools.ts)
// como el panel web (via panel-server.ts) llaman a estas mismas funciones, para que el chat
// y la web nunca se desincronicen en como se registra o corrige algo.
// Todo es async porque la base (Turso) es remota.

// ---------- helpers ----------

export async function findPersona(nombre: string) {
  return get(`SELECT * FROM personas WHERE nombre = ? COLLATE NOCASE`, [nombre]);
}

export async function findOrCreatePersona(
  nombre: string,
  opts: { telefono?: string; es_empleado?: boolean; descuento_pct?: number; nota?: string } = {}
) {
  const persona = await findPersona(nombre);
  if (persona) return persona;
  const info = await run(`INSERT INTO personas (nombre, telefono, es_empleado, descuento_pct, nota) VALUES (?, ?, ?, ?, ?)`, [
    nombre,
    opts.telefono ?? null,
    opts.es_empleado ? 1 : 0,
    opts.descuento_pct ?? 0,
    opts.nota ?? null,
  ]);
  return get(`SELECT * FROM personas WHERE id = ?`, [info.lastInsertRowid]);
}

export async function findProducto(nombre: string) {
  return get(`SELECT * FROM productos WHERE nombre = ? COLLATE NOCASE`, [nombre]);
}

async function requireProducto(nombre: string) {
  const p = await findProducto(nombre);
  if (!p) throw new Error(`No existe un producto llamado "${nombre}". Primero hay que darlo de alta.`);
  return p;
}

// ---------- productos / stock ----------

export async function agregarProducto(args: {
  nombre: string;
  cantidad: number;
  costo?: number;
  precio_venta?: number;
  moneda?: string;
  categoria?: string;
  nota?: string;
}) {
  const existente = await findProducto(args.nombre);
  if (existente) {
    await run(
      `UPDATE productos SET cantidad = cantidad + ?, costo = COALESCE(?, costo), precio_venta = COALESCE(?, precio_venta), moneda = COALESCE(?, moneda), categoria = COALESCE(?, categoria), actualizado_en = datetime('now','localtime') WHERE id = ?`,
      [args.cantidad, args.costo ?? null, args.precio_venta ?? null, args.moneda ?? null, args.categoria ?? null, existente.id]
    );
    await run(`INSERT INTO movimientos_stock (producto_id, tipo, cantidad, precio_unitario, nota) VALUES (?, 'entrada', ?, ?, ?)`, [
      existente.id,
      args.cantidad,
      args.costo ?? null,
      args.nota ?? "reposicion de stock",
    ]);
    const actualizado = await findProducto(args.nombre);
    return { ok: true, mensaje: `Sumado stock a "${args.nombre}". Cantidad total ahora: ${actualizado.cantidad}.`, producto: actualizado };
  }
  // Producto nuevo: si no vino categoria, se la pedimos a la IA (ej: "iPhone 12" -> Celulares).
  const categoria = args.categoria || (await inferirCategoria(args.nombre));
  const info = await run(`INSERT INTO productos (nombre, categoria, cantidad, costo, precio_venta, moneda, nota) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    args.nombre,
    categoria,
    args.cantidad,
    args.costo ?? null,
    args.precio_venta ?? null,
    args.moneda ?? "USD",
    args.nota ?? null,
  ]);
  await run(`INSERT INTO movimientos_stock (producto_id, tipo, cantidad, precio_unitario, nota) VALUES (?, 'entrada', ?, ?, 'alta inicial')`, [
    info.lastInsertRowid,
    args.cantidad,
    args.costo ?? null,
  ]);
  const nuevo = await get(`SELECT * FROM productos WHERE id = ?`, [info.lastInsertRowid]);
  return { ok: true, mensaje: `Producto "${args.nombre}" creado con ${args.cantidad} unidades.`, producto: nuevo };
}

export async function ajustarStock(args: { nombre_producto: string; cantidad_delta: number; motivo?: string }) {
  const p = await requireProducto(args.nombre_producto);
  const nuevaCantidad = p.cantidad + args.cantidad_delta;
  if (nuevaCantidad < 0) {
    throw new Error(`El ajuste dejaria stock negativo (${nuevaCantidad}) para "${args.nombre_producto}". Cantidad actual: ${p.cantidad}.`);
  }
  await run(`UPDATE productos SET cantidad = ?, actualizado_en = datetime('now','localtime') WHERE id = ?`, [nuevaCantidad, p.id]);
  await run(`INSERT INTO movimientos_stock (producto_id, tipo, cantidad, nota) VALUES (?, 'ajuste', ?, ?)`, [
    p.id,
    args.cantidad_delta,
    args.motivo ?? "ajuste manual",
  ]);
  return { ok: true, mensaje: `Stock de "${args.nombre_producto}" ajustado. Cantidad nueva: ${nuevaCantidad}.` };
}

export async function registrarVenta(args: {
  nombre_producto: string;
  cantidad: number;
  nombre_cliente?: string;
  precio_unitario?: number;
  moneda?: string;
  nota?: string;
}) {
  // No bloqueamos la venta por falta de stock: a veces se compra y se vende en el mismo momento
  // (no llega a quedar cargado como stock previo). Si el producto no existe todavia en el
  // sistema, se crea solo con cantidad 0. Si falta cantidad para cubrir la venta, se repone
  // automaticamente esa diferencia (como si se hubiera comprado justo antes) para que el
  // stock nunca quede en negativo.
  let p = await findProducto(args.nombre_producto);
  if (!p) {
    const categoria = await inferirCategoria(args.nombre_producto);
    await run(`INSERT INTO productos (nombre, categoria, cantidad, precio_venta, nota) VALUES (?, ?, 0, ?, 'creado automaticamente al vender')`, [
      args.nombre_producto,
      categoria,
      args.precio_unitario ?? null,
    ]);
    p = await findProducto(args.nombre_producto);
  }
  let persona: any = null;
  let precioUnitario = args.precio_unitario ?? p.precio_venta ?? null;
  if (args.nombre_cliente) {
    persona = await findOrCreatePersona(args.nombre_cliente);
    if (args.precio_unitario == null && persona.descuento_pct > 0 && p.precio_venta != null) {
      precioUnitario = Math.round(p.precio_venta * (1 - persona.descuento_pct / 100) * 100) / 100;
    }
  }
  const faltante = args.cantidad - p.cantidad;
  if (faltante > 0) {
    await run(`UPDATE productos SET cantidad = cantidad + ? WHERE id = ?`, [faltante, p.id]);
    await run(
      `INSERT INTO movimientos_stock (producto_id, tipo, cantidad, precio_unitario, nota) VALUES (?, 'entrada', ?, ?, 'reposicion automatica: compra y venta en el momento')`,
      [p.id, faltante, args.precio_unitario ?? null]
    );
  }
  await run(`UPDATE productos SET cantidad = cantidad - ?, actualizado_en = datetime('now','localtime') WHERE id = ?`, [args.cantidad, p.id]);
  await run(
    `INSERT INTO movimientos_stock (producto_id, tipo, cantidad, persona_id, precio_unitario, moneda, nota) VALUES (?, 'salida', ?, ?, ?, ?, ?)`,
    [p.id, args.cantidad, persona?.id ?? null, precioUnitario, args.moneda ?? "ARS", args.nota ?? null]
  );
  const restante = p.cantidad + faltante - args.cantidad;
  const total = precioUnitario != null ? precioUnitario * args.cantidad : null;
  const avisoReposicion =
    faltante > 0 ? ` (se sumaron ${faltante} de stock automaticamente porque no estaba cargado: se compro y vendio en el momento)` : "";
  return {
    ok: true,
    mensaje: `Venta registrada: ${args.cantidad} x "${args.nombre_producto}"${persona ? ` a ${persona.nombre}` : ""}${
      precioUnitario != null ? ` a ${precioUnitario} ${args.moneda ?? "ARS"} c/u (total ${total})` : ""
    }.${avisoReposicion} Stock restante: ${restante}.`,
  };
}

export async function listarProductos() {
  return all(`SELECT * FROM productos ORDER BY nombre`);
}

export async function obtenerProducto(id: number) {
  return get(`SELECT * FROM productos WHERE id = ?`, [id]);
}

export async function actualizarProductoPorId(
  id: number,
  campos: { nombre?: string; categoria?: string; cantidad?: number; costo?: number; precio_venta?: number; moneda?: string; nota?: string }
) {
  const actual = await obtenerProducto(id);
  if (!actual) throw new Error(`No existe el producto #${id}.`);
  await run(
    `UPDATE productos SET nombre = ?, categoria = ?, cantidad = ?, costo = ?, precio_venta = ?, moneda = ?, nota = ?, actualizado_en = datetime('now','localtime') WHERE id = ?`,
    [
      campos.nombre ?? actual.nombre,
      campos.categoria ?? actual.categoria,
      campos.cantidad ?? actual.cantidad,
      campos.costo ?? actual.costo,
      campos.precio_venta ?? actual.precio_venta,
      campos.moneda ?? actual.moneda,
      campos.nota ?? actual.nota,
      id,
    ]
  );
  if (campos.cantidad != null && campos.cantidad !== actual.cantidad) {
    await run(`INSERT INTO movimientos_stock (producto_id, tipo, cantidad, nota) VALUES (?, 'ajuste', ?, 'edicion manual desde el panel')`, [
      id,
      campos.cantidad - actual.cantidad,
    ]);
  }
  return obtenerProducto(id);
}

// ---------- personas / empleados ----------

export async function agregarEmpleado(args: { nombre: string; telefono?: string; descuento_pct?: number; nota?: string }) {
  const existente = await findPersona(args.nombre);
  if (existente) {
    await run(
      `UPDATE personas SET es_empleado = 1, telefono = COALESCE(?, telefono), descuento_pct = COALESCE(?, descuento_pct), nota = COALESCE(?, nota) WHERE id = ?`,
      [args.telefono ?? null, args.descuento_pct ?? null, args.nota ?? null, existente.id]
    );
    return { ok: true, mensaje: `"${args.nombre}" actualizado como empleado.` };
  }
  await findOrCreatePersona(args.nombre, {
    telefono: args.telefono,
    es_empleado: true,
    descuento_pct: args.descuento_pct ?? 0,
    nota: args.nota,
  });
  return { ok: true, mensaje: `Empleado "${args.nombre}" agregado con ${args.descuento_pct ?? 0}% de descuento (precio amigo).` };
}

export async function listarEmpleados() {
  return all(`SELECT * FROM personas WHERE es_empleado = 1 ORDER BY nombre`);
}

export async function listarPersonas() {
  return all(`SELECT * FROM personas ORDER BY nombre`);
}

export async function obtenerPersona(id: number) {
  return get(`SELECT * FROM personas WHERE id = ?`, [id]);
}

export async function actualizarPersonaPorId(
  id: number,
  campos: { nombre?: string; telefono?: string; es_empleado?: boolean; descuento_pct?: number; nota?: string }
) {
  const actual = await obtenerPersona(id);
  if (!actual) throw new Error(`No existe la persona #${id}.`);
  await run(`UPDATE personas SET nombre = ?, telefono = ?, es_empleado = ?, descuento_pct = ?, nota = ? WHERE id = ?`, [
    campos.nombre ?? actual.nombre,
    campos.telefono ?? actual.telefono,
    campos.es_empleado != null ? (campos.es_empleado ? 1 : 0) : actual.es_empleado,
    campos.descuento_pct ?? actual.descuento_pct,
    campos.nota ?? actual.nota,
    id,
  ]);
  return obtenerPersona(id);
}

// ---------- prestamos ----------

export async function registrarPrestamo(args: { persona: string; monto: number; moneda: "USD" | "ARS"; interes_pct?: number; nota?: string }) {
  const persona = await findOrCreatePersona(args.persona);
  const info = await run(
    `INSERT INTO prestamos (persona_id, monto_original, monto_pendiente, moneda, interes_pct, nota) VALUES (?, ?, ?, ?, ?, ?)`,
    [persona.id, args.monto, args.monto, args.moneda, args.interes_pct ?? 0, args.nota ?? null]
  );
  return { ok: true, mensaje: `Prestamo registrado: ${args.monto} ${args.moneda} a ${args.persona}.`, prestamo_id: info.lastInsertRowid };
}

export async function registrarPagoPrestamo(args: { persona: string; monto: number; nota?: string }) {
  const persona = await findPersona(args.persona);
  if (!persona) throw new Error(`No encontre a "${args.persona}" en el sistema.`);
  const prestamos = await all(`SELECT * FROM prestamos WHERE persona_id = ? AND estado != 'pagado' ORDER BY fecha ASC`, [persona.id]);
  if (prestamos.length === 0) throw new Error(`"${args.persona}" no tiene prestamos activos.`);
  let restante = args.monto;
  const afectados: any[] = [];
  for (const pr of prestamos) {
    if (restante <= 0) break;
    const aplicado = Math.min(restante, pr.monto_pendiente);
    const nuevoPendiente = Math.round((pr.monto_pendiente - aplicado) * 100) / 100;
    const nuevoEstado = nuevoPendiente <= 0 ? "pagado" : "parcial";
    await run(`UPDATE prestamos SET monto_pendiente = ?, estado = ? WHERE id = ?`, [nuevoPendiente, nuevoEstado, pr.id]);
    await run(`INSERT INTO pagos_prestamo (prestamo_id, monto, nota) VALUES (?, ?, ?)`, [pr.id, aplicado, args.nota ?? null]);
    afectados.push({ prestamo_id: pr.id, moneda: pr.moneda, aplicado, nuevoPendiente });
    restante -= aplicado;
  }
  return {
    ok: true,
    mensaje: `Pago de ${args.monto} registrado para "${args.persona}". Detalle: ${afectados
      .map((a) => `prestamo #${a.prestamo_id} (${a.moneda}): -${a.aplicado}, queda ${a.nuevoPendiente}`)
      .join("; ")}${restante > 0 ? `. Sobraron ${restante} sin aplicar (no habia mas deuda activa).` : ""}`,
  };
}

export async function listarPrestamos() {
  return all(
    `SELECT prestamos.*, personas.nombre as persona_nombre FROM prestamos JOIN personas ON personas.id = prestamos.persona_id ORDER BY prestamos.fecha DESC`
  );
}

export async function obtenerPrestamo(id: number) {
  return get(
    `SELECT prestamos.*, personas.nombre as persona_nombre FROM prestamos JOIN personas ON personas.id = prestamos.persona_id WHERE prestamos.id = ?`,
    [id]
  );
}

export async function actualizarPrestamoPorId(
  id: number,
  campos: { monto_pendiente?: number; estado?: "activo" | "parcial" | "pagado"; interes_pct?: number; nota?: string }
) {
  const actual = await obtenerPrestamo(id);
  if (!actual) throw new Error(`No existe el prestamo #${id}.`);
  await run(`UPDATE prestamos SET monto_pendiente = ?, estado = ?, interes_pct = ?, nota = ? WHERE id = ?`, [
    campos.monto_pendiente ?? actual.monto_pendiente,
    campos.estado ?? actual.estado,
    campos.interes_pct ?? actual.interes_pct,
    campos.nota ?? actual.nota,
    id,
  ]);
  return obtenerPrestamo(id);
}

export async function registrarPagoPrestamoPorId(prestamoId: number, monto: number, nota?: string) {
  const pr = await obtenerPrestamo(prestamoId);
  if (!pr) throw new Error(`No existe el prestamo #${prestamoId}.`);
  const aplicado = Math.min(monto, pr.monto_pendiente);
  const nuevoPendiente = Math.round((pr.monto_pendiente - aplicado) * 100) / 100;
  const nuevoEstado = nuevoPendiente <= 0 ? "pagado" : "parcial";
  await run(`UPDATE prestamos SET monto_pendiente = ?, estado = ? WHERE id = ?`, [nuevoPendiente, nuevoEstado, prestamoId]);
  await run(`INSERT INTO pagos_prestamo (prestamo_id, monto, nota) VALUES (?, ?, ?)`, [prestamoId, aplicado, nota ?? null]);
  return obtenerPrestamo(prestamoId);
}

export async function listarPagosDePrestamo(prestamoId: number) {
  return all(`SELECT * FROM pagos_prestamo WHERE prestamo_id = ? ORDER BY fecha DESC`, [prestamoId]);
}

// ---------- plan canje (trade-in de celulares) ----------
// Convencion de signo para saldo_monto: positivo = a favor del negocio (el cliente te tiene
// que dar esa plata); negativo = a favor del cliente (vos le debes esa plata).

export async function agregarCanje(args: {
  persona: string;
  descripcion: string;
  condicion?: string;
  valor_tomado?: number;
  moneda_valor?: string;
  producto_entregado?: string;
  saldo_monto?: number;
  saldo_moneda?: string;
  nota?: string;
}) {
  const persona = await findOrCreatePersona(args.persona);
  const info = await run(
    `INSERT INTO canjes (persona_id, descripcion, condicion, valor_tomado, moneda_valor, producto_entregado, saldo_monto, saldo_moneda, nota)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      persona.id,
      args.descripcion,
      args.condicion ?? null,
      args.valor_tomado ?? null,
      args.moneda_valor ?? "ARS",
      args.producto_entregado ?? null,
      args.saldo_monto ?? null,
      args.saldo_moneda ?? "ARS",
      args.nota ?? null,
    ]
  );
  const saldoTexto =
    args.saldo_monto != null
      ? args.saldo_monto > 0
        ? ` ${args.persona} te tiene que dar ${args.saldo_monto} ${args.saldo_moneda ?? "ARS"}.`
        : ` Vos le debes ${Math.abs(args.saldo_monto)} ${args.saldo_moneda ?? "ARS"} a ${args.persona}.`
      : "";
  return {
    ok: true,
    mensaje: `Canje registrado: "${args.descripcion}" de ${args.persona}.${saldoTexto}`,
    canje_id: info.lastInsertRowid,
  };
}

export async function actualizarCanje(args: { descripcion: string; persona?: string; estado: "pendiente" | "saldado"; nota?: string }) {
  let query = `SELECT canjes.*, personas.nombre as persona_nombre FROM canjes JOIN personas ON personas.id = canjes.persona_id WHERE canjes.descripcion LIKE ? COLLATE NOCASE`;
  const params: any[] = [`%${args.descripcion}%`];
  if (args.persona) {
    query += ` AND personas.nombre = ? COLLATE NOCASE`;
    params.push(args.persona);
  }
  query += ` ORDER BY canjes.fecha DESC`;
  const candidatos = await all(query, params);
  if (candidatos.length === 0) throw new Error(`No encontre ningun canje que coincida con "${args.descripcion}".`);
  if (candidatos.length > 1) {
    return {
      ok: false,
      mensaje: `Hay ${candidatos.length} canjes que coinciden con "${args.descripcion}". Se mas especifico (agrega el nombre de la persona o el id).`,
      candidatos: candidatos.map((c) => ({ id: c.id, descripcion: c.descripcion, persona: c.persona_nombre, estado: c.estado })),
    };
  }
  const canje = candidatos[0];
  await run(`UPDATE canjes SET estado = ?, nota = COALESCE(?, nota) WHERE id = ?`, [args.estado, args.nota ?? null, canje.id]);
  return { ok: true, mensaje: `Canje "${canje.descripcion}" de ${canje.persona_nombre} actualizado a estado "${args.estado}".` };
}

export async function listarCanjes() {
  return all(
    `SELECT canjes.*, personas.nombre as persona_nombre FROM canjes JOIN personas ON personas.id = canjes.persona_id ORDER BY canjes.fecha DESC`
  );
}

export async function obtenerCanje(id: number) {
  return get(
    `SELECT canjes.*, personas.nombre as persona_nombre FROM canjes JOIN personas ON personas.id = canjes.persona_id WHERE canjes.id = ?`,
    [id]
  );
}

export async function actualizarCanjePorId(
  id: number,
  campos: {
    descripcion?: string;
    condicion?: string;
    valor_tomado?: number;
    moneda_valor?: string;
    producto_entregado?: string;
    saldo_monto?: number;
    saldo_moneda?: string;
    estado?: string;
    nota?: string;
  }
) {
  const actual = await obtenerCanje(id);
  if (!actual) throw new Error(`No existe el canje #${id}.`);
  await run(
    `UPDATE canjes SET descripcion = ?, condicion = ?, valor_tomado = ?, moneda_valor = ?, producto_entregado = ?, saldo_monto = ?, saldo_moneda = ?, estado = ?, nota = ? WHERE id = ?`,
    [
      campos.descripcion ?? actual.descripcion,
      campos.condicion ?? actual.condicion,
      campos.valor_tomado ?? actual.valor_tomado,
      campos.moneda_valor ?? actual.moneda_valor,
      campos.producto_entregado ?? actual.producto_entregado,
      campos.saldo_monto ?? actual.saldo_monto,
      campos.saldo_moneda ?? actual.saldo_moneda,
      campos.estado ?? actual.estado,
      campos.nota ?? actual.nota,
      id,
    ]
  );
  return obtenerCanje(id);
}

// ---------- consultas ----------

export async function consultarStock(args: { nombre_producto?: string }) {
  if (args.nombre_producto) {
    const p = await findProducto(args.nombre_producto);
    if (!p) return { encontrado: false, mensaje: `No hay ningun producto llamado "${args.nombre_producto}".` };
    return { encontrado: true, producto: p };
  }
  return { productos: await listarProductos() };
}

export async function consultarPersona(args: { nombre: string }) {
  const persona = await findPersona(args.nombre);
  if (!persona) return { encontrada: false, mensaje: `No encontre a "${args.nombre}" en el sistema.` };
  const prestamos = await all(`SELECT * FROM prestamos WHERE persona_id = ? ORDER BY fecha DESC`, [persona.id]);
  const canjes = await all(`SELECT * FROM canjes WHERE persona_id = ? ORDER BY fecha DESC`, [persona.id]);
  const compras = await all(
    `SELECT movimientos_stock.*, productos.nombre as producto_nombre FROM movimientos_stock JOIN productos ON productos.id = movimientos_stock.producto_id WHERE persona_id = ? AND tipo = 'salida' ORDER BY fecha DESC LIMIT 20`,
    [persona.id]
  );
  return { encontrada: true, persona, prestamos, canjes, compras_recientes: compras };
}

export async function consultarEstadoGeneral() {
  const productos = await all(`SELECT nombre, cantidad, precio_venta FROM productos ORDER BY nombre`);
  const prestamos_activos = await all(
    `SELECT prestamos.*, personas.nombre as persona_nombre FROM prestamos JOIN personas ON personas.id = prestamos.persona_id WHERE prestamos.estado != 'pagado' ORDER BY prestamos.fecha`
  );
  const canjes_pendientes = await all(
    `SELECT canjes.*, personas.nombre as persona_nombre FROM canjes JOIN personas ON personas.id = canjes.persona_id WHERE canjes.estado = 'pendiente' ORDER BY canjes.fecha`
  );
  const empleados = await all(`SELECT nombre, descuento_pct, telefono FROM personas WHERE es_empleado = 1 ORDER BY nombre`);
  return { productos, prestamos_activos, canjes_pendientes, empleados };
}

export async function consultarVentas(args: { desde?: string; hasta?: string; nombre_producto?: string; nombre_cliente?: string }) {
  const condiciones = [`movimientos_stock.tipo = 'salida'`];
  const params: any[] = [];
  if (args.desde) {
    condiciones.push(`date(movimientos_stock.fecha) >= date(?)`);
    params.push(args.desde);
  }
  if (args.hasta) {
    condiciones.push(`date(movimientos_stock.fecha) <= date(?)`);
    params.push(args.hasta);
  }
  if (args.nombre_producto) {
    condiciones.push(`productos.nombre = ? COLLATE NOCASE`);
    params.push(args.nombre_producto);
  }
  if (args.nombre_cliente) {
    condiciones.push(`personas.nombre = ? COLLATE NOCASE`);
    params.push(args.nombre_cliente);
  }
  const filas = await all(
    `SELECT movimientos_stock.*, productos.nombre as producto_nombre, productos.costo as producto_costo, personas.nombre as persona_nombre
     FROM movimientos_stock
     JOIN productos ON productos.id = movimientos_stock.producto_id
     LEFT JOIN personas ON personas.id = movimientos_stock.persona_id
     WHERE ${condiciones.join(" AND ")}
     ORDER BY movimientos_stock.fecha DESC`,
    params
  );

  const resumenPorMoneda: Record<string, { unidades: number; operaciones: number; facturado: number; ganancia_estimada: number }> = {};
  for (const f of filas) {
    const moneda = f.moneda ?? "ARS";
    if (!resumenPorMoneda[moneda]) resumenPorMoneda[moneda] = { unidades: 0, operaciones: 0, facturado: 0, ganancia_estimada: 0 };
    const r = resumenPorMoneda[moneda];
    r.unidades += f.cantidad;
    r.operaciones += 1;
    if (f.precio_unitario != null) {
      r.facturado += f.precio_unitario * f.cantidad;
      if (f.producto_costo != null) {
        r.ganancia_estimada += (f.precio_unitario - f.producto_costo) * f.cantidad;
      }
    }
  }

  return {
    total_ventas_encontradas: filas.length,
    resumen_por_moneda: resumenPorMoneda,
    nota: "ganancia_estimada asume que el costo cargado del producto esta en la misma moneda que el precio de venta de esa operacion; tratarlo como aproximado.",
    detalle_ultimas_ventas: filas.slice(0, 30).map((f) => ({
      fecha: f.fecha,
      producto: f.producto_nombre,
      cantidad: f.cantidad,
      cliente: f.persona_nombre ?? null,
      precio_unitario: f.precio_unitario,
      moneda: f.moneda,
      nota: f.nota,
    })),
  };
}

// (ventas detalladas y sin limite de 30, usado por el panel web)
export async function listarMovimientosVenta(args: { desde?: string; hasta?: string; nombre_producto?: string; nombre_cliente?: string }) {
  const condiciones = [`movimientos_stock.tipo = 'salida'`];
  const params: any[] = [];
  if (args.desde) {
    condiciones.push(`date(movimientos_stock.fecha) >= date(?)`);
    params.push(args.desde);
  }
  if (args.hasta) {
    condiciones.push(`date(movimientos_stock.fecha) <= date(?)`);
    params.push(args.hasta);
  }
  if (args.nombre_producto) {
    condiciones.push(`productos.nombre = ? COLLATE NOCASE`);
    params.push(args.nombre_producto);
  }
  if (args.nombre_cliente) {
    condiciones.push(`personas.nombre = ? COLLATE NOCASE`);
    params.push(args.nombre_cliente);
  }
  return all(
    `SELECT movimientos_stock.*, productos.nombre as producto_nombre, personas.nombre as persona_nombre
     FROM movimientos_stock
     JOIN productos ON productos.id = movimientos_stock.producto_id
     LEFT JOIN personas ON personas.id = movimientos_stock.persona_id
     WHERE ${condiciones.join(" AND ")}
     ORDER BY movimientos_stock.fecha DESC`,
    params
  );
}

// ---------- conversacion (historial del cerebro) e idempotencia de mensajes de Telegram ----------
// Se guarda en la base (no en memoria) porque en Vercel cada mensaje puede caer en una
// instancia de funcion distinta.

export async function cargarHistorialConversacion(usuarioId: string): Promise<any[]> {
  const fila = await get(`SELECT historial FROM conversaciones WHERE usuario_id = ?`, [usuarioId]);
  if (!fila) return [];
  try {
    return JSON.parse(fila.historial);
  } catch {
    return [];
  }
}

export async function guardarHistorialConversacion(usuarioId: string, historial: any[]): Promise<void> {
  await run(
    `INSERT INTO conversaciones (usuario_id, historial, actualizado_en) VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(usuario_id) DO UPDATE SET historial = excluded.historial, actualizado_en = excluded.actualizado_en`,
    [usuarioId, JSON.stringify(historial)]
  );
}

// Devuelve true si YA se habia procesado este update_id de Telegram (para no duplicar
// acciones si Telegram reintenta un mensaje). Si es la primera vez, lo marca y devuelve false.
export async function yaProcesadoUpdate(updateId: number): Promise<boolean> {
  try {
    await run(`INSERT INTO updates_procesados (update_id) VALUES (?)`, [updateId]);
    return false;
  } catch {
    // Choco con la PRIMARY KEY: ya existia.
    return true;
  }
}

// ---------- respuestas predefinidas (FAQ sin gastar IA) ----------

export async function listarRespuestasPredefinidas() {
  return all(`SELECT * FROM respuestas_predefinidas ORDER BY id DESC`);
}

export async function agregarRespuestaPredefinida(args: { disparador: string; respuesta: string; activo?: boolean }) {
  const info = await run(`INSERT INTO respuestas_predefinidas (disparador, respuesta, activo) VALUES (?, ?, ?)`, [
    args.disparador,
    args.respuesta,
    args.activo === false ? 0 : 1,
  ]);
  return { ok: true, id: info.lastInsertRowid };
}

export async function actualizarRespuestaPredefinidaPorId(
  id: number,
  campos: { disparador?: string; respuesta?: string; activo?: boolean }
) {
  const actual = await get(`SELECT * FROM respuestas_predefinidas WHERE id = ?`, [id]);
  if (!actual) throw new Error(`No existe la respuesta predefinida #${id}.`);
  await run(`UPDATE respuestas_predefinidas SET disparador = ?, respuesta = ?, activo = ? WHERE id = ?`, [
    campos.disparador ?? actual.disparador,
    campos.respuesta ?? actual.respuesta,
    campos.activo != null ? (campos.activo ? 1 : 0) : actual.activo,
    id,
  ]);
  return get(`SELECT * FROM respuestas_predefinidas WHERE id = ?`, [id]);
}

export async function eliminarRespuestaPredefinidaPorId(id: number) {
  await run(`DELETE FROM respuestas_predefinidas WHERE id = ?`, [id]);
  return { ok: true };
}

// Busca la primera respuesta activa cuyo disparador aparezca dentro del texto (sin
// mayusculas/minusculas). null si ninguna coincide.
export async function buscarRespuestaPredefinida(texto: string): Promise<string | null> {
  const activas = await all(`SELECT * FROM respuestas_predefinidas WHERE activo = 1`);
  const textoLower = texto.toLowerCase();
  const match = activas.find((r) => textoLower.includes(String(r.disparador).toLowerCase()));
  return match ? match.respuesta : null;
}

// ---------- logs del bot ----------

export async function registrarLog(entrada: {
  usuario_id?: string;
  usuario_nombre?: string;
  tipo: "mensaje" | "respuesta_predefinida" | "error";
  entrada?: string;
  salida?: string;
  herramientas_usadas?: string[];
}) {
  await run(
    `INSERT INTO logs_bot (usuario_id, usuario_nombre, tipo, entrada, salida, herramientas_usadas) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entrada.usuario_id ?? null,
      entrada.usuario_nombre ?? null,
      entrada.tipo,
      entrada.entrada ?? null,
      entrada.salida ?? null,
      entrada.herramientas_usadas?.length ? JSON.stringify(entrada.herramientas_usadas) : null,
    ]
  );
}

export async function listarLogs(limite = 100) {
  const filas = await all(`SELECT * FROM logs_bot ORDER BY id DESC LIMIT ?`, [limite]);
  return filas.map((f) => ({ ...f, herramientas_usadas: f.herramientas_usadas ? JSON.parse(f.herramientas_usadas) : [] }));
}

// ---------- estado / diagnostico ----------

export async function chequearConexionDb(): Promise<boolean> {
  try {
    await get(`SELECT 1 as ok`);
    return true;
  } catch {
    return false;
  }
}
