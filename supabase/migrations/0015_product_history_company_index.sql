-- ═══════════════════════════════════════════════════════════════════════════
-- 0015_product_history_company_index.sql
--
-- Hasta ahora `product_history` solo se consultaba por producto individual
-- (ficha de un producto en Inventario), y el único índice que tenía era
-- (product_id, created_at desc). Con el fix del Historial general que ahora
-- también trae los ajustes manuales de stock (mermas/correcciones) de TODA
-- la empresa — ver MovementsModule.jsx / TransactionHistory.jsx — la
-- consulta pasa a filtrar por company_id y ordenar por created_at, que sin
-- este índice haría un escaneo secuencial de toda la tabla.
-- ═══════════════════════════════════════════════════════════════════════════
create index if not exists product_history_company_id_created_at_idx
  on public.product_history(company_id, created_at desc);
