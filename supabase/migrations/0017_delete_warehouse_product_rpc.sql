-- ═══════════════════════════════════════════════════════════════════════════
-- 0017_delete_warehouse_product_rpc.sql
--
-- Encontrado en revisión: el botón "Eliminar" de un producto de Almacén
-- (ProductosTab.jsx) hacía un DELETE directo del cliente contra
-- `warehouse_products` — pero la policy RLS de borrado de la tabla
-- HERMANA `warehouse_stock` (donde vive el stock real) exige el permiso
-- 'eliminar_registros', mientras que toda la pestaña "Mis Productos" (y su
-- botón "Eliminar") solo exige 'gestionar_almacen'. Como el DELETE de
-- warehouse_products en sí SÍ acepta 'gestionar_almacen' (ver
-- warehouse_products_delete en 0002_rls.sql), el producto del catálogo se
-- borraba pero las filas de `warehouse_stock` con su stock quedaban
-- huérfanas — el producto seguía apareciendo con su stock en el Mapa
-- (que lee el nombre/sku DENORMALIZADO directo de warehouse_stock, no de
-- warehouse_products), dando la sensación de que "no se puede eliminar".
--
-- Esta función hace las 2 cosas en un solo paso atómico, con el MISMO
-- permiso que ya usa el resto de la pestaña (gestionar_almacen).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.delete_warehouse_product(
  p_company    uuid,
  p_product_id uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not (public.has_perm(p_company,'gestionar_almacen') or public.has_perm(p_company,'eliminar_registros')) then
    raise exception 'No autorizado.';
  end if;

  delete from public.warehouse_stock where product_id = p_product_id and company_id = p_company;
  delete from public.warehouse_products where id = p_product_id and company_id = p_company;
end;
$$;
revoke all on function public.delete_warehouse_product(uuid,uuid) from public;
grant execute on function public.delete_warehouse_product(uuid,uuid) to authenticated;
