import type Anthropic from "@anthropic-ai/sdk";
import * as repo from "./repo.js";

// ---------- Anthropic tool schema + dispatcher ----------
// La logica real vive en repo.ts. Este archivo solo describe las herramientas para Claude
// y las conecta con las funciones correspondientes.

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "agregar_producto",
    description:
      "Da de alta un producto nuevo o suma stock a uno existente (misma logica para 'compre X', 'llegaron X', 'tengo X unidades nuevas'). Si el producto ya existe, suma la cantidad al stock actual. El costo de compra conviene pedirlo si no lo dieron (sirve para la ganancia); el precio de venta NO hace falta preguntarlo, se puede definir despues. La categoria se infiere sola con IA a partir del nombre, no preguntarla.",
    input_schema: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre del producto, ej 'iPhone 12 128GB'" },
        cantidad: { type: "number", description: "Cantidad de unidades que entran" },
        costo: { type: "number", description: "Costo unitario de compra. Si no te lo dijeron, preguntalo." },
        precio_venta: { type: "number", description: "Precio de venta por unidad, SOLO si te lo dieron espontaneamente. No preguntarlo." },
        moneda: {
          type: "string",
          enum: ["USD", "ARS"],
          description: "Moneda del costo y precio_venta. Si no se especifica, asumir USD (es lo mas comun en este rubro).",
        },
        categoria: { type: "string", description: "Dejar vacio salvo que el usuario la mencione explicitamente: se infiere sola con IA." },
        nota: { type: "string", description: "Nota libre opcional" },
      },
      required: ["nombre", "cantidad"],
    },
  },
  {
    name: "ajustar_stock",
    description:
      "Corrige manualmente la cantidad de stock de un producto sin que sea ni una compra ni una venta (ej: se rompio uno, conteo fisico distinto al del sistema). El delta puede ser negativo.",
    input_schema: {
      type: "object",
      properties: {
        nombre_producto: { type: "string" },
        cantidad_delta: { type: "number", description: "Diferencia a aplicar, puede ser negativa" },
        motivo: { type: "string" },
      },
      required: ["nombre_producto", "cantidad_delta"],
    },
  },
  {
    name: "registrar_venta",
    description:
      "Registra la venta o entrega de productos a un cliente/empleado, descontando stock. Si el cliente es un empleado con precio amigo y no se especifica precio, se aplica el descuento automaticamente. Usar SIEMPRE que se cuenta una venta, incluso si no hay stock cargado de ese producto o no alcanza: se repone automaticamente la diferencia (como si se hubiera comprado justo antes de vender) para que el stock nunca quede negativo. Nunca rechazar ni preguntar si 'hay stock' antes de registrar una venta.",
    input_schema: {
      type: "object",
      properties: {
        nombre_producto: { type: "string" },
        cantidad: { type: "number" },
        nombre_cliente: { type: "string", description: "Nombre de la persona que compra (opcional)" },
        precio_unitario: { type: "number", description: "Precio unitario cobrado, si no se pasa se usa el precio de lista (con descuento si aplica)" },
        moneda: { type: "string", enum: ["ARS", "USD"] },
        nota: { type: "string" },
      },
      required: ["nombre_producto", "cantidad"],
    },
  },
  {
    name: "agregar_empleado",
    description: "Da de alta o actualiza a una persona como 'empleado' (cliente mayorista con precio amigo/descuento fijo).",
    input_schema: {
      type: "object",
      properties: {
        nombre: { type: "string" },
        telefono: { type: "string" },
        descuento_pct: { type: "number", description: "Porcentaje de descuento sobre el precio de venta, ej 10" },
        nota: { type: "string" },
      },
      required: ["nombre"],
    },
  },
  {
    name: "listar_empleados",
    description: "Devuelve la lista completa de empleados (clientes con precio amigo) y su descuento.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "registrar_prestamo",
    description: "Registra un prestamo de dinero (en dolares o pesos) a una persona.",
    input_schema: {
      type: "object",
      properties: {
        persona: { type: "string" },
        monto: { type: "number" },
        moneda: { type: "string", enum: ["USD", "ARS"] },
        interes_pct: { type: "number", description: "Interes en porcentaje, si aplica" },
        nota: { type: "string" },
      },
      required: ["persona", "monto", "moneda"],
    },
  },
  {
    name: "registrar_pago_prestamo",
    description:
      "Registra un pago/devolucion de un prestamo de una persona. Se aplica automaticamente contra el/los prestamos activos mas viejos de esa persona.",
    input_schema: {
      type: "object",
      properties: {
        persona: { type: "string" },
        monto: { type: "number" },
        nota: { type: "string" },
      },
      required: ["persona", "monto"],
    },
  },
  {
    name: "agregar_canje",
    description:
      "Registra un 'plan canje': se recibe un celular en cierto estado, se lo toma a un precio, y de esa operacion sale una diferencia a favor del negocio o del cliente (en plata y/o en otro producto entregado a cambio). Usar cuando cuentan que tomaron un celular usado como parte de pago de otro, o que hicieron un canje/trade-in.",
    input_schema: {
      type: "object",
      properties: {
        persona: { type: "string" },
        descripcion: { type: "string", description: "El celular que se recibe, ej: 'iPhone 11 128GB negro'" },
        condicion: { type: "string", description: "Estado/condicion del equipo recibido, ej: 'excelente', 'con detalles', 'para repuestos'" },
        valor_tomado: { type: "number", description: "Precio al que se toma el equipo recibido" },
        moneda_valor: { type: "string", enum: ["ARS", "USD"], description: "Moneda del valor_tomado" },
        producto_entregado: { type: "string", description: "Que producto se entrega a cambio, si lo hay (ej: 'iPhone 13 128GB')" },
        saldo_monto: {
          type: "number",
          description:
            "Diferencia de plata que queda, si la hay. POSITIVO si el cliente tiene que dar esa plata (a favor del negocio). NEGATIVO si el negocio le debe esa plata al cliente.",
        },
        saldo_moneda: { type: "string", enum: ["ARS", "USD"], description: "Moneda del saldo_monto" },
        nota: { type: "string" },
      },
      required: ["persona", "descripcion"],
    },
  },
  {
    name: "actualizar_canje",
    description: "Cambia el estado de un canje ya registrado a 'saldado' (cuando ya se entrego/cobro la diferencia pendiente) o de vuelta a 'pendiente'.",
    input_schema: {
      type: "object",
      properties: {
        descripcion: { type: "string", description: "Texto para buscar el canje (puede ser parcial)" },
        persona: { type: "string", description: "Nombre de la persona, para desambiguar" },
        estado: { type: "string", enum: ["pendiente", "saldado"] },
        nota: { type: "string" },
      },
      required: ["descripcion", "estado"],
    },
  },
  {
    name: "consultar_stock",
    description: "Consulta el stock actual. Si no se especifica producto, devuelve todo el inventario.",
    input_schema: {
      type: "object",
      properties: {
        nombre_producto: { type: "string" },
      },
    },
  },
  {
    name: "consultar_persona",
    description: "Consulta todo lo relacionado a una persona: prestamos (activos e historicos), canjes hechos, y compras recientes.",
    input_schema: {
      type: "object",
      properties: { nombre: { type: "string" } },
      required: ["nombre"],
    },
  },
  {
    name: "consultar_estado_general",
    description:
      "Devuelve una foto general de todo el negocio: stock completo, prestamos activos, canjes pendientes y lista de empleados. Usar cuando preguntan algo general tipo 'como estamos', 'que tengo pendiente', 'resumen'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "consultar_ventas",
    description:
      "Control de ventas: totales de lo vendido (unidades, monto facturado por moneda, ganancia estimada) y detalle de las ultimas ventas. Usar para preguntas como 'cuanto vendi', 'cuanta plata hice', 'cuantas ventas tuve esta semana/mes', 'cuanto le vendi a Juan', 'como van las ventas de iPhone 12'. Si no se filtra por fecha, cuenta TODO el historico.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha desde (inclusive), formato YYYY-MM-DD" },
        hasta: { type: "string", description: "Fecha hasta (inclusive), formato YYYY-MM-DD" },
        nombre_producto: { type: "string" },
        nombre_cliente: { type: "string" },
      },
    },
  },
];

