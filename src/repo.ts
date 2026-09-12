import { db } from "./db.js";
import { inferirCategoria } from "./categorizador.js";

// Esta es la UNICA capa que toca la base de datos. Tanto el cerebro (Claude, via tools.ts)
// como el panel web (via panel-server.ts) llaman a estas mismas funciones, para que el chat
// y la web nunca se desincronicen en como se registra o corrige algo.

// ---------- helpers ----------

export function findPersona(nombre: string) {
  return db.prepare(`SELECT * FROM personas WHERE nombre = ? COLLATE NOCASE`).get(nombre) as any;
}

export function findOrCreatePersona(
  nombre: string,
  opts: { telefono?: string; es_empleado?: boolean; descuento_pct?: number; nota?: string } = {}
) {
  let persona = findPersona(nombre);
  if (persona) return persona;
  const info = db
    .prepare(`INSERT INTO personas (nombre, telefono, es_empleado, descuento_pct, nota) VALUES (?, ?, ?, ?, ?)`)
    .run(nombre, opts.telefono ?? null, opts.es_empleado ? 1 : 0, opts.descuento_pct ?? 0, opts.nota ?? null);
  return db.prepare(`SELECT * FROM personas WHERE id = ?`).get(info.lastInsertRowid);
}

export function findProducto(nombre: string) {
  return db.prepare(`SELECT * FROM productos WHERE nombre = ? COLLATE NOCASE`).get(nombre) as any;
}

function requireProducto(nombre: string) {
  const p = findProducto(nombre);
  if (!p) throw new Error(`No existe un producto llamado "${nombre}". Primero hay que darlo de alta.`);
  return p;
}

// ---------- productos / stock ----------

