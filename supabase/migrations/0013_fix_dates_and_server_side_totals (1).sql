-- ═══════════════════════════════════════════════════════════════════════════
-- 0013_fix_dates_and_server_side_totals.sql
--
-- Esta migración corrige 3 bugs encontrados en una revisión general:
--
-- BUG 1 — Fechas en el timezone equivocado (el más importante). Varias RPC
-- fechaban cada fila con `current_date` / `now()`, que Postgres evalúa en el
-- timezone DE LA BASE DE DATOS (UTC por defecto en Supabase) — no en el del
-- país de la empresa. Esta app tiene empresas en Perú y el resto de
-- Latinoamérica (todas detrás de UTC), así que cualquier venta/compra hecha
-- después de aprox. las 7pm hora local quedaba fechada al día SIGUIENTE,
-- porque para esa hora en el reloj de la base de datos ya era "mañana".
-- Rompía el historial, el gráfico diario/semanal y la fecha del comprobante.
--
-- Arreglo: se agrega un parámetro opcional `p_client_date` (y `p_client_time`
-- donde aplica) a cada función que fecha una fila — el navegador SÍ conoce
-- la hora local real de quien usa la app, así que el cliente se la manda
-- (ver src/utils/localDateTime.js). Si no viene (llamadas antiguas, u otro
-- origen), cae en el comportamiento anterior vía `coalesce(...,
-- current_date)` — no rompe nada que ya funcionaba.
--
-- BUG 2 — record_purchase() confiaba en `p_total` tal como lo mandaba el
-- cliente en vez de recalcularlo — inconsistente con record_warehouse_purchase
-- y sell_warehouse_to_supplier, que SÍ lo recalculan server-side. Se corrige
-- para que sea siempre qty × costo unitario, calculado acá adentro.
--
-- BUG 3 — send_warehouse_to_inventory() confiaba en `p_unit_qty` (empaques ×
-- unidades por empaque) calculado en el cliente, en vez de recalcularlo con
-- el pack_qty real guardado en warehouse_products — un cliente desactualizado
-- (u otra pestaña que cambió el pack_qty del producto mientras el formulario
-- estaba abierto) podía sumarle a la tienda una cantidad de unidades que no
-- correspondía a los empaques realmente descontados del almacén.
--
-- Cada función se agrega con un parámetro nuevo al final (incluidos los que
-- ya tenían default) y se DROPea la firma vieja — mismo patrón ya usado en
-- 0011_add_payment_method_to_sales.sql — para no dejar dos versiones
-- ambiguas de la misma función conviviendo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── adjust_product_stock() — + p_client_date ────────────────────────────────
create or replace function public.adjust_product_stock(
  p_company     uuid,
  p_product_id  uuid,
  p_type        text,   -- 'add' | 'remove'
  p_qty         numeric,
  p_user_name   text,
  p_client_date date default null
)
returns numeric
language plpgsql security definer
set search_path = public
as $$
declare
  v_stock numeric; v_min_stock numeric; v_new_stock numeric;
begin
  if not public.has_perm(p_company,'editar_productos') then
    raise exception 'No autorizado.';
  end if;

  select stock, min_stock into v_stock, v_min_stock
    from public.products where id = p_product_id and company_id = p_company
    for update;
  if not found then raise exception 'Producto no encontrado.'; end if;

  v_new_stock := case when p_type = 'add' then v_stock + p_qty else greatest(0, v_stock - p_qty) end;

  update public.products
    set stock = v_new_stock, status = public._stock_status(v_new_stock, v_min_stock), updated_at = now()
    where id = p_product_id;

  insert into public.product_history (company_id, product_id, date, action, qty, user_name)
  values (p_company, p_product_id, coalesce(p_client_date, current_date), case when p_type='add' then 'Ajuste +' else 'Ajuste -' end, p_qty, p_user_name);

  return v_new_stock;
