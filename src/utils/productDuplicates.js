// ─────────────────────────────────────────────────────────────────────────────
// src/utils/productDuplicates.js
//
// Cuando una compra a proveedor llega con un costo distinto al ya registrado,
// SuppliersModule.jsx no sobrescribe el costo del producto existente — crea
// uno NUEVO con el costo como sufijo del nombre, ej.:
//   "Coca Cola 500ml"  →  "Coca Cola 500ml (S/ 3.20)"
// para no mezclar compras con costos distintos bajo el mismo registro.
//
// Estos helpers son puramente de texto/nombres — la limpieza real de
// duplicados que se quedan en 0 stock vive en Postgres (ver
// supabase/migrations/0012_cleanup_zero_stock_duplicates.sql) y se llama
// desde services/firestore/products.js y warehouse.js.
// ─────────────────────────────────────────────────────────────────────────────
import { formatMoney } from "./currency";

/** "Coca Cola 500ml (S/ 3.20)" → "Coca Cola 500ml". Sin sufijo, no cambia nada. */
export function getBaseProductName(name) {
  if (!name) return name || "";
  return name.replace(/\s*\([^()]*\)\s*$/, "").trim();
}

/** "Coca Cola 500ml" + 3.2 + "S/" → "Coca Cola 500ml (S/ 3.20)" */
export function buildDuplicateProductName(baseName, cost, currencySymbol) {
  return `${baseName} (${formatMoney(cost, currencySymbol)})`;
}

/**
 * Compara el costo nuevo contra el precio de venta vigente y devuelve una
 * frase lista para anexar a la descripción del producto duplicado — o null
 * si todavía no hay un precio de venta con el que comparar.
 */
export function buildCostVsPriceNote(cost, salePrice, currencySymbol) {
  const price = Number(salePrice);
  if (!price || price <= 0) return null;
  const c = Number(cost) || 0;
  const diffCents = Math.round(c * 100) - Math.round(price * 100);
  const costTxt = formatMoney(c, currencySymbol);
  const priceTxt = formatMoney(price, currencySymbol);
  if (diffCents === 0) {
    return `⚠️ Costo (${costTxt}) IGUAL al precio de venta actual (${priceTxt}) — no quedaría margen.`;
  }
  if (diffCents > 0) {
    return `⚠️ Costo (${costTxt}) por ENCIMA del precio de venta actual (${priceTxt}) — revisa el precio o el margen antes de vender este lote.`;
  }
  return `✅ Costo (${costTxt}) por DEBAJO del precio de venta actual (${priceTxt}).`;
}

/** Anexa `note` a una descripción existente, en una línea aparte. */
export function appendDescriptionNote(baseDescription, note) {
  if (!note) return baseDescription || "";
  return baseDescription ? `${baseDescription}\n${note}` : note;
}
