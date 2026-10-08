import { randomUUID } from "node:crypto";
import { get, all, run, enTransaccion } from "./db.js";
import { inferirCategoria } from "./categorizador.js";
import { estadoYBateriaDelNombre, nombreConBateria, validarBateria, validarEstado } from "./equipos.js";

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

// Estado y bateria de un equipo que se carga: lo que se indica manda y, si no se indico, se lee
// del nombre ("Iphone 15 pro 128gb 79%"). Un sellado no tiene bateria. El % queda en el nombre
// (ver nombreConBateria), asi cada usado con su bateria es un producto aparte.
function prepararEquipo(nombre: string, estado?: unknown, bateria?: unknown) {
  const delNombre = estadoYBateriaDelNombre(nombre);
  const estadoFinal = estado === undefined ? delNombre.estado : validarEstado(estado);
  const bateriaFinal = estadoFinal === "Sellado" ? null : bateria === undefined ? delNombre.bateria : validarBateria(bateria);
  const tocaElNombre = estadoFinal != null || bateriaFinal != null;
  return { nombre: tocaElNombre ? nombreConBateria(nombre, bateriaFinal) : String(nombre).trim(), estado: estadoFinal, bateria: bateriaFinal };
}

export async function agregarProducto(args: {
  nombre: string;
  cantidad: number;
  costo?: number;
  precio_venta?: number;
  moneda?: string;
  categoria?: string;
  nota?: string;
  estado?: string | null;
  bateria?: number | null;
}) {
  const equipo = prepararEquipo(args.nombre, args.estado, args.bateria);
  args = { ...args, nombre: equipo.nombre };
  // Producto nuevo sin categoria: se la pedimos a la IA (ej: "iPhone 12" -> Celulares). Va ANTES
  // de abrir la transaccion porque es una llamada lenta y no tiene que trabar la base.
  const categoriaSiEsNuevo = args.categoria || ((await findProducto(args.nombre)) ? null : await inferirCategoria(args.nombre));
  return enTransaccion(async () => {
    const existente = await findProducto(args.nombre);
    if (existente) {
      const estado = equipo.estado ?? existente.estado ?? null;
      const bateria = estado === "Sellado" ? null : (equipo.bateria ?? existente.bateria ?? null);
      await run(
        `UPDATE productos SET cantidad = cantidad + ?, costo = COALESCE(?, costo), precio_venta = COALESCE(?, precio_venta), moneda = COALESCE(?, moneda), categoria = COALESCE(?, categoria), estado = ?, bateria = ?, actualizado_en = datetime('now','localtime') WHERE id = ?`,
        [args.cantidad, args.costo ?? null, args.precio_venta ?? null, args.moneda ?? null, args.categoria ?? null, estado, bateria, existente.id]
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
    const info = await run(
      `INSERT INTO productos (nombre, categoria, cantidad, costo, precio_venta, moneda, nota, estado, bateria) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        args.nombre,
        categoriaSiEsNuevo ?? "Otros",
        args.cantidad,
        args.costo ?? null,
        args.precio_venta ?? null,
        args.moneda ?? "USD",
        args.nota ?? null,
        equipo.estado,
        equipo.bateria,
      ]
    );
    await run(`INSERT INTO movimientos_stock (producto_id, tipo, cantidad, precio_unitario, nota) VALUES (?, 'entrada', ?, ?, 'alta inicial')`, [
      info.lastInsertRowid,
      args.cantidad,
      args.costo ?? null,
    ]);
    const nuevo = await get(`SELECT * FROM productos WHERE id = ?`, [info.lastInsertRowid]);
    return { ok: true, mensaje: `Producto "${args.nombre}" creado con ${args.cantidad} unidades.`, producto: nuevo };
  });
}

export async function ajustarStock(args: { nombre_producto: string; cantidad_delta: number; motivo?: string }) {
  return enTransaccion(async () => {
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
  });
}

interface ArgsVenta {
  nombre_producto: string;
  cantidad: number;
  nombre_cliente?: string;
  precio_unitario?: number;
  moneda?: string;
  nota?: string;
}

export async function registrarVenta(args: ArgsVenta) {
  // Si el producto todavia no existe, la categoria se le pide a la IA ANTES de abrir la
  // transaccion (es una llamada lenta y no tiene que trabar la base mientras tanto).
  const categoriaSiEsNuevo = (await findProducto(args.nombre_producto)) ? null : await inferirCategoria(args.nombre_producto);
  return enTransaccion(() => registrarVentaEnTransaccion(args, categoriaSiEsNuevo));
}

async function registrarVentaEnTransaccion(args: ArgsVenta, categoriaSiEsNuevo: string | null) {
  // No bloqueamos la venta por falta de stock: a veces se compra y se vende en el mismo momento
  // (no llega a quedar cargado como stock previo). Si el producto no existe todavia en el
  // sistema, se crea solo con cantidad 0. Si falta cantidad para cubrir la venta, se repone
  // automaticamente esa diferencia (como si se hubiera comprado justo antes) para que el
  // stock nunca quede en negativo.
  let p = await findProducto(args.nombre_producto);
  if (!p) {
    const { estado, bateria } = estadoYBateriaDelNombre(args.nombre_producto);
    await run(
      `INSERT INTO productos (nombre, categoria, cantidad, precio_venta, moneda, nota, estado, bateria) VALUES (?, ?, 0, ?, ?, ?, ?, ?)`,
      [args.nombre_producto, categoriaSiEsNuevo ?? "Otros", args.precio_unitario ?? null, args.moneda ?? "ARS", NOTA_PRODUCTO_CREADO_AL_VENDER, estado, bateria]
    );
    p = await findProducto(args.nombre_producto);
  }
  let persona: any = null;
  // Si no se dijo el precio se usa el de lista del producto, y entonces la moneda tiene que ser
  // la del producto (no ARS por defecto): un iPhone de lista a 800 USD no puede quedar
  // registrado como una venta de 800 pesos.
  const usaPrecioDeLista = args.precio_unitario == null && p.precio_venta != null;
  const moneda = usaPrecioDeLista ? p.moneda : args.moneda ?? "ARS";
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
      `INSERT INTO movimientos_stock (producto_id, tipo, cantidad, precio_unitario, nota) VALUES (?, 'entrada', ?, ?, ?)`,
      [p.id, faltante, args.precio_unitario ?? null, NOTA_REPOSICION_AUTOMATICA]
    );
  }
  await run(`UPDATE productos SET cantidad = cantidad - ?, actualizado_en = datetime('now','localtime') WHERE id = ?`, [args.cantidad, p.id]);
  const salida = await run(
    `INSERT INTO movimientos_stock (producto_id, tipo, cantidad, persona_id, precio_unitario, moneda, nota) VALUES (?, 'salida', ?, ?, ?, ?, ?)`,
    [p.id, args.cantidad, persona?.id ?? null, precioUnitario, moneda, args.nota ?? null]
  );
  // OJO: si habia stock de sobra, "faltante" queda negativo (no representa una reposicion real,
  // esa rama del if de arriba ni se ejecuta). Para el stock restante solo hay que sumar lo que
  // efectivamente se repuso (faltante > 0), nunca restar un "faltante" negativo de nuevo.
  const restante = p.cantidad - args.cantidad + Math.max(faltante, 0);
  const total = precioUnitario != null ? precioUnitario * args.cantidad : null;
  const avisoReposicion =
    faltante > 0 ? ` (se sumaron ${faltante} de stock automaticamente porque no estaba cargado: se compro y vendio en el momento)` : "";
  return {
    ok: true,
    venta_id: salida.lastInsertRowid,
    mensaje: `Venta registrada: ${args.cantidad} x "${args.nombre_producto}"${persona ? ` a ${persona.nombre}` : ""}${
      precioUnitario != null ? ` a ${precioUnitario} ${moneda} c/u (total ${total})` : ""
    }.${avisoReposicion} Stock restante: ${restante}.`,
  };
}

const NOTA_REPOSICION_AUTOMATICA = "reposicion automatica: compra y venta en el momento";
const NOTA_PRODUCTO_CREADO_AL_VENDER = "creado automaticamente al vender";

// Anula una venta cargada por error (ej: una prueba, o mal cargada): borra la venta y devuelve
// las unidades al stock. Si al registrarla se habia repuesto stock automaticamente (compra y
// venta en el momento), esa reposicion tambien se deshace, asi el stock queda exactamente como
// estaba antes de la venta. Y si el producto lo habia creado esa misma venta y no le queda ningun
// otro movimiento, se borra tambien (si no quedaria un producto "fantasma" con 0 unidades).
export async function anularVenta(args: { venta_id: number }) {
  const id = Number(args.venta_id);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Falta el id de la venta a anular (buscalo con consultar_ventas).");
  return enTransaccion(async () => {
    const venta = await get(
      `SELECT movimientos_stock.*, productos.nombre as producto_nombre, productos.nota as producto_nota, personas.nombre as persona_nombre
       FROM movimientos_stock
       JOIN productos ON productos.id = movimientos_stock.producto_id
       LEFT JOIN personas ON personas.id = movimientos_stock.persona_id
       WHERE movimientos_stock.id = ? AND movimientos_stock.tipo = 'salida'`,
      [id]
    );
    if (!venta) throw new Error(`No existe ninguna venta con id #${id} (puede que ya se haya anulado).`);
    // La reposicion automatica se inserta justo antes que la venta, en la misma transaccion, asi
    // que siempre queda con el id anterior.
    const reposicion = await get(`SELECT * FROM movimientos_stock WHERE id = ? AND producto_id = ? AND tipo = 'entrada' AND nota = ?`, [
      id - 1,
      venta.producto_id,
      NOTA_REPOSICION_AUTOMATICA,
    ]);
    await run(`DELETE FROM movimientos_stock WHERE id = ?`, [id]);
    if (reposicion) await run(`DELETE FROM movimientos_stock WHERE id = ?`, [reposicion.id]);
    const devolver = venta.cantidad - (reposicion?.cantidad ?? 0);
    await run(`UPDATE productos SET cantidad = cantidad + ?, actualizado_en = datetime('now','localtime') WHERE id = ?`, [devolver, venta.producto_id]);

    let productoBorrado = false;
    if (venta.producto_nota === NOTA_PRODUCTO_CREADO_AL_VENDER) {
      const otros = await get(`SELECT COUNT(*) as n FROM movimientos_stock WHERE producto_id = ?`, [venta.producto_id]);
      if (Number(otros.n) === 0) {
        await run(`DELETE FROM productos WHERE id = ?`, [venta.producto_id]);
        productoBorrado = true;
      }
    }
    const descripcion = `${venta.cantidad} x "${venta.producto_nombre}"${venta.persona_nombre ? ` a ${venta.persona_nombre}` : ""}${
      venta.precio_unitario != null ? ` a ${venta.precio_unitario} ${venta.moneda} c/u` : ""
    }`;
    if (productoBorrado) {
      return {
        ok: true,
        mensaje: `Venta #${id} anulada (${descripcion}). El producto "${venta.producto_nombre}" se habia creado solo con esa venta, asi que tambien se borro.`,
      };
    }
    const producto = await get(`SELECT cantidad FROM productos WHERE id = ?`, [venta.producto_id]);
    return {
      ok: true,
      mensaje: `Venta #${id} anulada (${descripcion}). Stock de "${venta.producto_nombre}" ahora: ${producto.cantidad}.`,
    };
  });
}

export async function listarProductos() {
  return all(`SELECT * FROM productos ORDER BY nombre`);
}

export async function obtenerProducto(id: number) {
  return get(`SELECT * FROM productos WHERE id = ?`, [id]);
}

export async function actualizarProductoPorId(
  id: number,
  campos: {
    nombre?: string;
    categoria?: string;
    cantidad?: number;
    costo?: number;
    precio_venta?: number;
    moneda?: string;
    nota?: string;
    estado?: string | null;
    bateria?: number | null;
  }
) {
  return enTransaccion(async () => {
    const actual = await obtenerProducto(id);
    if (!actual) throw new Error(`No existe el producto #${id}.`);
    // Estado y bateria: null o vacio los borra; sin mandarlos, quedan como estaban.
    const estado = campos.estado !== undefined ? validarEstado(campos.estado) : (actual.estado ?? null);
    const bateria = estado === "Sellado" ? null : campos.bateria !== undefined ? validarBateria(campos.bateria) : (actual.bateria ?? null);
    let nombre = String(campos.nombre ?? actual.nombre).trim();
    if (estado != null || bateria != null || actual.bateria != null) nombre = nombreConBateria(nombre, bateria);
    if (!nombre) throw new Error("El nombre no puede quedar vacio.");
    const otro = await findProducto(nombre);
    if (otro && Number(otro.id) !== Number(id)) throw new Error(`Ya hay otro producto llamado "${nombre}" en el stock.`);
    await run(
      `UPDATE productos SET nombre = ?, categoria = ?, cantidad = ?, costo = ?, precio_venta = ?, moneda = ?, nota = ?, estado = ?, bateria = ?, actualizado_en = datetime('now','localtime') WHERE id = ?`,
      [
        nombre,
        campos.categoria ?? actual.categoria,
        campos.cantidad ?? actual.cantidad,
        campos.costo ?? actual.costo,
        campos.precio_venta ?? actual.precio_venta,
        campos.moneda ?? actual.moneda,
        campos.nota ?? actual.nota,
        estado,
        bateria,
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
  });
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
  return enTransaccion(async () => {
    const persona = await findOrCreatePersona(args.persona);
    const info = await run(
      `INSERT INTO prestamos (persona_id, monto_original, monto_pendiente, moneda, interes_pct, nota) VALUES (?, ?, ?, ?, ?, ?)`,
      [persona.id, args.monto, args.monto, args.moneda, args.interes_pct ?? 0, args.nota ?? null]
    );
    return { ok: true, mensaje: `Prestamo registrado: ${args.monto} ${args.moneda} a ${args.persona}.`, prestamo_id: info.lastInsertRowid };
  });
}

function validarMontoPago(monto: number) {
  if (!(Number(monto) > 0)) throw new Error("El monto del pago tiene que ser un numero mayor a cero.");
}

export async function registrarPagoPrestamo(args: { persona: string; monto: number; moneda?: "USD" | "ARS"; nota?: string }) {
  validarMontoPago(args.monto);
  return enTransaccion(async () => {
    const persona = await findPersona(args.persona);
    if (!persona) throw new Error(`No encontre a "${args.persona}" en el sistema.`);
    const activos = await all(`SELECT * FROM prestamos WHERE persona_id = ? AND estado != 'pagado' ORDER BY fecha ASC`, [persona.id]);
    if (activos.length === 0) throw new Error(`"${args.persona}" no tiene prestamos activos.`);
    // Un pago se aplica solo contra prestamos de SU moneda: 100 USD no pueden descontarse de una
    // deuda en pesos. Si no se dijo la moneda y la persona debe en una sola, se usa esa.
    const monedasConDeuda = [...new Set(activos.map((pr) => pr.moneda))];
    const moneda = args.moneda ?? (monedasConDeuda.length === 1 ? monedasConDeuda[0] : undefined);
    if (!moneda) {
      throw new Error(
        `"${args.persona}" tiene prestamos activos en ${monedasConDeuda.join(" y ")}: hay que aclarar en que moneda es el pago (USD o ARS).`
      );
    }
    const prestamos = activos.filter((pr) => pr.moneda === moneda);
    if (prestamos.length === 0) {
      throw new Error(`"${args.persona}" no tiene prestamos activos en ${moneda} (debe en ${monedasConDeuda.join(" y ")}).`);
    }
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
      mensaje: `Pago de ${args.monto} ${moneda} registrado para "${args.persona}". Detalle: ${afectados
        .map((a) => `prestamo #${a.prestamo_id} (${a.moneda}): -${a.aplicado}, queda ${a.nuevoPendiente}`)
        .join("; ")}${restante > 0 ? `. Sobraron ${restante} ${moneda} sin aplicar (no habia mas deuda activa en esa moneda).` : ""}`,
    };
  });
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
  validarMontoPago(monto);
  return enTransaccion(async () => {
    const pr = await obtenerPrestamo(prestamoId);
    if (!pr) throw new Error(`No existe el prestamo #${prestamoId}.`);
    const aplicado = Math.min(monto, pr.monto_pendiente);
    const nuevoPendiente = Math.round((pr.monto_pendiente - aplicado) * 100) / 100;
    const nuevoEstado = nuevoPendiente <= 0 ? "pagado" : "parcial";
    await run(`UPDATE prestamos SET monto_pendiente = ?, estado = ? WHERE id = ?`, [nuevoPendiente, nuevoEstado, prestamoId]);
    await run(`INSERT INTO pagos_prestamo (prestamo_id, monto, nota) VALUES (?, ?, ?)`, [prestamoId, aplicado, nota ?? null]);
    return obtenerPrestamo(prestamoId);
  });
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
  return enTransaccion(async () => {
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
  });
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

// Version para el bot de CLIENTES (WhatsApp): igual que consultarStock, pero nunca expone el
// costo de compra (eso es informacion del negocio, no del cliente) ni notas internas.
export async function consultarStockPublico(args: { nombre_producto?: string }) {
  const aPublico = (p: any) => ({
    nombre: p.nombre,
    categoria: p.categoria,
    estado: p.estado ?? null,
    bateria: p.bateria ?? null,
    cantidad_disponible: p.cantidad,
    precio_venta: p.precio_venta,
    moneda: p.moneda,
  });
  if (args.nombre_producto) {
    const p = await findProducto(args.nombre_producto);
    if (!p) return { encontrado: false, mensaje: `No hay ningun producto llamado "${args.nombre_producto}".` };
    return { encontrado: true, producto: aPublico(p) };
  }
  return { productos: (await listarProductos()).map(aPublico) };
}

// ---------- catalogo publico (publicaciones que ven los clientes) ----------
// El catalogo va aparte del stock: son "publicaciones" que se arman desde el panel (nombre,
// estado, memorias con su precio, si lo tengo o no, si se muestra o no). La primera vez se arma
// solo a partir de lo que haya en stock (ver asegurarCatalogoInicial), para no arrancar vacio.

type MemoriaCatalogo = { capacidad: string; precio: number | null; disponible: boolean };

const MAX_MEMORIAS = 10;

// Limpia las memorias que llegan del panel: capacidad obligatoria, precio numero o nada, sin
// repetidas.
function limpiarMemorias(entrada: unknown): MemoriaCatalogo[] {
  if (!Array.isArray(entrada)) return [];
  const vistas = new Set<string>();
  const memorias: MemoriaCatalogo[] = [];
  for (const m of entrada) {
    const capacidad = String(m?.capacidad ?? "").trim();
    if (!capacidad || vistas.has(normalizarTexto(capacidad))) continue;
    vistas.add(normalizarTexto(capacidad));
    const precio = m?.precio === "" || m?.precio == null ? null : Number(m.precio);
    memorias.push({ capacidad, precio: precio != null && Number.isFinite(precio) && precio >= 0 ? precio : null, disponible: m?.disponible !== false });
    if (memorias.length >= MAX_MEMORIAS) break;
  }
  return memorias;
}

function leerMemorias(json: unknown): MemoriaCatalogo[] {
  try {
    return limpiarMemorias(JSON.parse(String(json ?? "[]")));
  } catch {
    return [];
  }
}

function filaAItem(f: any) {
  const memorias = leerMemorias(f.memorias);
  return {
    id: Number(f.id),
    nombre: String(f.nombre),
    categoria: String(f.categoria ?? "Otros"),
    estado: f.estado ?? null,
    detalle: f.detalle ?? null,
    precio: f.precio ?? null,
    moneda: String(f.moneda ?? "USD"),
    memorias,
    disponible: !!f.disponible,
    visible: !!f.visible,
    orden: Number(f.orden ?? 0),
  };
}

// Lo que se puede leer del nombre de un producto del stock, para armar el catalogo inicial.
function analizarNombreProducto(nombre: string) {
  const t = normalizarTexto(nombre);
  const clave = claveModelo(nombre);
  const esCelular = /iphone|ipad|galaxy|samsung|xiaomi|redmi|motorola/.test(t);
  const conUnidad = /(\d+)\s?(gb|tb)\b/.exec(t);
  const suelta = esCelular ? /\b(64|128|256|512)\b/.exec(t) : null;
  const capacidad = conUnidad ? `${conUnidad[1]} ${conUnidad[2].toUpperCase()}` : suelta ? `${suelta[1]} GB` : null;
  const estado = /\bsellad[oa]s?\b|\bnuev[oa]s?\b/.test(t) ? "Sellado" : /\bsemi/.test(t) ? "Usado - como nuevo" : /\busad[oa]s?\b/.test(t) ? "Usado" : null;
  const porcentaje = /\b(\d{2,3})\s?%/.exec(nombre);
  const bateria = porcentaje && Number(porcentaje[1]) <= 100 ? Number(porcentaje[1]) : null;
  return { clave, nombre: clave.startsWith("iphone") ? nombreModeloBonito(clave) : String(nombre).trim(), capacidad, estado, bateria, detalle: null as string | null };
}

// Equipos usados del stock que tienen la bateria cargada (campos Estado y Bateria del stock): en
// el catalogo, el cliente elige entre los que hay de ese modelo segun la bateria. Se toman del
// stock en el momento, asi que cuando uno se vende (queda en 0) desaparece solo.
type UnidadEnStock = { clave: string; estado: string | null; bateria: number; capacidad: string | null; precio: number | null; moneda: string };

async function unidadesConBateria(): Promise<UnidadEnStock[]> {
  const productos = await all(
    `SELECT nombre, precio_venta, moneda, estado, bateria FROM productos WHERE cantidad > 0 AND bateria IS NOT NULL AND COALESCE(estado, '') <> 'Sellado'`
  );
  return productos.map((p) => {
    const a = analizarNombreProducto(p.nombre);
    return {
      clave: a.clave,
      estado: p.estado ?? null,
      bateria: Number(p.bateria),
      capacidad: a.capacidad,
      precio: p.precio_venta ?? null,
      moneda: String(p.moneda ?? "USD"),
    };
  });
}

// Las unidades que le corresponden a una publicacion: mismo modelo y mismo estado (una "Usado -
// como nuevo" muestra solo los como nuevo; un equipo sin estado cargado entra en cualquiera). Un
// "Sellado" no tiene bateria usada. De la mejor bateria a la peor.
function unidadesDeItem(item: { nombre: string; estado: string | null }, unidades: UnidadEnStock[]) {
  if (item.estado === "Sellado") return [];
  const clave = claveModelo(item.nombre);
  return unidades
    .filter((u) => u.clave === clave && (u.estado == null || item.estado == null || u.estado === item.estado))
    .map(({ clave: _clave, estado: _estado, ...u }) => u)
    .sort((a, b) => b.bateria - a.bateria);
}

// Para el orden inicial: primero los iPhone, del mas nuevo al mas viejo; despues el resto.
function puntajeDestacado(clave: string): number {
  const iphone = /^iphone (\d+)/.exec(clave);
  if (!iphone) return 0;
  return 1000 + Number(iphone[1]) * 10 + (/pro max/.test(clave) ? 3 : /pro/.test(clave) ? 2 : /plus|air/.test(clave) ? 1 : 0);
}

// Una sola vez (la primera vez que se usa el catalogo): se arma con lo que hay en stock, para no
// arrancar vacio. Los productos que son el mismo modelo y estado pero distinta memoria quedan en
// UNA publicacion con varias memorias ("Iphone 17 pro max 256 sellado" + "... 512 sellado" ->
// "iPhone 17 Pro Max", Nuevo sellado, 256 GB y 512 GB). Despues se maneja solo desde el panel.
async function asegurarCatalogoInicial() {
  if (await get(`SELECT 1 FROM configuracion WHERE clave = 'catalogo_inicial'`)) return;
  await enTransaccion(async () => {
    const marca = await run(`INSERT OR IGNORE INTO configuracion (clave, valor) VALUES ('catalogo_inicial', datetime('now','localtime'))`);
    if (marca.changes === 0) return; // otro pedido lo armo justo al mismo tiempo
    if (Number((await get(`SELECT COUNT(*) as n FROM catalogo_items`)).n) > 0) return;
    const productos = await all(`SELECT nombre, categoria, precio_venta, moneda, estado FROM productos WHERE cantidad > 0 ORDER BY nombre`);
    const grupos = new Map<string, any>();
    for (const p of productos) {
      const a = analizarNombreProducto(p.nombre);
      if (p.estado) a.estado = p.estado;
      // La bateria no separa publicaciones: los usados del mismo modelo van juntos y el cliente
      // elige la bateria en el catalogo (ver unidadesConBateria).
      const llave = `${a.clave}|${a.estado ?? ""}`;
      const g = grupos.get(llave) ?? { ...a, categoria: p.categoria ?? "Otros", moneda: p.moneda ?? "USD", precio: null, memorias: [] as MemoriaCatalogo[] };
      if (a.capacidad && !g.memorias.some((m: MemoriaCatalogo) => m.capacidad === a.capacidad)) {
        g.memorias.push({ capacidad: a.capacidad, precio: p.precio_venta ?? null, disponible: true });
      } else if (!a.capacidad && g.precio == null) {
        g.precio = p.precio_venta ?? null;
      }
      grupos.set(llave, g);
    }
    const ordenados = [...grupos.values()].sort((x, y) => puntajeDestacado(y.clave) - puntajeDestacado(x.clave) || x.nombre.localeCompare(y.nombre, "es"));
    for (const [i, g] of ordenados.entries()) {
      g.memorias.sort((x: MemoriaCatalogo, y: MemoriaCatalogo) => parseInt(x.capacidad) * (/tb/i.test(x.capacidad) ? 1024 : 1) - parseInt(y.capacidad) * (/tb/i.test(y.capacidad) ? 1024 : 1));
      await run(
        `INSERT INTO catalogo_items (nombre, categoria, estado, detalle, precio, moneda, memorias, orden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [g.nombre, g.categoria, g.estado, g.detalle, g.precio, g.moneda, JSON.stringify(g.memorias), i + 1]
      );
    }
  });
}

// Todas las publicaciones (para el panel y el bot), con sus fotos.
export async function listarItemsCatalogo() {
  await asegurarCatalogoInicial();
  const [filas, fotos, unidades] = await Promise.all([all(`SELECT * FROM catalogo_items ORDER BY orden, id`), listarFotosCatalogo(), unidadesConBateria()]);
  return filas.map((f) => {
    const item = filaAItem(f);
    return {
      ...item,
      fotos: fotosDeProducto(item.nombre, fotos).map((x) => ({ color: x.color, hex: x.color_hex, url: x.url })),
      unidades: unidadesDeItem(item, unidades),
    };
  });
}

// Lo que ve el cliente: solo las publicaciones visibles. Si no tengo ninguna de sus memorias, la
// publicacion entera cuenta como "sin stock".
export async function listarCatalogo() {
  const items = await listarItemsCatalogo();
  return items
    .filter((i) => i.visible)
    .map(({ visible: _visible, orden: _orden, ...i }) => ({
      ...i,
      disponible: i.disponible && (i.memorias.length === 0 || i.memorias.some((m) => m.disponible)),
    }));
}

function validarItemCatalogo(datos: any) {
  const nombre = String(datos.nombre ?? "").trim();
  if (!nombre) throw new Error("Falta el nombre de la publicación.");
  const precio = datos.precio === "" || datos.precio == null ? null : Number(datos.precio);
  if (precio != null && !(precio >= 0)) throw new Error("El precio tiene que ser un número.");
  return {
    nombre,
    categoria: String(datos.categoria ?? "").trim() || "Otros",
    estado: String(datos.estado ?? "").trim() || null,
    detalle: String(datos.detalle ?? "").trim() || null,
    precio,
    moneda: datos.moneda === "ARS" ? "ARS" : "USD",
    memorias: limpiarMemorias(datos.memorias),
    disponible: datos.disponible !== false,
    visible: datos.visible !== false,
  };
}

export async function crearItemCatalogo(datos: any) {
  await asegurarCatalogoInicial();
  const v = validarItemCatalogo(datos);
  const ultimo = await get(`SELECT COALESCE(MAX(orden), 0) as orden FROM catalogo_items`);
  const info = await run(
    `INSERT INTO catalogo_items (nombre, categoria, estado, detalle, precio, moneda, memorias, disponible, visible, orden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.nombre, v.categoria, v.estado, v.detalle, v.precio, v.moneda, JSON.stringify(v.memorias), v.disponible ? 1 : 0, v.visible ? 1 : 0, Number(ultimo.orden) + 1]
  );
  return { ok: true, id: info.lastInsertRowid, mensaje: `Publicación "${v.nombre}" creada.` };
}

// Acepta cambios parciales: el panel manda solo { visible } o { disponible } desde los
// interruptores, o la publicacion entera desde el formulario.
export async function actualizarItemCatalogo(id: number, campos: any) {
  const actual = await get(`SELECT * FROM catalogo_items WHERE id = ?`, [id]);
  if (!actual) throw new Error(`No existe la publicación #${id}.`);
  const a = filaAItem(actual);
  const v = validarItemCatalogo({ ...a, ...campos, memorias: campos.memorias ?? a.memorias });
  await run(
    `UPDATE catalogo_items SET nombre = ?, categoria = ?, estado = ?, detalle = ?, precio = ?, moneda = ?, memorias = ?, disponible = ?, visible = ?,
       actualizado_en = datetime('now','localtime') WHERE id = ?`,
    [v.nombre, v.categoria, v.estado, v.detalle, v.precio, v.moneda, JSON.stringify(v.memorias), v.disponible ? 1 : 0, v.visible ? 1 : 0, id]
  );
  return { ok: true, mensaje: `Publicación "${v.nombre}" actualizada.` };
}

export async function eliminarItemCatalogo(id: number) {
  await run(`DELETE FROM catalogo_items WHERE id = ?`, [id]);
  return { ok: true };
}

// Sube o baja una publicacion un lugar en el orden del catalogo (intercambia con la vecina).
export async function moverItemCatalogo(id: number, direccion: "arriba" | "abajo") {
  return enTransaccion(async () => {
    const actual = await get(`SELECT id, orden FROM catalogo_items WHERE id = ?`, [id]);
    if (!actual) throw new Error(`No existe la publicación #${id}.`);
    const vecina =
      direccion === "arriba"
        ? await get(`SELECT id, orden FROM catalogo_items WHERE orden < ? OR (orden = ? AND id < ?) ORDER BY orden DESC, id DESC LIMIT 1`, [actual.orden, actual.orden, id])
        : await get(`SELECT id, orden FROM catalogo_items WHERE orden > ? OR (orden = ? AND id > ?) ORDER BY orden ASC, id ASC LIMIT 1`, [actual.orden, actual.orden, id]);
    if (!vecina) return { ok: true };
    // Si tenian el mismo numero de orden, se separan para que el intercambio tenga efecto.
    const ordenActual = Number(actual.orden), ordenVecina = Number(vecina.orden);
    const [nuevoActual, nuevoVecina] = ordenActual === ordenVecina ? (direccion === "arriba" ? [ordenVecina - 1, ordenActual] : [ordenVecina + 1, ordenActual]) : [ordenVecina, ordenActual];
    await run(`UPDATE catalogo_items SET orden = ? WHERE id = ?`, [nuevoActual, id]);
    await run(`UPDATE catalogo_items SET orden = ? WHERE id = ?`, [nuevoVecina, vecina.id]);
    return { ok: true };
  });
}

// ---------- catalogo desde el bot de Telegram ----------
// El bot solo puede mostrar u ocultar publicaciones (nunca borrarlas): ocultar = sacarla de la
// vista de los clientes, pero sigue en el panel y se puede volver a mostrar cuando quieras.

export async function consultarCatalogoParaBot() {
  const items = await listarItemsCatalogo();
  return {
    publicaciones: items.map((i) => ({
      id: i.id,
      nombre: i.nombre,
      estado: i.estado,
      detalle: i.detalle,
      visible_para_clientes: i.visible,
      lo_tengo: i.disponible,
      memorias: i.memorias.map((m) => `${m.capacidad}${m.precio != null ? ` (${m.precio} ${i.moneda})` : ""}${m.disponible ? "" : " - sin stock"}`),
      baterias_en_stock: i.unidades.map((u) => `${u.bateria}%${u.capacidad ? ` ${u.capacidad}` : ""}${u.precio != null ? ` (${u.precio} ${u.moneda})` : ""}`),
      precio: i.memorias.length ? undefined : i.precio,
      moneda: i.moneda,
    })),
  };
}

export async function cambiarVisibilidadCatalogo(args: { publicacion?: string; id?: number; visible: boolean }) {
  const items = await listarItemsCatalogo();
  let elegido = args.id != null ? items.find((i) => i.id === Number(args.id)) : undefined;
  if (!elegido) {
    const palabras = normalizarTexto(String(args.publicacion ?? "")).split(" ").filter(Boolean);
    if (!palabras.length) throw new Error("Decime qué publicación del catálogo (el nombre o el id).");
    const texto = (i: (typeof items)[number]) => ` ${normalizarTexto([i.nombre, i.estado, i.detalle, ...i.memorias.map((m) => m.capacidad)].filter(Boolean).join(" "))} `;
    const candidatas = items.filter((i) => palabras.every((p) => texto(i).includes(` ${p}`)));
    const exacta = candidatas.filter((i) => normalizarTexto(i.nombre) === palabras.join(" "));
    const unica = candidatas.length === 1 ? candidatas : exacta.length === 1 ? exacta : [];
    if (!candidatas.length) throw new Error(`No encontré ninguna publicación del catálogo que coincida con "${args.publicacion}".`);
    if (!unica.length) {
      return {
        ok: false,
        mensaje: `Hay ${candidatas.length} publicaciones que coinciden con "${args.publicacion}". Preguntá cuál (o usá el id).`,
        candidatas: candidatas.map((i) => ({ id: i.id, nombre: i.nombre, estado: i.estado, detalle: i.detalle, visible: i.visible })),
      };
    }
    elegido = unica[0];
  }
  if (!elegido) throw new Error(`No existe la publicación #${args.id}.`);
  const visible = args.visible !== false;
  await run(`UPDATE catalogo_items SET visible = ?, actualizado_en = datetime('now','localtime') WHERE id = ?`, [visible ? 1 : 0, elegido.id]);
  const nombre = [elegido.nombre, elegido.estado, elegido.detalle].filter(Boolean).join(" · ");
  return {
    ok: true,
    mensaje: visible
      ? `"${nombre}" vuelve a aparecer en el catálogo de los clientes.`
      : `"${nombre}" ya no aparece en el catálogo de los clientes. No se borró: sigue en el panel y se puede volver a mostrar.`,
  };
}

// ---------- fotos del catalogo ----------

// Clave del modelo, para emparejar fotos con productos. En los iPhone se saca el modelo exacto
// del nombre ("Iphone 17 pro max 256 sellado" -> "iphone 17 pro max"), asi la foto de un 17 no
// le aparece a un 17 Pro Max. En cualquier otro producto es el texto normalizado tal cual.
export function claveModelo(texto: string): string {
  const t = normalizarTexto(texto);
  const iphone = /\biphone\s*(\d{1,2}e?|se|xr|xs|x|air)\b(?:\s*(pro\s*max|pro|plus|mini|max))?/.exec(t);
  if (iphone) return ["iphone", iphone[1], iphone[2]?.replace(/pro\s*max/, "pro max")].filter(Boolean).join(" ");
  return t;
}

// "iphone 17 pro max" -> "iPhone 17 Pro Max" (para mostrar en el panel).
function nombreModeloBonito(clave: string): string {
  return clave
    .split(" ")
    .map((p) => (p === "iphone" ? "iPhone" : ["se", "xr", "xs", "x"].includes(p) ? p.toUpperCase() : /^\d/.test(p) ? p : p[0].toUpperCase() + p.slice(1)))
    .join(" ");
}

type FotoCatalogo = { id: number; modelo: string; modelo_clave: string; color: string; color_hex: string | null; url: string };

// Las fotos que le corresponden a un producto. iPhone: el mismo modelo exacto. Otros productos:
// la foto cuyo modelo aparezca entero en el nombre (si hay varias, gana la mas especifica).
function fotosDeProducto(nombre: string, fotos: FotoCatalogo[]): FotoCatalogo[] {
  const clave = claveModelo(nombre);
  const exactas = fotos.filter((f) => f.modelo_clave === clave);
  if (exactas.length || clave.startsWith("iphone")) return exactas;
  const texto = ` ${normalizarTexto(nombre)} `;
  const candidatas = fotos.filter((f) => !f.modelo_clave.startsWith("iphone") && texto.includes(` ${f.modelo_clave} `));
  const largo = Math.max(0, ...candidatas.map((f) => f.modelo_clave.length));
  return candidatas.filter((f) => f.modelo_clave.length === largo);
}

export async function listarFotosCatalogo(): Promise<FotoCatalogo[]> {
  const filas = await all(
    `SELECT id, modelo, modelo_clave, color, color_hex, actualizado_en, length(datos) as bytes FROM fotos_catalogo ORDER BY modelo_clave, id`
  );
  // La url lleva la fecha de actualizacion: si se reemplaza la foto, cambia la url y el navegador
  // no muestra la vieja guardada (la foto en si se cachea "para siempre").
  return filas.map((f) => ({ ...f, url: `/api/catalogo/fotos/${f.id}?v=${encodeURIComponent(f.actualizado_en)}` }));
}

// Para la seccion del panel: las fotos cargadas y que publicaciones visibles todavia no tienen.
export async function estadoFotosCatalogo() {
  const [fotos, items] = await Promise.all([listarFotosCatalogo(), listarItemsCatalogo()]);
  const sinFoto = new Map<string, { modelo: string; productos: string[] }>();
  for (const i of items) {
    if (!i.visible || i.fotos.length) continue;
    const clave = claveModelo(i.nombre);
    const grupo = sinFoto.get(clave) ?? { modelo: clave.startsWith("iphone") ? nombreModeloBonito(clave) : i.nombre, productos: [] as string[] };
    grupo.productos.push([i.nombre, i.estado, i.detalle].filter(Boolean).join(" · "));
    sinFoto.set(clave, grupo);
  }
  return { fotos, modelos_sin_foto: [...sinFoto.values()] };
}

const MAX_BYTES_FOTO = 1_500_000;

export async function guardarFotoCatalogo(args: { modelo: string; color: string; color_hex?: string; imagen: string }) {
  const modelo = String(args.modelo ?? "").trim();
  const color = String(args.color ?? "").trim();
  if (!modelo || !color) throw new Error("Falta el modelo o el color.");
  const partes = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(args.imagen ?? ""));
  if (!partes) throw new Error("La imagen tiene que ser JPG, PNG o WebP.");
  const datos = Buffer.from(partes[2], "base64");
  if (datos.length > MAX_BYTES_FOTO) throw new Error("La imagen pesa demasiado (máximo 1,5 MB).");
  const hex = /^#[0-9a-f]{6}$/i.test(args.color_hex ?? "") ? args.color_hex! : null;
  await run(
    `INSERT INTO fotos_catalogo (modelo, modelo_clave, color, color_clave, color_hex, mime, datos) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(modelo_clave, color_clave) DO UPDATE SET modelo = excluded.modelo, color = excluded.color, color_hex = excluded.color_hex,
       mime = excluded.mime, datos = excluded.datos, actualizado_en = datetime('now','localtime')`,
    [modelo, claveModelo(modelo), color, normalizarTexto(color), hex, partes[1], datos]
  );
  return { ok: true, mensaje: `Foto de ${modelo} (${color}) guardada.` };
}

export async function eliminarFotoCatalogo(id: number) {
  await run(`DELETE FROM fotos_catalogo WHERE id = ?`, [id]);
  return { ok: true };
}

export async function obtenerFotoCatalogo(id: number): Promise<{ mime: string; datos: Buffer } | null> {
  const fila = await get(`SELECT mime, datos FROM fotos_catalogo WHERE id = ?`, [id]);
  if (!fila) return null;
  return { mime: fila.mime, datos: Buffer.from(fila.datos as ArrayBuffer) };
}

// ---------- pedidos pendientes (clientes por WhatsApp) ----------

export async function crearPedidoPendiente(args: {
  cliente_telefono: string;
  cliente_nombre?: string;
  producto: string;
  cantidad: number;
  precio_unitario?: number;
  moneda?: string;
  nota?: string;
}) {
  const p = await findProducto(args.producto);
  const precioSugerido = args.precio_unitario ?? p?.precio_venta ?? null;
  const moneda = args.moneda ?? p?.moneda ?? "ARS";
  const info = await run(
    `INSERT INTO pedidos_pendientes (cliente_telefono, cliente_nombre, producto, cantidad, precio_unitario, moneda, nota) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [args.cliente_telefono, args.cliente_nombre ?? null, args.producto, args.cantidad, precioSugerido, moneda, args.nota ?? null]
  );
  return {
    ok: true,
    pedido_id: info.lastInsertRowid,
    mensaje: `Pedido registrado: ${args.cantidad} x "${args.producto}"${
      precioSugerido != null ? ` a ${precioSugerido} ${moneda} c/u (estimado)` : ""
    }. Queda PENDIENTE hasta que el negocio lo confirme.`,
  };
}

export async function listarPedidosPendientes(soloPendientes = false) {
  if (soloPendientes) return all(`SELECT * FROM pedidos_pendientes WHERE estado = 'pendiente' ORDER BY creado_en DESC`);
  return all(`SELECT * FROM pedidos_pendientes ORDER BY creado_en DESC LIMIT 200`);
}

async function requierePedidoPendiente(id: number) {
  const pedido = await get(`SELECT * FROM pedidos_pendientes WHERE id = ?`, [id]);
  if (!pedido) throw new Error(`No existe el pedido #${id}.`);
  if (pedido.estado !== "pendiente") throw new Error(`El pedido #${id} ya esta "${pedido.estado}", no se puede volver a resolver.`);
  return pedido;
}

// Marca el pedido como resuelto SOLO si sigue pendiente, en un unico UPDATE. Si dos personas
// aprueban el mismo pedido casi a la vez (doble clic, o el dueno y Lucas juntos), solo una de las
// dos lo consigue: la otra recibe el error y no se registra la venta dos veces.
async function marcarPedidoResuelto(id: number, estado: "aprobado" | "rechazado", nota?: string | null) {
  const info = await run(
    `UPDATE pedidos_pendientes SET estado = ?, resuelto_en = datetime('now','localtime'), nota = COALESCE(?, nota) WHERE id = ? AND estado = 'pendiente'`,
    [estado, nota ?? null, id]
  );
  if (info.changes === 0) throw new Error(`El pedido #${id} ya fue resuelto por otra persona, no se puede volver a resolver.`);
}

// Aprobar = se registra la venta de verdad (misma logica que registrarVenta: nunca bloquea por
// falta de stock, repone automatico). A partir de aca el pedido deja de ser "de mentira".
export async function aprobarPedidoPendiente(id: number) {
  const pedido = await requierePedidoPendiente(id);
  const categoriaSiEsNuevo = (await findProducto(pedido.producto)) ? null : await inferirCategoria(pedido.producto);
  return enTransaccion(async () => {
    await marcarPedidoResuelto(id, "aprobado");
    const resultado = await registrarVentaEnTransaccion(
      {
        nombre_producto: pedido.producto,
        cantidad: pedido.cantidad,
        nombre_cliente: pedido.cliente_nombre ?? undefined,
        precio_unitario: pedido.precio_unitario ?? undefined,
        moneda: pedido.moneda,
        nota: `Pedido por WhatsApp #${id}${pedido.nota ? " - " + pedido.nota : ""}`,
      },
      categoriaSiEsNuevo
    );
    return { ok: true, mensaje: `Pedido #${id} aprobado y registrado como venta. ${resultado.mensaje}` };
  });
}

export async function rechazarPedidoPendiente(id: number, motivo?: string) {
  const pedido = await requierePedidoPendiente(id);
  const notaFinal = motivo ? `${pedido.nota ?? ""} [Rechazado: ${motivo}]`.trim() : null;
  await marcarPedidoResuelto(id, "rechazado", notaFinal);
  return { ok: true, mensaje: `Pedido #${id} rechazado.` };
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
  const productos = await all(`SELECT nombre, cantidad, precio_venta, moneda FROM productos ORDER BY nombre`);
  const prestamos_activos = await all(
    `SELECT prestamos.*, personas.nombre as persona_nombre FROM prestamos JOIN personas ON personas.id = prestamos.persona_id WHERE prestamos.estado != 'pagado' ORDER BY prestamos.fecha`
  );
  const canjes_pendientes = await all(
    `SELECT canjes.*, personas.nombre as persona_nombre FROM canjes JOIN personas ON personas.id = canjes.persona_id WHERE canjes.estado = 'pendiente' ORDER BY canjes.fecha`
  );
  const empleados = await all(`SELECT nombre, descuento_pct, telefono FROM personas WHERE es_empleado = 1 ORDER BY nombre`);
  return { productos, prestamos_activos, canjes_pendientes, empleados };
}

interface FiltrosVentas {
  desde?: string;
  hasta?: string;
  nombre_producto?: string;
  nombre_cliente?: string;
}

// Todas las ventas (movimientos de salida) que cumplen los filtros, de la mas nueva a la mas vieja.
async function buscarVentas(args: FiltrosVentas) {
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
    `SELECT movimientos_stock.*, productos.nombre as producto_nombre, productos.costo as producto_costo, personas.nombre as persona_nombre
     FROM movimientos_stock
     JOIN productos ON productos.id = movimientos_stock.producto_id
     LEFT JOIN personas ON personas.id = movimientos_stock.persona_id
     WHERE ${condiciones.join(" AND ")}
     ORDER BY movimientos_stock.fecha DESC`,
    params
  );
}

export async function consultarVentas(args: FiltrosVentas) {
  const filas = await buscarVentas(args);

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
      venta_id: f.id,
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
export async function listarMovimientosVenta(args: FiltrosVentas) {
  return buscarVentas(args);
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

// Borra la memoria de la conversacion de un usuario (comando /reiniciar del bot, o si alguna
// vez hay que destrabar manualmente una conversacion que quedo en mal estado). No toca ningun
// dato de negocio (ventas, stock, etc.), solo lo que el bot "recuerda" haber charlado.
export async function reiniciarConversacion(usuarioId: string): Promise<void> {
  await guardarHistorialConversacion(usuarioId, []);
}

// Cuanto tiempo se respeta el turno de un mensaje antes de considerarlo abandonado (ej: la
// funcion de Vercel se corto por un crash). Tiene que ser MAS que lo maximo que puede durar una
// respuesta (maxDuration de 60 s en vercel.json): si fuera menos, un segundo mensaje podria
// "robar" el turno mientras el primero todavia esta trabajando, y se procesarian en paralelo.
const SEGUNDOS_VENCIMIENTO_BLOQUEO = 70;

// Intenta tomar el "turno" para procesar un mensaje de esta persona. Si lo consigue (nadie mas
// lo tenia, o el que estaba lo dejo abandonado) devuelve un token que identifica ESTE turno; si
// otro mensaje de la misma persona se esta procesando ahora mismo, devuelve null. Siempre
// liberar el turno con liberarBloqueo(usuarioId, token) al terminar (en un finally).
export async function intentarBloquear(usuarioId: string): Promise<string | null> {
  const token = randomUUID();
  const info = await run(
    `INSERT INTO bloqueos_conversacion (usuario_id, bloqueado_en, token) VALUES (?, datetime('now','localtime'), ?)
     ON CONFLICT(usuario_id) DO UPDATE SET bloqueado_en = excluded.bloqueado_en, token = excluded.token
     WHERE bloqueos_conversacion.bloqueado_en < datetime('now','localtime','-${SEGUNDOS_VENCIMIENTO_BLOQUEO} seconds')`,
    [usuarioId, token]
  );
  return info.changes > 0 ? token : null;
}

// Solo borra el bloqueo si sigue siendo el de este turno: si este mensaje tardo de mas y otro ya
// tomo el turno, no se lo sacamos.
export async function liberarBloqueo(usuarioId: string, token: string): Promise<void> {
  await run(`DELETE FROM bloqueos_conversacion WHERE usuario_id = ? AND token = ?`, [usuarioId, token]);
}

// Devuelve true si YA se habia procesado este update_id de Telegram (para no duplicar
// acciones si Telegram reintenta un mensaje). Si es la primera vez, lo marca y devuelve false.
// (Si la base no responde, el error sale para afuera: no hay que confundir "no me pude conectar"
// con "ya lo procese", porque eso tiraria el mensaje a la basura sin avisar.)
export async function yaProcesadoUpdate(updateId: number): Promise<boolean> {
  const info = await run(`INSERT OR IGNORE INTO updates_procesados (update_id) VALUES (?)`, [updateId]);
  return info.changes === 0;
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

// Las respuestas fijas cortan ANTES de la IA, asi que solo se usan para mensajes cortos: en uno
// largo tipo "vendi 2 iphone a Juan, che cual era el horario?" lo importante es la venta, y si
// contestaramos solo el horario la venta no se registraria nunca.
const MAX_PALABRAS_RESPUESTA_FIJA = 8;

// Minusculas, sin tildes y sin signos de puntuacion: "¿Dirección?" -> "direccion".
function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Busca la primera respuesta activa cuyo disparador aparezca en el mensaje empezando en una
// palabra (asi "horario" coincide con "horarios", pero "hola" no salta adentro de "cholas"). Sin
// importar mayusculas ni tildes. null si ninguna coincide o si el mensaje es largo.
export async function buscarRespuestaPredefinida(texto: string): Promise<string | null> {
  const textoNormalizado = normalizarTexto(texto);
  if (!textoNormalizado || textoNormalizado.split(" ").length > MAX_PALABRAS_RESPUESTA_FIJA) return null;
  const activas = await all(`SELECT * FROM respuestas_predefinidas WHERE activo = 1`);
  const conEspacioAdelante = ` ${textoNormalizado}`;
  const match = activas.find((r) => {
    const disparador = normalizarTexto(String(r.disparador));
    return disparador.length > 0 && conEspacioAdelante.includes(` ${disparador}`);
  });
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

// Igual que registrarLog, pero si falla solo lo anota en consola: que no se pueda guardar un log
// nunca tiene que romper la respuesta al usuario.
export async function registrarLogSeguro(entrada: Parameters<typeof registrarLog>[0]) {
  try {
    await registrarLog(entrada);
  } catch (e) {
    console.error("No se pudo guardar el log:", e);
  }
}

export async function listarLogs(limite?: number) {
  const n = Number.isFinite(limite) ? Math.min(Math.max(Math.trunc(limite!), 1), 500) : 100;
  const filas = await all(`SELECT * FROM logs_bot ORDER BY id DESC LIMIT ?`, [n]);
  return filas.map((f) => ({ ...f, herramientas_usadas: f.herramientas_usadas ? JSON.parse(f.herramientas_usadas) : [] }));
}

// ---------- mantenimiento ----------

// Borra registros que ya no sirven para que esas tablas no crezcan para siempre. Telegram solo
// reintenta un update durante unas horas, asi que 7 dias de updates_procesados sobra; los logs
// se guardan 90 dias (el panel igual muestra solo los ultimos). Lo llama el chequeo periodico.
// ---------- fecha de Argentina ----------
// La base (Turso) corre en hora UTC, asi que su "localtime" no es la hora de aca: a las 22 hs
// de Argentina ya es el dia siguiente. Para los dashboards el "hoy" se calcula en hora argentina
// y las fechas guardadas se corren a esa hora antes de agruparlas por dia.
const ZONA_ARGENTINA = "America/Argentina/Buenos_Aires";

export function hoyEnArgentina(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_ARGENTINA, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Diferencia de la hora argentina con UTC, en segundos (hoy: -10800, o sea -3 hs).
function desfaseArgentina(fecha = new Date()): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: ZONA_ARGENTINA, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(fecha)
      .map((x) => [x.type, x.value])
  );
  const comoUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((comoUtc - fecha.getTime()) / 1000 / 60) * 60;
}

// Modificador de SQLite que pasa una fecha guardada (en la hora local de la base, sea cual sea)
// a la hora argentina. En Turso queda "-10800 seconds"; con una base local en hora argentina, "+0".
async function modificadorArgentina(): Promise<string> {
  const r = await get(`SELECT CAST(strftime('%s', datetime('now','localtime')) AS INTEGER) - CAST(strftime('%s','now') AS INTEGER) as desfase`);
  const corrimiento = desfaseArgentina() - Math.round(Number(r?.desfase ?? 0) / 60) * 60;
  return `${corrimiento >= 0 ? "+" : ""}${corrimiento} seconds`;
}

// ---------- gastos del negocio ----------
// Lo que se paga y no es mercaderia (la mercaderia entra por agregarProducto). Con esto el
// dashboard Financiero calcula la ganancia real y el flujo de caja.

export const CATEGORIAS_GASTO = ["Alquiler", "Sueldos", "Servicios", "Envíos", "Publicidad", "Impuestos", "Comisiones", "Otros"] as const;

// Si no se dice la categoria, se adivina por el concepto ("pague el alquiler" -> Alquiler).
function categoriaDeGasto(concepto: string): string {
  const t = normalizarTexto(concepto);
  if (/alquiler|expensa/.test(t)) return "Alquiler";
  if (/sueldo|salario|aguinaldo|jornal|empleado|vacaciones/.test(t)) return "Sueldos";
  if (/\bluz\b|\bagua\b|\bgas\b|internet|telefono|celular de la empresa|abono|edenor|edesur|metrogas|servicio/.test(t)) return "Servicios";
  if (/envio|flete|correo|andreani|oca\b|cadete|moto|uber|nafta|combustible/.test(t)) return "Envíos";
  if (/publicidad|anuncio|ads\b|instagram|facebook|meta\b|google|marketing|promocion/.test(t)) return "Publicidad";
  if (/impuesto|afip|arca|iibb|ingresos brutos|monotributo|iva\b|tasa|municipal/.test(t)) return "Impuestos";
  if (/comision|mercado ?pago|posnet|tarjeta|banco|transferencia/.test(t)) return "Comisiones";
  return "Otros";
}

function validarCategoriaGasto(categoria: unknown, concepto: string): string {
  if (categoria == null || String(categoria).trim() === "") return categoriaDeGasto(concepto);
  const buscada = normalizarTexto(String(categoria));
  return CATEGORIAS_GASTO.find((c) => normalizarTexto(c) === buscada) ?? "Otros";
}

function validarFecha(fecha: unknown): string | null {
  if (fecha == null || String(fecha).trim() === "") return null;
  const f = String(fecha).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || Number.isNaN(Date.parse(f))) throw new Error(`Fecha invalida: "${f}". Tiene que ser AAAA-MM-DD.`);
  return f;
}

export async function registrarGasto(args: { concepto: string; monto: number; moneda?: string; categoria?: string; fecha?: string; nota?: string }) {
  const concepto = String(args.concepto ?? "").trim();
  if (!concepto) throw new Error("Falta el concepto del gasto (ej: alquiler, sueldo, envio).");
  const monto = Number(args.monto);
  if (!Number.isFinite(monto) || monto <= 0) throw new Error("El monto del gasto tiene que ser un numero mayor a 0.");
  const moneda = args.moneda === "USD" ? "USD" : "ARS";
  const categoria = validarCategoriaGasto(args.categoria, concepto);
  const fecha = validarFecha(args.fecha) ?? hoyEnArgentina();
  const info = await run(
    `INSERT INTO gastos (fecha, concepto, categoria, monto, moneda, nota) VALUES (?, ?, ?, ?, ?, ?)`,
    [fecha, concepto, categoria, monto, moneda, args.nota ?? null]
  );
  const gasto = await get(`SELECT * FROM gastos WHERE id = ?`, [info.lastInsertRowid]);
  return { ok: true, gasto_id: gasto.id, mensaje: `Gasto registrado: ${concepto} (${categoria}) por ${monto} ${moneda} el ${gasto.fecha}.`, gasto };
}

export async function listarGastos(args: { desde?: string; hasta?: string } = {}) {
  const condiciones: string[] = [];
  const params: any[] = [];
  if (args.desde) {
    condiciones.push(`date(fecha) >= date(?)`);
    params.push(validarFecha(args.desde));
  }
  if (args.hasta) {
    condiciones.push(`date(fecha) <= date(?)`);
    params.push(validarFecha(args.hasta));
  }
  return all(`SELECT * FROM gastos ${condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : ""} ORDER BY date(fecha) DESC, id DESC`, params);
}

export async function consultarGastos(args: { desde?: string; hasta?: string }) {
  const gastos = await listarGastos(args);
  const totales: Record<string, number> = {};
  for (const g of gastos) totales[g.moneda] = (totales[g.moneda] ?? 0) + g.monto;
  return { total_gastos: gastos.length, totales_por_moneda: totales, ultimos: gastos.slice(0, 30) };
}

export async function anularGasto(args: { gasto_id: number }) {
  const id = Number(args.gasto_id);
  const gasto = await get(`SELECT * FROM gastos WHERE id = ?`, [id]);
  if (!gasto) throw new Error(`No existe ningun gasto con id #${id} (buscalo con consultar_gastos).`);
  await run(`DELETE FROM gastos WHERE id = ?`, [id]);
  return { ok: true, mensaje: `Gasto anulado: ${gasto.concepto} por ${gasto.monto} ${gasto.moneda} del ${gasto.fecha}.` };
}

// ---------- objetivos mensuales ----------
// Cada fila vale desde su mes hasta el mes en que se cargue otra.

export async function listarObjetivos() {
  return all(`SELECT * FROM objetivos ORDER BY mes`);
}

export async function guardarObjetivos(args: { mes?: string; facturacion?: number | null; ganancia?: number | null; unidades?: number | null; moneda?: string }) {
  const mes = String(args.mes ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error(`Mes invalido: "${mes}". Tiene que ser AAAA-MM.`);
  const numero = (v: unknown) => {
    if (v == null || String(v).trim() === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error("Los objetivos tienen que ser numeros positivos.");
    return n;
  };
  const moneda = args.moneda === "ARS" ? "ARS" : "USD";
  await run(
    `INSERT INTO objetivos (mes, facturacion, ganancia, unidades, moneda, actualizado_en) VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(mes) DO UPDATE SET facturacion = excluded.facturacion, ganancia = excluded.ganancia, unidades = excluded.unidades, moneda = excluded.moneda, actualizado_en = excluded.actualizado_en`,
    [mes, numero(args.facturacion), numero(args.ganancia), numero(args.unidades) == null ? null : Math.round(numero(args.unidades)!), moneda]
  );
  return { ok: true, objetivos: await listarObjetivos() };
}

// ---------- datos para los dashboards del Resumen ----------
// Todo agrupado por dia (y producto/cliente en las ventas), de los ultimos 25 meses: el panel
// arma con esto cualquier periodo, las comparaciones con el periodo anterior y los graficos.
// Los montos van en su moneda original; el panel los pasa a una sola con el dolar blue.
export async function datosDashboard() {
  const hoy = hoyEnArgentina();
  const mod = await modificadorArgentina();
  const [anio, mes] = hoy.split("-").map(Number);
  const desde = new Date(Date.UTC(anio, mes - 1 - 24, 1)).toISOString().slice(0, 10);
  const [ventas, compras, gastos, prestamos, objetivos, stock, porCobrar, canjes] = await Promise.all([
    all(
      `SELECT date(m.fecha, ?) as fecha, m.producto_id, p.nombre as producto, COALESCE(p.categoria, 'Otros') as categoria, m.persona_id as cliente_id,
              COALESCE(m.moneda, 'ARS') as moneda, COALESCE(p.moneda, 'USD') as costo_moneda,
              SUM(m.cantidad) as unidades, COUNT(*) as operaciones,
              SUM(CASE WHEN m.precio_unitario IS NOT NULL THEN m.precio_unitario * m.cantidad ELSE 0 END) as facturado,
              SUM(CASE WHEN m.precio_unitario IS NOT NULL AND p.costo IS NOT NULL THEN m.precio_unitario * m.cantidad ELSE 0 END) as facturado_con_costo,
              SUM(CASE WHEN m.precio_unitario IS NOT NULL AND p.costo IS NOT NULL THEN p.costo * m.cantidad ELSE 0 END) as costo
       FROM movimientos_stock m JOIN productos p ON p.id = m.producto_id
       WHERE m.tipo = 'salida' AND date(m.fecha, ?) >= ?
       GROUP BY 1, m.producto_id, m.persona_id, COALESCE(m.moneda, 'ARS')`,
      [mod, mod, desde]
    ),
    // Compras de mercaderia: lo que entro al stock a su costo. En la reposicion automatica (compra
    // y venta en el momento) el precio guardado es el de venta, asi que ahi se usa el costo.
    all(
      `SELECT date(m.fecha, ?) as fecha, COALESCE(p.moneda, 'USD') as moneda,
              SUM(m.cantidad * COALESCE(CASE WHEN m.nota = ? THEN NULL ELSE m.precio_unitario END, p.costo, 0)) as monto
       FROM movimientos_stock m JOIN productos p ON p.id = m.producto_id
       WHERE m.tipo = 'entrada' AND date(m.fecha, ?) >= ?
       GROUP BY 1, COALESCE(p.moneda, 'USD')`,
      [mod, NOTA_REPOSICION_AUTOMATICA, mod, desde]
    ),
    // Los gastos ya se guardan con la fecha de Argentina (ver registrarGasto).
    all(`SELECT id, date(fecha) as fecha, concepto, categoria, monto, moneda, nota FROM gastos WHERE date(fecha) >= ? ORDER BY date(fecha) DESC, id DESC`, [desde]),
    all(
      `SELECT date(fecha, ?) as fecha, 'otorgado' as tipo, moneda, SUM(monto_original) as monto FROM prestamos WHERE date(fecha, ?) >= ? GROUP BY 1, moneda
       UNION ALL
       SELECT date(pp.fecha, ?) as fecha, 'cobrado' as tipo, pr.moneda, SUM(pp.monto) as monto FROM pagos_prestamo pp JOIN prestamos pr ON pr.id = pp.prestamo_id
       WHERE date(pp.fecha, ?) >= ? GROUP BY 1, pr.moneda`,
      [mod, mod, desde, mod, mod, desde]
    ),
    listarObjetivos(),
    all(
      `SELECT COALESCE(moneda, 'USD') as moneda, SUM(cantidad) as unidades, SUM(COALESCE(costo, 0) * cantidad) as al_costo, SUM(COALESCE(precio_venta, 0) * cantidad) as a_precio_venta
       FROM productos WHERE cantidad > 0 GROUP BY COALESCE(moneda, 'USD')`
    ),
    all(`SELECT moneda, SUM(monto_pendiente) as monto, COUNT(*) as cantidad FROM prestamos WHERE estado != 'pagado' GROUP BY moneda`),
    get(`SELECT COUNT(*) as n FROM canjes WHERE estado = 'pendiente'`),
  ]);
  return {
    hoy,
    zona_horaria: ZONA_ARGENTINA,
    desde,
    ventas,
    compras,
    gastos,
    prestamos,
    objetivos,
    posicion: { stock, por_cobrar: porCobrar, canjes_pendientes: Number(canjes?.n ?? 0) },
  };
}

export async function limpiarRegistrosViejos() {
  const updates = await run(`DELETE FROM updates_procesados WHERE procesado_en < datetime('now','localtime','-7 days')`);
  const logs = await run(`DELETE FROM logs_bot WHERE fecha < datetime('now','localtime','-90 days')`);
  return { updates_borrados: updates.changes, logs_borrados: logs.changes };
}

// Todas las tablas con datos del negocio (no las internas del bot, como el historial de chat o
// los bloqueos). Lo usan el backup local (backup.ts) y la descarga de backup del panel.
const TABLAS_BACKUP = [
  "personas",
  "productos",
  "movimientos_stock",
  "prestamos",
  "pagos_prestamo",
  "canjes",
  "pedidos_pendientes",
  "respuestas_predefinidas",
  "gastos",
  "objetivos",
];

export async function exportarTodo(): Promise<Record<string, any[]>> {
  const datos: Record<string, any[]> = {};
  for (const tabla of TABLAS_BACKUP) {
    datos[tabla] = await all(`SELECT * FROM ${tabla}`);
  }
  return datos;
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
