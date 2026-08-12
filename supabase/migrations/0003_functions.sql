-- ═══════════════════════════════════════════════════════════════════════════
-- 0003_functions.sql — Lógica de negocio transaccional (RPC)
--
-- Cada runTransaction(...) del código original de Firestore se traduce acá a
-- una función Postgres `SECURITY DEFINER` que:
--   1. Verifica el permiso correspondiente a mano (has_perm) — OBLIGATORIO,
--      porque SECURITY DEFINER bypasea RLS por completo. Si esta verificación
--      faltara, cualquier usuario autenticado podría llamar a la función con
--      el companyId de otra empresa y escribir ahí.
--   2. Bloquea las filas que va a tocar con `SELECT ... FOR UPDATE`, el
--      equivalente de que Firestore reintente la transacción si otro cliente
--      escribió el mismo documento entre medio — acá Postgres simplemente
--      hace esperar a la segunda transacción hasta que la primera termine.
--   3. Hace todas las escrituras dentro de la misma función ⇒ atomicidad
--      real (todo o nada), igual que runTransaction().
--
-- Todas usan `set search_path = public` (obligatorio en funciones
-- SECURITY DEFINER, si no un search_path malicioso podría secuestrar la
-- función) y se les revoca EXECUTE a PUBLIC/anon, dejándolo solo para
-- `authenticated`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helper de estado de stock (recorta 0 abajo, igual que el JS original) ──
create or replace function public._stock_status(p_stock numeric, p_min_stock numeric)
returns text language sql immutable as $$
  select case
    when p_stock <= 0 then 'Agotado'
    when p_stock <= p_min_stock then 'Stock Bajo'
    else 'En Stock'
  end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- create_company() — createCompany() de companies.js
