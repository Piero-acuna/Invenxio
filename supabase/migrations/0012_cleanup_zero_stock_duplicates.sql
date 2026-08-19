-- ═══════════════════════════════════════════════════════════════════════════
-- 0012_cleanup_zero_stock_duplicates.sql
--
-- Cuando una compra a proveedor llega con un costo distinto al ya registrado,
-- SuppliersModule.jsx crea un producto NUEVO (mismo nombre + el costo como
-- sufijo, ej. "Coca Cola 500ml (S/ 3.20)") en vez de sobrescribir el costo
-- del producto existente — así no se mezclan compras con costos distintos
-- bajo el mismo registro.
--
-- Estas dos funciones limpian ese "duplicado" cuando se queda en 0 stock:
-- borran (permanentemente) cualquier variante de un mismo producto base que
-- tenga 0 stock, SIEMPRE QUE al menos otra variante hermana todavía tenga
-- stock > 0 — así nunca se borra una línea de producto completa por esta vía
-- (eso sigue requiriendo un borrado manual con el permiso 'eliminar_registros').
--
-- Van como RPC con SECURITY DEFINER (mismo patrón que record_purchase() /
-- record_warehouse_purchase()) porque quien registra una compra normalmente
-- solo tiene 'registrar_compras' — no necesariamente 'eliminar_registros'
-- (products_delete) ni 'gestionar_almacen' (warehouse_products_delete), que
-- son los permisos que exige el borrado manual normal vía RLS. Esta limpieza
-- es una consecuencia automática y acotada de registrar una compra, no un
-- borrado libre, así que se autoriza acá con su propia validación de permiso
-- en vez de heredar la policy de delete.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── INVENTARIO (public.products) ────────────────────────────────────────────
create or replace function public.cleanup_zero_stock_products(
  p_company   uuid,
  p_base_name text
)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_has_stock boolean;
  v_deleted   integer;
begin
  if not public.has_perm(p_company, 'registrar_compras') then
    raise exception 'No autorizado.';
  end if;

  if p_base_name is null or length(trim(p_base_name)) = 0 then
    return 0;
  end if;

  -- Solo actúa si, entre las variantes de este producto base, al menos una
  -- SIGUE teniendo stock — si no, no hay "otro producto que se queda" y no
  -- se borra nada (evita vaciar por completo una línea de producto).
  select exists (
    select 1 from public.products
    where company_id = p_company
      and (name = p_base_name or name like p_base_name || ' (%')
      and coalesce(stock, 0) > 0
  ) into v_has_stock;

  if not v_has_stock then
    return 0;
  end if;

  delete from public.products
  where company_id = p_company
    and (name = p_base_name or name like p_base_name || ' (%')
    and coalesce(stock, 0) <= 0;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.cleanup_zero_stock_products(uuid,text) from public;
grant execute on function public.cleanup_zero_stock_products(uuid,text) to authenticated;

-- ── ALMACÉN (public.warehouse_products + public.warehouse_stock) ───────────
create or replace function public.cleanup_zero_stock_warehouse_products(
  p_company   uuid,
  p_base_name text
)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_has_stock boolean;
  v_deleted   integer := 0;
  v_id        uuid;
begin
  if not (public.has_perm(p_company, 'registrar_compras') or public.has_perm(p_company, 'gestionar_proveedores')) then
    raise exception 'No autorizado.';
  end if;

  if p_base_name is null or length(trim(p_base_name)) = 0 then
    return 0;
  end if;

  select exists (
    select 1
    from public.warehouse_products wp
    where wp.company_id = p_company
      and (wp.name = p_base_name or wp.name like p_base_name || ' (%')
      and coalesce(
            (select sum(ws.qty) from public.warehouse_stock ws
              where ws.product_id = wp.id and ws.company_id = p_company),
            0
          ) > 0
  ) into v_has_stock;

  if not v_has_stock then
    return 0;
  end if;

  for v_id in
    select wp.id
    from public.warehouse_products wp
    where wp.company_id = p_company
      and (wp.name = p_base_name or wp.name like p_base_name || ' (%')
      and coalesce(
            (select sum(ws.qty) from public.warehouse_stock ws
              where ws.product_id = wp.id and ws.company_id = p_company),
            0
          ) <= 0
  loop
    -- warehouse_stock.product_id no tiene FK a warehouse_products (ver
    -- 0001_schema.sql), así que hay que limpiar las filas de stock (en 0,
    -- pero por prolijidad) a mano antes de borrar el producto.
    delete from public.warehouse_stock where product_id = v_id and company_id = p_company;
    delete from public.warehouse_products where id = v_id and company_id = p_company;
    v_deleted := v_deleted + 1;
  end loop;

  return v_deleted;
end;
$$;
revoke all on function public.cleanup_zero_stock_warehouse_products(uuid,text) from public;
grant execute on function public.cleanup_zero_stock_warehouse_products(uuid,text) to authenticated;
