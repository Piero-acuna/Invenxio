// ─────────────────────────────────────────────────────────────────────────────
// src/hooks/useDropdownPlacement.js
//
// Los desplegables de resultados de búsqueda (buscar producto por nombre/SKU,
// en MovimientoTab.jsx, SupplierPurchaseTab.jsx, SupplierSaleTab.jsx) se
// posicionan con `position: absolute` justo debajo del campo. Con una altura
// fija, si el campo queda cerca del borde inferior de la pantalla — celular
// chico, zoom del navegador, o el usuario scrolleó hasta abajo del
// formulario antes de escribir — el desplegable se sale de la pantalla y
// queda cortado o superpuesto sobre el fondo de la página.
//
// Este hook mide, mientras el desplegable está abierto, cuánto espacio real
// queda debajo (y arriba) del campo y devuelve: (1) cuánto alto puede tener
// antes de necesitar scroll interno, y (2) si conviene abrirlo hacia ARRIBA
// en vez de hacia abajo cuando abajo no entra pero arriba sí. Se recalcula
// si la ventana cambia de tamaño o si se scrollea mientras está abierto (por
// ejemplo, el teclado del celular apareciendo).
//
// El ref del campo (el "ancla") lo crea CADA COMPONENTE con su propio
// useRef() y se lo pasa a este hook como parámetro — el hook no lo crea ni
// lo devuelve. El regla `react-hooks/refs` del linter (orientada al React
// Compiler) marca como sospechoso que un ref "viaje" de ida y vuelta por un
// hook propio, así que este hook solo recibe el ref para LEER su posición
// dentro de un efecto (uso permitido) y devuelve puro estado derivado.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useLayoutEffect } from "react";

export function useDropdownPlacement(anchorRef, open) {
  const [placement, setPlacement] = useState({ maxHeight: 256, openUp: false });

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const measure = () => {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      const margin = 12; // aire respecto al borde de la ventana
      const spaceBelow = window.innerHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
      const available = openUp ? spaceAbove : spaceBelow;
      setPlacement({ maxHeight: Math.max(96, Math.min(256, available)), openUp });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, anchorRef]);

  return placement;
}
