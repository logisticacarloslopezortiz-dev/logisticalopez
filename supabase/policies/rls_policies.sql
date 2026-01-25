-- RLS policies for collaborators and orders

-- Collaborators table
alter table public.collaborators enable row level security;

create policy "collab self select" on public.collaborators
for select using (id = auth.uid());

create policy "admin select all" on public.collaborators
for select using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

create policy "admin insert" on public.collaborators
for insert with check (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

create policy "admin update" on public.collaborators
for update using (
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

create policy "admin delete" on public.collaborators
for delete using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

-- Orders table
alter table public.orders enable row level security;

create policy "admin select orders" on public.orders
for select using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

create policy "collaborator select assigned" on public.orders
for select using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid()
      and c.status = 'activo'
      and (
        -- Si puede_ver_todas_las_ordenes = true, ve pending SIN asignar Y sus asignadas
        (c.puede_ver_todas_las_ordenes = true and (status = 'pending' or assigned_to = auth.uid()))
        OR
        -- Si puede_ver_todas_las_ordenes = false, solo ve sus asignadas
        (c.puede_ver_todas_las_ordenes = false and assigned_to = auth.uid())
      )
  )
);

create policy "admin update orders" on public.orders
for update using (
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

create policy "collaborator update own assigned" on public.orders
for update using (assigned_to = auth.uid())
with check (assigned_to = auth.uid());

create policy "admin insert orders" on public.orders
for insert with check (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

create policy "admin delete orders" on public.orders
for delete using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

-- Device Bindings table
alter table public.device_bindings enable row level security;

-- Allow admins full access
create policy "admin select device_bindings" on public.device_bindings
for select using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

create policy "admin insert device_bindings" on public.device_bindings
for insert with check (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

create policy "admin update device_bindings" on public.device_bindings
for update using (
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

create policy "admin delete device_bindings" on public.device_bindings
for delete using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

-- Allow regular users to view their own device bindings
create policy "user select own device_bindings" on public.device_bindings
for select using (user_id = auth.uid());

-- Profile Changes table
alter table public.profile_changes enable row level security;

create policy "admin select profile_changes" on public.profile_changes
for select using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

create policy "admin insert profile_changes" on public.profile_changes
for insert with check (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

create policy "admin update profile_changes" on public.profile_changes
for update using (
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

create policy "admin delete profile_changes" on public.profile_changes
for delete using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

-- Allow users to view their own profile changes
create policy "user select own profile_changes" on public.profile_changes
for select using (target_user_id = auth.uid());

-- Client Logs table
alter table public.client_logs enable row level security;

create policy "admin select client_logs" on public.client_logs
for select using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

-- Allow authenticated users to insert their own logs
create policy "user insert own client_logs" on public.client_logs
for insert with check (user_id = auth.uid());

-- Allow users to select their own logs
create policy "user select own client_logs" on public.client_logs
for select using (user_id = auth.uid());