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
-- - Notificaciones y suscripciones push
-- - Acta de completado (receipts)
-- - Facturas (invoices)
-- - Tabla de clientes (para pedidos anónimos)
-- - Function logs
-- - RLS coherente (clientes, colaboradores activos, administrador/owner)
-- - RPCs: accept_order, update_order_status, set_order_amount_admin
-- =============================================================

-- 1) EXTENSIONES
create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1.1) ENUMS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE public.order_status AS ENUM (
      'pending', 'accepted', 'in_progress', 'completed', 'cancelled'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_status') THEN
    CREATE TYPE public.notification_status AS ENUM (
      'pending', 'processing', 'retry', 'sent', 'failed'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE public.invoice_status AS ENUM (
      'generada', 'enviada', 'pagada', 'anulada'
    );
  END IF;
END $$;

-- 2) FUNCIONES UTILITARIAS GENERALES
-- Unificar a una sola función updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- (run_push_self_test movido más abajo para evitar dependencia circular)

-- Dashboard View moved after notification_events to satisfy dependency
-- (definition temporarily removed here; redefined later)

-- Helpers de rol (se definen más abajo, después de crear tablas necesarias)

-- 3) CATÁLOGOS
-- Vehicles
create table if not exists public.vehicles (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  name text not null unique,
  description text,
  image_url text,
  is_active boolean not null default true
);
comment on table public.vehicles is 'Catálogo de vehículos.';

-- Services
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
-- Profiles (vincula auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_profiles_email on public.profiles(email);

-- Trigger updated_at
drop trigger if exists trg_profiles_set_updated on public.profiles;
create trigger trg_profiles_set_updated
before update on public.profiles
for each row execute function public.set_updated_at();

-- Collaborators
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

-- Trigger updated_at
drop trigger if exists trg_collaborators_touch_updated on public.collaborators;
create trigger trg_collaborators_touch_updated
before update on public.collaborators
for each row execute function public.set_updated_at();

-- Sincronizar colaborador -> profile (upsert)
create or replace function public.sync_profile_name()
returns trigger
language plpgsql set search_path = pg_catalog, public as $$
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
$$;

drop trigger if exists trg_sync_profile_name on public.collaborators;
create trigger trg_sync_profile_name
after insert or update of name, email, phone on public.collaborators
for each row execute function public.sync_profile_name();

-- Matriculas (Clients)
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now()
);
comment on table public.clients is 'Tabla para clientes no autenticados (invitados).';

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
  constraint business_rnc_check check (rnc ~ '^\d{3}-\d{5}-\d{1}$' or rnc is null)
);
alter table public.business add column if not exists vapid_public_key text;
alter table public.business add column if not exists push_vapid_key text;
create index if not exists idx_business_owner on public.business(owner_user_id);
create index if not exists idx_business_rnc on public.business(rnc);

drop trigger if exists trg_business_touch_updated on public.business;
create trigger trg_business_touch_updated
before update on public.business
for each row execute function public.set_updated_at();

insert into public.business (business_name, address, phone, email)
values ('Mi Negocio', '', '', '')
on conflict (id) do nothing;

-- Helpers de rol
create or replace function public.is_owner(uid uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(
    select 1 from public.business b where b.owner_user_id = uid
  );
$$;

create or replace function public.is_admin(uid uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1
    from public.collaborators
    where id = uid
      and lower(role) = 'administrador'
      and status = 'activo'
  );
$$;

-- 6) ÓRDENES Y RELACIONADOS
-- Generador de short_id
create or replace function public.generate_order_short_id()
returns text
language plpgsql set search_path = pg_catalog, public as $$
declare
  random_part text;
  date_part text;
begin
  random_part := upper(substring(md5(random()::text) from 1 for 6));
  date_part := to_char(current_date, 'YYYYMMDD');
  return 'ORD-' || date_part || '-' || random_part;
end;
$$;

-- Tabla orders
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
  status public.order_status not null default 'pending',
  assigned_to uuid references public.profiles(id) on delete set null,
  -- Columnas de aceptación para compatibilidad
  accepted_by uuid,
  accepted_at timestamptz,
  -- Fin columnas de aceptación
  assigned_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  evidence_photos jsonb,
  rating jsonb,
  estimated_price numeric,
  monto_cobrado numeric,
  metodo_pago text,
  tracking_data jsonb,
  tracking_url text,
  client_contact_id uuid,
  updated_at timestamptz not null default now(),
  customer_comment text
);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_date on public.orders("date");
create index if not exists idx_orders_short_id on public.orders(short_id);
create index if not exists idx_orders_assigned_to on public.orders(assigned_to);
create index if not exists idx_orders_client_id on public.orders(client_id);
create index if not exists idx_orders_created_at on public.orders(created_at);
create index if not exists idx_orders_completed_at on public.orders(completed_at);
create index if not exists idx_orders_status_assigned_to on public.orders(status, assigned_to);
create index if not exists idx_orders_status_created_at on public.orders(status, created_at);

-- FK client_contact_id
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'client_contact_id') then
    if not exists (select 1 from pg_constraint where conname = 'orders_client_contact_id_fkey') then
      alter table public.orders
        add constraint orders_client_contact_id_fkey
        foreign key (client_contact_id) references public.clients(id) on delete set null;
    end if;
  end if;
end $$;

-- tracking_url auto
create or replace function public.set_order_tracking_url()
returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.tracking_url is null or new.tracking_url = '' then
    new.tracking_url := '/seguimiento.html?orderId=' || coalesce(new.short_id::text, new.id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_set_tracking on public.orders;
create trigger trg_orders_set_tracking
before insert on public.orders
for each row execute function public.set_order_tracking_url();

-- updated_at
drop trigger if exists trg_orders_touch_updated on public.orders;
create trigger trg_orders_touch_updated
before update on public.orders
for each row execute function public.set_updated_at();

-- Remover columna redundante si aún existe
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'last_collab_status'
  ) THEN
    ALTER TABLE public.orders DROP COLUMN last_collab_status;
  END IF;
END $$;

-- Asegurar metadatos de completado
create or replace function public.ensure_completed_metadata()
returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.status = 'completed' then
    if new.completed_at is null then
      new.completed_at := now();
    end if;
    if new.completed_by is null then
      new.completed_by := coalesce(new.assigned_to, auth.uid());
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_ensure_completed_metadata on public.orders;
create trigger trg_orders_ensure_completed_metadata
before update on public.orders
for each row when (old.status is distinct from new.status)
execute function public.ensure_completed_metadata();

-- Normalización de estado (Retorna ENUM)
-- IMPORTANTE: Drop previo para permitir cambio de tipo de retorno
DROP FUNCTION IF EXISTS public.normalize_order_status(text);

