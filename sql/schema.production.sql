-- =============================================================
--        ESQUEMA FINAL TLC - PRODUCCIÓN (Supabase Ready)
--        Consolidado, idempotente y alineado al frontend
-- =============================================================
-- Contiene:
-- - Extensiones requeridas
-- - Catálogos: vehicles, services
-- - Perfiles/colaboradores/matrículas
-- - Configuración del negocio (business + compat business_settings)
-- - Órdenes con short_id, tracking, normalización de estado
-- - Notificaciones y suscripciones push (con patrón Outbox)
-- - Acta de completado (receipts)
-- - Facturas (invoices)
-- - Tabla de clientes (para pedidos anónimos)
-- - Function logs
-- - RLS coherente (clientes, colaboradores activos, administrador/owner)
-- - RPCs: accept_order, update_order_status, set_order_amount_admin, get_subscriptions_by_role
-- =============================================================

-- 1) EXTENSIONES
create extension if not exists pgcrypto;
create extension if not exists pg_net;

-- 2) FUNCIONES UTILITARIAS GENERALES
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 3) CATÁLOGOS
create table if not exists public.vehicles (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  name text not null unique,
  description text,
  image_url text,
  is_active boolean not null default true
);
comment on table public.vehicles is 'Catálogo de vehículos.';

create table if not exists public.services (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  name text not null unique,
  description text,
  image_url text,
  is_active boolean not null default true,
  display_order int
);
comment on table public.services is 'Catálogo de servicios.';

-- 4) USUARIOS Y COLABORADORES
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_profiles_email on public.profiles(email);

drop trigger if exists trg_profiles_set_updated on public.profiles;
create trigger trg_profiles_set_updated
before update on public.profiles
for each row execute function public.set_updated_at();

create table if not exists public.collaborators (
  id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  name text,
  email text,
  phone text,
  matricula text,
  status text not null default 'activo',
  role text not null default 'colaborador' check (lower(role) in ('administrador','colaborador')),
  push_subscription jsonb,
  notes text,
  updated_at timestamptz not null default now()
);
create index if not exists idx_collaborators_status on public.collaborators(status);
create index if not exists idx_collaborators_role on public.collaborators(role);
create index if not exists idx_collaborators_email on public.collaborators(email);

drop trigger if exists trg_collaborators_touch_updated on public.collaborators;
create trigger trg_collaborators_touch_updated
before update on public.collaborators
for each row execute function public.set_updated_at();

create or replace function public.sync_profile_name()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, phone, created_at, updated_at)
  values (new.id, new.name, new.email, new.phone, now(), now())
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    phone = excluded.phone,
    updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_profile_name on public.collaborators;
create trigger trg_sync_profile_name
after insert or update of name, email, phone on public.collaborators
for each row execute function public.sync_profile_name();

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now()
);
comment on table public.clients is 'Tabla para clientes no autenticados (invitados).';

create table if not exists public.matriculas (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  matricula text not null,
  status text not null default 'activo'
);
create index if not exists idx_matriculas_user_id on public.matriculas(user_id);

-- 5) CONFIGURACIÓN DEL NEGOCIO
create table if not exists public.business (
  id integer primary key default 1,
  business_name text,
  address text,
  phone text,
  email text,
  rnc text,
  quotation_rates jsonb,
  owner_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_rnc_check check (rnc ~ '^[0-9]{9,11}$' or rnc is null)
);
create index if not exists idx_business_owner on public.business(owner_user_id);
create index if not exists idx_business_rnc on public.business(rnc);

drop trigger if exists trg_business_touch_updated on public.business;
create trigger trg_business_touch_updated
before update on public.business
for each row execute function public.touch_updated_at();

insert into public.business (id, business_name, address, phone, email)
values (1, 'Mi Negocio', '', '', '')
on conflict (id) do nothing;

create table if not exists public.business_settings (
  id integer primary key default 1,
  business_name text,
  address text,
  phone text,
  email text,
  rnc text,
  quotation_rates jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_settings_rnc_check check (rnc ~ '^[0-9]{9,11}$' or rnc is null)
);

