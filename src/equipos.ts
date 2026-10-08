// Estado y bateria de los equipos (celulares) del stock. Lo usan la base (para completar los
// productos que ya estaban cargados) y repo.ts (al cargar o editar un producto).

export const ESTADOS_EQUIPO = ["Sellado", "Usado - como nuevo", "Usado"] as const;

function normalizar(texto: string): string {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Un equipo, no un accesorio para ese equipo ("Funda iPhone 15" no es un celular).
export function pareceCelular(texto: string): boolean {
  const t = normalizar(texto);
  if (/funda|cargador|cable|vidrio|templado|protector|auricular|airpods|malla|correa|adaptador|soporte|\bcase\b|glass|film/.test(t)) return false;
  return /iphone|ipad|galaxy|samsung|xiaomi|redmi|motorola|pixel|celular/.test(t);
}

// Lo que dice el nombre: "Iphone 15 pro 128gb usado 79%" -> Usado, 79. El estado solo se lee en
// los celulares (una "funda nueva" no es un equipo sellado); el % de bateria, en cualquiera.
export function estadoYBateriaDelNombre(nombre: string): { estado: string | null; bateria: number | null } {
  const t = normalizar(nombre);
  const porcentaje = /\b(\d{1,3})\s?%/.exec(String(nombre ?? ""));
  const bateria = porcentaje && Number(porcentaje[1]) <= 100 ? Number(porcentaje[1]) : null;
  let estado: string | null = null;
  if (pareceCelular(nombre)) {
    if (/\bsellad[oa]s?\b|\bnuev[oa]s?\b/.test(t)) estado = "Sellado";
    else if (/\bsemi|como nuevo/.test(t)) estado = "Usado - como nuevo";
    else if (/\busad[oa]s?\b/.test(t)) estado = "Usado";
  }
  return { estado, bateria: estado === "Sellado" ? null : bateria };
}

// Acepta el estado escrito de cualquier forma ("sellado", "USADO - como nuevo"); vacio = sin estado.
export function validarEstado(estado: unknown): string | null {
  if (estado == null || String(estado).trim() === "") return null;
  const buscado = normalizar(String(estado)).replace(/\s+/g, " ").trim();
  const encontrado = ESTADOS_EQUIPO.find((e) => normalizar(e) === buscado);
  if (!encontrado) throw new Error(`Estado invalido: "${estado}". Tiene que ser ${ESTADOS_EQUIPO.join(", ")}.`);
  return encontrado;
}

export function validarBateria(bateria: unknown): number | null {
  if (bateria == null || String(bateria).trim() === "") return null;
  const n = Number(String(bateria).replace("%", "").trim());
  if (!Number.isFinite(n) || n < 1 || n > 100) throw new Error(`Bateria invalida: "${bateria}". Tiene que ser un % entre 1 y 100.`);
  return Math.round(n);
}

// El nombre de cada producto es unico, asi que el % de bateria va en el nombre: dos
// "iPhone 15 Pro 128GB" usados con distinta bateria quedan como "... 85%" y "... 79%". Si cambia
// la bateria, cambia el nombre; si no tiene (ej: es sellado), se le saca.
export function nombreConBateria(nombre: string, bateria: number | null): string {
  const base = String(nombre ?? "")
    .replace(/\s*\b\d{1,3}\s?%/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return bateria == null ? base : `${base} ${bateria}%`;
}
