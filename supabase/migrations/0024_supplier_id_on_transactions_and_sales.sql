-- ═══════════════════════════════════════════════════════════════════════════
-- 0024_supplier_id_on_transactions_and_sales.sql
--
-- BUG ENCONTRADO EN REVISIÓN: el historial de compras/ventas de un proveedor
-- en SuppliersModule.jsx (supplierOrders / supplierSalesHistory) filtra por
-- NOMBRE (`t.supplier === selSupplier.name`), porque transactions y
-- supplier_sales solo guardan el nombre del proveedor como texto — nunca
-- guardaron su id, aunque record_purchase/record_warehouse_purchase ya
-- reciben p_supplier_id (lo usaban solo para actualizar las estadísticas
-- agregadas de suppliers, nunca para guardarlo en la fila). Si se renombra
-- un proveedor, todo su historial anterior deja de aparecer en su ficha.
--
-- Arreglo: agregar supplier_id a ambas tablas, hacer backfill con lo que
-- todavía se puede resolver por nombre, y guardar el id de ahora en
-- adelante en las 3 rutas que crean estas filas (compra a Inventario,
-- compra a Almacén, venta a proveedor).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Columnas nuevas ──────────────────────────────────────────────────────
alter table public.transactions
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.supplier_sales
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

create index if not exists transactions_supplier_id_idx on public.transactions(supplier_id) where supplier_id is not null;
create index if not exists supplier_sales_supplier_id_idx on public.supplier_sales(supplier_id) where supplier_id is not null;

-- ── Backfill de lo existente ─────────────────────────────────────────────
-- Solo puede recuperar filas cuyo texto `supplier` todavía coincide con el
-- nombre ACTUAL de algún proveedor de la misma empresa. Si un proveedor ya
-- fue renombrado antes de esta migración, esas filas viejas no se pueden
-- recuperar (no hay forma de saber a cuál correspondían) y quedan con
-- supplier_id null — igual que hoy, pero no empeora nada.
update public.transactions t
  set supplier_id = s.id
  from public.suppliers s
  where t.company_id = s.company_id
    and t.supplier_id is null
    and t.supplier is not null and t.supplier <> ''
    and t.supplier = s.name;

update public.supplier_sales ss
  set supplier_id = s.id
  from public.suppliers s
  where ss.company_id = s.company_id
    and ss.supplier_id is null
    and ss.supplier is not null and ss.supplier <> ''
    and ss.supplier = s.name;