drop trigger if exists trg_business_settings_touch_updated on public.business_settings;
create trigger trg_business_settings_touch_updated
before update on public.business_settings
for each row execute function public.touch_updated_at();

insert into public.business_settings (id, business_name, address, phone, email)
values (1, 'Mi Negocio', '', '', '')
on conflict (id) do nothing;

create or replace function public.is_owner(uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.business b where b.owner_user_id = uid
  );
$$;

create or replace function public.is_admin(uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.collaborators c
    where c.id = uid and lower(coalesce(c.role,'colaborador')) = 'administrador'
  );
$$;

-- 6) ÓRDENES Y NOTIFICACIONES
create or replace function public.generate_order_short_id()
returns text as $$
declare
  random_part text;
  date_part text;
begin
  random_part := upper(substring(md5(random()::text) from 1 for 6));
  date_part := to_char(current_date, 'YYYYMMDD');
  return 'ORD-' || date_part || '-' || random_part;
end;
$$ language plpgsql;

create table if not exists public.orders (
  id bigserial primary key,
  short_id text unique default public.generate_order_short_id(),
  created_at timestamptz not null default now(),
  client_id uuid references public.profiles(id) on delete set null,
  name text not null,
  phone text not null,
  email text,
  rnc text,
  empresa text,
  service_id bigint references public.services(id) on delete set null,
  vehicle_id bigint references public.vehicles(id) on delete set null,
  service_questions jsonb,
  pickup text,
  delivery text,
  origin_coords jsonb,
  destination_coords jsonb,
  "date" date,
  "time" time,
  status text not null default 'Pendiente',
  assigned_to uuid references public.profiles(id) on delete set null,
  accepted_by uuid,
  accepted_at timestamptz,
  assigned_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  evidence_photos jsonb,
  rating jsonb,
  estimated_price text default 'Por confirmar',
  monto_cobrado numeric,
  metodo_pago text,
  tracking_data jsonb,
  tracking_url text,
  last_collab_status text,
  client_contact_id uuid references public.clients(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint orders_status_check check (status in ('Pendiente','Aceptada','En curso','Completada','Cancelada'))
);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_date on public.orders("date");
create index if not exists idx_orders_assigned_to on public.orders(assigned_to);
create index if not exists idx_orders_client_id on public.orders(client_id);

create or replace function public.set_order_tracking_url()
returns trigger as $$
begin
  if new.tracking_url is null or new.tracking_url = '' then
    new.tracking_url := '/seguimiento.html?codigo=' || coalesce(new.short_id::text, new.id::text);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_orders_set_tracking on public.orders;
create trigger trg_orders_set_tracking
before insert on public.orders
for each row execute function public.set_order_tracking_url();

drop trigger if exists trg_orders_touch_updated on public.orders;
create trigger trg_orders_touch_updated
before update on public.orders
for each row execute function public.touch_updated_at();

create or replace function public.ensure_completed_metadata()
returns trigger as $$
begin
  if new.status = 'Completada' then
    if new.completed_at is null then
      new.completed_at := now();
    end if;
    if new.completed_by is null then
      new.completed_by := coalesce(new.assigned_to, auth.uid());
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_orders_ensure_completed_metadata on public.orders;
create trigger trg_orders_ensure_completed_metadata
before update on public.orders
for each row when (old.status is distinct from new.status)
execute function public.ensure_completed_metadata();

create or replace function public.normalize_order_status(in_status text)
returns text language plpgsql as $$
declare s text := trim(both from coalesce(in_status,''));
begin
  if s = '' then return 'Pendiente'; end if;
  s := replace(lower(s), '_', ' ');
  if s in ('pendiente') then return 'Pendiente'; end if;
  if s in ('aceptada','aceptado','aceptar','accepted') then return 'Aceptada'; end if;
  if s in ('en curso','en progreso','en proceso','en transito','en tránsito') then return 'En curso'; end if;
  if s in ('completada','completado','finalizada','terminada','entregado','entregada') then return 'Completada'; end if;
  if s in ('cancelada','cancelado','anulada') then return 'Cancelada'; end if;
  return 'Pendiente';
end $$;

create or replace function public.orders_status_guard()
returns trigger language plpgsql as $$
begin
  new.status := public.normalize_order_status(new.status);
  if new.status not in ('Pendiente','Aceptada','En curso','Completada','Cancelada') then
    raise exception 'Estado no permitido: %', new.status using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_status_guard on public.orders;
create trigger trg_orders_status_guard
before insert or update on public.orders
for each row execute function public.orders_status_guard();

create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  title text,
  body text,
  data jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists idx_notifications_user on public.notifications(user_id);
create index if not exists idx_notifications_created_at on public.notifications(created_at);
create index if not exists idx_notifications_unread on public.notifications((read_at is null)) where read_at is null;

create table if not exists public.notification_outbox (
  id bigint generated by default as identity primary key,
  order_id bigint not null,
  new_status text not null,
  target_role text,
  target_user_id uuid,
  target_contact_id uuid references public.clients(id) on delete set null,
  payload jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists idx_notification_outbox_target_contact_id on public.notification_outbox(target_contact_id);
create index if not exists idx_notification_outbox_processed_at_null on public.notification_outbox(processed_at) where processed_at is null;

create table if not exists public.push_subscriptions (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  endpoint text not null,
  keys jsonb not null,
  created_at timestamptz not null default now(),
  client_contact_id uuid references public.clients(id) on delete cascade,
  unique(user_id, endpoint),
  unique(client_contact_id, endpoint),
  constraint chk_push_owner check (user_id is not null or client_contact_id is not null)
);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);
create index if not exists idx_push_subscriptions_contact on public.push_subscriptions(client_contact_id);

create or replace function public.sync_collaborator_push_subscription()
returns trigger as $$
declare endpoint text; keys jsonb;
begin
  if new.push_subscription is null then return new; end if;
  endpoint := new.push_subscription->>'endpoint';
  keys := new.push_subscription->'keys';
  if endpoint is null or endpoint = '' then return new; end if;
  insert into public.push_subscriptions(user_id, endpoint, keys, created_at)
  values (new.id, endpoint, coalesce(keys,'{}'::jsonb), now())
  on conflict (user_id, endpoint) do update set keys = excluded.keys;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_collaborators_sync_push_subscription on public.collaborators;
create trigger trg_collaborators_sync_push_subscription
after update of push_subscription on public.collaborators
for each row execute function public.sync_collaborator_push_subscription();

-- 7) RPCS
create or replace function public.create_order_with_contact(order_payload jsonb)
returns public.orders
language plpgsql
security definer
set search_path = public as $$
declare
  v_client_id uuid := (select auth.uid());
  v_contact_id uuid;
  v_order public.orders;
  v_push_subscription jsonb;
