-- Optimización recomendada por el linter de Supabase: envolver auth.uid()
-- en (select auth.uid()) para que Postgres lo evalúe UNA vez por consulta
-- en vez de una vez POR FILA — mismo resultado exacto, solo cambia el plan
-- de ejecución. No cambia ningún comportamiento de seguridad.

drop policy if exists "users_select" on public.users;
create policy "users_select" on public.users
  for select
  using ((select auth.uid()) = id or public.is_owner(company_id));

drop policy if exists "users_insert" on public.users;
create policy "users_insert" on public.users
  for insert
  with check (
    (select auth.uid()) = id
    and role = any (array['owner','empleado'])
    and (
      (role = 'owner' and company_id = id)
      or (role = 'empleado' and company_id <> id and permissions = public.default_permissions())
    )
  );

drop policy if exists "companies_insert" on public.companies;
create policy "companies_insert" on public.companies
  for insert
  with check ((select auth.uid()) = id and owner_id = id and plan = 'free');
