import { createHash, timingSafeEqual } from "node:crypto";

// Compara una clave recibida contra la correcta sin que el tiempo de respuesta delate cuantos
// caracteres coinciden (un "===" comun corta apenas encuentra una diferencia, y midiendo eso
// se puede ir adivinando la clave de a un caracter). Se comparan los hashes para que tambien
// funcione con claves de distinto largo.
export function claveCoincide(recibida: string, esperada: string): boolean {
  const a = createHash("sha256").update(recibida).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}