create or replace function public.normalize_order_status(in_status text)
returns public.order_status
language plpgsql set search_path = pg_catalog, public as $$
declare s text := trim(both from coalesce(in_status,''));
begin
  if s = '' then return 'pending'; end if;
  s := replace(lower(s), '_', ' ');
  if s in ('pendiente', 'pending') then return 'pending'; end if;
  if s in ('aceptada','aceptado','aceptar','accepted') then return 'accepted'; end if;
  if s in ('en curso','en progreso','en proceso','en transito','en tránsito', 'in_progress', 'en_camino_recoger', 'cargando', 'en_camino_entregar') then return 'in_progress'; end if;
  if s in ('completada','completado','finalizada','terminada','entregado','entregada', 'completed') then return 'completed'; end if;
  if s in ('cancelada','cancelado','anulada', 'cancelled') then return 'cancelled'; end if;
  return 'pending';
end $$;

-- Migration for orders.status (If exists as TEXT)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'status' AND data_type = 'text'
  ) THEN
    ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
    ALTER TABLE public.orders
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE public.order_status USING
        CASE
          WHEN lower(status) IN ('pendiente', 'pending') THEN 'pending'::public.order_status
          WHEN lower(status) IN ('aceptada', 'accepted') THEN 'accepted'::public.order_status
          WHEN lower(status) IN ('en curso', 'in_progress', 'en_camino_recoger', 'cargando', 'en_camino_entregar') THEN 'in_progress'::public.order_status
          WHEN lower(status) IN ('completada', 'completed', 'entregada', 'entregado') THEN 'completed'::public.order_status
          WHEN lower(status) IN ('cancelada', 'cancelled', 'anulada') THEN 'cancelled'::public.order_status
          ELSE 'pending'::public.order_status
        END,
      ALTER COLUMN status SET DEFAULT 'pending'::public.order_status;
  END IF;
END $$;


-- Notificaciones
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

alter table public.notifications add column if not exists contact_id uuid references public.clients(id) on delete cascade;
create index if not exists idx_notifications_contact on public.notifications(contact_id);
create index if not exists idx_notifications_user_read_at on public.notifications(user_id, read_at);

-- Ajustes para comisiones
alter table public.collaborators add column if not exists commission_percent numeric default 0.10;

-- RPC: Datos del panel del colaborador
create or replace function public.get_collaborator_dashboard_data(collab_id uuid, period_start date, period_end date)
returns table (
  order_id bigint,
  "date" date,
  client_name text,
  commission_amount numeric,
  rating_stars int,
  customer_comment text
)
language sql stable security definer set search_path = pg_catalog, public as $$
  select 
    o.id as order_id,
    o."date"::date as "date",
    coalesce(o.name,'') as client_name,
    round(coalesce(o.monto_cobrado,0) * coalesce(c.commission_percent, 0.10), 2) as commission_amount,
    coalesce((o.rating->>'service')::int, (o.rating->>'stars')::int, null) as rating_stars,
    o.customer_comment
  from public.orders o
  left join public.collaborators c on c.id = o.assigned_to
  where o.assigned_to = collab_id
    and o.status = 'completed'
    and (period_start is null or o."date" >= period_start)
    and (period_end is null or o."date" <= period_end)
  order by o."date" desc
$$;
grant execute on function public.get_collaborator_dashboard_data(uuid, date, date) to authenticated;

