import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as repo from "./repo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PANEL_PORT = Number(process.env.PANEL_PORT ?? 4000);
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;

if (!PANEL_PASSWORD) throw new Error("Falta PANEL_PASSWORD en el .env");

const app = express();
app.use(express.json());

// ---------- autenticacion ----------
// El HTML/CSS/JS estatico se sirve libre (no tiene datos, es solo la pantalla). La propia
// pagina pide la clave con un formulario propio y la manda como header Authorization en
// cada llamada a la API; solo /api/* exige esa clave.
app.use("/api", (req, res, next) => {
  const header = req.headers.authorization;
  if (header?.startsWith("Basic ")) {
    const [, clave] = Buffer.from(header.slice(6), "base64").toString().split(":");
    if (clave === PANEL_PASSWORD) return next();
  }
  res.status(401).json({ ok: false, error: "Clave incorrecta o faltante." });
});

function envolver(handler: (req: express.Request) => any) {
  return async (req: express.Request, res: express.Response) => {
    try {
      const resultado = await handler(req);
      res.json(resultado ?? { ok: true });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message ?? String(e) });
    }
  };
}

// ---------- productos ----------
app.get("/api/productos", envolver(() => repo.listarProductos()));
app.post("/api/productos", envolver((req) => repo.agregarProducto(req.body)));
app.put("/api/productos/:id", envolver((req) => repo.actualizarProductoPorId(Number(req.params.id), req.body)));

// ---------- personas / empleados ----------
app.get("/api/personas", envolver(() => repo.listarPersonas()));
app.put("/api/personas/:id", envolver((req) => repo.actualizarPersonaPorId(Number(req.params.id), req.body)));
app.get("/api/empleados", envolver(() => repo.listarEmpleados()));
app.post("/api/empleados", envolver((req) => repo.agregarEmpleado(req.body)));

// ---------- prestamos ----------
app.get("/api/prestamos", envolver(() => repo.listarPrestamos()));
app.post("/api/prestamos", envolver((req) => repo.registrarPrestamo(req.body)));
app.put("/api/prestamos/:id", envolver((req) => repo.actualizarPrestamoPorId(Number(req.params.id), req.body)));
app.post("/api/prestamos/:id/pagos", envolver((req) => repo.registrarPagoPrestamoPorId(Number(req.params.id), req.body.monto, req.body.nota)));
app.get("/api/prestamos/:id/pagos", envolver((req) => repo.listarPagosDePrestamo(Number(req.params.id))));

// ---------- plan canje ----------
app.get("/api/canjes", envolver(() => repo.listarCanjes()));
app.post("/api/canjes", envolver((req) => repo.agregarCanje(req.body)));
app.put("/api/canjes/:id", envolver((req) => repo.actualizarCanjePorId(Number(req.params.id), req.body)));

// ---------- ventas / resumen ----------
app.post("/api/ventas", envolver((req) => repo.registrarVenta(req.body)));
app.get(
  "/api/ventas",
  envolver((req) => {
    const filtros = {
      desde: typeof req.query.desde === "string" ? req.query.desde : undefined,
      hasta: typeof req.query.hasta === "string" ? req.query.hasta : undefined,
      nombre_producto: typeof req.query.producto === "string" ? req.query.producto : undefined,
      nombre_cliente: typeof req.query.cliente === "string" ? req.query.cliente : undefined,
    };
    return {
      resumen: repo.consultarVentas(filtros).resumen_por_moneda,
      detalle: repo.listarMovimientosVenta(filtros),
    };
  })
);
app.get("/api/resumen", envolver(() => repo.consultarEstadoGeneral()));

// ---------- frontend estatico ----------
app.use(express.static(path.join(__dirname, "..", "public")));

export function iniciarPanel() {
  app.listen(PANEL_PORT, "0.0.0.0", () => {
    console.log(`Panel web corriendo en http://localhost:${PANEL_PORT} (y en tu red local en ese mismo puerto).`);
  });
}
