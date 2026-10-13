import { createHmac, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import * as repo from "./repo.js";

// Login del panel con cuenta de Google. Entran los duenos (los mails de PANEL_EMAILS, en Vercel)
// y los usuarios que los duenos agregan desde la seccion Usuarios del panel (tabla usuarios_panel).
//
// Como funciona: el boton del login abre la ventanita de Google (modo "popup"), Google le da a la
// pagina un codigo de un solo uso, la pagina se lo manda al servidor, y el servidor lo cambia con
// Google por los datos de la cuenta (usando GOOGLE_CLIENT_SECRET, que nunca sale del servidor).
// Si el mail esta permitido, el servidor deja una cookie de sesion firmada que dura 30 dias.
//
// La cookie no se guarda en ningun lado: lleva adentro el mail y el vencimiento, firmados con
// PANEL_SESSION_SECRET. Sin ese secreto no se puede fabricar ni modificar. Para echar a todos de
// golpe alcanza con cambiar PANEL_SESSION_SECRET; para echar a una persona, sacarla de Usuarios en
// el panel (o de PANEL_EMAILS si es dueno): se revisa en cada pedido, no solo al entrar.

const NOMBRE_COOKIE = "gm_sesion";
const DURACION_SESION_MS = 30 * 24 * 60 * 60 * 1000;

function config() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || null,
    secreto: process.env.PANEL_SESSION_SECRET?.trim() || null,
    emails: (process.env.PANEL_EMAILS ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  };
}

// Que variables faltan para que el login funcione. Si falta alguna, nadie puede entrar (pero el
// resto del sistema, como el bot, sigue andando: por eso no se corta el arranque).
export function faltaConfigurar(): string[] {
  const c = config();
  const faltan: string[] = [];
  if (!c.clientId) faltan.push("GOOGLE_CLIENT_ID");
  if (!c.clientSecret) faltan.push("GOOGLE_CLIENT_SECRET");
  if (!c.secreto) faltan.push("PANEL_SESSION_SECRET");
  if (c.emails.length === 0) faltan.push("PANEL_EMAILS");
  return faltan;
}

// Lo que necesita saber la pagina del login (el client id es publico: es el que Google muestra en la ventanita).
export function googleClientId() {
  return config().clientId;
}

// Los duenos: pueden entrar siempre, manejan la seccion Usuarios y nadie los puede sacar desde el panel.
export function esDueno(email: string | null | undefined) {
  return Boolean(email) && config().emails.includes(String(email).trim().toLowerCase());
}

export function emailsDuenos() {
  return config().emails;
}

// Quien entro y que puede hacer: "dueno" (PANEL_EMAILS), "admin" o "usuario" (agregados desde el
// panel, ver repo.ts), o null si no puede entrar.
export type Rol = "dueno" | repo.RolPanel;

// Duenos y admins manejan la seccion Usuarios (los admins, sin poder tocar a los duenos).
export function gestionaUsuarios(rol: Rol | null | undefined) {
  return rol === "dueno" || rol === "admin";
}

// Los roles de los agregados desde el panel, guardados un rato en memoria: si no, cada pedido a la
// API le preguntaria a la base. Al agregar, editar o sacar a alguien se olvida
// (olvidarUsuariosEnCache); en las otras instancias de Vercel el cambio llega a mas tardar en
// CACHE_USUARIOS_MS.
const CACHE_USUARIOS_MS = 30 * 1000;
let cacheUsuarios: { roles: Map<string, repo.RolPanel>; hasta: number } | null = null;

export function olvidarUsuariosEnCache() {
  cacheUsuarios = null;
}

export async function rolDe(email: string): Promise<Rol | null> {
  const normalizado = email.trim().toLowerCase();
  if (esDueno(normalizado)) return "dueno";
  if (!cacheUsuarios || cacheUsuarios.hasta < Date.now()) {
    try {
      cacheUsuarios = { roles: await repo.rolesUsuariosPanel(), hasta: Date.now() + CACHE_USUARIOS_MS };
    } catch {
      return null; // sin base no se puede saber: no entra (los duenos si, ver arriba)
    }
  }
  return cacheUsuarios.roles.get(normalizado) ?? null;
}

