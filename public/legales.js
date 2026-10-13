// Paginas legales (/terminos y /privacidad): solo el boton de tema claro/oscuro, igual que en el
// catalogo y guardado en la misma clave, asi se ven igual al ir y volver.

const COLOR_BARRA_TEMA = { claro: "#f5f5f7", oscuro: "#0b0b0d" };

function aplicarTema(tema, conTransicion) {
  const raiz = document.documentElement;
  if (conTransicion && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    raiz.classList.add("tema-transicion");
    setTimeout(() => raiz.classList.remove("tema-transicion"), 450);
  }
  raiz.dataset.tema = tema;
  document.querySelector('meta[name="theme-color"]').setAttribute("content", COLOR_BARRA_TEMA[tema]);
  const boton = document.getElementById("cambiar-tema");
  const texto = tema === "oscuro" ? "Cambiar a fondo claro" : "Cambiar a fondo oscuro";
  boton.setAttribute("aria-label", texto);
  boton.title = texto;
}

aplicarTema(document.documentElement.dataset.tema === "oscuro" ? "oscuro" : "claro", false);

document.getElementById("cambiar-tema").addEventListener("click", () => {
  const nuevo = document.documentElement.dataset.tema === "oscuro" ? "claro" : "oscuro";
  aplicarTema(nuevo, true);
  try {
    localStorage.setItem("catalogo_tema", nuevo);
  } catch {
    /* sin almacenamiento (ej: navegacion privada): el cambio vale hasta recargar */
  }
});
