-- Índices para las 3 llaves foráneas que el advisor de performance marcó
-- sin cobertura. No cambian ningún comportamiento, solo evitan table scans
-- cuando el volumen de datos crezca (ej. borrar una ubicación de almacén,
-- o el join implícito owner_id → companies).
create index if not exists companies_owner_id_idx        on public.companies(owner_id);
create index if not exists product_history_company_id_idx on public.product_history(company_id);
create index if not exists warehouse_stock_location_id_idx on public.warehouse_stock(location_id);
