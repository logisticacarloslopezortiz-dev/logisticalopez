-- Storage RLS policies for 'order-evidence' bucket
-- Permite a usuarios autenticados subir evidencias dentro del prefijo 'public/'

do $$
begin
  -- Habilitar RLS si no está habilitado
  if not exists (
    select 1 from pg_tables where schemaname = 'storage' and tablename = 'objects'
  ) then
    raise notice 'storage.objects table not found';
  end if;
end$$;

-- Insert: autenticados pueden subir a bucket 'order-evidence' bajo 'public/'
create policy if not exists "order_evidence_insert_public_prefix" on storage.objects
  for insert to authenticated
  using (bucket_id = 'order-evidence' and position('public/' in name) = 1)
  with check (bucket_id = 'order-evidence' and position('public/' in name) = 1);

-- Update: propietario autenticado puede actualizar objetos bajo 'public/'
create policy if not exists "order_evidence_update_public_prefix" on storage.objects
  for update to authenticated
  using (bucket_id = 'order-evidence' and position('public/' in name) = 1)
  with check (bucket_id = 'order-evidence' and position('public/' in name) = 1);

-- Delete: autenticados pueden borrar dentro de 'public/' (ajusta si deseas restringir)
create policy if not exists "order_evidence_delete_public_prefix" on storage.objects
  for delete to authenticated
  using (bucket_id = 'order-evidence' and position('public/' in name) = 1);

-- Select: público puede leer si el bucket es público; en caso contrario, permitir autenticados
create policy if not exists "order_evidence_select_public_prefix" on storage.objects
  for select to public
  using (bucket_id = 'order-evidence' and position('public/' in name) = 1);