-- Se llama UNA vez, justo después de auth.signUp(), con el propio usuario ya
-- autenticado. auth.uid() será tanto el id de la empresa como el id del
-- perfil del Dueño (mismo truco que en Firestore: companyId == uid).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.create_company(
  p_company_name text,
  p_country       text default 'PE',
  p_owner_name    text default 'Propietario',
  p_owner_email   text default ''
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gateway text;
  v_currency_code text;
  v_currency_symbol text;
begin
  if v_uid is null then
    raise exception 'No autenticado.';
  end if;

  if v_country = 'PE' then
    v_gateway := 'culqi'; v_currency_code := 'PEN'; v_currency_symbol := 'S/';
  else
    v_gateway := 'mercadopago'; v_currency_code := 'USD'; v_currency_symbol := '$';
  end if;

  insert into public.companies (id, owner_id, name, plan, country, payment_gateway, currency_code, currency_symbol)
  values (v_uid, v_uid, p_company_name, 'free', coalesce(p_country,'OTHER'), v_gateway, v_currency_code, v_currency_symbol);

  insert into public.users (id, company_id, name, email, role, permissions, active)
  values (v_uid, v_uid, p_owner_name, p_owner_email, 'owner', '{}'::jsonb, true);

  insert into public.subscriptions (company_id, status, plan, trial_ends_at, payment_gateway, currency_code)
  values (v_uid, 'trial', 'trial', now() + interval '14 days', v_gateway, v_currency_code);

  return v_uid;
end;
$$;
revoke all on function public.create_company(text,text,text,text) from public;
grant execute on function public.create_company(text,text,text,text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- join_company() — joinCompany(): un usuario se une a una empresa YA
-- existente como empleado con permisos por defecto (ej. link de invitación).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.join_company(
  p_company_id uuid,
  p_name       text,
  p_email      text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado.'; end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'La empresa no existe.';
  end if;
  insert into public.users (id, company_id, name, email, role, permissions, active)
  values (v_uid, p_company_id, p_name, p_email, 'empleado', public.default_permissions(), true);
end;
$$;
revoke all on function public.join_company(uuid,text,text) from public;
grant execute on function public.join_company(uuid,text,text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- next_invoice_number() — getNextInvoiceNumber()
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.next_invoice_number(p_company uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare v_next integer;
begin
  if not (public.has_perm(p_company,'registrar_ventas') or public.has_perm(p_company,'registrar_compras')) then
    raise exception 'No autorizado.';
  end if;

  insert into public.invoice_counters (company_id, value, updated_at)
  values (p_company, 1, now())
  on conflict (company_id) do update
    set value = public.invoice_counters.value + 1, updated_at = now()
  returning value into v_next;

  return v_next;
end;
$$;
revoke all on function public.next_invoice_number(uuid) from public;
grant execute on function public.next_invoice_number(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- adjust_product_stock() — adjustProductStock() (ajuste manual)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.adjust_product_stock(
  p_company    uuid,
  p_product_id uuid,
  p_type       text,   -- 'add' | 'remove'
  p_qty        numeric,
  p_user_name  text
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
  values (p_company, p_product_id, current_date, case when p_type='add' then 'Ajuste +' else 'Ajuste -' end, p_qty, p_user_name);

  return v_new_stock;
end;
$$;
revoke all on function public.adjust_product_stock(uuid,uuid,text,numeric,text) from public;
grant execute on function public.adjust_product_stock(uuid,uuid,text,numeric,text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- record_purchase() — recordPurchase()
-- ═══════════════════════════════════════════════════════════════════════════
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
  p_base_unit_name text default ''
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_tx_id uuid;
  v_stock numeric; v_min_stock numeric; v_new_stock numeric;
  v_orders integer; v_spent numeric;
begin
  if not public.has_perm(p_company,'registrar_compras') then
    raise exception 'No autorizado.';
  end if;

  insert into public.transactions (
    company_id, type, date, product, sku, description, qty, unit_cost, total,
    supplier, note, created_by, pack_mode, pack_qty, pack_name, base_unit_name
  ) values (
    p_company, 'compra', current_date, p_product_name, p_sku, coalesce(p_description,''), p_qty, p_unit_cost, p_total,
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
      values (p_company, p_product_id, current_date, 'Compra', p_qty, p_user_name);
  end if;

  if p_supplier_id is not null then
    select total_orders, total_spent into v_orders, v_spent
      from public.suppliers where id = p_supplier_id and company_id = p_company for update;
    if found then
      update public.suppliers
        set total_orders = coalesce(v_orders,0) + 1, total_spent = coalesce(v_spent,0) + p_total,
            last_order = current_date::text, updated_at = now()
        where id = p_supplier_id;
    end if;
  end if;

  return v_tx_id;
end;
$$;
revoke all on function public.record_purchase(uuid,uuid,text,uuid,text,text,text,numeric,numeric,numeric,text,text,boolean,numeric,text,text) from public;
grant execute on function public.record_purchase(uuid,uuid,text,uuid,text,text,text,numeric,numeric,numeric,text,text,boolean,numeric,text,text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- adjust_warehouse_stock() — adjustWarehouseStock() (helper interno, pero
-- también expuesto por si algún flujo necesita un ajuste manual directo)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.adjust_warehouse_stock(
  p_company        uuid,
  p_product_id     uuid,
  p_product_name   text,
  p_sku            text,
  p_location_id    uuid,
  p_location_name  text,
  p_delta          numeric
)
returns numeric
language plpgsql security definer
set search_path = public
as $$
declare
  v_id text := p_product_id::text || '__' || p_location_id::text;
  v_current numeric; v_next numeric;
begin
  if not (public.has_perm(p_company,'gestionar_almacen') or public.has_perm(p_company,'registrar_compras') or public.has_perm(p_company,'gestionar_proveedores')) then
    raise exception 'No autorizado.';
  end if;

  select qty into v_current from public.warehouse_stock where id = v_id for update;
  v_next := greatest(0, coalesce(v_current,0) + p_delta);

  insert into public.warehouse_stock (id, company_id, product_id, product_name, sku, location_id, location_name, qty, updated_at)
  values (v_id, p_company, p_product_id, p_product_name, p_sku, p_location_id, p_location_name, v_next, now())
  on conflict (id) do update set qty = v_next, product_name = p_product_name, sku = p_sku, location_name = p_location_name, updated_at = now();

  return v_next;
end;
$$;
revoke all on function public.adjust_warehouse_stock(uuid,uuid,text,text,uuid,text,numeric) from public;
grant execute on function public.adjust_warehouse_stock(uuid,uuid,text,text,uuid,text,numeric) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- add_warehouse_movement() — addWarehouseMovement()
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.add_warehouse_movement(
  p_company           uuid,
  p_type              text,   -- 'entrada' | 'salida' | 'traslado' | 'envio_inventario'
  p_product_id        uuid,
  p_product_name      text,
  p_sku               text,
  p_qty               numeric,
  p_from_location_id  uuid default null,
  p_from_location_name text default null,
  p_to_location_id    uuid default null,
  p_to_location_name  text default null,
  p_reason            text default '',
  p_user_name         text default null,
  p_pack_name         text default null,
  p_pack_qty          numeric default null,
  p_pack_price        numeric default null
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
    coalesce(p_reason,''), p_user_name, current_date, to_char(now(),'HH24:MI'), p_pack_name, p_pack_qty, p_pack_price
  ) returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.add_warehouse_movement(uuid,text,uuid,text,text,numeric,uuid,text,uuid,text,text,text,text,numeric,numeric) from public;
grant execute on function public.add_warehouse_movement(uuid,text,uuid,text,text,numeric,uuid,text,uuid,text,text,text,text,numeric,numeric) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- record_warehouse_purchase() — recordWarehousePurchase()
-- ═══════════════════════════════════════════════════════════════════════════
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
  p_user_name              text
)
returns numeric
language plpgsql security definer
set search_path = public
as $$
declare
  v_total numeric := p_pack_count * p_unit_cost;
  v_orders integer; v_spent numeric;
begin
  if not public.has_perm(p_company,'registrar_compras') then
    raise exception 'No autorizado.';
  end if;

  insert into public.transactions (
    company_id, type, target, date, time, product, sku, description, qty,
    pack_name, pack_qty, unit_cost, total, supplier, location_id, location_name, note, created_by
  ) values (
    p_company, 'compra', 'almacen', current_date, to_char(now(),'HH24:MI'), p_warehouse_product_name, p_sku, coalesce(p_description,''), p_pack_count,
    p_pack_name, p_pack_qty, p_unit_cost, v_total, p_supplier_name, p_location_id, p_location_name, coalesce(p_note,''), p_user_name
  );

  perform public.add_warehouse_movement(
    p_company, 'entrada', p_warehouse_product_id, p_warehouse_product_name, p_sku, p_pack_count,
    null, null, p_location_id, p_location_name,
    'Compra a proveedor: ' || p_supplier_name, p_user_name, p_pack_name, p_pack_qty, null
  );

  if p_supplier_id is not null then
    select total_orders, total_spent into v_orders, v_spent
      from public.suppliers where id = p_supplier_id and company_id = p_company for update;
    if found then
      update public.suppliers
        set total_orders = coalesce(v_orders,0)+1, total_spent = coalesce(v_spent,0) + v_total,
            last_order = current_date::text, updated_at = now()
        where id = p_supplier_id;
    end if;
  end if;

  return v_total;
end;
$$;
revoke all on function public.record_warehouse_purchase(uuid,uuid,text,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,text,text) from public;
grant execute on function public.record_warehouse_purchase(uuid,uuid,text,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,text,text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- record_sale() — recordSale() — recibe el carrito como jsonb (array de
-- {id, name, sku, qty, packMode, packQty, packName, baseUnitName}) para no
-- tener que declarar un tipo compuesto de Postgres para el carrito.
-- IMPORTANTE (igual que el comentario original): el precio SIEMPRE se lee
-- del producto real dentro de esta misma transacción — nunca se confía en
-- ningún precio que venga del cliente.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.record_sale(
  p_company     uuid,
  p_cart        jsonb,
  p_user_name   text,
  p_client_name text default 'Cliente'
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
begin
  if not public.has_perm(p_company,'registrar_ventas') then
    raise exception 'No autorizado.';
  end if;
  if jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) = 0 then
    raise exception 'El carrito está vacío.';
  end if;

  -- Bloqueamos TODOS los productos involucrados, ordenados por id, para
  -- evitar deadlocks si dos ventas concurrentes comparten productos.
  perform 1 from public.products
    where company_id = p_company
      and id in (select (elem->>'id')::uuid from jsonb_array_elements(p_cart) elem)
    order by id
    for update;

  -- Validar stock de TODOS antes de escribir nada.
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

  -- Ahora sí, escribir: transacción + descuento de stock, por cada ítem.
  for v_item in select * from jsonb_array_elements(p_cart) loop
    v_product_id := (v_item->>'id')::uuid;
    v_item_name  := v_item->>'name';
    v_item_qty   := (v_item->>'qty')::numeric;

    select price, description, stock, min_stock into v_price, v_description, v_stock, v_min_stock
      from public.products where id = v_product_id and company_id = p_company;

    v_new_stock := v_stock - v_item_qty;

    insert into public.transactions (
      company_id, type, date, product, sku, description, qty, unit_price, total, client, note, created_by,
      pack_mode, pack_qty, pack_name, base_unit_name
    ) values (
      p_company, 'venta', current_date, v_item_name, v_item->>'sku', coalesce(v_description,''), v_item_qty,
      v_price, v_price * v_item_qty, coalesce(p_client_name,'Cliente'), '', p_user_name,
      coalesce((v_item->>'packMode')::boolean,false), coalesce((v_item->>'packQty')::numeric,0),
      coalesce(v_item->>'packName',''), coalesce(v_item->>'baseUnitName','')
    ) returning id into v_tx_id;

    v_tx_ids := v_tx_ids || v_tx_id;

    update public.products
      set stock = v_new_stock, status = public._stock_status(v_new_stock, v_min_stock), updated_at = now()
      where id = v_product_id;

    insert into public.product_history (company_id, product_id, date, action, qty, user_name)
      values (p_company, v_product_id, current_date, 'Venta', v_item_qty, p_user_name);
  end loop;

  return to_jsonb(v_tx_ids);
end;
$$;
revoke all on function public.record_sale(uuid,jsonb,text,text) from public;
grant execute on function public.record_sale(uuid,jsonb,text,text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- send_warehouse_to_inventory() — sendWarehouseToInventory()
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.send_warehouse_to_inventory(
  p_company               uuid,
  p_warehouse_product_id  uuid,
  p_warehouse_product_name text,
  p_sku                    text,
  p_location_id            uuid,
  p_location_name          text,
  p_pack_count             numeric,
  p_pack_name              text,
  p_unit_qty               numeric,
  p_store_product_id       uuid,
  p_store_product_name     text,
  p_reason                 text,
  p_user_name              text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_stock numeric; v_min_stock numeric; v_new_stock numeric; v_movement_id uuid;
begin
  if not public.has_perm(p_company,'gestionar_almacen') then
    raise exception 'No autorizado.';
  end if;

  perform public.adjust_warehouse_stock(p_company, p_warehouse_product_id, p_warehouse_product_name, p_sku, p_location_id, p_location_name, -p_pack_count);

  select stock, min_stock into v_stock, v_min_stock
    from public.products where id = p_store_product_id and company_id = p_company for update;
  if not found then raise exception 'El producto de tienda seleccionado ya no existe.'; end if;

  v_new_stock := coalesce(v_stock,0) + p_unit_qty;
  update public.products
    set stock = v_new_stock, status = public._stock_status(v_new_stock, coalesce(v_min_stock,0)), updated_at = now()
    where id = p_store_product_id;

  insert into public.product_history (company_id, product_id, date, action, qty, user_name, note)
    values (p_company, p_store_product_id, current_date, 'Recibido de Almacén', p_unit_qty, p_user_name,
            'Desde: ' || p_pack_count || ' ' || coalesce(p_pack_name,'empaque(s)') || ' de ' || p_warehouse_product_name);

  insert into public.warehouse_movements (
    company_id, type, product_id, product_name, sku, qty, unit_qty, pack_name,
    from_location_id, from_location_name, store_product_id, store_product_name,
    reason, user_name, date, time
  ) values (
    p_company, 'envio_inventario', p_warehouse_product_id, p_warehouse_product_name, p_sku, p_pack_count, p_unit_qty, p_pack_name,
    p_location_id, p_location_name, p_store_product_id, p_store_product_name,
    coalesce(p_reason,''), p_user_name, current_date, to_char(now(),'HH24:MI')
  ) returning id into v_movement_id;

  return v_movement_id;
end;
$$;
revoke all on function public.send_warehouse_to_inventory(uuid,uuid,text,text,uuid,text,numeric,text,numeric,uuid,text,text,text) from public;
grant execute on function public.send_warehouse_to_inventory(uuid,uuid,text,text,uuid,text,numeric,text,numeric,uuid,text,text,text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- sell_warehouse_to_supplier() — sellWarehouseToSupplier()
-- ═══════════════════════════════════════════════════════════════════════════
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
  p_status                 text default 'Entregado'
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_total numeric := p_pack_count * p_unit_price_per_pack; v_sale_id uuid;
begin
  if not public.has_perm(p_company,'gestionar_proveedores') then
    raise exception 'No autorizado.';
  end if;

  perform public.add_warehouse_movement(
    p_company, 'salida', p_warehouse_product_id, p_warehouse_product_name, p_sku, p_pack_count,
    p_location_id, p_location_name, null, null,
    'Venta a proveedor: ' || p_supplier_name, p_user_name, p_pack_name, p_pack_qty, null
  );

  insert into public.supplier_sales (
    company_id, supplier, product, description, sku, qty, pack_name, pack_qty,
    unit_price, total, status, note, warehouse_product_id, location_id, location_name, date
  ) values (
    p_company, p_supplier_name, p_warehouse_product_name, coalesce(p_description,''), coalesce(p_sku,''),
    p_pack_count, p_pack_name, p_pack_qty, p_unit_price_per_pack, v_total, coalesce(p_status,'Entregado'),
    coalesce(p_note,''), p_warehouse_product_id, p_location_id, p_location_name, current_date
  ) returning id into v_sale_id;

  return v_sale_id;
end;
$$;
revoke all on function public.sell_warehouse_to_supplier(uuid,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,text,text,text,text) from public;
grant execute on function public.sell_warehouse_to_supplier(uuid,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,text,text,text,text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- cancel_supplier_sale() — cancelSupplierSale()
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cancel_supplier_sale(
  p_company   uuid,
  p_sale_id   uuid,
  p_user_name text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_sale public.supplier_sales;
begin
  if not public.has_perm(p_company,'gestionar_proveedores') then
    raise exception 'No autorizado.';
  end if;

  select * into v_sale from public.supplier_sales where id = p_sale_id and company_id = p_company for update;
  if not found then raise exception 'Venta no encontrada.'; end if;
  if v_sale.status = 'Cancelado' then return; end if;

  if v_sale.warehouse_product_id is not null and v_sale.location_id is not null then
    perform public.add_warehouse_movement(
      p_company, 'entrada', v_sale.warehouse_product_id, v_sale.product, v_sale.sku, v_sale.qty,
      null, null, v_sale.location_id, coalesce(v_sale.location_name,''),
      'Devolución por venta cancelada (' || v_sale.supplier || ')', p_user_name, v_sale.pack_name, v_sale.pack_qty, null
    );
  end if;

  update public.supplier_sales set status = 'Cancelado', updated_at = now() where id = p_sale_id;
end;
$$;
revoke all on function public.cancel_supplier_sale(uuid,uuid,text) from public;
grant execute on function public.cancel_supplier_sale(uuid,uuid,text) to authenticated;