end;
$$;
drop function if exists public.adjust_product_stock(uuid,uuid,text,numeric,text);
revoke all on function public.adjust_product_stock(uuid,uuid,text,numeric,text,date) from public;
grant execute on function public.adjust_product_stock(uuid,uuid,text,numeric,text,date) to authenticated;

-- ── record_purchase() — total recalculado server-side + p_client_date ──────
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
  p_total          numeric,  -- ya NO se usa para calcular nada (ver v_total); se
                              -- deja el parámetro solo para no romper la firma.
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
  v_total numeric := p_qty * p_unit_cost; -- BUG 2: antes se usaba p_total tal cual
  v_date date := coalesce(p_client_date, current_date);
begin
  if not public.has_perm(p_company,'registrar_compras') then
    raise exception 'No autorizado.';
  end if;

  insert into public.transactions (
    company_id, type, date, product, sku, description, qty, unit_cost, total,
    supplier, note, created_by, pack_mode, pack_qty, pack_name, base_unit_name
  ) values (
    p_company, 'compra', v_date, p_product_name, p_sku, coalesce(p_description,''), p_qty, p_unit_cost, v_total,
    p_supplier_name, coalesce(p_note,''), p_user_name,
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
drop function if exists public.record_purchase(uuid,uuid,text,uuid,text,text,text,numeric,numeric,numeric,text,text,boolean,numeric,text,text);
revoke all on function public.record_purchase(uuid,uuid,text,uuid,text,text,text,numeric,numeric,numeric,text,text,boolean,numeric,text,text,date) from public;
grant execute on function public.record_purchase(uuid,uuid,text,uuid,text,text,text,numeric,numeric,numeric,text,text,boolean,numeric,text,text,date) to authenticated;

-- ── add_warehouse_movement() — + p_client_date / p_client_time ─────────────
create or replace function public.add_warehouse_movement(
  p_company            uuid,
  p_type               text,   -- 'entrada' | 'salida' | 'traslado' | 'envio_inventario'
  p_product_id         uuid,
  p_product_name       text,
  p_sku                text,
  p_qty                numeric,
  p_from_location_id   uuid default null,
  p_from_location_name text default null,
  p_to_location_id     uuid default null,
  p_to_location_name   text default null,
  p_reason             text default '',
  p_user_name          text default null,
  p_pack_name          text default null,
  p_pack_qty           numeric default null,
  p_pack_price         numeric default null,
  p_client_date        date default null,
  p_client_time        text default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not (public.has_perm(p_company,'gestionar_almacen') or public.has_perm(p_company,'registrar_compras') or public.has_perm(p_company,'gestionar_proveedores')) then
    raise exception 'No autorizado.';
  end if;

  if p_type in ('entrada','traslado') then
    perform public.adjust_warehouse_stock(p_company, p_product_id, p_product_name, p_sku, p_to_location_id, p_to_location_name, p_qty);
  end if;
  if p_type in ('salida','traslado') then
    perform public.adjust_warehouse_stock(p_company, p_product_id, p_product_name, p_sku, p_from_location_id, p_from_location_name, -p_qty);
  end if;

  insert into public.warehouse_movements (
    company_id, type, product_id, product_name, sku, qty,
    from_location_id, from_location_name, to_location_id, to_location_name,
    reason, user_name, date, time, pack_name, pack_qty, pack_price
  ) values (
    p_company, p_type, p_product_id, p_product_name, p_sku, p_qty,
    p_from_location_id, p_from_location_name, p_to_location_id, p_to_location_name,
    coalesce(p_reason,''), p_user_name, coalesce(p_client_date, current_date),
    coalesce(p_client_time, to_char(now(),'HH24:MI')), p_pack_name, p_pack_qty, p_pack_price
  ) returning id into v_id;

  return v_id;
end;
$$;
drop function if exists public.add_warehouse_movement(uuid,text,uuid,text,text,numeric,uuid,text,uuid,text,text,text,text,numeric,numeric);
revoke all on function public.add_warehouse_movement(uuid,text,uuid,text,text,numeric,uuid,text,uuid,text,text,text,text,numeric,numeric,date,text) from public;
grant execute on function public.add_warehouse_movement(uuid,text,uuid,text,text,numeric,uuid,text,uuid,text,text,text,text,numeric,numeric,date,text) to authenticated;

-- ── record_warehouse_purchase() — + p_client_date / p_client_time ──────────
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
    pack_name, pack_qty, unit_cost, total, supplier, location_id, location_name, note, created_by
  ) values (
    p_company, 'compra', 'almacen', v_date, v_time, p_warehouse_product_name, p_sku, coalesce(p_description,''), p_pack_count,
    p_pack_name, p_pack_qty, p_unit_cost, v_total, p_supplier_name, p_location_id, p_location_name, coalesce(p_note,''), p_user_name
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
drop function if exists public.record_warehouse_purchase(uuid,uuid,text,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,text,text);
revoke all on function public.record_warehouse_purchase(uuid,uuid,text,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,text,text,date,text) from public;
grant execute on function public.record_warehouse_purchase(uuid,uuid,text,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,text,text,date,text) to authenticated;

-- ── record_sale() — + p_client_date ─────────────────────────────────────────
create or replace function public.record_sale(
  p_company        uuid,
  p_cart           jsonb,
  p_user_name      text,
  p_client_name    text default 'Cliente',
  p_payment_method text default 'Efectivo',
  p_client_date    date default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_product_id uuid;
  v_item_name text;
  v_item_qty numeric;
  v_price numeric; v_description text; v_stock numeric; v_min_stock numeric; v_new_stock numeric;
  v_tx_ids uuid[] := '{}';
  v_tx_id uuid;
  v_date date := coalesce(p_client_date, current_date);
begin
  if not public.has_perm(p_company,'registrar_ventas') then
    raise exception 'No autorizado.';
  end if;
  if jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) = 0 then
    raise exception 'El carrito está vacío.';
  end if;

  perform 1 from public.products
    where company_id = p_company
      and id in (select (elem->>'id')::uuid from jsonb_array_elements(p_cart) elem)
    order by id
    for update;

  for v_item in select * from jsonb_array_elements(p_cart) loop
    v_product_id := (v_item->>'id')::uuid;
    v_item_qty   := (v_item->>'qty')::numeric;
    select stock into v_stock from public.products where id = v_product_id and company_id = p_company;
    if not found then
      raise exception 'El producto "%" ya no existe.', coalesce(v_item->>'name','');
    end if;
    if v_stock < v_item_qty then
      raise exception 'Stock insuficiente para "%": quedan %, se intentó vender %.', v_item->>'name', v_stock, v_item_qty;
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(p_cart) loop
    v_product_id := (v_item->>'id')::uuid;
    v_item_name  := v_item->>'name';
    v_item_qty   := (v_item->>'qty')::numeric;

    select price, description, stock, min_stock into v_price, v_description, v_stock, v_min_stock
      from public.products where id = v_product_id and company_id = p_company;

    v_new_stock := v_stock - v_item_qty;

    insert into public.transactions (
      company_id, type, date, product, sku, description, qty, unit_price, total, client, note, created_by,
      pack_mode, pack_qty, pack_name, base_unit_name, payment_method
    ) values (
      p_company, 'venta', v_date, v_item_name, v_item->>'sku', coalesce(v_description,''), v_item_qty,
      v_price, v_price * v_item_qty, coalesce(p_client_name,'Cliente'), '', p_user_name,
      coalesce((v_item->>'packMode')::boolean,false), coalesce((v_item->>'packQty')::numeric,0),
      coalesce(v_item->>'packName',''), coalesce(v_item->>'baseUnitName',''), coalesce(p_payment_method,'Efectivo')
    ) returning id into v_tx_id;

    v_tx_ids := v_tx_ids || v_tx_id;

    update public.products
      set stock = v_new_stock, status = public._stock_status(v_new_stock, v_min_stock), updated_at = now()
      where id = v_product_id;

    insert into public.product_history (company_id, product_id, date, action, qty, user_name)
      values (p_company, v_product_id, v_date, 'Venta', v_item_qty, p_user_name);
  end loop;

  return to_jsonb(v_tx_ids);
end;
$$;
drop function if exists public.record_sale(uuid,jsonb,text,text,text);
revoke all on function public.record_sale(uuid,jsonb,text,text,text,date) from public;
grant execute on function public.record_sale(uuid,jsonb,text,text,text,date) to authenticated;

-- ── send_warehouse_to_inventory() — unit_qty recalculado server-side desde
--    el pack_qty REAL del producto de almacén + p_client_date/p_client_time ─
create or replace function public.send_warehouse_to_inventory(
  p_company               uuid,
  p_warehouse_product_id  uuid,
  p_warehouse_product_name text,
  p_sku                    text,
  p_location_id            uuid,
  p_location_name          text,
  p_pack_count             numeric,
  p_pack_name              text,
  p_unit_qty               numeric,  -- ya NO se usa (ver BUG 3 / v_unit_qty); se
                                      -- deja el parámetro para no romper la firma.
  p_store_product_id       uuid,
  p_store_product_name     text,
  p_reason                 text,
  p_user_name              text,
  p_client_date            date default null,
  p_client_time            text default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_stock numeric; v_min_stock numeric; v_new_stock numeric; v_movement_id uuid;
  v_pack_qty numeric;
  v_unit_qty numeric;
  v_date date := coalesce(p_client_date, current_date);
  v_time text := coalesce(p_client_time, to_char(now(),'HH24:MI'));
begin
  if not public.has_perm(p_company,'gestionar_almacen') then
    raise exception 'No autorizado.';
  end if;

  -- BUG 3: antes se confiaba en p_unit_qty (calculado en el cliente) para
  -- decidir cuánto stock sumarle a la tienda — acá se recalcula con el
  -- pack_qty REAL guardado en warehouse_products, para que nunca pueda
  -- quedar desalineado de lo que efectivamente se descontó del almacén.
  select pack_qty into v_pack_qty
    from public.warehouse_products where id = p_warehouse_product_id and company_id = p_company;
  if not found then raise exception 'El producto de almacén ya no existe.'; end if;
  v_unit_qty := p_pack_count * coalesce(v_pack_qty, 1);

  perform public.adjust_warehouse_stock(p_company, p_warehouse_product_id, p_warehouse_product_name, p_sku, p_location_id, p_location_name, -p_pack_count);

  select stock, min_stock into v_stock, v_min_stock
    from public.products where id = p_store_product_id and company_id = p_company for update;
  if not found then raise exception 'El producto de tienda seleccionado ya no existe.'; end if;

  v_new_stock := coalesce(v_stock,0) + v_unit_qty;
  update public.products
    set stock = v_new_stock, status = public._stock_status(v_new_stock, coalesce(v_min_stock,0)), updated_at = now()
    where id = p_store_product_id;

  insert into public.product_history (company_id, product_id, date, action, qty, user_name, note)
    values (p_company, p_store_product_id, v_date, 'Recibido de Almacén', v_unit_qty, p_user_name,
            'Desde: ' || p_pack_count || ' ' || coalesce(p_pack_name,'empaque(s)') || ' de ' || p_warehouse_product_name);

  insert into public.warehouse_movements (
    company_id, type, product_id, product_name, sku, qty, unit_qty, pack_name,
    from_location_id, from_location_name, store_product_id, store_product_name,
    reason, user_name, date, time
  ) values (
    p_company, 'envio_inventario', p_warehouse_product_id, p_warehouse_product_name, p_sku, p_pack_count, v_unit_qty, p_pack_name,
    p_location_id, p_location_name, p_store_product_id, p_store_product_name,
    coalesce(p_reason,''), p_user_name, v_date, v_time
  ) returning id into v_movement_id;

  return v_movement_id;
end;
$$;
drop function if exists public.send_warehouse_to_inventory(uuid,uuid,text,text,uuid,text,numeric,text,numeric,uuid,text,text,text);
revoke all on function public.send_warehouse_to_inventory(uuid,uuid,text,text,uuid,text,numeric,text,numeric,uuid,text,text,text,date,text) from public;
grant execute on function public.send_warehouse_to_inventory(uuid,uuid,text,text,uuid,text,numeric,text,numeric,uuid,text,text,text,date,text) to authenticated;

-- ── sell_warehouse_to_supplier() — + p_client_date / p_client_time ─────────
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
  p_client_time            text default null
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

  insert into public.supplier_sales (
    company_id, supplier, product, description, sku, qty, pack_name, pack_qty,
    unit_price, total, status, note, warehouse_product_id, location_id, location_name, date
  ) values (
    p_company, p_supplier_name, p_warehouse_product_name, coalesce(p_description,''), coalesce(p_sku,''),
    p_pack_count, p_pack_name, p_pack_qty, p_unit_price_per_pack, v_total, coalesce(p_status,'Entregado'),
    coalesce(p_note,''), p_warehouse_product_id, p_location_id, p_location_name, v_date
  ) returning id into v_sale_id;

  return v_sale_id;
end;
$$;
drop function if exists public.sell_warehouse_to_supplier(uuid,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,text,text,text,text);
revoke all on function public.sell_warehouse_to_supplier(uuid,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,text,text,text,text,date,text) from public;
grant execute on function public.sell_warehouse_to_supplier(uuid,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,text,text,text,text,date,text) to authenticated;

-- ── cancel_supplier_sale() — + p_client_date / p_client_time (para la
--    "devolución" de stock que genera, ver rama con warehouse_product_id) ──
create or replace function public.cancel_supplier_sale(
  p_company     uuid,
  p_sale_id     uuid,
  p_user_name   text,
  p_client_date date default null,
  p_client_time text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_sale public.supplier_sales;
  v_date date := coalesce(p_client_date, current_date);
  v_time text := coalesce(p_client_time, to_char(now(),'HH24:MI'));
begin
  if not public.has_perm(p_company,'gestionar_proveedores') then
    raise exception 'No autorizado.';
  end if;

  select * into v_sale from public.supplier_sales where id = p_sale_id and company_id = p_company for update;
  if not found then raise exception 'Venta no encontrada.'; end if;
  if v_sale.status = 'Cancelado' then return; end if;

  if v_sale.warehouse_product_id is not null and v_sale.location_id is not null then
    perform public.add_warehouse_movement(
      p_company            => p_company,
      p_type                => 'entrada',
      p_product_id          => v_sale.warehouse_product_id,
      p_product_name        => v_sale.product,
      p_sku                 => v_sale.sku,
      p_qty                 => v_sale.qty,
      p_to_location_id      => v_sale.location_id,
      p_to_location_name    => coalesce(v_sale.location_name,''),
      p_reason              => 'Devolución por venta cancelada (' || v_sale.supplier || ')',
      p_user_name           => p_user_name,
      p_pack_name           => v_sale.pack_name,
      p_pack_qty            => v_sale.pack_qty,
      p_client_date         => v_date,
      p_client_time         => v_time
    );
  end if;

  update public.supplier_sales set status = 'Cancelado', updated_at = now() where id = p_sale_id;
end;
$$;
drop function if exists public.cancel_supplier_sale(uuid,uuid,text);
revoke all on function public.cancel_supplier_sale(uuid,uuid,text,date,text) from public;
grant execute on function public.cancel_supplier_sale(uuid,uuid,text,date,text) to authenticated;
