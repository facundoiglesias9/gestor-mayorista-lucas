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

// ---------- marca y modelo (filtros del catalogo) ----------
// Para que el cliente filtre los equipos por marca y despues por modelo, se leen del nombre de la
// publicacion: "Samsung Galaxy S24 Ultra 256GB negro" -> Samsung, "Galaxy S24 Ultra". Lo que no es
// un equipo (fundas, cargadores, vapers...) queda sin marca y no aparece en esos filtros.
const MARCAS: [RegExp, string][] = [
  [/\b(iphone|ipad|apple)\b/, "Apple"],
  [/\b(samsung|galaxy)\b/, "Samsung"],
  // "poco" solo seguido de un modelo: "poco uso" no es un Xiaomi.
  [/\b(xiaomi|redmi)\b|\bpoco [xfmc] ?\d/, "Xiaomi"],
  [/\bmotorola\b|\bmoto (g|e|edge|razr)\b|\bmoto [ge]\d/, "Motorola"],
  [/\bpixel \d|\bgoogle pixel\b/, "Google"],
  [/\bhuawei\b/, "Huawei"],
  [/\bhonor\b/, "Honor"],
  [/\boppo\b/, "Oppo"],
  [/\brealme\b/, "Realme"],
  [/\bone ?plus\b/, "OnePlus"],
  [/\bnokia\b/, "Nokia"],
  [/\btcl\b/, "TCL"],
  [/\bzte\b/, "ZTE"],
  [/\binfinix\b/, "Infinix"],
  [/\btecno\b/, "Tecno"],
];

const ACCESORIOS = /funda|cargador|cable|vidrio|templado|protector|auricular|airpods|buds|airtag|pencil|lapiz|magsafe|malla|correa|adaptador|soporte|power ?bank|\bcase\b|glass|film/;

// Lo que no es parte del modelo: el nombre de la marca, memoria, bateria, estado, color, red.
const SIN_MARCA = /\b(apple|samsung|xiaomi|motorola|google|huawei|honor|oppo|realme|one ?plus|nokia|tcl|zte|infinix|tecno)\b/g;
const RUIDO_MODELO = [
  /\b\d{1,3} ?%/g,
  /\b\d+ ?\/ ?\d+ ?(gb|tb)?\b/g,
  /\b\d+ ?(gb|tb)\b/g,
  /\b(sellad[oa]s?|nuev[oa]s?|usad[oa]s?|semi ?nuev[oa]s?|semi|como nuevo|reacondicionad[oa]s?|outlet|liberad[oa]s?|caja abierta)\b/g,
  /\b(5g|4g|lte|dual ?sim|e ?sim|global)\b/g,
  /\b(titanio|titanium|natural|negr[oa]|blanc[oa]|azul|roj[oa]|verde|rosa|rosad[oa]|violeta|morad[oa]|lila|lavanda|purpura|amarill[oa]|dorad[oa]|oro|plata|platead[oa]|gris|grafito|celeste|naranja|coral|crema|beige|desierto|medianoche|estelar|sierra|alpino|pacifico|black|white|blue|red|green|pink|purple|gold|silver|graphite|gray|grey|midnight|starlight|desert|yellow|orange|cream|mint|lavender|space|product)\b/g,
];

// "iphone 15 pro max" -> "iPhone 15 Pro Max", "galaxy s24" -> "Galaxy S24", "redmi note 13 pro+".
function modeloBonito(texto: string, marca: string): string {
  return texto
    .split(" ")
    .map((p) => {
      if (p === "iphone") return "iPhone";
      if (p === "ipad") return "iPad";
      if (p === "mini" && marca === "Apple") return "mini";
      if (p === "mi") return "Mi";
      if (/\d/.test(p) || (/^[a-z]{1,2}$/.test(p))) return p.toUpperCase();
      return p[0].toUpperCase() + p.slice(1);
    })
    .join(" ");
}

export function marcaYModelo(nombre: string): { marca: string; modelo: string | null } | null {
  const t = normalizar(nombre)
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9+%/]+/g, " ")
    .replace(/\s+\+/g, "+")
    .trim();
  if (ACCESORIOS.test(t)) return null;
  const marca = MARCAS.find(([patron]) => patron.test(t))?.[1];
  if (!marca) return null;
  let modelo = t.replace(SIN_MARCA, " ").replace(/\bpromax\b/g, "pro max");
  for (const patron of RUIDO_MODELO) modelo = modelo.replace(patron, " ");
  // iPhone con la memoria sin "GB" ("iphone 15 pro 256"). 16 y 32 no, que son modelos (iPhone 16).
  if (marca === "Apple") modelo = modelo.replace(/\b(64|128|256|512)\b/g, " ");
  modelo = modelo
    .replace(/[/%]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z]) (\d)/g, "$1$2"); // "moto g 84" = "moto g84"
  if (!modelo) return { marca, modelo: null };
  // Que el modelo se entienda solo y salga igual se escriba como se escriba:
  // "Samsung A55" = "Galaxy A55", "Motorola G84" = "Moto G84", "Xiaomi 14T" (no "14T" a secas).
  if (marca === "Samsung" && !modelo.startsWith("galaxy")) modelo = `galaxy ${modelo}`;
  if (marca === "Motorola" && /^[ge]\d/.test(modelo)) modelo = `moto ${modelo}`;
  const bonito = modeloBonito(modelo, marca);
  return { marca, modelo: /^\d/.test(bonito) ? `${marca} ${bonito}` : bonito };
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
