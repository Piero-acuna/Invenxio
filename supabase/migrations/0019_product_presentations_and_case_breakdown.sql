-- ═══════════════════════════════════════════════════════════════════════════
-- 0019_product_presentations_and_case_breakdown.sql
--
-- Soporta la jerarquía de abastecimiento de 3 niveles Caja → Packs →
-- Unidades sueltas, centralizando el stock en una única base (unidades):
--
--   1. ALMACÉN: "cuántos Packs trae la Caja" × "cuántas Unidades trae cada
--      Pack" se guardan por separado (packs_per_case / units_per_pack) SOLO
--      como desglose informativo/editable — pack_qty sigue siendo la ÚNICA
--      cifra que el resto del sistema (RPCs de almacén, envío a tienda,
--      movimientos) usa como "unidades totales por caja", exactamente igual
--      que antes. El frontend calcula pack_qty = packs_per_case *
--      units_per_pack y lo manda como siempre — ver src/utils/packaging.js
--      (calcUnitsPerCase) y src/modules/InventoryModule.jsx.
--
--   2. INVENTARIO (Tienda): products.presentations guarda el array de
--      formas de venta de un producto — Unidad, Pack, Caja, etc. — cada una
--      con su propio multiplicador de stock (en unidades base), precio y
--      código de barras. products.price / products.pack_qty / products.barcode
--      NO se eliminan: siguen siendo la fuente de verdad para el resto de
--      la app (tabla, ficha, ajuste de stock, POS, RLS...) mientras esos
--      consumidores no se migran a leer `presentations` directamente. El
--      frontend los deriva de `presentations` antes de guardar (ver
--      deriveLegacyFieldsFromPresentations en packaging.js): price/barcode
--      vienen de la presentación con multiplicador 1 ("Unidad"), pack_qty
--      del multiplicador de la siguiente presentación de empaque ("Pack").
--
-- No se necesitan cambios de RLS: 0002_rls.sql asegura estas tablas a nivel
-- de FILA (company_id), no de columna — cualquier columna nueva queda
-- automáticamente cubierta por las policies ya existentes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── PRODUCTS: presentaciones de venta ───────────────────────────────────────
alter table public.products
  add column if not exists presentations jsonb not null default '[]'::jsonb;

comment on column public.products.presentations is
  'Array [{id,name,multiplier,price,barcode}] de formas de venta del producto, '
  'en unidades base (multiplier=1 = "Unidad"). Es la fuente de verdad nueva; '
  'products.price/pack_qty/barcode se siguen escribiendo en paralelo, derivados '
  'de este array, por compatibilidad con el resto de la app (ver packaging.js).';

-- Sanity check liviano: solo valida que sea un array (la validación de
-- negocio real — multiplicador base único, precios > 0, sin duplicados —
-- vive en el frontend, ver validatePresentations() en packaging.js, igual
-- que el resto de las reglas de negocio de este proyecto).
alter table public.products
  add constraint products_presentations_is_array
  check (jsonb_typeof(presentations) = 'array');

-- ── WAREHOUSE_PRODUCTS: desglose Caja → Packs → Unidades ───────────────────
alter table public.warehouse_products
  add column if not exists packs_per_case numeric(14,3),
  add column if not exists units_per_pack numeric(14,3);

comment on column public.warehouse_products.packs_per_case is
  'Cuántos Packs trae 1 Caja — desglose informativo. pack_qty (unidades '
  'totales por caja) sigue siendo packs_per_case * units_per_pack.';
comment on column public.warehouse_products.units_per_pack is
  'Cuántas Unidades sueltas trae 1 Pack — desglose informativo de pack_qty.';

alter table public.warehouse_products
  add constraint warehouse_products_packs_per_case_nonneg check (packs_per_case is null or packs_per_case >= 0),
  add constraint warehouse_products_units_per_pack_nonneg check (units_per_pack is null or units_per_pack >= 0);
