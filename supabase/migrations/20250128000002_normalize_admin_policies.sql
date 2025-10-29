-- Normaliza políticas de administrador para evitar dependencias recursivas sobre public.business
-- Reemplaza políticas 'owner_*' por políticas basadas en rol 'administrador' en collaborators

-- Vehículos
drop policy if exists "owner_all_access_vehicles" on public.vehicles;
create policy if not exists "admin_all_access_vehicles" on public.vehicles
for all using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
) with check (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

-- Servicios
drop policy if exists "owner_all_access_services" on public.services;
create policy if not exists "admin_all_access_services" on public.services
for all using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
) with check (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

-- Órdenes
drop policy if exists "owner_all_orders" on public.orders;
create policy if not exists "admin_all_orders" on public.orders
for all using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
) with check (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

-- Colaboradores (gestión completa por administradores)
drop policy if exists "owner_manage_collaborators" on public.collaborators;
create policy if not exists "admin_manage_collaborators" on public.collaborators
for all using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
) with check (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

-- Matrículas
drop policy if exists "owner_manage_matriculas" on public.matriculas;
create policy if not exists "admin_manage_matriculas" on public.matriculas
for all using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
) with check (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

-- Nota: Las políticas específicas de colaboradores (self select/update) y de órdenes para colaboradores
-- permanecen intactas en otras migraciones recientes.