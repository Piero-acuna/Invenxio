// ─────────────────────────────────────────────────────────────────────────────
// src/lib/barcode.js
// Helpers puros (sin React) para generar códigos de barras/SKU.
// Extraído de InventorySystem.jsx al separar el monolito por módulos.
// ─────────────────────────────────────────────────────────────────────────────

// ─── BARCODE HELPERS ─────────────────────────────────────────────────────────

/** Genera un código EAN-13 válido (12 dígitos + dígito de control) */
function generateEAN13() {
  const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const checksum = digits.reduce((sum, d, i) => sum + d * (i % 2 === 0 ? 1 : 3), 0);
  const ctrl = (10 - (checksum % 10)) % 10;
  return [...digits, ctrl].join("");
}

/**
 * Renderiza un EAN-13 como SVG puro (sin dependencias externas).
 * Implementación minimalista de barras EAN-13.
 */
// Genera código simple compatible con CODE128
function generateBarcode() {
  const prefix = "INV";
  const random = Math.floor(Math.random() * 1000000000).toString().padStart(9, "0");
  return `${prefix}${random}`;
}

export { generateEAN13, generateBarcode };
