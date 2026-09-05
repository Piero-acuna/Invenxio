-- ═══════════════════════════════════════════════════════════════════════════
-- 0020_backfill_default_presentations.sql
--
-- record_sale_v2() y el nuevo POS (MovementsModule.jsx) SOLO venden por
-- product_presentations — ya no existe un camino paralelo por
-- products.price directo. Sin este backfill, cualquier producto creado
-- ANTES de 0019 (o sea, todo tu catálogo actual) quedaría sin ninguna
-- presentación y por lo tanto invendible en el POS nuevo.
--
-- Idempotente: solo inserta si el producto todavía no tiene ninguna
-- presentación marcada is_default_sale — correr esto 2 veces no duplica
-- nada.
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.product_presentations (company_id, product_id, name, factor, price, is_default_sale, active)
select
  p.company_id,
  p.id,
  case when p.unit_type = 'peso' then 'Kilogramo' else 'Unidad' end,
  1,
  p.price,
  true,
  true
from public.products p
where not exists (
  select 1 from public.product_presentations pp
  where pp.product_id = p.id and pp.is_default_sale = true
);
