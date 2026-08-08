// ─────────────────────────────────────────────────────────────────────────────
// src/utils/packaging.js
// El almacén siempre cuenta el stock en EMPAQUES completos (cajas, paquetes),
// nunca en unidades sueltas — pero la tienda sí vende por unidad. Esta es la
// única fórmula de conversión entre ambos, para que "Nuevo producto",
// "Agregar Stock" y "Enviar a Tienda" calculen siempre exactamente lo mismo.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convierte una cantidad de empaques a unidades totales.
 * Ej: 5 cajas × 24 unidades por caja = 120 unidades.
 */
export function calcUnitsFromPacks(packCount, unitsPerPack) {
  const packs = Number(packCount) || 0;
  const perPack = Number(unitsPerPack) || 0;
  return packs * perPack;
}
