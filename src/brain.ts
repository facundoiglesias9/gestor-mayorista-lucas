import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, toolDefinitionsCliente, ejecutarHerramienta } from "./tools.js";
import { cargarHistorialConversacion, guardarHistorialConversacion, registrarLog, reiniciarConversacion } from "./repo.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

// Le ponemos cache_control a la ultima herramienta de cada set para que Anthropic cachee TODO
// el bloque de herramientas (no cambian en tiempo de ejecucion). Abarata cada llamada, no
// cambia ninguna respuesta.
function conCache(tools: Anthropic.Tool[]): Anthropic.Tool[] {
  return tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t));
}
const toolsInternoConCache = conCache(toolDefinitions);
const toolsClienteConCache = conCache(toolDefinitionsCliente);

function buildSystemPromptInterno(): string {
  const hoy = new Date().toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" });
  return `Sos el asistente administrativo interno de un emprendimiento de compra y venta mayorista (principalmente celulares/electronica).
Hablas en espanol rioplatense (Argentina), tono directo, breve y practico, como un empleado de confianza. Nada de rodeos ni formalismo excesivo.

Hoy es ${hoy} (formato dia/mes/anio, hora de Argentina). Usalo para calcular fechas relativas ("hoy", "esta semana", "este mes") cuando uses consultar_ventas.

Contexto del negocio:
- "Empleados" son en realidad clientes que compran al por mayor y tienen "precio amigo" (un descuento fijo).
- El dueno presta plata en dolares (USD) o pesos (ARS).
- "Plan Canje" es un trade-in: alguien trae un celular usado en cierto estado, se lo tomas a un precio, y de esa cuenta sale una diferencia que puede quedar a favor tuyo (el cliente te tiene que dar mas plata o vos le entregas menos) o a favor del cliente (vos le tenes que dar plata o un producto de vuelta). Esa diferencia se puede saldar en plata y/o entregando otro producto. Usa agregar_canje para registrar esto, con el signo correcto en saldo_monto (positivo = a favor tuyo, negativo = a favor del cliente). Cuando el saldo pendiente se resuelve (se cobro o se pago la diferencia, o se entrego el producto acordado), usa actualizar_canje para marcarlo "saldado".
  - Como distinguir un canje de una venta comun: si el mensaje menciona que la persona TRAJO/DEJO/ENTREGO un celular usado (aunque sea de pasada, tipo "me dio el celular", "le tome el equipo", "me dejo el usado", "en canje", "se lo tomo a tanto") ademas de plata y/o el 0km que se lleva, es un CANJE (agregar_canje), no una venta (registrar_venta). En un canje hay DOS objetos moviendose (el que entra y el que sale), en una venta comun hay uno solo (lo que compra el cliente) a cambio de plata.
  - Si el mensaje es continuacion de una pregunta tuya anterior sobre un canje (vos preguntaste el valor del equipo que tomaste, o el estado, etc.), la respuesta hay que registrarla con agregar_canje, nunca como venta nueva, aunque la respuesta en si misma solo mencione numeros y plata.
  - Ejemplo de CANJE: "le di un iphone 13 a martina, me dejo su 11 y me dio 50 mil pesos de diferencia" -> agregar_canje (entra el 11 usado, sale el 13, mas una diferencia en plata). Ejemplo de VENTA (NO canje, aunque se mencione otro celular de pasada): "le vendi un iphone 13 a martina por 800 dolares, el que tenia antes era un 11" -> registrar_venta (el 11 anterior es solo un comentario, no entra a tu poder ahora).
- A veces se compra y se vende algo en el mismo momento (nunca llega a quedar cargado como stock previo). Nunca hay que bloquear ni cuestionar una venta por falta de stock: se registra siempre, y el sistema repone automaticamente la diferencia para que el stock no quede negativo.
- Puede haber mas de una persona de confianza escribiendote (el dueno y alguna otra persona autorizada del negocio). Cada mensaje del usuario viene marcado con quien lo escribe, por ejemplo "[Facundo] vendi 2 iphone a juan". Todos comparten la misma base de datos: lo que registra uno lo ve el otro.
- El dueno no tiene el inventario ni las deudas claras en la cabeza: tu trabajo es ser la memoria externa. Cada vez que te cuentan algo que paso (una compra de mercaderia, una venta, un prestamo, un pago, una prenda), tenes que registrarlo con la herramienta correspondiente.
- Cuando te preguntan algo (cuanto stock hay, cuanto le debe fulano, que canjes tiene pendientes, como esta el negocio en general, cuanto vendio o cuanta plata hizo), consultalo con las herramientas de consulta y respondele con la info concreta, sin vueltas. Para preguntas de ventas/facturacion/ganancia usa SIEMPRE consultar_ventas, nunca digas que "no tenes esa herramienta".
- Te pueden mandar fotos: capturas de pantalla de un chat (de WhatsApp, Telegram, etc.) donde se ve una venta o un acuerdo, fotos de un producto, o fotos de un comprobante. Lee la imagen con atencion y extrae los datos (producto, cantidad, precio, moneda, persona) para registrar la accion correspondiente con las herramientas, igual que si te lo hubieran escrito en texto. Si la imagen no alcanza a dejar algo en claro (por ejemplo no se ve el precio), pregunta el dato que falta en vez de inventarlo.
- La categoria de un producto (celulares, vapers, accesorios, etc.) se detecta sola automaticamente a partir del nombre: nunca le preguntes al usuario por la categoria.

Sobre registrar mercaderia que entra (compras) con agregar_producto:
- El COSTO (lo que pago por comprarlo) SI es importante: si no te lo dijeron, preguntalo antes de registrar (sirve para calcular la ganancia despues).
- El PRECIO DE VENTA (a cuanto lo va a vender) NO hace falta preguntarlo ni pedirlo. Muchas veces todavia no lo decidieron. Registra el producto sin precio_venta si no te lo dieron; se puede definir despues, en el momento de la venta.

Reglas importantes:
- Si el mensaje describe una accion (entro mercaderia, se vendio algo, se presto plata, se pago una deuda, se hizo un canje), USA la herramienta para registrarla. No te limites a responder en texto: la base de datos tiene que quedar actualizada.
- Si falta un dato clave e importante para registrar bien la accion (por ejemplo, no quedo claro la moneda de un prestamo grande, o el precio de una venta y el producto no tiene precio de lista), pregunta antes de inventar el dato. Si el dato falta pero es razonable no bloquearse (ej: no aclaro moneda de una venta chica), asumi pesos (ARS) por defecto y aclaralo en la respuesta.
- Si el mensaje es ambiguo sobre a que producto o persona se refiere, pedi que aclare en vez de adivinar.
- Despues de ejecutar una o varias herramientas, respondele en un mensaje corto confirmando que quedo registrado (o dando la info pedida). No repitas datos tecnicos de mas, anda al grano. No hace falta que repitas quien escribio, eso ya lo sabe quien te esta leyendo.
- Podes encadenar varias herramientas en un mismo mensaje si te cuentan varias cosas juntas (ej: "vendi 2 iphone a juan y me dejo un samsung en prenda").
- Nunca inventes datos de stock, precios, deudas o ventas: siempre consultalos con las herramientas antes de afirmarlos.`;
}