-- RPC: Enviar calificación
create or replace function public.submit_rating(order_id bigint, stars int, comment text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare exists_order boolean;
begin
  select exists(select 1 from public.orders where id = order_id) into exists_order;
  if not exists_order then
    return false;
  end if;

  update public.orders
  set rating = jsonb_build_object('stars', greatest(1, least(5, stars)), 'comment', nullif(comment,'')),
      customer_comment = nullif(comment,'')
  where id = order_id
    and (status = 'completed' or completed_at is not null);
  return true;
end;
$$;
grant execute on function public.submit_rating(bigint, int, text) to anon, authenticated;

create or replace function public.submit_rating_v2(order_id bigint, service_stars int, collab_stars int, comment text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare exists_order boolean;
begin
  select exists(select 1 from public.orders where id = order_id) into exists_order;
  if not exists_order then
    return false;
  end if;

  update public.orders
  set rating = jsonb_build_object(
      'service', greatest(1, least(5, service_stars)),
      'collab', greatest(1, least(5, collab_stars)),
      'stars', greatest(1, least(5, service_stars)),
      'comment', nullif(comment,'')
    ),
      customer_comment = nullif(comment,'')
  where id = order_id
    and (status = 'completed' or completed_at is not null);
  return true;
end;
$$;
grant execute on function public.submit_rating_v2(bigint, int, int, text) to anon, authenticated;

-- RPC: Testimonios públicos
create or replace function public.get_public_testimonials(limit_count int default 10)
returns table (
  order_id bigint,
  stars int,
  comment text,
  client_name text
)
language sql stable security definer set search_path = pg_catalog, public as $$
  select 
    o.id as order_id,
    coalesce((o.rating->>'service')::int, (o.rating->>'stars')::int, null) as stars,
    nullif(o.customer_comment,'') as comment,
    nullif(o.name,'') as client_name
  from public.orders o
  where o.customer_comment is not null 
    and trim(o.customer_comment) <> ''
    and coalesce((o.rating->>'stars')::int, 0) >= 4
  order by o.completed_at desc nulls last, o.created_at desc
  limit greatest(1, limit_count)
$$;
grant execute on function public.get_public_testimonials(int) to anon, authenticated;

-- Push subscriptions
create table if not exists public.push_subscriptions (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  endpoint text not null,
  keys jsonb not null,
  created_at timestamptz not null default now(),
  unique(user_id, endpoint)
);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);
create unique index if not exists uniq_push_subscriptions_user_endpoint
  on public.push_subscriptions(user_id, endpoint);

alter table public.push_subscriptions add column if not exists client_contact_id uuid references public.clients(id) on delete cascade;
create index if not exists idx_push_subscriptions_contact on public.push_subscriptions(client_contact_id);
create unique index if not exists uniq_push_subscriptions_contact_endpoint
  on public.push_subscriptions(client_contact_id, endpoint);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_push_owner') then
    alter table public.push_subscriptions
      add constraint chk_push_owner
      check (user_id is not null or client_contact_id is not null);
  end if;
end $$;

-- Sincronía desde collaborators.push_subscription
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
$$ language plpgsql set search_path = pg_catalog, public;

drop trigger if exists trg_collaborators_sync_push_subscription on public.collaborators;
create trigger trg_collaborators_sync_push_subscription
after update of push_subscription on public.collaborators
for each row execute function public.sync_collaborator_push_subscription();

-- RPC: crear orden con contacto
create or replace function public.create_order_with_contact(order_payload jsonb)
returns public.orders
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_client_id uuid := (select auth.uid());
  v_contact_id uuid;
  v_order public.orders;
  v_status public.order_status;
begin
  v_status := public.normalize_order_status(order_payload->>'status');

  if v_client_id is null then -- Usuario anónimo
    insert into public.clients(name, phone, email)
    values (
      nullif(order_payload->>'name',''),
      nullif(order_payload->>'phone',''),
      nullif(order_payload->>'email','')
    ) returning id into v_contact_id;

    if order_payload->'push_subscription' is not null and order_payload->'push_subscription'->>'endpoint' is not null then
      insert into public.push_subscriptions(client_contact_id, endpoint, keys)
      values (v_contact_id, order_payload->'push_subscription'->>'endpoint', order_payload->'push_subscription'->'keys')
      on conflict (client_contact_id, endpoint) do update set keys = excluded.keys;
    end if;

    insert into public.orders (
      name, phone, email, rnc, empresa,
      service_id, vehicle_id, service_questions,
      pickup, delivery,
      origin_coords, destination_coords,
      "date", "time",
      status, estimated_price, tracking_data,
      client_contact_id
    ) values (
      nullif(order_payload->>'name',''),
      nullif(order_payload->>'phone',''),
      nullif(order_payload->>'email',''),
      nullif(order_payload->>'rnc',''),
      nullif(order_payload->>'empresa',''),
      nullif(order_payload->>'service_id','')::bigint,
      (order_payload->>'vehicle_id')::bigint,
      order_payload->'service_questions',
      order_payload->>'pickup',
      order_payload->>'delivery',
      order_payload->'origin_coords',
      order_payload->'destination_coords',
      (order_payload->>'date')::date,
      (order_payload->>'time')::time,
      v_status,
      (CASE WHEN order_payload->>'estimated_price' ~ '^[0-9]+(\.[0-9]+)?$' THEN (order_payload->>'estimated_price')::numeric ELSE NULL END),
      order_payload->'tracking_data', v_contact_id
    ) returning * into v_order;
  else
    if order_payload->'push_subscription' is not null and order_payload->'push_subscription'->>'endpoint' is not null then
      insert into public.push_subscriptions(user_id, endpoint, keys)
      values (v_client_id, order_payload->'push_subscription'->>'endpoint', order_payload->'push_subscription'->'keys')
      on conflict (user_id, endpoint) do update set keys = excluded.keys;
    end if;

    insert into public.orders (
      name, phone, email, rnc, empresa,
      service_id, vehicle_id, service_questions,
      pickup, delivery,
      origin_coords, destination_coords,
      "date", "time",
      status, estimated_price,
      tracking_data,
      client_id
    ) values (
      nullif(order_payload->>'name',''),
      nullif(order_payload->>'phone',''),
      nullif(order_payload->>'email',''),
      nullif(order_payload->>'rnc',''),
      nullif(order_payload->>'empresa',''),
      nullif(order_payload->>'service_id','')::bigint,
      (order_payload->>'vehicle_id')::bigint,
      order_payload->'service_questions',
      order_payload->>'pickup',
      order_payload->>'delivery',
      order_payload->'origin_coords',
      order_payload->'destination_coords',
      (order_payload->>'date')::date,
      (order_payload->>'time')::time,
      v_status,
      (CASE WHEN order_payload->>'estimated_price' ~ '^[0-9]+(\.[0-9]+)?$' THEN (order_payload->>'estimated_price')::numeric ELSE NULL END),
      order_payload->'tracking_data',
      v_client_id
    ) returning * into v_order;
  end if;
  return v_order;
end;
$$;
grant execute on function public.create_order_with_contact(jsonb) to anon, authenticated;

-- RPC: Aceptar orden por ID
create or replace function public.accept_order_by_id(p_order_id bigint)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare _now timestamptz := now();
begin
  if not exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(coalesce(c.status,'inactive')) = 'activo'
  ) then
    raise exception 'No autorizado: colaborador inactivo' using errcode = '42501';
  end if;
  update public.orders
  set
    status = 'accepted',
    accepted_at = coalesce(accepted_at, _now),
    accepted_by = coalesce(accepted_by, auth.uid()),
    assigned_to = coalesce(assigned_to, auth.uid()),
    assigned_at = coalesce(assigned_at, _now),
    tracking_data = jsonb_build_array(
      jsonb_build_object('status','accepted','date',_now,'description','Orden aceptada'))
  where id = p_order_id
    and status = 'pending'
    and assigned_to is null;
end;
$$;
grant execute on function public.accept_order_by_id(bigint) to authenticated;

-- RPC: Aceptar orden por Short ID
create or replace function public.accept_order_by_short_id(p_short_id text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare _now timestamptz := now();
begin
  if not exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(coalesce(c.status,'inactive')) = 'activo'
  ) then
    raise exception 'No autorizado: colaborador inactivo' using errcode = '42501';
  end if;
  update public.orders
  set
    status = 'accepted',
    accepted_at = coalesce(accepted_at, _now),
    accepted_by = coalesce(accepted_by, auth.uid()),
    assigned_to = coalesce(assigned_to, auth.uid()),
    assigned_at = coalesce(assigned_at, _now),
    tracking_data = jsonb_build_array(
      jsonb_build_object('status','accepted','date',_now,'description','Orden aceptada'))
  where short_id = p_short_id
    and status = 'pending'
    and assigned_to is null;
end;
$$;
grant execute on function public.accept_order_by_short_id(text) to authenticated;

-- Actualizar estado de orden
create or replace function public.update_order_status(
  order_id bigint,
  new_status text,
  collaborator_id uuid,
  tracking_entry jsonb
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare 
  updated jsonb;
  v_normalized public.order_status;
begin
  if not exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(coalesce(c.status,'inactive')) = 'activo'
  ) then
    raise exception 'No autorizado: colaborador inactivo' using errcode = '42501';
  end if;

  v_normalized := public.normalize_order_status(new_status);

  update public.orders o
  set
    status = v_normalized,
    assigned_to = coalesce(o.assigned_to, collaborator_id),
    assigned_at = case when v_normalized = 'accepted' and o.assigned_at is null then now() else assigned_at end,
    completed_by = case when v_normalized = 'completed' then collaborator_id else completed_by end,
    completed_at = case when v_normalized = 'completed' then now() else completed_at end,
    tracking_data = case when tracking_entry is not null then coalesce(o.tracking_data, '[]'::jsonb) || jsonb_build_array(tracking_entry) else o.tracking_data end
  where o.id = order_id
    and (o.assigned_to = collaborator_id or o.assigned_to is null)
    and o.status not in ('cancelled', 'completed')
  returning to_jsonb(o) into updated;

  if updated is null then
    raise exception 'No autorizado o no encontrada' using errcode = '42501';
  end if;
  if v_normalized = 'in_progress' then
    if exists (select 1 from public.collaborator_active_jobs j where j.collaborator_id = collaborator_id) then
      raise exception 'Ya tienes una orden activa' using errcode = 'P0001';
    end if;
    insert into public.collaborator_active_jobs(collaborator_id, order_id)
    values (collaborator_id, order_id)
    on conflict (collaborator_id) do update set order_id = excluded.order_id, started_at = now();
  elsif v_normalized in ('completed','cancelled') then
    delete from public.collaborator_active_jobs where order_id = order_id;
  end if;
  return updated;
