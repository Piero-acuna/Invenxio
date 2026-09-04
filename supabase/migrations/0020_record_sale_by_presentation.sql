-- ═══════════════════════════════════════════════════════════════════════════
-- 0020_record_sale_by_presentation.sql
--
-- POS (Venta): el cajero ahora puede vender un producto por cualquiera de
-- sus presentaciones (Unidad, Pack, Caja...) — record_sale() recibe el
-- `presentationId` elegido dentro de cada ítem del carrito y, SIEMPRE del
-- lado del servidor, contra products.presentations (nunca contra lo que
-- mande el cliente):
--   1. Resuelve el multiplicador de esa presentación → unidades REALES a
--      descontar de products.stock = (cantidad vendida de esa presentación)
--      × multiplicador. Ej: vender 1 "Pack" (multiplicador 6) descuenta 6
--      unidades; vender 1 "Unidad" (multiplicador 1) descuenta 1.
--   2. Resuelve el precio de esa presentación → el total cobrado es
--      SIEMPRE presentación.price × cantidad vendida, nunca products.price
--      × unidades (una Caja/Pack normalmente NO cuesta lo mismo que N
--      veces el precio unitario — es precio propio, con su descuento por
--      volumen si lo hay).
--
-- products.qty / unit_price en la tabla `transactions` se siguen guardando
-- SIEMPRE en unidades base (igual que record_purchase, adjust_product_stock,
-- etc. — necesario para que el Dashboard pueda sumar "unidades vendidas" de
-- forma consistente entre filas, sin importar en qué presentación se vendió
-- cada una); pack_qty/pack_name quedan para poder mostrar "vendido como
-- Pack (×6)" en Historial (ver TransactionHistory.jsx, que ya lee
-- t.packName) sin tener que perder esa unidad base.
--
-- Compatibilidad con productos SIN presentaciones (creados antes de esta
-- función, o importados por Excel — products.presentations = '[]'): si el
-- carrito manda presentationId = 'legacy_pack' (ver getSellablePresentations
-- en src/utils/packaging.js, que sintetiza esa opción en el POS a partir
-- del viejo products.pack_qty), acá se resuelve igual de estricto: el
-- multiplicador se relee de products.pack_qty (NUNCA del carrito) y el
-- precio se deriva de products.price × ese pack_qty. Si presentationId no
-- viene, o no matchea nada (id viejo/inválido), cae exactamente al
-- comportamiento anterior: multiplicador 1, precio = products.price — venta
-- por unidad simple, como todo antes de esta migración.
--
-- Misma firma que la versión anterior (record_sale(uuid,jsonb,text,text,
-- text,date)) — no hace falta drop/grant, CREATE OR REPLACE conserva los
-- permisos ya otorgados en 0013_fix_dates_and_server_side_totals.
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_presentation jsonb;
  v_presentations jsonb;
  v_product_id uuid;
  v_presentation_id text;
  v_item_name text;
  v_item_qty numeric;      -- lo que manda el carrito: cantidad de la PRESENTACIÓN elegida (ej. "2" Packs)
  v_multiplier numeric;    -- unidades base que representa 1 de esa presentación
  v_units numeric;         -- unidades REALES a descontar de stock = v_item_qty * v_multiplier
  v_pack_qty numeric;
  v_pack_price numeric;
  v_pack_name text;
  v_price numeric; v_description text; v_stock numeric; v_min_stock numeric; v_new_stock numeric;
  v_unit_price numeric; v_line_total numeric;
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

  -- ── Paso 1: validar stock de TODO el carrito antes de tocar nada — ya en
  --    unidades reales (cantidad de la presentación × su multiplicador). ──
  for v_item in select * from jsonb_array_elements(p_cart) loop
    v_product_id      := (v_item->>'id')::uuid;
    v_item_qty        := (v_item->>'qty')::numeric;
    v_presentation_id := nullif(v_item->>'presentationId', '');

    select stock, presentations, pack_qty into v_stock, v_presentations, v_pack_qty
      from public.products where id = v_product_id and company_id = p_company;
    if not found then
      raise exception 'El producto "%" ya no existe.', coalesce(v_item->>'name','');
    end if;

    v_multiplier := 1;
    if v_presentation_id = 'legacy_pack' then
      v_multiplier := greatest(coalesce(v_pack_qty, 1), 1);
    elsif v_presentation_id is not null then
      select elem into v_presentation
        from jsonb_array_elements(coalesce(v_presentations, '[]'::jsonb)) elem
        where elem->>'id' = v_presentation_id
        limit 1;
      if v_presentation is not null then
        v_multiplier := coalesce((v_presentation->>'multiplier')::numeric, 1);
        if v_multiplier <= 0 then v_multiplier := 1; end if;
      end if;
    end if;

    v_units := v_item_qty * v_multiplier;
    if v_stock < v_units then
      raise exception 'Stock insuficiente para "%": quedan % unidades, se intentó vender %.', v_item->>'name', v_stock, v_units;
    end if;
  end loop;

  -- ── Paso 2: aplicar la venta — unidades a descontar y precio SIEMPRE
  --    recalculados acá adentro contra products.presentations / pack_qty /
  --    price, nunca contra lo que mande el carrito. ─────────────────────
  for v_item in select * from jsonb_array_elements(p_cart) loop
    v_product_id      := (v_item->>'id')::uuid;
    v_item_name       := v_item->>'name';
    v_item_qty        := (v_item->>'qty')::numeric;
    v_presentation_id := nullif(v_item->>'presentationId', '');

    select price, description, stock, min_stock, presentations, pack_qty
      into v_price, v_description, v_stock, v_min_stock, v_presentations, v_pack_qty
      from public.products where id = v_product_id and company_id = p_company;

    v_multiplier := 1;
    v_pack_price := null;
    v_pack_name  := '';
    if v_presentation_id = 'legacy_pack' then
      v_multiplier := greatest(coalesce(v_pack_qty, 1), 1);
      v_pack_price := v_price * v_multiplier;   -- sin descuento por volumen propio: precio unitario × pack_qty real
      v_pack_name  := 'Empaque';
    elsif v_presentation_id is not null then
      select elem into v_presentation
        from jsonb_array_elements(coalesce(v_presentations, '[]'::jsonb)) elem
        where elem->>'id' = v_presentation_id
        limit 1;
      if v_presentation is not null then
        v_multiplier := coalesce((v_presentation->>'multiplier')::numeric, 1);
        if v_multiplier <= 0 then v_multiplier := 1; end if;
        v_pack_price := (v_presentation->>'price')::numeric;
        v_pack_name  := coalesce(v_presentation->>'name', '');
      end if;
      -- si no matchea nada (id viejo/inválido), cae al comportamiento base
      -- de abajo: multiplicador 1, precio = products.price.
    end if;

    v_units      := v_item_qty * v_multiplier;
    -- Total SIEMPRE calculado directo desde el precio de la presentación
    -- (nunca desde un unit_price ya redondeado) para no arrastrar error de
    -- redondeo; unit_price es solo informativo/columna histórica.
    v_line_total := coalesce(v_pack_price, v_price) * v_item_qty;
    v_unit_price := case when v_units > 0 then round(v_line_total / v_units, 2) else coalesce(v_pack_price, v_price) end;

    v_new_stock := v_stock - v_units;

    insert into public.transactions (
      company_id, type, date, product, sku, description, qty, unit_price, total, client, note, created_by,
      pack_mode, pack_qty, pack_name, base_unit_name, payment_method
    ) values (
      p_company, 'venta', v_date, v_item_name, v_item->>'sku', coalesce(v_description,''), v_units,
      v_unit_price, v_line_total, coalesce(p_client_name,'Cliente'), '', p_user_name,
      (v_multiplier <> 1), case when v_multiplier <> 1 then v_multiplier else 0 end,
      case when v_multiplier <> 1 then v_pack_name else '' end, coalesce(v_item->>'baseUnitName',''),
      coalesce(p_payment_method,'Efectivo')
    ) returning id into v_tx_id;

    v_tx_ids := v_tx_ids || v_tx_id;

    update public.products
      set stock = v_new_stock, status = public._stock_status(v_new_stock, v_min_stock), updated_at = now()
      where id = v_product_id;

    insert into public.product_history (company_id, product_id, date, action, qty, user_name)
      values (p_company, v_product_id, v_date, 'Venta', v_units, p_user_name);
  end loop;

  return to_jsonb(v_tx_ids);
end;
$$;
