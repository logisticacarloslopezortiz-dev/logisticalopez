-- Asegura políticas RLS para evitar 401 en inserts con select de órdenes pendientes
-- Ejecutar en Supabase SQL editor

alter table if exists public.orders enable row level security;

-- Permitir INSERT de órdenes en estado Pendiente (anon/autenticados)
drop policy if exists "public_insert_pending_orders" on public.orders;
create policy "public_insert_pending_orders" on public.orders
for insert
with check (
  status = 'Pendiente' and (client_id is null or client_id = auth.uid()) and assigned_to is null
);

-- Permitir SELECT de órdenes pendientes para evitar 401 en retorno de insert
drop policy if exists "public_read_pending_orders" on public.orders;
create policy "public_read_pending_orders" on public.orders
for select using (
  status = 'Pendiente' or client_id = auth.uid() or assigned_to = auth.uid() or public.is_owner(auth.uid()) or public.is_admin(auth.uid())
);

-- Mantener otras políticas comunes
drop policy if exists "clients_read_own_orders" on public.orders;
create policy "clients_read_own_orders" on public.orders for select using (client_id = auth.uid());

drop policy if exists "collaborator_read_assigned_orders" on public.orders;
create policy "collaborator_read_assigned_orders" on public.orders for select using (assigned_to = auth.uid());

drop policy if exists "owner_admin_all_orders" on public.orders;
create policy "owner_admin_all_orders" on public.orders
for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()))
with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Nota: El trigger "trg_orders_set_tracking" ya establece tracking_url automáticamente en el backend.