-- Aplicada en producción el 2026-08-12 (antes de esta sesión de revisión).
alter table public.products
  add column if not exists barcode text,
  add column if not exists pack_qty numeric(14,3);

comment on column public.products.barcode is 'Código de barras (EAN/UPC generado o ingresado a mano) — se muestra/imprime desde BarcodeDisplay.';
comment on column public.products.pack_qty is 'Unidades base por empaque, cuando el producto se vende en packs.';
