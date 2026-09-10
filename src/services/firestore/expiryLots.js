// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/expiryLots.js
//
// Lotes de caducidad — 0, 1 o varios por producto (catálogo Inventario o
// Almacén), nunca obligatorios. Ver 0023_product_expiry_lots.sql.
// Se lee en tiempo real como cualquier otra colección con
// subscribeToCollection(companyId, "productExpiryLots", ...) — este
// archivo solo tiene las escrituras (insert/update/delete), igual que
// products.js / warehouse.js con sus respectivas tablas.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, paramsToSnake, assertNoError } from "./shared";

/**
 * @param {Object} lot
 * @param {"inventario"|"almacen"} lot.catalog
 * @param {string} lot.productId
 * @param {string} lot.expiryDate  "YYYY-MM-DD" — obligatorio POR LOTE (si no
 *   tiene caducidad no tiene sentido como fila de esta tabla), pero el
 *   producto en sí puede no tener ningún lote.
 * @param {string} [lot.entryDate] "YYYY-MM-DD" — opcional
 * @param {number} [lot.qty]       opcional
 * @param {string} [lot.note]      opcional
 */
export async function addExpiryLot(companyId, lot) {
  const payload = { ...paramsToSnake(lot), company_id: companyId };
  const { data, error } = await supabase.from("product_expiry_lots").insert(payload).select("id").single();
  assertNoError(error, "addExpiryLot");
  return data.id;
}

export async function updateExpiryLot(companyId, lotId, data) {
  const { error } = await supabase
    .from("product_expiry_lots")
    .update(paramsToSnake(data))
    .eq("id", lotId)
    .eq("company_id", companyId);
  assertNoError(error, "updateExpiryLot");
}

export async function deleteExpiryLot(companyId, lotId) {
  const { error } = await supabase.from("product_expiry_lots").delete().eq("id", lotId).eq("company_id", companyId);
  assertNoError(error, "deleteExpiryLot");
}

/**
 * Aplica en bloque los cambios de un editor de lotes (ver
 * ExpiryLotsEditor.jsx) contra lo que ya había guardado: inserta los
 * nuevos, actualiza los que ya existían (siempre, para no tener que
 * detectar campo por campo qué cambió) y borra los que el usuario quitó.
 * Se usa igual desde Inventario y desde Almacén — solo cambia `catalog`.
 *
 * @param {string} companyId
 * @param {"inventario"|"almacen"} catalog
 * @param {string} productId
 * @param {Array}  currentLots   Lo que quedó en el editor al guardar — cada
 *   fila con `id` (si ya existía) o sin `id` (si es nueva), `entryDate`,
 *   `expiryDate`, `qty`.
 * @param {Array}  originalLots  Lo que había ANTES de abrir el editor (para
 *   saber cuáles se borraron).
 */
export async function syncExpiryLots(companyId, catalog, productId, currentLots, originalLots) {
  const currentIds = new Set(currentLots.filter(l => l.id).map(l => l.id));
  const toDelete = (originalLots || []).filter(l => !currentIds.has(l.id));
  const toUpsert = (currentLots || []).filter(l => l.expiryDate); // sin fecha de caducidad, se ignora la fila (no es un lote válido)

  await Promise.all([
    ...toDelete.map(l => deleteExpiryLot(companyId, l.id)),
    ...toUpsert.map(l => {
      const fields = { entryDate: l.entryDate || null, expiryDate: l.expiryDate, qty: l.qty !== "" && l.qty != null ? Number(l.qty) : null };
      return l.id
        ? updateExpiryLot(companyId, l.id, fields)
        : addExpiryLot(companyId, { ...fields, catalog, productId });
    }),
  ]);
}
