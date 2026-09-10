-- ─────────────────────────────────────────────────────────────────────────────
-- 0023_product_expiry_lots.sql
--
-- Reemplaza el enfoque de "una fecha de entrada / una fecha de caducidad
-- por producto" (0022_product_entry_expiry_dates.sql) por una lista de
-- LOTES por producto: el mismo producto puede recibir varios ingresos con
-- caducidades distintas (ej. un lote vence el 10/03 y otro, del mismo
-- producto, el 22/05) y ninguno es obligatorio — un producto puede no
-- tener ningún lote, uno, o varios.
--
-- Las columnas entry_date/expiry_date agregadas en 0022 se dejan tal cual
-- (no se borran ni se migran solas) — si tenían algún dato ya cargado no se
-- pierde, pero el código de la app ya no las lee ni las escribe: toda la
-- UI pasa a usar esta tabla. Se pueden eliminar en una migración futura si
-- se confirma que no se necesitan.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.product_expiry_lots (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  -- 'inventario' → products.id (catálogo de Tienda) | 'almacen' → warehouse_products.id.
  -- No es una FK real porque el padre depende de `catalog` (dos tablas
  -- distintas) — Postgres no soporta FK condicional; la integridad se
  -- valida en la app (siempre a través de expiryLots.js).
  catalog      text not null check (catalog in ('inventario','almacen')),
  product_id   uuid not null,
  qty          numeric(14,3),        -- opcional: cantidad de ESE lote (no obligatorio)
  entry_date   date,                 -- opcional
  expiry_date  date not null,        -- razón de ser de la fila — si no tiene caducidad, no es un "lote de caducidad"
  note         text,
  created_at   timestamptz not null default now()
);
create index product_expiry_lots_company_idx  on public.product_expiry_lots(company_id);
create index product_expiry_lots_product_idx  on public.product_expiry_lots(company_id, catalog, product_id);
create index product_expiry_lots_expiry_idx   on public.product_expiry_lots(company_id, expiry_date);

alter table public.product_expiry_lots enable row level security;

-- Mismos permisos que ya existen para cada catálogo (products / warehouse_products)
-- — ver 0002_rls.sql — separados por `catalog` porque un lote de Inventario
-- y uno de Almacén se gobiernan por permisos distintos.
create policy product_expiry_lots_select on public.product_expiry_lots
  for select using (
    (catalog = 'inventario' and (
      public.has_perm(company_id,'ver_inventario') or public.has_perm(company_id,'crear_productos') or public.has_perm(company_id,'editar_productos')
    )) or
    (catalog = 'almacen' and (
      public.has_perm(company_id,'ver_almacen') or public.has_perm(company_id,'gestionar_almacen')
    ))
  );

create policy product_expiry_lots_insert on public.product_expiry_lots
  for insert with check (
    (catalog = 'inventario' and (
      public.has_perm(company_id,'crear_productos') or public.has_perm(company_id,'editar_productos')
    )) or
    (catalog = 'almacen' and public.has_perm(company_id,'gestionar_almacen'))
  );

create policy product_expiry_lots_update on public.product_expiry_lots
  for update using (
    (catalog = 'inventario' and public.has_perm(company_id,'editar_productos')) or
    (catalog = 'almacen' and public.has_perm(company_id,'gestionar_almacen'))
  );

create policy product_expiry_lots_delete on public.product_expiry_lots
  for delete using (
    (catalog = 'inventario' and (
      public.has_perm(company_id,'editar_productos') or public.has_perm(company_id,'eliminar_registros')
    )) or
    (catalog = 'almacen' and (
      public.has_perm(company_id,'gestionar_almacen') or public.has_perm(company_id,'eliminar_registros')
    ))
  );

alter publication supabase_realtime add table public.product_expiry_lots;