// ---------- herramientas del bot de CLIENTES (WhatsApp) ----------
// Deliberadamente un set chiquito: un cliente puede consultar stock/precio y armar un pedido,
// nada mas. Ninguna herramienta de venta/stock/prestamo/canje "real" esta en esta lista, asi
// que aunque alguien intente pedirle al modelo que las use, no puede: no existen en su menu.
export const toolDefinitionsCliente: Anthropic.Tool[] = [
  {
    name: "consultar_stock_publico",
    description: "Consulta si hay stock de un producto y su precio de venta. Si no se especifica producto, devuelve el catalogo completo disponible.",
    input_schema: {
      type: "object",
      properties: { nombre_producto: { type: "string" } },
    },
  },
  {
    name: "crear_pedido",
    description:
      "Registra el pedido de un cliente. OJO: esto NO es una venta todavia, queda pendiente de que el negocio lo confirme (el cliente tiene que saber que es un pedido, no una compra cerrada). Usar cuando el cliente ya dijo claramente que producto y cantidad quiere.",
    input_schema: {
      type: "object",
      properties: {
        producto: { type: "string" },
        cantidad: { type: "number" },
        nota: { type: "string", description: "Cualquier detalle extra que haya dado el cliente (color, para cuando lo necesita, etc.)" },
      },
      required: ["producto", "cantidad"],
    },
  },
];