begin
  v_push_subscription := order_payload->'push_subscription';

  if v_client_id is null then
    insert into public.clients(name, phone, email)
    values (
      nullif(order_payload->>'name', ''),
      nullif(order_payload->>'phone', ''),
      nullif(order_payload->>'email', '')
    ) returning id into v_contact_id;

    if v_push_subscription is not null and v_push_subscription->>'endpoint' is not null then
      insert into public.push_subscriptions(client_contact_id, endpoint, keys)
      values (v_contact_id, v_push_subscription->>'endpoint', v_push_subscription->'keys')
      on conflict (client_contact_id, endpoint) do update set keys = excluded.keys;
    end if;

    insert into public.orders (
      name, phone, email, rnc, empresa, service_id, vehicle_id, service_questions,
      pickup, delivery, origin_coords, destination_coords, "date", "time",
      status, estimated_price, tracking_data, client_contact_id
    ) values (
      nullif(order_payload->>'name', ''), nullif(order_payload->>'phone', ''), nullif(order_payload->>'email', ''),
      nullif(order_payload->>'rnc', ''), nullif(order_payload->>'empresa', ''),
      (order_payload->>'service_id')::bigint, (order_payload->>'vehicle_id')::bigint, order_payload->'service_questions',
      order_payload->>'pickup', order_payload->>'delivery',
      order_payload->'origin_coords', order_payload->'destination_coords',
      (order_payload->>'date')::date, (order_payload->>'time')::time,
      'Pendiente', order_payload->>'estimated_price', order_payload->'tracking_data', v_contact_id
    ) returning * into v_order;

    insert into public.notification_outbox(order_id, new_status, target_contact_id, payload)
    values (
      v_order.id, 'Creada', v_contact_id,
      jsonb_build_object(
        'title', '✅ Solicitud Recibida',
        'body', 'Hemos recibido tu solicitud #' || v_order.short_id || '. Pronto será revisada.'
      )
    );
  else
    if v_push_subscription is not null and v_push_subscription->>'endpoint' is not null then
      insert into public.push_subscriptions(user_id, endpoint, keys)
      values (v_client_id, v_push_subscription->>'endpoint', v_push_subscription->'keys')
      on conflict (user_id, endpoint) do update set keys = excluded.keys;
    end if;

    insert into public.orders (
      name, phone, email, rnc, empresa, service_id, vehicle_id, service_questions,
      pickup, delivery, origin_coords, destination_coords, "date", "time",
      status, estimated_price, tracking_data, client_id
    ) values (
      nullif(order_payload->>'name', ''), nullif(order_payload->>'phone', ''), nullif(order_payload->>'email', ''),
      nullif(order_payload->>'rnc', ''), nullif(order_payload->>'empresa', ''),
      (order_payload->>'service_id')::bigint, (order_payload->>'vehicle_id')::bigint, order_payload->'service_questions',
      order_payload->>'pickup', order_payload->>'delivery',
      order_payload->'origin_coords', order_payload->'destination_coords',
      (order_payload->>'date')::date, (order_payload->>'time')::time,
      'Pendiente', order_payload->>'estimated_price', order_payload->'tracking_data', v_client_id
    ) returning * into v_order;

    insert into public.notification_outbox(order_id, new_status, target_user_id, payload)
    values (
      v_order.id, 'Creada', v_client_id,
      jsonb_build_object(
        'title', '✅ Solicitud Recibida',
        'body', 'Hemos recibido tu solicitud #' || v_order.short_id || '. Pronto será revisada.'
      )
    );
  end if;

  insert into public.notification_outbox(order_id, new_status, target_role, payload)
  values (
    v_order.id, 'Creada', 'administrador',
    jsonb_build_object(
      'title', '📢 Nueva Solicitud Recibida',
      'body', 'Se ha creado la solicitud #' || v_order.short_id || ' por ' || coalesce(v_order.name, 'No especificado') || '.'
    )
  );

  return v_order;
