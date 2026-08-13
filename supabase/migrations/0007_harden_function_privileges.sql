-- ═══════════════════════════════════════════════════════════════════════════
-- harden_function_privileges (parte 1)
--
-- Hallazgo del advisor de seguridad de Supabase: TODAS las funciones de
-- public (RPCs de negocio + helpers de RLS) eran ejecutables por el rol
-- `anon` (cualquiera con la anon key, que es pública en el navegador, sin
-- haber iniciado sesión). El `revoke all on function ... from public;` de
-- 0003_functions.sql no alcanzaba a quitarle el permiso a `anon`: Supabase
-- otorga EXECUTE a `anon`/`authenticated` automáticamente vía
-- ALTER DEFAULT PRIVILEGES al crear cada función — un grant EXPLÍCITO a
-- esos roles, que "revoke ... from public" (el pseudo-rol implícito) no
-- revoca.
--
-- En la práctica, cada función ya valida `auth.uid()` (a través de
-- has_perm/is_owner/is_same_company) y con `anon` ese valor es NULL, así
-- que las llamadas ya fallaban con "No autorizado" — pero es una capa de
-- defensa menos: si alguna función nueva se agrega en el futuro sin ese
-- chequeo, quedaría abierta a cualquiera sin iniciar sesión. Se revoca el
-- permiso explícito a `anon` en todas las funciones de public.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from anon;', f.sig);
  end loop;
end $$;

alter default privileges in schema public revoke execute on functions from anon;

-- ── search_path mutable (WARN del advisor) ──────────────────────────────
alter function public.enforce_users_update()      set search_path = public, pg_temp;
alter function public.enforce_companies_update()   set search_path = public, pg_temp;
alter function public._stock_status(numeric, numeric) set search_path = public, pg_temp;
alter function public.default_permissions()        set search_path = public, pg_temp;
alter function public.valid_permission_keys()       set search_path = public, pg_temp;