const dispatch: Record<string, (args: any) => any | Promise<any>> = {
  agregar_producto: repo.agregarProducto,
  ajustar_stock: repo.ajustarStock,
  registrar_venta: repo.registrarVenta,
  agregar_empleado: repo.agregarEmpleado,
  listar_empleados: async () => ({ empleados: await repo.listarEmpleados() }),
  registrar_prestamo: repo.registrarPrestamo,
  registrar_pago_prestamo: repo.registrarPagoPrestamo,
  agregar_canje: repo.agregarCanje,
  actualizar_canje: repo.actualizarCanje,
  consultar_stock: repo.consultarStock,
  consultar_persona: repo.consultarPersona,
  consultar_estado_general: () => repo.consultarEstadoGeneral(),
  consultar_ventas: repo.consultarVentas,
  consultar_stock_publico: repo.consultarStockPublico,
};

export interface ContextoHerramienta {
  usuarioId: string;
  nombreUsuario: string;
}

export async function ejecutarHerramienta(nombre: string, args: any, contexto?: ContextoHerramienta): Promise<any> {
  try {
    // crear_pedido es un caso especial: el telefono/nombre del cliente NO se lo pedimos al
    // modelo (podria inventarlo o confundirlo), lo tomamos directo de quien esta escribiendo.
    if (nombre === "crear_pedido") {
      if (!contexto) return { ok: false, error: "Falta contexto del cliente para crear el pedido." };
      return await repo.crearPedidoPendiente({
        cliente_telefono: contexto.usuarioId,
        cliente_nombre: contexto.nombreUsuario,
        producto: args?.producto,
        cantidad: args?.cantidad,
        nota: args?.nota,
      });
    }
    const fn = dispatch[nombre];
    if (!fn) return { ok: false, error: `Herramienta desconocida: ${nombre}` };
    return await fn(args ?? {});
  } catch (e: any) {
    return { ok: false, error: e.message ?? String(e) };
  }
}
