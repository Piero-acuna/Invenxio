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

// ─────────────────────────────────────────────────────────────────────────────
// Jerarquía de abastecimiento de 3 niveles: Caja mayorista → Packs → Unidades
// sueltas. El stock se centraliza SIEMPRE en la unidad mínima (unidades) —
// packs_per_case / units_per_pack son solo el desglose que el Dueño ingresa
// en Almacén para que el sistema calcule el total; ver 0019_product_
// presentations_and_case_breakdown.sql.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Total de unidades sueltas que trae 1 Caja, a partir de cuántos Packs trae
 * la Caja y cuántas Unidades trae cada Pack.
 * Ej: 10 packs/caja × 6 unidades/pack = 60 unidades/caja.
 */
export function calcUnitsPerCase(packsPerCase, unitsPerPack) {
  const packs = Number(packsPerCase) || 0;
  const perPack = Number(unitsPerPack) || 0;
  return packs * perPack;
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentaciones de venta (Inventario/Tienda) — cada producto puede venderse
// en más de una "forma" (Unidad suelta, Pack, Caja...), cada una con su
// propio precio y código de barras, pero TODAS descuentan del mismo stock
// base en unidades: `multiplier` es cuántas unidades base descuenta vender 1
// de esa presentación. La presentación con multiplier === 1 es siempre la
// unidad base ("Unidad") — es la referencia que el resto de la fórmula usa
// para convertir cualquier venta a unidades.
// ─────────────────────────────────────────────────────────────────────────────

let presentationSeq = 0;
/** Id local único para un renglón de presentación (solo de UI — no es el id de fila de Postgres). */
export function makePresentationId() {
  presentationSeq += 1;
  return `pres_${Date.now()}_${presentationSeq}`;
}

/**
 * Presentaciones por defecto para el formulario "Nuevo Producto": TODO
 * producto de Inventario arranca con estas dos, obligatorias — "Unidad"
 * (unidad mínima, multiplicador fijo en 1) y "Pack" (multiplicador
 * configurable, 6 por defecto). El usuario puede agregar más encima (ej.
 * "Caja"), pero estas dos no se pueden borrar — ver `locked` más abajo.
 */
export function buildDefaultPresentations() {
  return [
    // isBase: true bloquea el multiplicador en 1 en la UI — se identifica
    // por este flag, no por el nombre, para que renombrar "Unidad" (ej. a
    // "Suelto") no le haga perder su rol de unidad base.
    { id: makePresentationId(), name: "Unidad", multiplier: 1, price: "", barcode: "", locked: true, isBase: true },
    { id: makePresentationId(), name: "Pack",   multiplier: 6, price: "", barcode: "", locked: true, isBase: false },
  ];
}

/** Renglón vacío para "+ Agregar presentación" (ej. una tercera fila "Caja"). */
export function buildEmptyPresentation() {
  return { id: makePresentationId(), name: "", multiplier: "", price: "", barcode: "", locked: false, isBase: false };
}

/**
 * Valida el array de presentaciones antes de guardar un producto de
 * Inventario. Devuelve { ok: true } o { ok: false, error }.
 *   - Debe haber EXACTAMENTE una presentación base (multiplicador === 1):
 *     la "Unidad" — es la que define qué es "1 unidad de stock".
 *   - El resto debe tener nombre, multiplicador > 1 y precio > 0.
 *   - Ningún multiplicador ni código de barras puede repetirse.
 */
export function validatePresentations(presentations) {
  if (!Array.isArray(presentations) || presentations.length < 2) {
    return { ok: false, error: 'Debes registrar al menos las presentaciones "Unidad" y "Pack".' };
  }

  const baseRows = presentations.filter(p => Number(p.multiplier) === 1);
  if (baseRows.length !== 1) {
    return { ok: false, error: 'Debe existir exactamente una presentación base con multiplicador 1 (la "Unidad").' };
  }
  const base = baseRows[0];
  if (!(Number(base.price) > 0)) {
    return { ok: false, error: 'La presentación "Unidad" necesita un precio de venta mayor a 0.' };
  }

  const seenMultipliers = new Set();
  for (const p of presentations) {
    const name = String(p.name || "").trim();
    const multiplier = Number(p.multiplier);
    const price = Number(p.price);
    if (!name) return { ok: false, error: "Cada presentación necesita un nombre (ej: Unidad, Pack, Caja)." };
    if (!multiplier || multiplier <= 0) return { ok: false, error: `"${name}": el multiplicador de stock debe ser mayor a 0.` };
    if (!(price > 0)) return { ok: false, error: `"${name}": el precio de venta debe ser mayor a 0.` };
    if (seenMultipliers.has(multiplier)) {
      return { ok: false, error: `Ya hay otra presentación con multiplicador ${multiplier} — cada presentación necesita un multiplicador distinto.` };
    }
    seenMultipliers.add(multiplier);
  }

  const barcodes = presentations.map(p => String(p.barcode || "").trim()).filter(Boolean);
  if (new Set(barcodes).size !== barcodes.length) {
    return { ok: false, error: "Dos presentaciones no pueden compartir el mismo código de barras." };
  }

  return { ok: true };
}

/**
 * Deriva los campos "planos" que el resto de la app (tabla, ficha, ajuste
 * de stock, RLS, exportaciones) todavía lee directamente de products —
 * price, packQty, barcode — a partir del array de presentaciones. Se llama
 * justo antes de guardar, para que esos consumidores sigan funcionando sin
 * cambios mientras no se migran a leer `presentations` directamente:
 *   - price / barcode → los de la presentación base (multiplicador 1).
 *   - packQty         → el multiplicador de la presentación de empaque más
 *                        chica por encima de 1 (normalmente "Pack"), para
 *                        que "Ajustar stock en empaques" siga funcionando.
 */
export function deriveLegacyFieldsFromPresentations(presentations) {
  const base = presentations.find(p => Number(p.multiplier) === 1) || null;
  const packRows = presentations
    .filter(p => Number(p.multiplier) > 1)
    .sort((a, b) => Number(a.multiplier) - Number(b.multiplier));
  const pack = packRows[0] || null;
  return {
    price: Number(base?.price) || 0,
    barcode: String(base?.barcode || "").trim(),
    packQty: pack ? Number(pack.multiplier) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POS — vender por presentación (Unidad / Pack / Caja...)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Presentaciones vendibles de un producto, para el selector del POS.
 * Funciona igual con productos NUEVOS (presentations[] ya poblado desde
 * "Nuevo Producto") y con productos LEGADO (creados antes de esta función,
 * o importados por Excel — presentations = [] pero sí tienen los campos
 * sueltos price/packQty/barcode): para estos últimos se sintetiza una
 * "Unidad" (id fijo "legacy_unidad", igual que antes: vender 1 = descuenta
 * 1) y, si el producto tiene packQty > 1, un "Empaque" (id fijo
 * "legacy_pack", precio = price × packQty, sin descuento por volumen
 * propio ya que nunca se le definió uno) — record_sale() reconoce estos dos
 * ids especiales y recalcula ambos SIEMPRE contra products.price/pack_qty
 * reales (ver 0020_record_sale_by_presentation.sql), nunca contra lo que
 * mande el carrito.
 */
export function getSellablePresentations(product) {
  if (Array.isArray(product.presentations) && product.presentations.length > 0) {
    return product.presentations;
  }
  const legacy = [
    { id: "legacy_unidad", name: "Unidad", multiplier: 1, price: Number(product.price) || 0, barcode: product.barcode || "" },
  ];
  if (Number(product.packQty) > 1) {
    legacy.push({
      id: "legacy_pack", name: "Empaque", multiplier: Number(product.packQty),
      price: (Number(product.price) || 0) * Number(product.packQty), barcode: "",
    });
  }
  return legacy;
}

/** Busca, entre TODOS los productos, cuál presentación tiene este código de barras (o el barcode/sku del propio producto → su presentación "Unidad"). Para el escáner del POS. */
export function findPresentationByCode(products, code) {
  for (const product of products) {
    if (product.barcode === code || product.sku === code) {
      const presentations = getSellablePresentations(product);
      const base = presentations.find(p => Number(p.multiplier) === 1) || presentations[0];
      return { product, presentation: base };
    }
    const presentations = getSellablePresentations(product);
    const match = presentations.find(p => p.barcode && p.barcode === code);
    if (match) return { product, presentation: match };
  }
  return null;
}

/**
 * Presentaciones de un producto EXISTENTE, listas para el editor de
 * "Editar Producto" (PresentationsEditor) — funciona igual con productos
 * nuevos (ya tienen presentations[]) y con legado (se sintetizan desde
 * price/packQty vía getSellablePresentations, pero con ids FRESCOS en vez
 * de los sentinelas "legacy_unidad"/"legacy_pack" — esos ids son solo para
 * que el POS reconozca la venta legado en record_sale(); si el usuario
 * edita y guarda, deben quedar como presentaciones reales con su propio id).
 * Solo la fila base (multiplicador 1) queda bloqueada/no-removible al
 * editar — a diferencia de "Nuevo Producto", acá SÍ se puede quitar la
 * presentación de empaque si ya no se vende así.
 */
export function toEditablePresentations(product) {
  return getSellablePresentations(product).map(p => {
    const isBase = Number(p.multiplier) === 1;
    return {
      id: String(p.id || "").startsWith("legacy_") ? makePresentationId() : p.id,
      name: p.name, multiplier: p.multiplier, price: p.price, barcode: p.barcode || "",
      locked: isBase, isBase,
    };
  });
}