export async function agregarProducto(args: {
  nombre: string;
  cantidad: number;
  costo?: number;
  precio_venta?: number;
  categoria?: string;
  nota?: string;
}) {
  const existente = findProducto(args.nombre);
  if (existente) {
    db.prepare(
      `UPDATE productos SET cantidad = cantidad + ?, costo = COALESCE(?, costo), precio_venta = COALESCE(?, precio_venta), categoria = COALESCE(?, categoria), actualizado_en = datetime('now','localtime') WHERE id = ?`
    ).run(args.cantidad, args.costo ?? null, args.precio_venta ?? null, args.categoria ?? null, existente.id);
    db.prepare(
      `INSERT INTO movimientos_stock (producto_id, tipo, cantidad, precio_unitario, nota) VALUES (?, 'entrada', ?, ?, ?)`
    ).run(existente.id, args.cantidad, args.costo ?? null, args.nota ?? "reposicion de stock");
    const actualizado = findProducto(args.nombre);
    return { ok: true, mensaje: `Sumado stock a "${args.nombre}". Cantidad total ahora: ${actualizado.cantidad}.`, producto: actualizado };
  }
  // Producto nuevo: si no vino categoria, se la pedimos a la IA (ej: "iPhone 12" -> Celulares).
  const categoria = args.categoria || (await inferirCategoria(args.nombre));
  const info = db
    .prepare(`INSERT INTO productos (nombre, categoria, cantidad, costo, precio_venta, nota) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(args.nombre, categoria, args.cantidad, args.costo ?? null, args.precio_venta ?? null, args.nota ?? null);
  db.prepare(
    `INSERT INTO movimientos_stock (producto_id, tipo, cantidad, precio_unitario, nota) VALUES (?, 'entrada', ?, ?, 'alta inicial')`
  ).run(info.lastInsertRowid, args.cantidad, args.costo ?? null);
  const nuevo = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(info.lastInsertRowid);
  return { ok: true, mensaje: `Producto "${args.nombre}" creado con ${args.cantidad} unidades.`, producto: nuevo };
}

export function ajustarStock(args: { nombre_producto: string; cantidad_delta: number; motivo?: string }) {
  const p = requireProducto(args.nombre_producto);
  const nuevaCantidad = p.cantidad + args.cantidad_delta;
  if (nuevaCantidad < 0) {
    throw new Error(`El ajuste dejaria stock negativo (${nuevaCantidad}) para "${args.nombre_producto}". Cantidad actual: ${p.cantidad}.`);
  }
  db.prepare(`UPDATE productos SET cantidad = ?, actualizado_en = datetime('now','localtime') WHERE id = ?`).run(nuevaCantidad, p.id);
  db.prepare(`INSERT INTO movimientos_stock (producto_id, tipo, cantidad, nota) VALUES (?, 'ajuste', ?, ?)`).run(
    p.id,
    args.cantidad_delta,
    args.motivo ?? "ajuste manual"
  );
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
  let p = findProducto(args.nombre_producto);
  if (!p) {
    const categoria = await inferirCategoria(args.nombre_producto);
    db.prepare(
      `INSERT INTO productos (nombre, categoria, cantidad, precio_venta, nota) VALUES (?, ?, 0, ?, 'creado automaticamente al vender')`
    ).run(args.nombre_producto, categoria, args.precio_unitario ?? null);
    p = findProducto(args.nombre_producto);
  }
  let persona: any = null;
  let precioUnitario = args.precio_unitario ?? p.precio_venta ?? null;
  if (args.nombre_cliente) {
    persona = findOrCreatePersona(args.nombre_cliente);
    if (args.precio_unitario == null && persona.descuento_pct > 0 && p.precio_venta != null) {
      precioUnitario = Math.round(p.precio_venta * (1 - persona.descuento_pct / 100) * 100) / 100;
    }
  }
  const faltante = args.cantidad - p.cantidad;
  if (faltante > 0) {
    db.prepare(`UPDATE productos SET cantidad = cantidad + ? WHERE id = ?`).run(faltante, p.id);
    db.prepare(
      `INSERT INTO movimientos_stock (producto_id, tipo, cantidad, precio_unitario, nota) VALUES (?, 'entrada', ?, ?, 'reposicion automatica: compra y venta en el momento')`
    ).run(p.id, faltante, args.precio_unitario ?? null);
  }
  db.prepare(`UPDATE productos SET cantidad = cantidad - ?, actualizado_en = datetime('now','localtime') WHERE id = ?`).run(
    args.cantidad,
    p.id
  );
  db.prepare(
    `INSERT INTO movimientos_stock (producto_id, tipo, cantidad, persona_id, precio_unitario, moneda, nota) VALUES (?, 'salida', ?, ?, ?, ?, ?)`
  ).run(p.id, args.cantidad, persona?.id ?? null, precioUnitario, args.moneda ?? "ARS", args.nota ?? null);
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

export function listarProductos() {
  return db.prepare(`SELECT * FROM productos ORDER BY nombre`).all() as any[];
}

export function obtenerProducto(id: number) {
  return db.prepare(`SELECT * FROM productos WHERE id = ?`).get(id) as any;
}

export function actualizarProductoPorId(
  id: number,
  campos: { nombre?: string; categoria?: string; cantidad?: number; costo?: number; precio_venta?: number; nota?: string }
) {
  const actual = obtenerProducto(id);
  if (!actual) throw new Error(`No existe el producto #${id}.`);
  db.prepare(
    `UPDATE productos SET nombre = ?, categoria = ?, cantidad = ?, costo = ?, precio_venta = ?, nota = ?, actualizado_en = datetime('now','localtime') WHERE id = ?`
  ).run(
    campos.nombre ?? actual.nombre,
    campos.categoria ?? actual.categoria,
    campos.cantidad ?? actual.cantidad,
    campos.costo ?? actual.costo,
    campos.precio_venta ?? actual.precio_venta,
    campos.nota ?? actual.nota,
    id
  );
  if (campos.cantidad != null && campos.cantidad !== actual.cantidad) {
    db.prepare(`INSERT INTO movimientos_stock (producto_id, tipo, cantidad, nota) VALUES (?, 'ajuste', ?, 'edicion manual desde el panel')`).run(
      id,
      campos.cantidad - actual.cantidad
    );
  }
  return obtenerProducto(id);
}

// ---------- personas / empleados ----------

export function agregarEmpleado(args: { nombre: string; telefono?: string; descuento_pct?: number; nota?: string }) {
  const existente = findPersona(args.nombre);
  if (existente) {
    db.prepare(
      `UPDATE personas SET es_empleado = 1, telefono = COALESCE(?, telefono), descuento_pct = COALESCE(?, descuento_pct), nota = COALESCE(?, nota) WHERE id = ?`
    ).run(args.telefono ?? null, args.descuento_pct ?? null, args.nota ?? null, existente.id);
    return { ok: true, mensaje: `"${args.nombre}" actualizado como empleado.` };
  }
  findOrCreatePersona(args.nombre, {
    telefono: args.telefono,
    es_empleado: true,
    descuento_pct: args.descuento_pct ?? 0,
    nota: args.nota,
  });
  return { ok: true, mensaje: `Empleado "${args.nombre}" agregado con ${args.descuento_pct ?? 0}% de descuento (precio amigo).` };
}

export function listarEmpleados() {
  return db.prepare(`SELECT * FROM personas WHERE es_empleado = 1 ORDER BY nombre`).all() as any[];
}

export function listarPersonas() {
  return db.prepare(`SELECT * FROM personas ORDER BY nombre`).all() as any[];
}

export function obtenerPersona(id: number) {
  return db.prepare(`SELECT * FROM personas WHERE id = ?`).get(id) as any;
}

export function actualizarPersonaPorId(
  id: number,
  campos: { nombre?: string; telefono?: string; es_empleado?: boolean; descuento_pct?: number; nota?: string }
) {
  const actual = obtenerPersona(id);
  if (!actual) throw new Error(`No existe la persona #${id}.`);
  db.prepare(`UPDATE personas SET nombre = ?, telefono = ?, es_empleado = ?, descuento_pct = ?, nota = ? WHERE id = ?`).run(
    campos.nombre ?? actual.nombre,
    campos.telefono ?? actual.telefono,
    campos.es_empleado != null ? (campos.es_empleado ? 1 : 0) : actual.es_empleado,
    campos.descuento_pct ?? actual.descuento_pct,
    campos.nota ?? actual.nota,
    id
  );
  return obtenerPersona(id);
}

// ---------- prestamos ----------

export function registrarPrestamo(args: { persona: string; monto: number; moneda: "USD" | "ARS"; interes_pct?: number; nota?: string }) {
  const persona = findOrCreatePersona(args.persona);
  const info = db
    .prepare(`INSERT INTO prestamos (persona_id, monto_original, monto_pendiente, moneda, interes_pct, nota) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(persona.id, args.monto, args.monto, args.moneda, args.interes_pct ?? 0, args.nota ?? null);
  return { ok: true, mensaje: `Prestamo registrado: ${args.monto} ${args.moneda} a ${args.persona}.`, prestamo_id: info.lastInsertRowid };
}

export function registrarPagoPrestamo(args: { persona: string; monto: number; nota?: string }) {
  const persona = findPersona(args.persona);
  if (!persona) throw new Error(`No encontre a "${args.persona}" en el sistema.`);
  const prestamos = db
    .prepare(`SELECT * FROM prestamos WHERE persona_id = ? AND estado != 'pagado' ORDER BY fecha ASC`)
    .all(persona.id) as any[];
  if (prestamos.length === 0) throw new Error(`"${args.persona}" no tiene prestamos activos.`);
  let restante = args.monto;
  const afectados: any[] = [];
  for (const pr of prestamos) {
    if (restante <= 0) break;
    const aplicado = Math.min(restante, pr.monto_pendiente);
    const nuevoPendiente = Math.round((pr.monto_pendiente - aplicado) * 100) / 100;
    const nuevoEstado = nuevoPendiente <= 0 ? "pagado" : "parcial";
    db.prepare(`UPDATE prestamos SET monto_pendiente = ?, estado = ? WHERE id = ?`).run(nuevoPendiente, nuevoEstado, pr.id);
    db.prepare(`INSERT INTO pagos_prestamo (prestamo_id, monto, nota) VALUES (?, ?, ?)`).run(pr.id, aplicado, args.nota ?? null);
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

export function listarPrestamos() {
  return db
    .prepare(
      `SELECT prestamos.*, personas.nombre as persona_nombre FROM prestamos JOIN personas ON personas.id = prestamos.persona_id ORDER BY prestamos.fecha DESC`
    )
    .all() as any[];
}

export function obtenerPrestamo(id: number) {
  return db
    .prepare(
      `SELECT prestamos.*, personas.nombre as persona_nombre FROM prestamos JOIN personas ON personas.id = prestamos.persona_id WHERE prestamos.id = ?`
    )
    .get(id) as any;
}

export function actualizarPrestamoPorId(
  id: number,
  campos: { monto_pendiente?: number; estado?: "activo" | "parcial" | "pagado"; interes_pct?: number; nota?: string }
) {
  const actual = obtenerPrestamo(id);
  if (!actual) throw new Error(`No existe el prestamo #${id}.`);
  db.prepare(`UPDATE prestamos SET monto_pendiente = ?, estado = ?, interes_pct = ?, nota = ? WHERE id = ?`).run(
    campos.monto_pendiente ?? actual.monto_pendiente,
    campos.estado ?? actual.estado,
    campos.interes_pct ?? actual.interes_pct,
    campos.nota ?? actual.nota,
    id
  );
  return obtenerPrestamo(id);
}

export function registrarPagoPrestamoPorId(prestamoId: number, monto: number, nota?: string) {
  const pr = obtenerPrestamo(prestamoId);
  if (!pr) throw new Error(`No existe el prestamo #${prestamoId}.`);
  const aplicado = Math.min(monto, pr.monto_pendiente);
  const nuevoPendiente = Math.round((pr.monto_pendiente - aplicado) * 100) / 100;
  const nuevoEstado = nuevoPendiente <= 0 ? "pagado" : "parcial";
  db.prepare(`UPDATE prestamos SET monto_pendiente = ?, estado = ? WHERE id = ?`).run(nuevoPendiente, nuevoEstado, prestamoId);
  db.prepare(`INSERT INTO pagos_prestamo (prestamo_id, monto, nota) VALUES (?, ?, ?)`).run(prestamoId, aplicado, nota ?? null);
  return obtenerPrestamo(prestamoId);
}

export function listarPagosDePrestamo(prestamoId: number) {
  return db.prepare(`SELECT * FROM pagos_prestamo WHERE prestamo_id = ? ORDER BY fecha DESC`).all(prestamoId) as any[];
}

// ---------- plan canje (trade-in de celulares) ----------
// Convencion de signo para saldo_monto: positivo = a favor del negocio (el cliente te tiene
// que dar esa plata); negativo = a favor del cliente (vos le debes esa plata).

export function agregarCanje(args: {
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
  const persona = findOrCreatePersona(args.persona);
  const info = db
    .prepare(
      `INSERT INTO canjes (persona_id, descripcion, condicion, valor_tomado, moneda_valor, producto_entregado, saldo_monto, saldo_moneda, nota)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      persona.id,
      args.descripcion,
      args.condicion ?? null,
      args.valor_tomado ?? null,
      args.moneda_valor ?? "ARS",
      args.producto_entregado ?? null,
      args.saldo_monto ?? null,
      args.saldo_moneda ?? "ARS",
      args.nota ?? null
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

export function actualizarCanje(args: { descripcion: string; persona?: string; estado: "pendiente" | "saldado"; nota?: string }) {
  let query = `SELECT canjes.*, personas.nombre as persona_nombre FROM canjes JOIN personas ON personas.id = canjes.persona_id WHERE canjes.descripcion LIKE ? COLLATE NOCASE`;
  const params: any[] = [`%${args.descripcion}%`];
  if (args.persona) {
    query += ` AND personas.nombre = ? COLLATE NOCASE`;
    params.push(args.persona);
  }
  query += ` ORDER BY canjes.fecha DESC`;
  const candidatos = db.prepare(query).all(...params) as any[];
  if (candidatos.length === 0) throw new Error(`No encontre ningun canje que coincida con "${args.descripcion}".`);
  if (candidatos.length > 1) {
    return {
      ok: false,
      mensaje: `Hay ${candidatos.length} canjes que coinciden con "${args.descripcion}". Se mas especifico (agrega el nombre de la persona o el id).`,
      candidatos: candidatos.map((c) => ({ id: c.id, descripcion: c.descripcion, persona: c.persona_nombre, estado: c.estado })),
    };
  }
  const canje = candidatos[0];
  db.prepare(`UPDATE canjes SET estado = ?, nota = COALESCE(?, nota) WHERE id = ?`).run(args.estado, args.nota ?? null, canje.id);
  return { ok: true, mensaje: `Canje "${canje.descripcion}" de ${canje.persona_nombre} actualizado a estado "${args.estado}".` };
}

export function listarCanjes() {
  return db
    .prepare(
      `SELECT canjes.*, personas.nombre as persona_nombre FROM canjes JOIN personas ON personas.id = canjes.persona_id ORDER BY canjes.fecha DESC`
    )
    .all() as any[];
}

export function obtenerCanje(id: number) {
  return db
    .prepare(
      `SELECT canjes.*, personas.nombre as persona_nombre FROM canjes JOIN personas ON personas.id = canjes.persona_id WHERE canjes.id = ?`
    )
    .get(id) as any;
}

export function actualizarCanjePorId(
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
  const actual = obtenerCanje(id);
  if (!actual) throw new Error(`No existe el canje #${id}.`);
  db.prepare(
    `UPDATE canjes SET descripcion = ?, condicion = ?, valor_tomado = ?, moneda_valor = ?, producto_entregado = ?, saldo_monto = ?, saldo_moneda = ?, estado = ?, nota = ? WHERE id = ?`
  ).run(
    campos.descripcion ?? actual.descripcion,
    campos.condicion ?? actual.condicion,
    campos.valor_tomado ?? actual.valor_tomado,
    campos.moneda_valor ?? actual.moneda_valor,
    campos.producto_entregado ?? actual.producto_entregado,
    campos.saldo_monto ?? actual.saldo_monto,
    campos.saldo_moneda ?? actual.saldo_moneda,
    campos.estado ?? actual.estado,
    campos.nota ?? actual.nota,
    id
  );
  return obtenerCanje(id);
}

// ---------- consultas ----------

export function consultarStock(args: { nombre_producto?: string }) {
  if (args.nombre_producto) {
    const p = findProducto(args.nombre_producto);
    if (!p) return { encontrado: false, mensaje: `No hay ningun producto llamado "${args.nombre_producto}".` };
    return { encontrado: true, producto: p };
  }
  return { productos: listarProductos() };
}

export function consultarPersona(args: { nombre: string }) {
  const persona = findPersona(args.nombre);
  if (!persona) return { encontrada: false, mensaje: `No encontre a "${args.nombre}" en el sistema.` };
  const prestamos = db.prepare(`SELECT * FROM prestamos WHERE persona_id = ? ORDER BY fecha DESC`).all(persona.id);
  const canjes = db.prepare(`SELECT * FROM canjes WHERE persona_id = ? ORDER BY fecha DESC`).all(persona.id);
  const compras = db
    .prepare(
      `SELECT movimientos_stock.*, productos.nombre as producto_nombre FROM movimientos_stock JOIN productos ON productos.id = movimientos_stock.producto_id WHERE persona_id = ? AND tipo = 'salida' ORDER BY fecha DESC LIMIT 20`
    )
    .all(persona.id);
  return { encontrada: true, persona, prestamos, canjes, compras_recientes: compras };
}

export function consultarEstadoGeneral() {
  const productos = db.prepare(`SELECT nombre, cantidad, precio_venta FROM productos ORDER BY nombre`).all();
  const prestamos_activos = db
    .prepare(
      `SELECT prestamos.*, personas.nombre as persona_nombre FROM prestamos JOIN personas ON personas.id = prestamos.persona_id WHERE prestamos.estado != 'pagado' ORDER BY prestamos.fecha`
    )
    .all();
  const canjes_pendientes = db
    .prepare(
      `SELECT canjes.*, personas.nombre as persona_nombre FROM canjes JOIN personas ON personas.id = canjes.persona_id WHERE canjes.estado = 'pendiente' ORDER BY canjes.fecha`
    )
    .all();
  const empleados = db.prepare(`SELECT nombre, descuento_pct, telefono FROM personas WHERE es_empleado = 1 ORDER BY nombre`).all();
  return { productos, prestamos_activos, canjes_pendientes, empleados };
}

export function consultarVentas(args: { desde?: string; hasta?: string; nombre_producto?: string; nombre_cliente?: string }) {
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
  const filas = db
    .prepare(
      `SELECT movimientos_stock.*, productos.nombre as producto_nombre, productos.costo as producto_costo, personas.nombre as persona_nombre
       FROM movimientos_stock
       JOIN productos ON productos.id = movimientos_stock.producto_id
       LEFT JOIN personas ON personas.id = movimientos_stock.persona_id
       WHERE ${condiciones.join(" AND ")}
       ORDER BY movimientos_stock.fecha DESC`
    )
    .all(...params) as any[];

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
export function listarMovimientosVenta(args: { desde?: string; hasta?: string; nombre_producto?: string; nombre_cliente?: string }) {
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
  return db
    .prepare(
      `SELECT movimientos_stock.*, productos.nombre as producto_nombre, personas.nombre as persona_nombre
       FROM movimientos_stock
       JOIN productos ON productos.id = movimientos_stock.producto_id
       LEFT JOIN personas ON personas.id = movimientos_stock.persona_id
       WHERE ${condiciones.join(" AND ")}
       ORDER BY movimientos_stock.fecha DESC`
    )
    .all(...params) as any[];
}
