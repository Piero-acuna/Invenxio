-- ═══════════════════════════════════════════════════════════════════════════
-- add_payment_method_to_sales
-- Agrega el método de pago (Efectivo / Yape / Transferencia / Tarjeta) a las
-- ventas de tienda, para que quede registrado con qué pagó el cliente y se
-- pueda mostrar en el Historial y en el comprobante impreso.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.transactions
  add column if not exists payment_method text;
comment on column public.transactions.payment_method is 'Efectivo | Yape | Transferencia | Tarjeta — solo aplica a type=venta (MovementsModule.jsx)';

create or replace function public.record_sale(
  p_company        uuid,
  p_cart           jsonb,
  p_user_name      text,
  p_client_name    text default 'Cliente',
  p_payment_method text default 'Efectivo'
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
      p_company, 'venta', current_date, v_item_name, v_item->>'sku', coalesce(v_description,''), v_item_qty,
      v_price, v_price * v_item_qty, coalesce(p_client_name,'Cliente'), '', p_user_name,
      coalesce((v_item->>'packMode')::boolean,false), coalesce((v_item->>'packQty')::numeric,0),
      coalesce(v_item->>'packName',''), coalesce(v_item->>'baseUnitName',''), coalesce(p_payment_method,'Efectivo')
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
revoke all on function public.record_sale(uuid,jsonb,text,text,text) from public;
grant execute on function public.record_sale(uuid,jsonb,text,text,text) to authenticated;

drop function if exists public.record_sale(uuid, jsonb, text, text);