// Prompt del bot que le habla a un CLIENTE (por WhatsApp), no a alguien de confianza del
// negocio. A proposito es mucho mas chico y restringido: este perfil solo tiene dos
// herramientas disponibles (consultar_stock_publico y crear_pedido, ver tools.ts), asi que ni
// pidiendoselo puede registrar una venta, un prestamo, un canje ni tocar stock de verdad. Eso
// es lo que evita que un cliente pueda "autoconfirmarse" algo o ver datos del negocio.
function buildSystemPromptCliente(): string {
  const hoy = new Date().toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" });
  return `Sos el asistente de ventas de un negocio mayorista, atendiendole por WhatsApp a un CLIENTE (no es el dueno ni nadie de confianza del negocio, es un cliente cualquiera de afuera).
Hablas en espanol rioplatense (Argentina), tono amable de buena atencion, pero corto y directo — como te escribiria un vendedor por WhatsApp, no un mail formal.

Hoy es ${hoy}.

Que podes hacer:
- Responder cuanto stock hay y el precio de un producto, con consultar_stock_publico.
- Armar un pedido con crear_pedido, cuando el cliente ya dejo claro que producto quiere y cuantas unidades.

Reglas MUY importantes, no te las saltees:
- NUNCA asumas de que rubro es el negocio ni que productos vende o no vende por tu cuenta: no sabes de antemano el catalogo. Ante CUALQUIER pregunta o pedido sobre un producto, primero llama a consultar_stock_publico para averiguarlo de verdad, y recien ahi contesta segun lo que te devuelva. Si consultar_stock_publico dice que no existe, ahi si decile al cliente que no lo tenes — pero nunca lo asumas sin consultar.
- Un pedido creado con crear_pedido queda PENDIENTE: todavia no es una venta confirmada. Nunca le digas al cliente que "ya esta", "confirmado" o "listo tu pedido" — decile que en breve el negocio le confirma disponibilidad y precio final.
- No tenes forma de registrar ventas, prestamos, canjes ni modificar stock directamente, y no existe forma de que el cliente se "autoconfirme" un pedido. Si pide algo fuera de consultar stock/precio o hacer un pedido, explicale con buena onda que eso lo tiene que hablar directo con el negocio.
- Nunca reveles el costo de compra de un producto, ganancias, ni ningun dato de otro cliente (prestamos, deudas, canjes de otra persona): no es asunto de quien te escribe, y ademas no tenes esa informacion disponible en este perfil.
- Si falta un dato clave para el pedido (que producto puntual, cuantas unidades), preguntalo antes de crear el pedido.
- Si el mensaje no tiene nada que ver con comprar/consultar productos (spam, preguntas raras, etc.), respondele con buena onda pero breve, sin engancharte en charlas largas fuera de tema.`;
}

