-- ═══════════════════════════════════════════════════════════════════════════
-- 0016_fix_cancelled_supplier_sale_stock.sql
--
-- BUG ENCONTRADO EN REVISIÓN: en "Venta a Proveedor" (SupplierSaleTab.jsx),
-- el campo Estado permite elegir "Cancelado" DESDE LA CREACIÓN de la venta
-- (no solo cancelar una ya existente). Pero sell_warehouse_to_supplier()
-- SIEMPRE descontaba el stock del almacén (llamando a add_warehouse_movement
-- tipo 'salida') sin importar el estado elegido — así que una venta creada
-- directamente como "Cancelado" igual restaba el stock como si se hubiera
-- entregado de verdad, y como ya nace marcada "Cancelado" nadie vuelve a
-- tocar el botón "Cancelar" (que sí devuelve el stock) — la merma quedaba
-- permanente y el conteo de almacén se desalineaba con la mercadería física.
--
-- Arreglo: solo se descuenta stock si la venta NO nace cancelada.
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

  -- BUG: antes esto se ejecutaba SIEMPRE, incluso si p_status llegaba como
  -- 'Cancelado' desde el formulario de alta — descontando stock de una
  -- venta que nunca se consideró "realmente hecha".
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
-- No hace falta drop/regrant: mismo nombre y misma firma que la versión de
-- 0013_fix_dates_and_server_side_totals.sql — CREATE OR REPLACE alcanza.