end;
$$;
grant execute on function public.create_order_with_contact(jsonb) to anon, authenticated;

create or replace function public.accept_order(order_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare _now timestamptz := now();
begin
  update public.orders
  set
    status = 'Aceptada',
    accepted_at = coalesce(accepted_at, _now),
    accepted_by = coalesce(accepted_by, auth.uid()),
    assigned_to = coalesce(assigned_to, auth.uid()),
    assigned_at = coalesce(assigned_at, _now),
    tracking_data = coalesce(tracking_data, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('status','en_camino_recoger','date',_now,'description','Orden aceptada, en camino a recoger'))
  where id = order_id or short_id = order_id::text;
end;
$$;
grant execute on function public.accept_order(bigint) to authenticated;

create or replace function public.update_order_status(
  order_id bigint,
  new_status text,
  collaborator_id uuid,
  tracking_entry jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare updated jsonb;
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
    completed_by = case when lower(new_status) = 'entregado' then collaborator_id else completed_by end,
    completed_at = case when lower(new_status) = 'entregado' then now() else completed_at end,
    last_collab_status = new_status,
    tracking_data = coalesce(o.tracking_data, '[]'::jsonb) || jsonb_build_array(tracking_entry)
  where o.id = order_id
    and (o.assigned_to = collaborator_id or o.assigned_to is null)
  returning to_jsonb(o) into updated;

  if updated is null then
    raise exception 'No autorizado o no encontrada' using errcode = '42501';
  end if;
  return updated;
end;
$$;
grant execute on function public.update_order_status(bigint, text, uuid, jsonb) to authenticated;

create or replace function public.set_order_amount_admin(
  order_id bigint,
  amount numeric,
  method text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare updated jsonb;
begin
  if not (public.is_admin(auth.uid()) or public.is_owner(auth.uid())) then
    raise exception 'Acceso restringido: solo administradores pueden modificar montos.' using errcode = '42501';
  end if;
  update public.orders o
  set monto_cobrado = amount, metodo_pago = method
  where o.id = order_id
  returning to_jsonb(o) into updated;
  if updated is null then
    raise exception 'Orden no encontrada' using errcode = 'P0002';
  end if;
  return updated;
end;
$$;
grant execute on function public.set_order_amount_admin(bigint, numeric, text) to authenticated;

create or replace function public.get_subscriptions_by_role(role_name text)
returns table(endpoint text, keys jsonb)
language plpgsql
security definer
set search_path = public as $$
begin
  return query
    select
      ps.endpoint,
      ps.keys
    from
      push_subscriptions ps
    join
      collaborators c on ps.user_id = c.id
    where
      c.role = role_name
      and c.status = 'activo';
end;
$$;
grant execute on function public.get_subscriptions_by_role(text) to service_role;

-- 8) OTRAS TABLAS
create table if not exists public.invoices (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  order_id bigint references public.orders(id) on delete set null,
  client_id uuid references public.profiles(id) on delete set null,
  file_path text not null,
  file_url text,
  total numeric,
  status text default 'generada',
  data jsonb
);

create table if not exists public.order_completion_receipts (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  order_id bigint references public.orders(id) on delete cascade,
  client_id uuid references public.profiles(id) on delete set null,
  collaborator_id uuid references public.collaborators(id) on delete set null,
  signed_by_collaborator_at timestamptz,
  signed_by_client_at timestamptz,
  data jsonb
);

create table if not exists public.function_logs (
  id bigserial primary key,
  fn_name text not null,
  level text not null default 'error',
  message text,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- 9) RLS (Row Level Security)
alter table public.vehicles enable row level security;
alter table public.services enable row level security;
alter table public.profiles enable row level security;
alter table public.collaborators enable row level security;
alter table public.matriculas enable row level security;
alter table public.business enable row level security;
alter table public.business_settings enable row level security;
alter table public.orders enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.order_completion_receipts enable row level security;
alter table public.invoices enable row level security;
alter table public.function_logs enable row level security;
alter table public.clients enable row level security;

-- Limpieza de políticas
drop policy if exists public_read_vehicles on public.vehicles;
drop policy if exists admin_all_access_vehicles on public.vehicles;
drop policy if exists public_read_services on public.services;
drop policy if exists admin_all_access_services on public.services;
drop policy if exists public_read_profiles on public.profiles;
drop policy if exists users_update_own_profile on public.profiles;
drop policy if exists admin_manage_profiles on public.profiles;
drop policy if exists public_insert_pending_orders on public.orders;
drop policy if exists clients_view_own_orders on public.orders;
drop policy if exists public_read_pending_orders on public.orders;
drop policy if exists collaborator_all_on_own_orders on public.orders;
drop policy if exists orders_select_assigned_collab on public.orders;
drop policy if exists admin_all_orders on public.orders;
drop policy if exists collaborator_self_manage on public.collaborators;
drop policy if exists collaborator_self_select on public.collaborators;
drop policy if exists collaborator_self_update on public.collaborators;
drop policy if exists admin_manage_collaborators on public.collaborators;
drop policy if exists collaborator_read_own_matriculas on public.matriculas;
drop policy if exists admin_manage_matriculas on public.matriculas;
drop policy if exists owner_full_access_business on public.business;
drop policy if exists owner_full_access_business_settings on public.business_settings;
drop policy if exists user_manage_own_notifications on public.notifications;
drop policy if exists admin_manage_notifications on public.notifications;
drop policy if exists user_manage_own_push_subscriptions on public.push_subscriptions;
drop policy if exists admin_read_push_subscriptions on public.push_subscriptions;
drop policy if exists client_read_own_receipts on public.order_completion_receipts;
drop policy if exists collaborator_manage_assigned_receipts on public.order_completion_receipts;
drop policy if exists admin_manage_receipts on public.order_completion_receipts;
drop policy if exists owner_admin_all_invoices on public.invoices;
drop policy if exists client_read_own_invoices on public.invoices;
drop policy if exists function_logs_read_admin on public.function_logs;
drop policy if exists clients_insert_any on public.clients;
drop policy if exists clients_select_any on public.clients;

-- Definición de políticas
create policy public_read_vehicles on public.vehicles for select using (true);
create policy admin_all_access_vehicles on public.vehicles for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid())) with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy public_read_services on public.services for select using (true);
create policy admin_all_access_services on public.services for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid())) with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy public_read_profiles on public.profiles for select using (true);
create policy users_update_own_profile on public.profiles for update using (auth.uid() = id);
create policy admin_manage_profiles on public.profiles for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid())) with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy collaborator_self_manage on public.collaborators for all using (auth.uid() = id or public.is_owner(auth.uid()) or public.is_admin(auth.uid())) with check (auth.uid() = id or public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy admin_manage_collaborators on public.collaborators for all using (public.is_admin(auth.uid()) or public.is_owner(auth.uid())) with check (public.is_admin(auth.uid()) or public.is_owner(auth.uid()));
create policy collaborator_read_own_matriculas on public.matriculas for select using (user_id = auth.uid());
create policy admin_manage_matriculas on public.matriculas for all using (public.is_admin(auth.uid()) or public.is_owner(auth.uid())) with check (public.is_admin(auth.uid()) or public.is_owner(auth.uid()));
create policy owner_full_access_business on public.business for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid())) with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy owner_full_access_business_settings on public.business_settings for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid())) with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy user_manage_own_push_subscriptions on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy admin_read_push_subscriptions on public.push_subscriptions for select using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy anon_insert_push_by_contact on public.push_subscriptions for insert to anon, authenticated with check (client_contact_id is not null);
create policy user_manage_own_notifications on public.notifications for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy admin_manage_notifications on public.notifications for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid())) with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy client_read_own_receipts on public.order_completion_receipts for select using (client_id = auth.uid());
create policy collaborator_manage_assigned_receipts on public.order_completion_receipts for all using (exists (select 1 from public.orders o where o.id = order_id and o.assigned_to = auth.uid())) with check (exists (select 1 from public.orders o where o.id = order_id and o.assigned_to = auth.uid()));
create policy admin_manage_receipts on public.order_completion_receipts for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid())) with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy owner_admin_all_invoices on public.invoices for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid())) with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy client_read_own_invoices on public.invoices for select using (client_id = auth.uid());
create policy function_logs_read_admin on public.function_logs for select using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy clients_insert_any on public.clients for insert to anon, authenticated with check (true);
create policy clients_select_any on public.clients for select to anon, authenticated using (true);
create policy public_insert_pending_orders on public.orders for insert with check (status = 'Pendiente' and (client_id is null or client_id = auth.uid()) and assigned_to is null);
create policy public_read_pending_orders on public.orders for select using (status = 'Pendiente' or client_id = auth.uid() or assigned_to = auth.uid() or public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy collaborator_all_on_own_orders on public.orders for all using (exists (select 1 from public.collaborators c where c.id = auth.uid() and c.status = 'activo') and (assigned_to = auth.uid() or status = 'Pendiente')) with check (exists (select 1 from public.collaborators c where c.id = auth.uid() and c.status = 'activo'));
create policy admin_all_orders on public.orders for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid())) with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- 10) TRIGGERS ADICIONALES
create or replace function public.create_completion_receipt_on_order_complete()
returns trigger as $$
begin
  if new.status = 'Completada' then
    if not exists (select 1 from public.order_completion_receipts r where r.order_id = new.id) then
      insert into public.order_completion_receipts(order_id, client_id, collaborator_id, signed_by_collaborator_at)
      values (new.id, new.client_id, new.assigned_to, coalesce(new.completed_at, now()));
    end if;
  end if;
  return new;