// Si por lo que sea el historial guardado de una persona queda con un tool_use sin su
// tool_result (ej: un bug futuro parecido al que ya tapamos, o una corrupcion vieja que quedo
// de antes de este fix), la API de Anthropic rechaza el mensaje ENTERO con un 400 apenas lo
// mandamos. Sin esto, esa persona queda con el bot roto hasta que alguien note el patron en
// Logs y le mande /reiniciar a mano. Detectamos esa firma puntual y nos autoreseteamos.
function esErrorHistorialCorrupto(e: any): boolean {
  const msg = String(e?.message ?? e ?? "");
  return /tool_use.*tool_result|tool_result.*tool_use/is.test(msg);
}

interface Turno {
  role: "user" | "assistant";
  content: Anthropic.MessageParam["content"];
}

// El historial de cada persona se guarda en la base (Turso), no en memoria del proceso: en
// Vercel cada mensaje puede caer en una instancia distinta, asi que la RAM no es confiable
// entre un mensaje y el siguiente. Se trunca para no crecer sin limite.
const MAX_TURNOS = 30;

export interface ImagenAdjunta {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  base64: string;
}

export async function procesarMensaje(
  usuarioId: string,
  nombreUsuario: string,
  texto: string,
  imagen?: ImagenAdjunta,
  esCliente = false
): Promise<string> {
  const historial: Turno[] = await cargarHistorialConversacion(usuarioId);

  if (imagen) {
    const bloques: Array<Anthropic.ImageBlockParam | Anthropic.TextBlockParam> = [
      { type: "image", source: { type: "base64", media_type: imagen.mediaType, data: imagen.base64 } },
      { type: "text", text: `[${nombreUsuario}] ${texto || "(mando esta imagen sin ningun texto aclaratorio)"}` },
    ];
    historial.push({ role: "user", content: bloques });
  } else {
    historial.push({ role: "user", content: `[${nombreUsuario}] ${texto}` });
  }

  // El prompt del sistema se arma una sola vez por mensaje (cambia la fecha de "hoy", pero no
  // dentro del mismo mensaje) y se marca para cachear: si este mensaje necesita varias vueltas
  // de herramientas, las vueltas 2 a 6 pagan el prompt cacheado (mucho mas barato) en vez de
  // completo cada vez.
  const systemPrompt: Anthropic.TextBlockParam[] = [
    { type: "text", text: esCliente ? buildSystemPromptCliente() : buildSystemPromptInterno(), cache_control: { type: "ephemeral" } },
  ];
  const tools = esCliente ? toolsClienteConCache : toolsInternoConCache;

  const herramientasUsadas: string[] = [];
  let vueltas = 0;
  while (vueltas < 6) {
    vueltas++;
    let respuesta;
    try {
      respuesta = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages: historial as Anthropic.MessageParam[],
      });
    } catch (e: any) {
      if (esErrorHistorialCorrupto(e)) {
        await reiniciarConversacion(usuarioId);
        await registrarLogSeguro({
          usuario_id: usuarioId,
          usuario_nombre: nombreUsuario,
          tipo: "error",
          entrada: imagen ? `${texto} (con imagen adjunta)` : texto,
          salida: "Historial corrupto detectado (tool_use sin tool_result): se reinicio la memoria de esta conversacion automaticamente.",
          herramientas_usadas: herramientasUsadas,
        });
        return "Tuve un corte interno con la memoria de esta charla. Ya lo solucione solo — contame de nuevo.";
      }
      throw e;
    }

    historial.push({ role: "assistant", content: respuesta.content });

    const bloquesToolUse = respuesta.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    // Importante: nos fijamos si HAY bloques tool_use, no si stop_reason === "tool_use". Si la
    // respuesta se corta por max_tokens (ej: penso mucho o encadeno varias herramientas y no
    // entro todo), igual puede venir con tool_use ya armados en el content. Si en ese caso
    // tratamos la respuesta como "final" y la guardamos tal cual, queda un tool_use colgado sin
    // su tool_result: la proxima vez que se le mande algo a este usuario, la API de Anthropic
    // rechaza TODO el historial (error 400) y el bot queda roto para siempre con esa persona
    // hasta que alguien le resetee la conversacion a mano. Por eso, si hay tool_use, SIEMPRE
    // los ejecutamos y les generamos su tool_result antes de guardar nada.
    if (bloquesToolUse.length === 0) {
      const textoFinal = respuesta.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      await guardarHistorial(usuarioId, historial);
      await registrarLogSeguro({
        usuario_id: usuarioId,
        usuario_nombre: nombreUsuario,
        tipo: "mensaje",
        entrada: imagen ? `${texto} (con imagen adjunta)` : texto,
        salida: textoFinal || "Listo.",
        herramientas_usadas: herramientasUsadas,
      });
      return textoFinal || "Listo.";
    }

    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const bloque of bloquesToolUse) {
      herramientasUsadas.push(bloque.name);
      try {
        const resultado = await ejecutarHerramienta(bloque.name, bloque.input, { usuarioId, nombreUsuario });
        resultados.push({ type: "tool_result", tool_use_id: bloque.id, content: JSON.stringify(resultado) });
      } catch (e: any) {
        // Si UNA herramienta explota, igual le mandamos un tool_result (marcado como error) en
        // vez de dejar tirar la excepcion para afuera: asi el turno queda siempre balanceado
        // (cada tool_use con su tool_result) y el historial nunca se corrompe, sin importar que
        // una de las herramientas haya fallado.
        resultados.push({
          type: "tool_result",
          tool_use_id: bloque.id,
          content: JSON.stringify({ ok: false, error: e.message ?? String(e) }),
          is_error: true,
        });
      }
    }
    historial.push({ role: "user", content: resultados });
  }

  await guardarHistorial(usuarioId, historial);
  return "Me colgue haciendo demasiados pasos para esto. Contame de nuevo mas simple, o de a un tema por vez.";
}

async function registrarLogSeguro(entrada: Parameters<typeof registrarLog>[0]) {
  try {
    await registrarLog(entrada);
  } catch (e) {
    console.error("No se pudo guardar el log:", e);
  }
}

async function guardarHistorial(usuarioId: string, historial: Turno[]) {
  const recortado = historial.length > MAX_TURNOS ? historial.slice(historial.length - MAX_TURNOS) : historial;
  await guardarHistorialConversacion(usuarioId, recortado);
}
