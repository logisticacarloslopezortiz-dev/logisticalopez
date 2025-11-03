-- Supabase RPCs y Políticas RLS para TLC
-- Ejecutar este archivo en el editor SQL de Supabase (proyecto remoto)

-- 1) Función: update_order_status
create or replace function public.update_order_status(
  order_id bigint,
  new_status text,
  collaborator_id uuid,
  tracking_entry jsonb,
  extra jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated jsonb;
begin
  update public.orders o
  set
    status = case
      when lower(new_status) = 'entregado' then 'Completada'
      when new_status in ('en_camino_recoger') then 'Aceptada'
      when new_status in ('cargando','en_camino_entregar') then 'En curso'
      else status
    end,
    assigned_to = coalesce(o.assigned_to, collaborator_id),
    assigned_at = case when new_status = 'en_camino_recoger' then now() else assigned_at end,
    completed_at = case when lower(new_status) = 'entregado' then now() else completed_at end,
    last_collab_status = new_status,
    tracking_data = coalesce(o.tracking_data, '[]'::jsonb) || jsonb_build_array(tracking_entry),
    -- aplicar campos extra si vienen (monto/metodo)
    monto_cobrado = coalesce((extra->>'monto_cobrado')::numeric, o.monto_cobrado),
    metodo_pago = coalesce(extra->>'metodo_pago', o.metodo_pago)
  where o.id = order_id
    and (o.assigned_to = collaborator_id or o.assigned_to is null)
  returning to_jsonb(o) into updated;

  if updated is null then
    raise exception 'No autorizado o no encontrada' using errcode = '42501';
  end if;

  return updated;
end;
$$;

grant execute on function public.update_order_status(bigint, text, uuid, jsonb, jsonb) to anon, authenticated;

-- 2) Función: set_order_amount
create or replace function public.set_order_amount(
  order_id bigint,
  amount numeric,
  method text,
  collaborator_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated jsonb;
begin
  update public.orders o
  set monto_cobrado = amount,
      metodo_pago = method
  where o.id = order_id
    and o.assigned_to = collaborator_id
  returning to_jsonb(o) into updated;

  if updated is null then
    raise exception 'No autorizado o no encontrada' using errcode = '42501';
  end if;

  return updated;
end;
$$;

grant execute on function public.set_order_amount(bigint, numeric, text, uuid) to authenticated;

-- 3) Políticas RLS de lectura para orders
alter table public.orders enable row level security;

-- Lectura para colaborador asignado
create policy if not exists orders_select_assigned_collab
  on public.orders
  for select
  to authenticated
  using (assigned_to = auth.uid());

-- Lectura para dueño/cliente
create policy if not exists orders_select_client_owner
  on public.orders
  for select
  to authenticated
  using (client_id = auth.uid());

-- Nota: las actualizaciones deben hacerse vía RPC con SECURITY DEFINER