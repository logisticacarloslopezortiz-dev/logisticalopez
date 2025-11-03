-- Function: public.set_order_amount
-- Purpose: Update monto_cobrado and metodo_pago for an order via SECURITY DEFINER to bypass RLS safely.
-- Note: Grant execute to role 'authenticated'.

create or replace function public.set_order_amount(
  order_id integer,
  amount numeric,
  method text,
  collaborator_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
begin
  update public.orders
  set monto_cobrado = amount,
      metodo_pago = method
  where id = order_id
  returning id, short_id, monto_cobrado, metodo_pago into v_order;

  if not found then
    raise exception 'Order % not found' using errcode = 'P0002';
  end if;

  return json_build_object(
    'id', v_order.id,
    'short_id', v_order.short_id,
    'monto_cobrado', v_order.monto_cobrado,
    'metodo_pago', v_order.metodo_pago
  );
end;
$$;

revoke all on function public.set_order_amount(integer, numeric, text, uuid) from public;
grant execute on function public.set_order_amount(integer, numeric, text, uuid) to authenticated;