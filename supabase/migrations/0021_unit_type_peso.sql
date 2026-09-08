-- ═══════════════════════════════════════════════════════════════════════════
-- 0021_unit_type_peso.sql
--
-- Soporte para productos que se venden/compran por PESO (ej. azúcar, arroz
-- a granel) en vez de por unidad discreta. unit_type es puramente
-- descriptivo — le dice al FRONTEND si debe aceptar decimales y mostrar
-- "Kg" en vez de "unidades" — no cambia ninguna función ni política RLS,
-- porque TODAS las columnas de cantidad (stock, qty, pack_qty, etc.) ya son
-- numeric(14,3) desde 0001_schema.sql: el backend siempre soportó
-- decimales, solo el frontend forzaba números enteros en varios lugares.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.products
  add column if not exists unit_type text not null default 'unidad';
alter table public.products
  add constraint products_unit_type_check check (unit_type in ('unidad', 'peso'));
comment on column public.products.unit_type is
  'unidad = cuenta discreta (1,2,3...); peso = vendido/comprado por Kg — admite decimales (ver InventoryModule.jsx / MovementsModule.jsx).';

alter table public.warehouse_products
  add column if not exists unit_type text not null default 'unidad';
alter table public.warehouse_products
  add constraint warehouse_products_unit_type_check check (unit_type in ('unidad', 'peso'));
comment on column public.warehouse_products.unit_type is
  'unidad = cajas/packs discretos; peso = Kg a granel — admite decimales.';