export async function emailPermitido(email: string) {
  return (await rolDe(email)) !== null;
}

const base64url = (texto: string) => Buffer.from(texto).toString("base64url");
const firmar = (datos: string, secreto: string) => createHmac("sha256", secreto).update(datos).digest("base64url");

export type Sesion = { email: string; nombre: string | null; vence: number };

export function crearCookieSesion(cuenta: { email: string; nombre: string | null }, https: boolean) {
  const secreto = config().secreto;
  if (!secreto) throw new Error("Falta PANEL_SESSION_SECRET");
  const sesion: Sesion = { email: cuenta.email.toLowerCase(), nombre: cuenta.nombre, vence: Date.now() + DURACION_SESION_MS };
  const datos = base64url(JSON.stringify(sesion));
  return armarCookie(`${datos}.${firmar(datos, secreto)}`, DURACION_SESION_MS / 1000, https);
}

export function cookieBorrada(https: boolean) {
  return armarCookie("", 0, https);
}

// HttpOnly: el JavaScript de la pagina no la puede leer (si algun dia se cuela un script, no se la
// lleva). SameSite=Strict: el navegador no la manda en pedidos que arrancan en otro sitio, asi una
// pagina ajena no puede hacer cosas en el panel "en nombre" de quien esta logueado.
function armarCookie(valor: string, maxAgeSegundos: number, https: boolean) {
  return [`${NOMBRE_COOKIE}=${valor}`, "Path=/", `Max-Age=${maxAgeSegundos}`, "HttpOnly", "SameSite=Strict", ...(https ? ["Secure"] : [])].join("; ");
}

// Devuelve la sesion si la cookie es valida, esta vigente y el mail sigue permitido; si no, null.
export async function leerSesion(headerCookie: string | undefined): Promise<(Sesion & { rol: Rol }) | null> {
  const secreto = config().secreto;
  if (!secreto || !headerCookie) return null;
  const valor = headerCookie
    .split(";")
    .map((parte) => parte.trim())
    .find((parte) => parte.startsWith(`${NOMBRE_COOKIE}=`))
    ?.slice(NOMBRE_COOKIE.length + 1);
  if (!valor) return null;
  const [datos, firma] = valor.split(".");
  if (!datos || !firma) return null;
  const esperada = Buffer.from(firmar(datos, secreto));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
  let sesion: Sesion;
  try {
    sesion = JSON.parse(Buffer.from(datos, "base64url").toString("utf8")) as Sesion;
  } catch {
    return null;
  }
  if (typeof sesion.email !== "string" || typeof sesion.vence !== "number") return null;
  if (sesion.vence < Date.now()) return null;
  const rol = await rolDe(sesion.email);
  return rol ? { ...sesion, rol } : null;
}

// Cambia el codigo que mando la pagina por los datos de la cuenta, y verifica con las claves
// publicas de Google que el token sea autentico y para esta app (audience = nuestro client id).
export async function cuentaDesdeCodigoGoogle(codigo: string) {
  const { clientId, clientSecret } = config();
  if (!clientId || !clientSecret) throw new Error("Falta configurar el login con Google");
  // "postmessage" es el redirect_uri que corresponde al modo popup de Google.
  const cliente = new OAuth2Client(clientId, clientSecret, "postmessage");
  const { tokens } = await cliente.getToken(codigo);
  if (!tokens.id_token) throw new Error("Google no devolvió los datos de la cuenta (falta id_token)");
  const ticket = await cliente.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
  const datos = ticket.getPayload();
  if (!datos?.email) throw new Error("La cuenta de Google no tiene mail");
  return { email: datos.email.toLowerCase(), verificado: datos.email_verified === true, nombre: datos.name ?? null };
}