-- ── record_purchase() — ahora SÍ guarda supplier_id en la fila ─────────────
create or replace function public.record_purchase(
  p_company        uuid,
  p_supplier_id    uuid,
  p_supplier_name  text,
  p_product_id     uuid,
  p_product_name   text,
  p_sku            text,
  p_description    text,
  p_qty            numeric,
  p_unit_cost      numeric,
  p_total          numeric,
  p_note           text,
  p_user_name      text,
  p_pack_mode      boolean default false,
  p_pack_qty       numeric default 0,
  p_pack_name      text default '',
  p_base_unit_name text default '',
  p_client_date    date default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_tx_id uuid;
  v_stock numeric; v_min_stock numeric; v_new_stock numeric;
  v_orders integer; v_spent numeric;
  v_total numeric := p_qty * p_unit_cost;
  v_date date := coalesce(p_client_date, current_date);
begin
  if not public.has_perm(p_company,'registrar_compras') then
    raise exception 'No autorizado.';
  end if;

  insert into public.transactions (
    company_id, type, date, product, sku, description, qty, unit_cost, total,
    supplier, supplier_id, note, created_by, pack_mode, pack_qty, pack_name, base_unit_name
  ) values (
    p_company, 'compra', v_date, p_product_name, p_sku, coalesce(p_description,''), p_qty, p_unit_cost, v_total,
    p_supplier_name, p_supplier_id, coalesce(p_note,''), p_user_name,
    p_pack_mode, case when p_pack_mode then p_pack_qty else 0 end,
    case when p_pack_mode then p_pack_name else '' end, case when p_pack_mode then p_base_unit_name else '' end
  ) returning id into v_tx_id;

  select stock, min_stock into v_stock, v_min_stock
    from public.products where id = p_product_id and company_id = p_company for update;
  if found then
    v_new_stock := v_stock + p_qty;
    update public.products
      set stock = v_new_stock, cost = p_unit_cost, status = public._stock_status(v_new_stock, v_min_stock), updated_at = now()
      where id = p_product_id;
    insert into public.product_history (company_id, product_id, date, action, qty, user_name)
      values (p_company, p_product_id, v_date, 'Compra', p_qty, p_user_name);
  end if;

  if p_supplier_id is not null then
    select total_orders, total_spent into v_orders, v_spent
      from public.suppliers where id = p_supplier_id and company_id = p_company for update;
    if found then
      update public.suppliers
        set total_orders = coalesce(v_orders,0) + 1, total_spent = coalesce(v_spent,0) + v_total,
            last_order = v_date::text, updated_at = now()
        where id = p_supplier_id;
    end if;
  end if;

  return v_tx_id;
end;
$$;
-- Mismo nombre y misma firma que 0013 — CREATE OR REPLACE alcanza, no hace
-- falta drop/regrant.

-- ── record_warehouse_purchase() — ídem, ahora guarda supplier_id ──────────
create or replace function public.record_warehouse_purchase(
  p_company               uuid,
  p_supplier_id           uuid,
  p_supplier_name         text,
  p_warehouse_product_id  uuid,
  p_warehouse_product_name text,
  p_sku                   text,
  p_description            text,
  p_location_id            uuid,
  p_location_name          text,
  p_pack_count             numeric,
  p_pack_name              text,
  p_pack_qty               numeric,
  p_unit_cost              numeric,
  p_note                   text,
  p_user_name              text,
  p_client_date            date default null,
  p_client_time            text default null
)
returns numeric
language plpgsql security definer
set search_path = public
as $$
declare
  v_total numeric := p_pack_count * p_unit_cost;
  v_orders integer; v_spent numeric;
  v_date date := coalesce(p_client_date, current_date);
  v_time text := coalesce(p_client_time, to_char(now(),'HH24:MI'));
begin
  if not public.has_perm(p_company,'registrar_compras') then
    raise exception 'No autorizado.';
  end if;

  insert into public.transactions (
    company_id, type, target, date, time, product, sku, description, qty,
    pack_name, pack_qty, unit_cost, total, supplier, supplier_id, location_id, location_name, note, created_by
  ) values (
    p_company, 'compra', 'almacen', v_date, v_time, p_warehouse_product_name, p_sku, coalesce(p_description,''), p_pack_count,
    p_pack_name, p_pack_qty, p_unit_cost, v_total, p_supplier_name, p_supplier_id, p_location_id, p_location_name, coalesce(p_note,''), p_user_name
  );

  perform public.add_warehouse_movement(
    p_company            => p_company,
    p_type                => 'entrada',
    p_product_id          => p_warehouse_product_id,
    p_product_name        => p_warehouse_product_name,
    p_sku                 => p_sku,
    p_qty                 => p_pack_count,
    p_to_location_id      => p_location_id,
    p_to_location_name    => p_location_name,
    p_reason              => 'Compra a proveedor: ' || p_supplier_name,
    p_user_name           => p_user_name,
    p_pack_name           => p_pack_name,
    p_pack_qty            => p_pack_qty,
    p_client_date         => v_date,
    p_client_time         => v_time
  );

  if p_supplier_id is not null then
    select total_orders, total_spent into v_orders, v_spent
      from public.suppliers where id = p_supplier_id and company_id = p_company for update;
    if found then
      update public.suppliers
        set total_orders = coalesce(v_orders,0)+1, total_spent = coalesce(v_spent,0) + v_total,
            last_order = v_date::text, updated_at = now()
        where id = p_supplier_id;
    end if;
  end if;

  return v_total;
end;
$$;
-- Mismo nombre y misma firma que 0013 — CREATE OR REPLACE alcanza.

-- ── sell_warehouse_to_supplier() — + p_supplier_id (parámetro nuevo) ──────
-- Cambia el número de argumentos (se agrega p_supplier_id al final con
-- default), así que Postgres lo trata como una firma distinta: hay que
-- tumbar la versión vieja de 17 parámetros para que no queden las dos.
create or replace function public.sell_warehouse_to_supplier(
  p_company                uuid,
  p_warehouse_product_id   uuid,
  p_warehouse_product_name text,
  p_sku                    text,
  p_description            text,
  p_location_id            uuid,
  p_location_name          text,
  p_pack_count             numeric,
  p_pack_name              text,
  p_pack_qty               numeric,
  p_unit_price_per_pack    numeric,
  p_supplier_name          text,
  p_note                   text,
  p_user_name              text,
  p_status                 text default 'Entregado',
  p_client_date            date default null,
  p_client_time            text default null,
  p_supplier_id            uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_total numeric := p_pack_count * p_unit_price_per_pack;
  v_sale_id uuid;
  v_date date := coalesce(p_client_date, current_date);
  v_time text := coalesce(p_client_time, to_char(now(),'HH24:MI'));
begin
  if not public.has_perm(p_company,'gestionar_proveedores') then
    raise exception 'No autorizado.';
  end if;

  if coalesce(p_status, 'Entregado') <> 'Cancelado' then
    perform public.add_warehouse_movement(
      p_company            => p_company,
      p_type                => 'salida',
      p_product_id          => p_warehouse_product_id,
      p_product_name        => p_warehouse_product_name,
      p_sku                 => p_sku,
      p_qty                 => p_pack_count,
      p_from_location_id    => p_location_id,
      p_from_location_name  => p_location_name,
      p_reason              => 'Venta a proveedor: ' || p_supplier_name,
      p_user_name           => p_user_name,
      p_pack_name           => p_pack_name,
      p_pack_qty            => p_pack_qty,
      p_client_date         => v_date,
      p_client_time         => v_time
    );
  end if;

  insert into public.supplier_sales (
    company_id, supplier, supplier_id, product, description, sku, qty, pack_name, pack_qty,
    unit_price, total, status, note, warehouse_product_id, location_id, location_name, date
  ) values (
    p_company, p_supplier_name, p_supplier_id, p_warehouse_product_name, coalesce(p_description,''), coalesce(p_sku,''),
    p_pack_count, p_pack_name, p_pack_qty, p_unit_price_per_pack, v_total, coalesce(p_status,'Entregado'),
    coalesce(p_note,''), p_warehouse_product_id, p_location_id, p_location_name, v_date
  ) returning id into v_sale_id;

  return v_sale_id;
end;
$$;
drop function if exists public.sell_warehouse_to_supplier(uuid,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,text,text,text,text,date,text);
revoke all on function public.sell_warehouse_to_supplier(uuid,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,text,text,text,text,date,text,uuid) from public;
grant execute on function public.sell_warehouse_to_supplier(uuid,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,text,text,text,text,date,text,uuid) to authenticated;