end;
$$ language plpgsql;
drop trigger if exists trg_orders_create_receipt_on_complete on public.orders;
create trigger trg_orders_create_receipt_on_complete
after update of status on public.orders
for each row execute function public.create_completion_receipt_on_order_complete();

-- 11) MÉTRICAS DE COLABORADOR
create table if not exists public.collaborator_performance (
  id bigserial primary key,
  collaborator_id uuid not null references public.profiles(id) on delete cascade,
  metric_date date not null default (current_date),
  accepted_count int not null default 0,
  in_progress_count int not null default 0,
  completed_count int not null default 0,
  canceled_count int not null default 0,
  avg_completion_minutes numeric,
  total_amount numeric not null default 0,
  avg_rating numeric,
  updated_at timestamptz not null default now(),
  unique(collaborator_id, metric_date)
);

drop trigger if exists trg_perf_touch_updated on public.collaborator_performance;
create trigger trg_perf_touch_updated
before update on public.collaborator_performance
for each row execute function public.touch_updated_at();

create or replace function public.upsert_collaborator_metric_fixed(
  p_collaborator_id uuid, p_metric_date date, p_accept_inc int, p_in_progress_inc int, p_complete_inc int, p_cancel_inc int,
  p_amount numeric, p_rating numeric, p_completion_minutes numeric
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.collaborator_performance(
    collaborator_id, metric_date, accepted_count, in_progress_count,
    completed_count, canceled_count, total_amount, avg_rating, avg_completion_minutes, updated_at
  ) values (
    p_collaborator_id, p_metric_date, greatest(p_accept_inc,0), greatest(p_in_progress_inc,0),
    greatest(p_complete_inc,0), greatest(p_cancel_inc,0), coalesce(p_amount,0), p_rating, p_completion_minutes, now()
  )
  on conflict (collaborator_id, metric_date)
  do update set
    accepted_count = public.collaborator_performance.accepted_count + greatest(p_accept_inc,0),
    in_progress_count = public.collaborator_performance.in_progress_count + greatest(p_in_progress_inc,0),
    completed_count = public.collaborator_performance.completed_count + greatest(p_complete_inc,0),
    canceled_count = public.collaborator_performance.canceled_count + greatest(p_cancel_inc,0),
    total_amount = public.collaborator_performance.total_amount + coalesce(p_amount,0),
    avg_rating = case when p_rating is null then public.collaborator_performance.avg_rating else coalesce((public.collaborator_performance.avg_rating + p_rating) / 2.0, p_rating) end,
    avg_completion_minutes = case when p_completion_minutes is null then public.collaborator_performance.avg_completion_minutes else coalesce((public.collaborator_performance.avg_completion_minutes + p_completion_minutes) / 2.0, p_completion_minutes) end,
    updated_at = now();
end;$$;

create or replace function public.track_order_metrics()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_collab uuid; v_when date := current_date; v_amount numeric := null; v_rating numeric := null; v_minutes numeric := null;
begin
  v_collab := coalesce(new.assigned_to, old.assigned_to);
  if v_collab is null then return new; end if;

  if new.status = 'Completada' and new.completed_at is not null then
    v_minutes := extract(epoch from (new.completed_at - coalesce(new.assigned_at, new.created_at))) / 60.0;
    v_rating := coalesce((new.rating->>'score')::numeric, null);
    v_amount := new.monto_cobrado;
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'Aceptada' then perform public.upsert_collaborator_metric_fixed(v_collab, v_when, 1, 0, 0, 0, null, null, null);
    elsif new.status = 'En curso' then perform public.upsert_collaborator_metric_fixed(v_collab, v_when, 0, 1, 0, 0, null, null, null);
    elsif new.status = 'Completada' then perform public.upsert_collaborator_metric_fixed(v_collab, v_when, 0, 0, 1, 0, v_amount, v_rating, v_minutes);
    elsif new.status = 'Cancelada' then perform public.upsert_collaborator_metric_fixed(v_collab, v_when, 0, 0, 0, 1, null, null, null);
    end if;
  end if;
  return new;
end;$$;

drop trigger if exists trg_orders_track_metrics on public.orders;
create trigger trg_orders_track_metrics
after update on public.orders
for each row execute function public.track_order_metrics();

create or replace view public.collaborator_performance_view as
select
  cp.collaborator_id, p.full_name as collaborator_name, date_trunc('day', cp.metric_date)::date as metric_date,
  cp.accepted_count, cp.in_progress_count, cp.completed_count, cp.canceled_count,
  cp.total_amount, cp.avg_rating, cp.avg_completion_minutes
from public.collaborator_performance cp
left join public.profiles p on p.id = cp.collaborator_id;

alter table public.collaborator_performance enable row level security;
drop policy if exists perf_self_view on public.collaborator_performance;
create policy perf_self_view on public.collaborator_performance for select using (auth.uid() = collaborator_id or public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- 12) SEEDS BÁSICOS
insert into public.vehicles (name, description, image_url, is_active) values
('Camión Pequeño','14 pies','https://i.postimg.cc/DynCkfnV/camionpequeno.jpg', true),
('Furgoneta','Paquetería y cargas ligeras','https://i.postimg.cc/RV4P5C9f/furgoneta.jpg', true),
('Grúa Vehicular','Remolque de autos y jeepetas','https://i.postimg.cc/hvgBTFmy/grua-vehiculos.jpg', true),
('Camión Grande','22 a 28 pies','https://i.postimg.cc/44z8SHCc/camiongrande.jpg', true),
('Grúa de Carga','Izado y movimiento de carga','https://i.postimg.cc/0yHZwpSf/grua.png', true),
('Motor','Entregas rápidas','https://i.postimg.cc/JMNgTvmd/motor.jpg', true),
('Camión Abierto','Materiales y mineros','https://i.postimg.cc/Kvx9ScFT/camionminero.jpg', true)
on conflict (name) do nothing;

insert into public.services (name, description, image_url, is_active, display_order) values
('Transporte Comercial','Mercancías comerciales.','https://i.postimg.cc/sXCdCFTD/transporte-comercial.png', true, 1),
('Paquetería','Envíos rápidos.','https://i.postimg.cc/zBYZYmx8/paqueteria.png', true, 2),
('Carga Pesada','Especialistas carga pesada.','https://i.postimg.cc/B65b1fbv/pesado.jpg', true, 3),
('Flete','Flete nacional.','https://i.postimg.cc/15vQnj3w/flete.png', true, 4),
('Mudanza','Residencial y comercial.','https://i.postimg.cc/HszyJd5m/mudanza.jpg', true, 5),
('Grúa Vehículo','Remolque.','https://i.postimg.cc/hvgBTFmy/grua-vehiculos.jpg', true, 6),
('Botes Mineros','Alquiler/transporte.','https://i.postimg.cc/gzL29mkt/botes-minenos.png', true, 7),
('Grúa de Carga','Movimiento de carga.','https://i.postimg.cc/sDjz2rsx/grua-carga.png', true, 8)
on conflict (name) do nothing;
