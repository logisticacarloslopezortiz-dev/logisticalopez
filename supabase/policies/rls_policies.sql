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
for select using (assigned_to = auth.uid());

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