import Anthropic from "@anthropic-ai/sdk";
import { registrarEvento } from "./repo.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Usamos un modelo chico/rapido para esto: es solo clasificar un nombre de producto en
// una categoria, no hace falta gastar de mas ni esperar de mas.
const MODEL_CATEGORIAS = "claude-haiku-5-5";

const SYSTEM = `Clasificas productos de un local de compra/venta mayorista de celulares y electronica en UNA categoria corta, en espanol, con mayuscula inicial.

Ejemplos:
- "iPhone 12 128GB" -> Celulares
- "Samsung Galaxy S21" -> Celulares
- "Xiaomi Redmi Note 11" -> Celulares
- "Motorola Edge 40" -> Celulares
- "Vaporizador recargable" -> Vapers
- "Vape pod descartable" -> Vapers
- "Pod Elfbar" -> Vapers
- "Cargador tipo C" -> Accesorios
- "Auriculares bluetooth" -> Accesorios
- "Funda para iPhone" -> Accesorios
- "Smartwatch" -> Accesorios
- "Notebook Lenovo" -> Computacion
- "Tablet Samsung" -> Tablets

Si el producto no encaja claramente en ninguna categoria conocida, respondé "Otros".
Respondé UNICAMENTE con el nombre de la categoria (una o dos palabras), sin puntos ni explicacion.`;

export async function inferirCategoria(nombreProducto: string): Promise<string> {
  try {
    const respuesta = await anthropic.messages.create({
      model: MODEL_CATEGORIAS,
      max_tokens: 16,
      system: SYSTEM,
      messages: [{ role: "user", content: nombreProducto }],
    });
    const bloque = respuesta.content.find((b) => b.type === "text");
    // Por si contesta con un punto final o algo de mas: nos quedamos con un nombre corto.
    const texto = bloque && "text" in bloque ? bloque.text.trim().replace(/[.\s]+$/, "").slice(0, 30) : "";
    return texto || "Otros";
  } catch (e) {
    console.error("No se pudo inferir categoria automaticamente:", e);
    await registrarEvento({ nivel: "aviso", origen: "ia", evento: `No se pudo adivinar la categoría de "${nombreProducto.slice(0, 80)}" (quedó en Otros)`, detalle: e });
    return "Otros";
  }
}