end;
$$;
grant execute on function public.update_order_status(bigint, text, uuid, jsonb) to authenticated;

-- Modificar monto
create or replace function public.set_order_amount_admin(
  order_id bigint,
  amount numeric,
  method text
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
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

-- Invoices
create table if not exists public.invoices (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  order_id bigint references public.orders(id) on delete set null,
  client_id uuid references public.profiles(id) on delete set null,
  file_path text not null,
  file_url text,
  total numeric,
  status public.invoice_status default 'generada',
  data jsonb,
  recipient_email text
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

-- 9) RLS
alter table public.vehicles enable row level security;
alter table public.services enable row level security;
alter table public.profiles enable row level security;
alter table public.collaborators enable row level security;
alter table public.business enable row level security;
alter table public.orders enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.order_completion_receipts enable row level security;
alter table public.invoices enable row level security;
alter table public.function_logs enable row level security;
alter table public.clients enable row level security;

-- Limpieza
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
drop policy if exists owner_full_access_business on public.business;
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

-- Policies split (Granular)

-- Vehicles
create policy public_read_vehicles on public.vehicles for select using (true);
create policy admin_insert_vehicles on public.vehicles for insert with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy admin_update_vehicles on public.vehicles for update using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy admin_delete_vehicles on public.vehicles for delete using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Services
create policy public_read_services on public.services for select using (true);
create policy admin_insert_services on public.services for insert with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy admin_update_services on public.services for update using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy admin_delete_services on public.services for delete using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Profiles
create policy public_read_profiles on public.profiles for select using (true);
create policy users_update_own_profile on public.profiles for update using (auth.uid() = id);
create policy admin_insert_profiles on public.profiles for insert with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy admin_update_profiles on public.profiles for update using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy admin_delete_profiles on public.profiles for delete using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Create completion receipt on order complete
create or replace function public.create_completion_receipt_on_order_complete()
returns trigger as $$
begin
  if new.status = 'completed' then
    if not exists (select 1 from public.order_completion_receipts r where r.order_id = new.id) then
      insert into public.order_completion_receipts(order_id, client_id, collaborator_id, signed_by_collaborator_at)
      values (new.id, new.client_id, new.assigned_to, coalesce(new.completed_at, now()));
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = pg_catalog, public;

-- Collaborators
create policy collaborator_select_self on public.collaborators for select using (auth.uid() = id or public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy collaborator_update_self on public.collaborators for update using (auth.uid() = id or public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy admin_insert_collaborators on public.collaborators for insert with check (public.is_admin(auth.uid()) or public.is_owner(auth.uid()));
create policy admin_delete_collaborators on public.collaborators for delete using (public.is_admin(auth.uid()) or public.is_owner(auth.uid()));

-- Business
create policy owner_select_business on public.business for select using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy owner_update_business on public.business for update using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy owner_insert_business on public.business for insert with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy owner_delete_business on public.business for delete using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Push Subscriptions
create policy user_select_own_push on public.push_subscriptions for select using (user_id = auth.uid());
create policy user_insert_own_push on public.push_subscriptions for insert with check (user_id = auth.uid());
create policy user_update_own_push on public.push_subscriptions for update using (user_id = auth.uid());
create policy user_delete_own_push on public.push_subscriptions for delete using (user_id = auth.uid());
create policy admin_read_push_subscriptions on public.push_subscriptions for select using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

create policy anon_insert_push_by_contact on public.push_subscriptions for insert to anon, authenticated with check (client_contact_id is not null);

-- Notifications
create policy user_select_own_notifications on public.notifications for select using (user_id = auth.uid());
create policy user_update_own_notifications on public.notifications for update using (user_id = auth.uid());
create policy user_delete_own_notifications on public.notifications for delete using (user_id = auth.uid());
create policy admin_select_notifications on public.notifications for select using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy admin_insert_notifications on public.notifications for insert with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Receipts
create policy client_read_own_receipts on public.order_completion_receipts for select using (client_id = auth.uid());
create policy collaborator_select_assigned_receipts on public.order_completion_receipts for select using (exists (select 1 from public.orders o where o.id = order_id and o.assigned_to = auth.uid()));
create policy admin_select_receipts on public.order_completion_receipts for select using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy admin_update_receipts on public.order_completion_receipts for update using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy admin_delete_receipts on public.order_completion_receipts for delete using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Invoices
create policy admin_select_invoices on public.invoices for select using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy admin_insert_invoices on public.invoices for insert with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy admin_update_invoices on public.invoices for update using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy admin_delete_invoices on public.invoices for delete using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy client_read_own_invoices on public.invoices for select using (client_id = auth.uid());

-- Function logs
create policy function_logs_read_admin on public.function_logs for select using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Clients
create policy clients_insert_any on public.clients for insert to anon, authenticated with check (
  length(coalesce(phone, '')) >= 7 or length(coalesce(email, '')) >= 5
);
create policy clients_select_auth on public.clients for select using (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

drop trigger if exists trg_orders_create_receipt_on_complete on public.orders;
create trigger trg_orders_create_receipt_on_complete
after update of status on public.orders
for each row execute function public.create_completion_receipt_on_order_complete();

-- Orders RLS
-- Limpiar previas
drop policy if exists public_insert_pending_orders on public.orders;
drop policy if exists client_select_own_orders on public.orders;
drop policy if exists collaborator_select_orders on public.orders;
drop policy if exists collaborator_select_own_orders on public.orders;
drop policy if exists public_read_pending_orders on public.orders;
drop policy if exists collaborator_update_own_orders on public.orders;
drop policy if exists admin_select_orders on public.orders;
drop policy if exists admin_update_orders on public.orders;
drop policy if exists admin_insert_orders on public.orders;
drop policy if exists admin_delete_orders on public.orders;

-- 1. Insert (Public)
create policy orders_insert_public on public.orders for insert with check (
  status = 'pending' and assigned_to is null
  and (client_id is not null or client_contact_id is not null)
);

-- 2. Select (Client + Collaborator + Admin)
create policy orders_select_policy on public.orders for select using (
  (client_id = auth.uid()) -- Client
  or ( -- Collaborator
    exists (select 1 from public.collaborators c where c.id = auth.uid() and c.status = 'activo')
    and (assigned_to = auth.uid() or status = 'pending')
  )
  or (public.is_owner(auth.uid()) or public.is_admin(auth.uid())) -- Admin
);

-- 3. Update (Collaborator)
create policy orders_update_collaborator on public.orders for update using (
  exists (select 1 from public.collaborators c where c.id = auth.uid() and c.status = 'activo')
  and assigned_to = auth.uid()
);

-- 4. All (Admin)
create policy orders_all_admin on public.orders for all using (
  public.is_owner(auth.uid()) or public.is_admin(auth.uid())
);

-- 10) MÉTRICAS
-- Historial de eventos de órdenes (event sourcing ligero)
create table if not exists public.order_events (
  id bigserial primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_events_order_created on public.order_events(order_id, created_at);

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
for each row execute function public.set_updated_at();

create or replace function public.upsert_collaborator_metric_fixed(
  p_collaborator_id uuid,
  p_metric_date date,
  p_accept_inc int,
  p_in_progress_inc int,
  p_complete_inc int,
  p_cancel_inc int,
  p_amount numeric,
  p_rating numeric,
  p_completion_minutes numeric
) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.collaborator_performance(
    collaborator_id, metric_date, accepted_count, in_progress_count,
    completed_count, canceled_count, total_amount, avg_rating, avg_completion_minutes, updated_at
  ) values (
    p_collaborator_id, p_metric_date,
    greatest(p_accept_inc,0),
    greatest(p_in_progress_inc,0),
    greatest(p_complete_inc,0),
    greatest(p_cancel_inc,0),
    coalesce(p_amount,0),
    null,
    null,
    now()
  )
  on conflict (collaborator_id, metric_date)
  do update set
    accepted_count = public.collaborator_performance.accepted_count + greatest(p_accept_inc,0),
    in_progress_count = public.collaborator_performance.in_progress_count + greatest(p_in_progress_inc,0),
    completed_count = public.collaborator_performance.completed_count + greatest(p_complete_inc,0),
    canceled_count = public.collaborator_performance.canceled_count + greatest(p_cancel_inc,0),
    total_amount = public.collaborator_performance.total_amount + coalesce(p_amount,0),
    avg_rating = case
      when p_rating is null then public.collaborator_performance.avg_rating
      else coalesce(((coalesce(public.collaborator_performance.avg_rating,0) * nullif(public.collaborator_performance.completed_count,0)) + p_rating)
                    / nullif(public.collaborator_performance.completed_count + 1,0), p_rating)
    end,
    avg_completion_minutes = case
      when p_completion_minutes is null then public.collaborator_performance.avg_completion_minutes
      else coalesce(((coalesce(public.collaborator_performance.avg_completion_minutes,0) * nullif(public.collaborator_performance.completed_count,0)) + p_completion_minutes)
                    / nullif(public.collaborator_performance.completed_count + 1,0), p_completion_minutes)
    end,
    updated_at = now();
end;$$;

create or replace function public.track_order_metrics()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_collab uuid;
  v_when date := current_date;
  v_amount numeric := null;
  v_rating numeric := null;
  v_minutes numeric := null;
begin
  v_collab := coalesce(new.assigned_to, old.assigned_to);
  if v_collab is null then return new; end if;

  if new.status = 'completed' and new.completed_at is not null then
    v_minutes := extract(epoch from (new.completed_at - coalesce(new.assigned_at, new.created_at))) / 60.0;
    v_rating := coalesce((new.rating->>'stars')::numeric, null);
    v_amount := new.monto_cobrado;
  end if;

  if tg_op = 'INSERT' then
    return new;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      if new.status = 'accepted' then
        perform public.upsert_collaborator_metric_fixed(v_collab, v_when, 1, 0, 0, 0, null, null, null);
      elsif new.status = 'in_progress' then
        perform public.upsert_collaborator_metric_fixed(v_collab, v_when, 0, 1, 0, 0, null, null, null);
      elsif new.status = 'completed' then
        perform public.upsert_collaborator_metric_fixed(v_collab, v_when, 0, 0, 1, 0, v_amount, v_rating, v_minutes);
      elsif new.status = 'cancelled' then
        perform public.upsert_collaborator_metric_fixed(v_collab, v_when, 0, 0, 0, 1, null, null, null);
      end if;
    end if;
    return new;
  end if;
  return new;
end;$$;

drop trigger if exists trg_orders_track_metrics on public.orders;
create trigger trg_orders_track_metrics
after update on public.orders
for each row execute function public.track_order_metrics();

create or replace view public.collaborator_performance_view as
select
  cp.collaborator_id,
  p.full_name as collaborator_name,
  date_trunc('day', cp.metric_date)::date as metric_date,
  cp.accepted_count,
  cp.in_progress_count,
  cp.completed_count,
  cp.canceled_count,
  cp.total_amount,
  cp.avg_rating,
  cp.avg_completion_minutes
from public.collaborator_performance cp
left join public.profiles p on p.id = cp.collaborator_id;

alter table public.collaborator_performance enable row level security;
drop policy if exists perf_self_view on public.collaborator_performance;
create policy perf_self_view on public.collaborator_performance
for select using (auth.uid() = collaborator_id or public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- 11) SEEDS (Vehicles, Services)
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

-- 12) NOTIFICACIONES Y OUTBOX (Refactorizado)

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  target_type text not null check (target_type in ('user','contact')),
  target_id uuid,
  payload jsonb not null,
  status public.notification_status not null default 'pending',
  attempts int not null default 0,
  last_error text,
  created_at timestamptz default now(),
  processed_at timestamptz,
  processing_started_at timestamptz,
  constraint chk_target_integrity check (
    (target_type = 'user' and target_id is not null)
    or
    (target_type = 'contact' and target_id is not null)
  )
);
create index if not exists idx_notification_events_status on public.notification_events(status);
create index if not exists idx_notification_events_target on public.notification_events(target_id);
create index if not exists idx_notification_events_created_at on public.notification_events(created_at);
create index if not exists idx_notification_events_status_created on public.notification_events(status, created_at);
create index if not exists idx_notification_events_processing_started_at on public.notification_events(processing_started_at);
create index if not exists idx_notification_events_retry
on public.notification_events(status, processing_started_at);

-- Dashboard View for Monitoring (moved here after notification_events)
create or replace view public.v_notification_stats as
select
  count(*) filter (where status = 'pending') as pending,
  count(*) filter (where status = 'processing') as processing,
  count(*) filter (where status = 'retry') as retry,
  count(*) filter (where status = 'failed') as failed,
  count(*) filter (where status = 'sent' and processed_at > now() - interval '24 hours') as sent_24h,
  avg(attempts) filter (where status = 'sent') as avg_attempts,
  max(processed_at) as last_processed_at
from public.notification_events;

CREATE OR REPLACE FUNCTION public.notify_admins(
  p_title text,
  p_body text,
  p_data jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r RECORD;
BEGIN
  IF NOT (pg_trigger_depth() > 0 OR public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  FOR r IN
    SELECT id FROM public.collaborators
    WHERE role IN ('admin', 'administrador') AND status = 'activo'
  LOOP
    PERFORM public.dispatch_notification(r.id, NULL, p_title, p_body, p_data);
  END LOOP;

  -- Also notify business owners
  FOR r IN
    SELECT owner_user_id as id FROM public.business WHERE owner_user_id IS NOT NULL
  LOOP
    PERFORM public.dispatch_notification(r.id, NULL, p_title, p_body, p_data);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_push_self_test()
RETURNS jsonb AS $$
DECLARE
  _run_id text := md5(random()::text || clock_timestamp()::text);
  _n_total integer := 0;
  _e_total integer := 0;
  _e_sent integer := 0;
  _e_failed integer := 0;
BEGIN
  PERFORM public.notify_admins('🔧 Self Test', 'Prueba de entrega push', jsonb_build_object('runId', _run_id));

  SELECT count(*) INTO _n_total FROM public.notifications WHERE data->>'runId' = _run_id;

  SELECT count(*) INTO _e_total
  FROM public.notification_events
  WHERE payload->'data'->>'runId' = _run_id;

  SELECT count(*) INTO _e_sent
  FROM public.notification_events
  WHERE payload->'data'->>'runId' = _run_id AND status = 'sent';

  SELECT count(*) INTO _e_failed
  FROM public.notification_events
  WHERE payload->'data'->>'runId' = _run_id AND status = 'failed';

  RETURN jsonb_build_object(
    'runId', _run_id,
    'notifications', _n_total,
    'events', _e_total,
    'queued_or_sent', _e_sent,
    'failed', _e_failed
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
create index if not exists idx_notification_events_status_attempts on public.notification_events(status, attempts);

create table if not exists public.push_delivery_attempts (
  id bigserial primary key,
  event_id uuid not null references public.notification_events(id) on delete cascade,
  endpoint text not null,
  status_code int,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_attempts_event on public.push_delivery_attempts(event_id);

CREATE OR REPLACE FUNCTION public.claim_notification_events(p_limit int)
RETURNS setof public.notification_events
LANGUAGE sql
SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  UPDATE public.notification_events
  SET
    status = 'processing',
    processing_started_at = now(),
    attempts = attempts + 1
  WHERE id IN (
    SELECT id
    FROM public.notification_events
    WHERE status IN ('pending', 'retry')
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_notification(
  p_user_id uuid,
  p_contact_id uuid,
  p_title text,
  p_body text,
  p_data jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT (pg_trigger_depth() > 0 OR public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' OR p_body IS NULL OR btrim(p_body) = '' THEN
    RETURN;
  END IF;

  IF p_user_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = p_user_id
        AND n.title = p_title
        AND n.body = p_body
        AND (n.data->>'orderId') = (p_data->>'orderId')
    ) THEN
      RETURN;
    END IF;
    INSERT INTO public.notifications(user_id, contact_id, title, body, data)
    VALUES (p_user_id, p_contact_id, p_title, p_body, p_data);
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.contact_id = p_contact_id
        AND n.title = p_title
        AND n.body = p_body
        AND (n.data->>'orderId') = (p_data->>'orderId')
    ) THEN
      RETURN;
    END IF;
    INSERT INTO public.notifications(user_id, contact_id, title, body, data)
    VALUES (p_user_id, p_contact_id, p_title, p_body, p_data);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_create_notification()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.notification_events(type, target_type, target_id, payload)
  VALUES (
    'push',
    CASE WHEN NEW.user_id IS NOT NULL THEN 'user' ELSE 'contact' END,
    COALESCE(NEW.user_id, NEW.contact_id),
    jsonb_build_object(
      'title', NEW.title,
      'body', NEW.body,
      'data', NEW.data,
      'user_id', NEW.user_id,
      'contact_id', NEW.contact_id,
      'notification_id', NEW.id
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_create_notification_event ON public.notifications;
CREATE TRIGGER trg_create_notification_event
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.trg_create_notification();

-- HELPER: Enqueue generic order notification (Avoid code duplication)
CREATE OR REPLACE FUNCTION public.enqueue_order_notification(
  p_order_id bigint,
  p_short_id text,
  p_client_id uuid,
  p_client_contact_id uuid,
  p_title text,
  p_client_body text,
  p_admin_body text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT (pg_trigger_depth() > 0 OR public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Client
  IF p_client_id IS NOT NULL THEN
    PERFORM public.dispatch_notification(
      p_client_id, NULL, p_title, p_client_body, jsonb_build_object('orderId', p_order_id)
    );
  ELSIF p_client_contact_id IS NOT NULL THEN
    PERFORM public.dispatch_notification(
      NULL, p_client_contact_id, p_title, p_client_body, jsonb_build_object('orderId', p_order_id)
    );
  END IF;

  -- Admin
  PERFORM public.notify_admins(
    p_title,
    p_admin_body,
    jsonb_build_object('orderId', p_order_id)
  );
END;
$$;

-- ORDER INSERT TRIGGER (Consolidated)
CREATE OR REPLACE FUNCTION public.orders_after_insert_notify()
RETURNS trigger AS $$
BEGIN
  PERFORM public.enqueue_order_notification(
    NEW.id,
    NEW.short_id,
    NEW.client_id,
    NEW.client_contact_id,
    '✅ Solicitud Recibida',
    'Hemos recibido tu solicitud #' || NEW.short_id,
    'Se creó la orden #' || NEW.short_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_orders_notify_creation ON public.orders;
CREATE TRIGGER trg_orders_after_insert_notify
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_after_insert_notify();

-- ORDER UPDATE TRIGGER (Consolidated)
CREATE OR REPLACE FUNCTION public.orders_after_update_notify()
RETURNS trigger AS $$
BEGIN
  -- 1. Assignment
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL THEN
    PERFORM public.dispatch_notification(
      NEW.assigned_to,
      NULL,
      '🛠️ Orden asignada',
      'Se te asignó la orden #' || COALESCE(NEW.short_id::text, NEW.id::text),
      jsonb_build_object('orderId', NEW.id)
    );
  END IF;

  -- 2. Status Change
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.enqueue_order_notification(
      NEW.id, NEW.short_id, NEW.client_id, NEW.client_contact_id,
      'Estado actualizado',
      'Tu orden #' || COALESCE(NEW.short_id::text, NEW.id::text) || ' ahora está: ' || NEW.status,
      'La orden #' || COALESCE(NEW.short_id::text, NEW.id::text) || ' → ' || NEW.status
    );
  END IF;

  -- 3. Price Update
  IF NEW.estimated_price IS DISTINCT FROM OLD.estimated_price THEN
    PERFORM public.enqueue_order_notification(
      NEW.id, NEW.short_id, NEW.client_id, NEW.client_contact_id,
      'Precio estimado actualizado',
      'El precio estimado de tu orden fue actualizado.',
      'La orden #' || COALESCE(NEW.short_id::text, NEW.id::text) || ' actualizó su precio estimado.'
    );
  END IF;

  -- 4. Amount Update
  IF NEW.monto_cobrado IS DISTINCT FROM OLD.monto_cobrado THEN
    PERFORM public.enqueue_order_notification(
      NEW.id, NEW.short_id, NEW.client_id, NEW.client_contact_id,
      'Monto actualizado',
      'El monto cobrado de tu orden fue actualizado.',
      'La orden #' || COALESCE(NEW.short_id::text, NEW.id::text) || ' actualizó su monto cobrado.'
    );
  END IF;

  -- 5. Evidence Upload
  IF NEW.evidence_photos IS DISTINCT FROM OLD.evidence_photos AND NEW.evidence_photos IS NOT NULL THEN
    PERFORM public.enqueue_order_notification(
      NEW.id, NEW.short_id, NEW.client_id, NEW.client_contact_id,
      'Nueva evidencia subida',
      'Se ha subido evidencia a tu orden.',
      'La orden #' || COALESCE(NEW.short_id::text, NEW.id::text) || ' tiene nueva evidencia.'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_orders_after_update_notify ON public.orders;
CREATE TRIGGER trg_orders_after_update_notify
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_after_update_notify();

-- CLEANUP OLD TRIGGERS/FUNCTIONS
DROP TRIGGER IF EXISTS trg_notify_price_update ON public.orders;
DROP TRIGGER IF EXISTS trg_notify_amount_update ON public.orders;
DROP TRIGGER IF EXISTS trg_notify_evidence_upload ON public.orders;
DROP TRIGGER IF EXISTS trg_notify_alert_update ON public.orders;
DROP TRIGGER IF EXISTS trg_orders_notify_status ON public.orders;
DROP TRIGGER IF EXISTS trg_notify_assigned_collaborator ON public.orders;

-- Helper to get details (Updated for ENUM if needed, though JSON output handles it)
CREATE OR REPLACE FUNCTION public.get_order_details_public(identifier text)
RETURNS jsonb AS $$
DECLARE
  o RECORD;
  res jsonb;
BEGIN
  o := NULL;
  -- Same logic as before, status is now ENUM but will cast to text in JSON automatically or explicit
  IF identifier ~ '^[0-9]+$' THEN
    SELECT o2.*, s.name AS service_name, v.name AS vehicle_name INTO o
    FROM public.orders o2
    LEFT JOIN public.services s ON s.id = o2.service_id
    LEFT JOIN public.vehicles v ON v.id = o2.vehicle_id
    WHERE o2.id = identifier::bigint
    LIMIT 1;
  ELSE
    -- ... (shortened for brevity, assuming similar logic)
    SELECT o2.*, s.name AS service_name, v.name AS vehicle_name INTO o
    FROM public.orders o2
    LEFT JOIN public.services s ON s.id = o2.service_id
    LEFT JOIN public.vehicles v ON v.id = o2.vehicle_id
    WHERE o2.short_id = identifier
    LIMIT 1;
  END IF;

  IF o IS NULL THEN RETURN NULL; END IF;

  res := jsonb_build_object(
    'id', o.id,
    'short_id', o.short_id,
    'created_at', o.created_at,
    'status', o.status,
    'name', o.name,
    'tracking_data', o.tracking_data,
    'evidence_photos', o.evidence_photos,
    'service', jsonb_build_object('name', o.service_name),
    'vehicle', jsonb_build_object('name', o.vehicle_name),
    'pickup', o.pickup,
    'delivery', o.delivery,
    'estimated_price', o.estimated_price,
    'origin_coords', o.origin_coords,
    'destination_coords', o.destination_coords
  );
  RETURN res;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
GRANT EXECUTE ON FUNCTION public.get_order_details_public(text) TO anon, authenticated;

-- Indices dedup
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_idx
ON public.notifications (user_id, title, body, ((data->>'orderId')))
WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_contact_idx
ON public.notifications (contact_id, title, body, ((data->>'orderId')))
WHERE contact_id IS NOT NULL;

-- Configs
DO $$ BEGIN
  PERFORM set_config('app.settings.send_push_url','https://fkprllkxyjtosjhtikxy.functions.supabase.co/process-outbox', true);
EXCEPTION WHEN OTHERS THEN PERFORM 1; END $$;

-- 13) PROCESAMIENTO OUTBOX EN PRODUCCIÓN (pg_net + pg_cron)
-- Reencolar eventos atascados en 'processing' por más de N minutos
create or replace function public.reset_stuck_notification_events(p_minutes int default 10)
returns int language sql security definer set search_path = pg_catalog, public as $$
  with upd as (
    update public.notification_events
    set status = 'retry', processing_started_at = null,
        last_error = coalesce(last_error,'') || ' | reset_stuck',
        attempts = attempts + 1
    where status = 'processing' and processing_started_at < now() - make_interval(mins => p_minutes)
    returning 1
  )
  select count(*) from upd;
$$;

-- Pasar failed->retry respetando backoff y límite de intentos
create or replace function public.plan_failed_retries(p_max_attempts int default 5, p_backoff_minutes int default 5)
returns int language sql security definer set search_path = pg_catalog, public as $$
  with upd as (
    update public.notification_events
    set status = 'retry', last_error = null
    where status = 'failed' and attempts < p_max_attempts
      and coalesce(processed_at, created_at) < now() - make_interval(mins => p_backoff_minutes)
    returning 1
  )
  select count(*) from upd;
$$;

-- Tick que invoca la función de procesamiento HTTP (edge function) y aplica housekeeping
create or replace function public.process_outbox_tick(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  _url text;
  _status int;
  _body text;
begin
  _url := current_setting('app.settings.send_push_url', true);
  if coalesce(btrim(_url),'') = '' then
    return jsonb_build_object('ok', false, 'error','send_push_url not configured');
  end if;

  -- Housekeeping previo
  perform public.reset_stuck_notification_events(5);
  perform public.plan_failed_retries(5, 5);

  -- Llamada HTTP a la función de proceso
  select status, body into _status, _body
  from net.http_post(
    url := _url,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('limit', p_limit)::text
  );

  return jsonb_build_object('ok', (_status between 200 and 299), 'status', _status, 'body', _body);
exception when others then
  insert into public.function_logs(fn_name, level, message, payload)
  values ('process_outbox_tick','error', SQLERRM, jsonb_build_object('hint','net.http_post failed'));
  return jsonb_build_object('ok', false, 'error', SQLERRM);
end;
$$;

-- Programación automática cada minuto (pg_cron)
DO $$ BEGIN
  begin
    perform cron.unschedule('process_outbox_every_minute');
  exception when others then null; end;

  begin
    perform cron.schedule('process_outbox_every_minute', '*/1 * * * *', 'select public.process_outbox_tick(100);');
  exception when others then
    -- Fallback sin nombre
    begin
      perform cron.schedule('*/1 * * * *', 'select public.process_outbox_tick(100);');
    exception when others then
      perform 1;
    end;
  end;
END $$;

-- Actualizar clave VAPID pública en la tabla de configuración de negocio
-- Clave generada para corregir el error: VAPID pública no configurada

insert into public.business (id, business_name, vapid_public_key, push_vapid_key)
values (
  1, 
  'Logística López Ortiz', 
  'BCgYgK3ZJwHjR529P7BaTE27ImKc6Cl-BzJSr8h2KrnUeQXth7G2iuAqfS-8BUQ9qAQ8oAMjb76cAXzA3R0MUn8',
  'BCgYgK3ZJwHjR529P7BaTE27ImKc6Cl-BzJSr8h2KrnUeQXth7G2iuAqfS-8BUQ9qAQ8oAMjb76cAXzA3R0MUn8'
)
on conflict (id) do update
set 
  vapid_public_key = excluded.vapid_public_key,
  push_vapid_key = excluded.push_vapid_key;

-- NOTA: Para que las notificaciones funcionen realmente, debes configurar la clave PRIVADA en las Edge Functions:
-- VAPID_PRIVATE_KEY=AFSWGqy7fZcFF3f63qgdKGBv474ISmREJOBS6T1UTSk
-- PUBLIC_VAPID_KEY=BCgYgK3ZJwHjR529P7BaTE27ImKc6Cl-BzJSr8h2KrnUeQXth7G2iuAqfS-8BUQ9qAQ8oAMjb76cAXzA3R0MUn8

-- Function to accept order with optional price update
create or replace function public.accept_order_with_price(
  p_order_id bigint,
  p_price numeric default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  _now timestamptz := now();
begin
  -- Check if collaborator is active
  if not exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(coalesce(c.status,'inactive')) = 'activo'
  ) then
    raise exception 'No autorizado: colaborador inactivo' using errcode = '42501';
  end if;

  -- Prevent accepting when collaborator already has an active order
  if exists (
    select 1 from public.orders o
    where o.assigned_to = auth.uid()
      and o.status in ('accepted','in_progress')
  ) then
    raise exception 'Ya tienes una orden activa' using errcode = 'P0001';
  end if;

  -- Update order
  update public.orders
  set
    status = 'accepted',
    accepted_at = coalesce(accepted_at, _now),
    accepted_by = coalesce(accepted_by, auth.uid()),
    assigned_to = coalesce(assigned_to, auth.uid()),
    assigned_at = coalesce(assigned_at, _now),
    estimated_price = coalesce(p_price, estimated_price), -- Update price if provided
    tracking_data = coalesce(tracking_data, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'status', 'accepted',
        'date', _now,
        'description', case when p_price is not null then 'Orden aceptada con tarifa ajustada: ' || p_price else 'Orden aceptada' end
      )
    )
  where id = p_order_id
    and status = 'pending'
    and assigned_to is null;

  if not found then
    raise exception 'No se pudo aceptar la orden. Puede que ya no esté disponible.' using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.accept_order_with_price(bigint, numeric) to authenticated;
create table if not exists public.collaborator_active_jobs (
  collaborator_id uuid not null references public.profiles(id) on delete cascade,
  order_id bigint not null references public.orders(id) on delete cascade,
  started_at timestamptz not null default now(),
  primary key (collaborator_id),
  unique(order_id)
);
create index if not exists idx_active_jobs_collab on public.collaborator_active_jobs(collaborator_id);
create index if not exists idx_active_jobs_order on public.collaborator_active_jobs(order_id);
alter table public.collaborator_active_jobs enable row level security;
create policy active_jobs_select on public.collaborator_active_jobs for select using (
  collaborator_id = auth.uid() or public.is_owner(auth.uid()) or public.is_admin(auth.uid())
);
create policy active_jobs_insert on public.collaborator_active_jobs for insert with check (
  collaborator_id = auth.uid() or public.is_owner(auth.uid()) or public.is_admin(auth.uid())
);
create policy active_jobs_delete on public.collaborator_active_jobs for delete using (
  collaborator_id = auth.uid() or public.is_owner(auth.uid()) or public.is_admin(auth.uid())
);
create or replace function public.cleanup_active_job_on_status()
returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.status in ('completed','cancelled') then
    delete from public.collaborator_active_jobs where order_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cleanup_active_job on public.orders;
create trigger trg_cleanup_active_job
after update of status on public.orders
for each row execute function public.cleanup_active_job_on_status();
-- Active Jobs model
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.collaborator_active_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  order_id bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_active_job_per_collaborator UNIQUE (collaborator_id),
  CONSTRAINT unique_active_job_per_order UNIQUE (order_id)
);

ALTER TABLE public.collaborator_active_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY collaborator_active_jobs_select_own
ON public.collaborator_active_jobs
FOR SELECT
USING (collaborator_id = auth.uid());

CREATE POLICY collaborator_active_jobs_manage_own
ON public.collaborator_active_jobs
FOR ALL
USING (collaborator_id = auth.uid())
WITH CHECK (collaborator_id = auth.uid());

DROP FUNCTION IF EXISTS public.accept_order_by_id(bigint);

CREATE OR REPLACE FUNCTION public.accept_order_by_id(p_order_id bigint)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_order public.orders;
BEGIN
  UPDATE public.orders
  SET status = 'accepted', assigned_to = COALESCE(assigned_to, auth.uid()), assigned_at = COALESCE(assigned_at, now())
  WHERE id = p_order_id AND status = 'pending'
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not available';
  END IF;

  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_order_work(p_order_id bigint)
RETURNS public.collaborator_active_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_job public.collaborator_active_jobs%ROWTYPE;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.collaborator_active_jobs WHERE collaborator_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Ya tienes un trabajo activo';
  END IF;

  UPDATE public.orders
  SET status = 'in_progress'
  WHERE id = p_order_id AND status = 'accepted'
  RETURNING id INTO v_job.order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no válida';
  END IF;

  INSERT INTO public.collaborator_active_jobs(collaborator_id, order_id)
  VALUES (auth.uid(), p_order_id)
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_order_work(p_order_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.orders
  SET status = 'completed'
  WHERE id = p_order_id AND status = 'in_progress';

  DELETE FROM public.collaborator_active_jobs
  WHERE order_id = p_order_id AND collaborator_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_active_job()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('cancelled','completed') THEN
    DELETE FROM public.collaborator_active_jobs WHERE order_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_cleanup_active_job ON public.orders;
CREATE TRIGGER trg_cleanup_active_job
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.cleanup_active_job();
