-- ═══════════════════════════════════════════════════════════════════════════
-- harden_function_privileges (parte 2)
--
-- La parte 1 reveló que 11 funciones (helpers usados dentro de las
-- políticas RLS: is_active, is_owner, is_same_company, has_perm,
-- my_company_id, my_profile, default_permissions, valid_permission_keys,
-- _stock_status, y los triggers enforce_users_update/
-- enforce_companies_update) NUNCA tuvieron el "revoke all from public" que
-- sí se aplicó a las RPC de negocio (record_sale, adjust_product_stock,
-- etc.) en 0003_functions.sql — todavía cargaban el grant implícito a
-- PUBLIC, que `anon` hereda sin importar el `revoke ... from anon`
-- explícito de la parte 1.
--
-- OJO: acá NO se revoca de `authenticated`, a propósito. Las políticas RLS
-- (0002_rls.sql) llaman a estas funciones dentro de sus expresiones USING/
-- WITH CHECK, y esas expresiones corren con los privilegios del rol que
-- hace la consulta real (`authenticated`, el rol con el que PostgREST
-- conecta tras validar el JWT) — si a `authenticated` le faltara EXECUTE
-- acá, CUALQUIER consulta a una tabla con RLS fallaría.
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on function public.is_active()                    from public;
revoke all on function public.is_owner(uuid)                  from public;
revoke all on function public.is_same_company(uuid)            from public;
revoke all on function public.has_perm(uuid, text)              from public;
revoke all on function public.my_company_id()                  from public;
revoke all on function public.my_profile()                     from public;
revoke all on function public.default_permissions()            from public;
revoke all on function public.valid_permission_keys()          from public;
revoke all on function public._stock_status(numeric, numeric)  from public;
revoke all on function public.enforce_users_update()            from public;
revoke all on function public.enforce_companies_update()        from public;

grant execute on function public.is_active()                    to authenticated;
grant execute on function public.is_owner(uuid)                  to authenticated;
grant execute on function public.is_same_company(uuid)            to authenticated;
grant execute on function public.has_perm(uuid, text)              to authenticated;
grant execute on function public.my_company_id()                  to authenticated;
grant execute on function public.my_profile()                     to authenticated;
grant execute on function public.default_permissions()            to authenticated;
grant execute on function public.valid_permission_keys()          to authenticated;
grant execute on function public._stock_status(numeric, numeric)  to authenticated;
-- enforce_users_update / enforce_companies_update son funciones de TRIGGER
-- (se disparan solas en cada UPDATE, nunca se llaman directo vía RPC) — no
-- necesitan grant a ningún rol para seguir funcionando como trigger.
