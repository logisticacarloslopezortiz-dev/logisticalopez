-- Function: public.update_order_status
-- Purpose: Update order status and tracking data via SECURITY DEFINER to bypass RLS safely.
-- Note: Grant execute to role 'authenticated'.

create or replace function public.update_order_status(
  order_id integer,
  new_status text,
  collaborator_id uuid default null,
  tracking_entry jsonb default null,
  extra jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
begin
  update public.orders
  set status = case 
      when lower(new_status) in ('entregado','completada') then 'Completada'
      when lower(new_status) in ('en_camino_recoger','aceptada') then 'Aceptada'
      when lower(new_status) in ('cargando','en_camino_entregar','en curso') then 'En curso'
      when lower(new_status) in ('cancelado') then 'Cancelado'
      else status
    end,
    assigned_at = case when lower(new_status) in ('en_camino_recoger','aceptada') then now() else assigned_at end,
    completed_at = case when lower(new_status) in ('entregado','completada') then now() else completed_at end,
    assigned_to = coalesce((extra->>'assigned_to')::uuid, case when collaborator_id is not null then collaborator_id else assigned_to end),
    completed_by = case when lower(new_status) in ('entregado','completada') then collaborator_id else completed_by end,
    tracking_data = case 
      when tracking_entry is not null then coalesce(tracking_data,'[]'::jsonb) || tracking_entry
      else tracking_data end
  where id = order_id
  returning * into v_order;

  if not found then
    raise exception 'Order % not found' using errcode = 'P0002';
  end if;

  return to_jsonb(v_order);
end;
$$;

revoke all on function public.update_order_status(integer, text, uuid, jsonb, jsonb) from public;
grant execute on function public.update_order_status(integer, text, uuid, jsonb, jsonb) to authenticated;