create or replace function public.update_push_subscription_by_order(
  p_order_id bigint,
  p_push_subscription jsonb
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_contact_id uuid;
  v_user_id uuid;
begin
  -- 1. Buscar la orden para obtener el contacto o usuario asociado
  select client_contact_id, client_id into v_contact_id, v_user_id
  from public.orders
  where id = p_order_id;

  -- 2. Si tiene contact_id (usuario anónimo con contacto)
  if v_contact_id is not null then
    if p_push_subscription is not null and p_push_subscription->>'endpoint' is not null then
      insert into public.push_subscriptions(client_contact_id, endpoint, keys)
      values (v_contact_id, p_push_subscription->>'endpoint', p_push_subscription->'keys')
      on conflict (client_contact_id, endpoint) do update set keys = excluded.keys;
    end if;
  -- 3. Si tiene client_id (usuario autenticado)
  elsif v_user_id is not null then
    if p_push_subscription is not null and p_push_subscription->>'endpoint' is not null then
      insert into public.push_subscriptions(user_id, endpoint, keys)
      values (v_user_id, p_push_subscription->>'endpoint', p_push_subscription->'keys')
      on conflict (user_id, endpoint) do update set keys = excluded.keys;
    end if;
  end if;
end;
$$;

grant execute on function public.update_push_subscription_by_order(bigint, jsonb) to anon, authenticated;
