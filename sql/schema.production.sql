-- =============================================================
--        ESQUEMA FINAL TLC - PRODUCCIÓN (Supabase Ready)
--        Consolidado, idempotente y alineado al frontend
--        Optimizado: 2025-01-27
-- =============================================================

-- 0) CONFIGURACIÓN INICIAL (Obligatorio ejecutar una vez)
-- Reemplaza 'TU_SERVICE_ROLE_KEY_REAL' por tu key real de Supabase (Project Settings -> API)
-- alter system set app.settings.service_role_key = 'TU_SERVICE_ROLE_KEY_REAL';
-- select pg_reload_conf();

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
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE public.invoice_status AS ENUM (
      'generada', 'enviada', 'pagada', 'anulada'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_status') THEN
    CREATE TYPE public.notification_status AS ENUM (
      'pending', 'processing', 'sent', 'failed'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel') THEN
    CREATE TYPE public.notification_channel AS ENUM (
      'push', 'email', 'sms'
    );
  END IF;
END $$;

-- 2) FUNCIONES UTILITARIAS GENERALES
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

-- 3) TABLAS BASE (CATÁLOGOS Y USUARIOS)

-- Vehicles
create table if not exists public.vehicles (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  name text not null unique,
  description text,
  image_url text,
  is_active boolean not null default true
);

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
  commission_percent numeric default 0.10,
  can_take_orders boolean default false,
  puede_ver_todas_las_ordenes boolean default false,
  availability text default 'available',
  updated_at timestamptz not null default now()
);
create index if not exists idx_collaborators_status on public.collaborators(status);
create index if not exists idx_collaborators_role on public.collaborators(role);
create index if not exists idx_collaborators_email on public.collaborators(email);
create index if not exists idx_collaborators_can_take on public.collaborators(can_take_orders);
create index if not exists idx_collaborators_availability on public.collaborators(availability);

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

-- Clients (Anonymous/Guest)
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text,
  email text,
  rnc text,
  empresa text,
  created_at timestamptz not null default now()
);

-- Business Config
drop table if exists public.business cascade;
create table public.business (
  id bigint primary key default 1,
  business_name text,
  address text,
  phone text,
  email text,
  rnc text,
  quotation_rates jsonb,
  owner_user_id uuid references public.profiles(id) on delete set null,
  vapid_public_key text,
  push_vapid_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_rnc_check check (rnc ~ '^\d{3}-\d{5}-\d{1}$' or rnc is null)
);
create index if not exists idx_business_owner on public.business(owner_user_id);

insert into public.business (id, business_name) values (1, 'Mi Negocio')
on conflict (id) do nothing;

drop trigger if exists trg_business_touch_updated on public.business;
create trigger trg_business_touch_updated
before update on public.business
for each row execute function public.set_updated_at();

-- System Secrets
create table if not exists public.system_secrets (
  key text primary key,
  value text not null
);
insert into public.system_secrets (key, value) values ('SERVICE_ROLE_KEY', 'PLACEHOLDER_KEY_PLEASE_UPDATE') on conflict (key) do nothing;

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
      and lower(status) in ('activo','active')
  );
$$;

-- 4) ÓRDENES
create or replace function public.generate_order_short_id()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
begin
  for i in 1..4 loop
    result := result || substr(chars, floor(random()*length(chars)+1)::int, 1);
  end loop;
  return 'ORD-' || result;
end;
$$;

create table if not exists public.orders (
  id bigserial primary key,
  short_id text unique default public.generate_order_short_id(),
  created_at timestamptz not null default now(),
  client_id uuid references public.profiles(id) on delete set null,
  client_contact_id uuid references public.clients(id) on delete set null,
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
  assigned_at timestamptz,
  accepted_by uuid,
  accepted_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  evidence_photos jsonb,
  rating jsonb,
  estimated_price numeric,
  monto_cobrado numeric,
  metodo_pago text,
  tracking_data jsonb,
  tracking_url text,
  updated_at timestamptz not null default now(),
  customer_comment text
);

-- Índices Orders
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_date on public.orders("date");
create index if not exists idx_orders_short_id on public.orders(short_id);
create index if not exists idx_orders_short_id_upper on public.orders(upper(short_id));
create index if not exists idx_orders_assigned_to on public.orders(assigned_to);
create index if not exists idx_orders_client_id on public.orders(client_id);
create index if not exists idx_orders_created_at on public.orders(created_at);
create index if not exists idx_orders_completed_at on public.orders(completed_at);
create index if not exists idx_orders_status_assigned_to on public.orders(status, assigned_to);
create index if not exists idx_orders_status_created_at on public.orders(status, created_at);

-- Order Helpers
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

drop trigger if exists trg_orders_touch_updated on public.orders;
create trigger trg_orders_touch_updated
before update on public.orders
for each row execute function public.set_updated_at();

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

-- Normalización de Estado
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
end;
$$;

-- 5) NOTIFICACIONES Y PLANTILLAS

-- Notifications (In-App)
create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  contact_id uuid references public.clients(id) on delete cascade,
  title text,
  body text,
  data jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  delivered_at timestamptz,
  delivered boolean default false
);
create index if not exists idx_notifications_user on public.notifications(user_id);
create index if not exists idx_notifications_contact on public.notifications(contact_id);
create index if not exists idx_notifications_unread on public.notifications((read_at is null)) where read_at is null;

-- Push Subscriptions
create table if not exists public.push_subscriptions (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  client_contact_id uuid references public.clients(id) on delete cascade,
  endpoint text not null,
  keys jsonb not null,
  created_at timestamptz not null default now(),
  constraint chk_push_owner check (user_id is not null or client_contact_id is not null)
);

-- 🔧 FIX: Reemplazar índices parciales por constraints explícitos para soportar ON CONFLICT ON CONSTRAINT
drop index if exists uniq_push_subscriptions_user_endpoint;
drop index if exists uniq_push_subscriptions_contact_endpoint;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'push_user_endpoint_unique') then
    alter table public.push_subscriptions add constraint push_user_endpoint_unique unique (user_id, endpoint);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'push_contact_endpoint_unique') then
    alter table public.push_subscriptions add constraint push_contact_endpoint_unique unique (client_contact_id, endpoint);
  end if;
end $$;

-- Notification Templates
create table if not exists public.notification_templates (
  id bigserial primary key,
  event_type text not null,
  role text not null, -- client | collaborator | admin
  status text, -- Estado de la orden que dispara la notificación
  locale text not null default 'es',
  title text not null,
  body text not null,
  is_active boolean not null default true,
  status_key text generated always as (coalesce(status, '')) stored
);
create unique index if not exists idx_notification_templates_unique
  on public.notification_templates(event_type, role, status_key, locale);

-- Notification Outbox (Partitioned by Month for Performance)
create table if not exists public.notification_outbox (
  id bigserial,
  event_id bigint,
  event_type text not null,
  recipient_type text not null, -- client | collaborator | admin
  recipient_id uuid,
  recipient_contact_id uuid,
  template_id bigint references public.notification_templates(id) on delete set null,
  payload jsonb,
  dedup_key text not null,
  status public.notification_status not null default 'pending',
  attempts int not null default 0,
  max_attempts int not null default 5,
  last_error text,
  processed_at timestamptz,
  next_retry_at timestamptz,
  channel public.notification_channel default 'push',
  hold_until timestamptz,
  created_at timestamptz not null default now(),
  constraint chk_recipient check (recipient_id is not null or recipient_contact_id is not null),
  primary key (id, created_at)
) partition by range (created_at);

-- Partitions (2025-2026 Example)
create table if not exists public.notification_outbox_y2025m01 partition of public.notification_outbox for values from ('2025-01-01') to ('2025-02-01');
create table if not exists public.notification_outbox_y2025m02 partition of public.notification_outbox for values from ('2025-02-01') to ('2025-03-01');
create table if not exists public.notification_outbox_y2025m12 partition of public.notification_outbox for values from ('2025-12-01') to ('2026-01-01');
create table if not exists public.notification_outbox_y2026m01 partition of public.notification_outbox for values from ('2026-01-01') to ('2026-02-01');
create table if not exists public.notification_outbox_default partition of public.notification_outbox default;

-- Indices
create unique index if not exists uniq_notification_dedup on public.notification_outbox(dedup_key, created_at);
create index if not exists idx_notification_outbox_status on public.notification_outbox(status);
create index if not exists idx_outbox_retry on public.notification_outbox(next_retry_at);
-- Índice compuesto para el Worker Fetch
create index if not exists idx_outbox_worker_fetch 
on public.notification_outbox(status, next_retry_at, hold_until, created_at);

-- DLQ & Delivery Logs
create table if not exists public.notification_dlq (
  id bigint primary key generated by default as identity,
  outbox_id bigint,
  event_id bigint,
  event_type text,
  recipient_type text,
  recipient_id uuid,
  recipient_contact_id uuid,
  channel text,
  payload jsonb,
  error_log text,
  final_attempts int,
  moved_at timestamptz default now()
);

create table if not exists public.notification_delivery (
  id bigserial primary key,
  outbox_id bigint,
  channel text,
  success boolean,
  response text,
  created_at timestamptz default now()
);

alter table public.notification_dlq enable row level security;
alter table public.notification_delivery enable row level security;

-- 6) LOGGING & EVENTS

create table if not exists public.order_events (
  id bigserial primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  event_type text not null,
  payload jsonb,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_events_order on public.order_events(order_id);

create table if not exists public.function_logs (
  id bigserial primary key,
  fn_name text not null,
  level text not null check (level in ('debug','info','warn','error')),
  message text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.system_logs (
  id bigserial primary key,
  source text,
  message text,
  payload jsonb,
  created_at timestamptz default now()
);

-- 7) TABLAS DE NEGOCIO ADICIONALES

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

create table if not exists public.collaborator_performance (
  id bigserial primary key,
  collaborator_id uuid not null references public.profiles(id) on delete cascade,
  metric_date date not null default (current_date),
  accepted_count int not null default 0,
  in_progress_count int not null default 0,
  completed_count int not null default 0,
  canceled_count int not null default 0,
  avg_completion_minutes numeric,
  sum_completion_minutes numeric default 0,
  sum_rating numeric default 0,
  count_ratings int default 0,
  total_amount numeric not null default 0,
  avg_rating numeric,
  updated_at timestamptz not null default now(),
  unique(collaborator_id, metric_date)
);

create table if not exists public.collaborator_active_jobs (
  collaborator_id uuid not null references public.profiles(id) on delete cascade,
  order_id bigint not null references public.orders(id) on delete cascade,
  started_at timestamptz not null default now(),
  primary key (collaborator_id),
  unique(order_id)
);

create table if not exists public.collaborator_locations (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid references public.collaborators(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  speed double precision,
  heading double precision,
  updated_at timestamptz default now(),
  constraint unique_collaborator_location unique (collaborator_id)
);

create table if not exists public.testimonials (
  id bigint generated by default as identity primary key,
  created_at timestamptz default now(),
  client_name text not null,
  comment text not null,
  stars int default 5,
  is_public boolean default true,
  display_order int default 0,
  avatar_url text
);

-- 8) FUNCIONES DE NEGOCIO

-- Sync Push from Collaborator
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
  on conflict (user_id, endpoint) where user_id is not null do update set keys = excluded.keys;
  return new;
end;
$$ language plpgsql set search_path = pg_catalog, public;

drop trigger if exists trg_collaborators_sync_push_subscription on public.collaborators;
create trigger trg_collaborators_sync_push_subscription
after update of push_subscription on public.collaborators
for each row execute function public.sync_collaborator_push_subscription();

-- Create Order (Safe)
create or replace function public.create_order_with_contact(order_payload jsonb)
returns public.orders
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_client_id uuid := auth.uid();
  v_contact_id uuid;
  v_order public.orders;
  v_status public.order_status;
begin
  v_status := public.normalize_order_status(order_payload->>'status');

  if v_client_id is null then -- Usuario anónimo
    -- Insertar o recuperar cliente existente
    insert into public.clients(name, phone, email)
    values (
      nullif(order_payload->>'name',''),
      nullif(order_payload->>'phone',''),
      nullif(order_payload->>'email','')
    ) 
    -- Si ya existe un cliente con ese ID (gen_random_uuid no debería chocar, pero por robustez)
    -- O si tienes un unique constraint en (phone) o (email), esto lo manejaría
    -- Pero public.clients actualmente solo tiene PK en ID.
    -- Si quieres evitar duplicados por email/phone, necesitarías unique constraints.
    -- Asumiendo que quieres crear uno nuevo cada vez o manejar error, lo dejamos así.
    -- EL ERROR 409 suele ser unique_violation.
    -- Verificamos si push_subscriptions tiene conflicto.
    returning id into v_contact_id;

    if order_payload->'push_subscription' is not null and order_payload->'push_subscription'->>'endpoint' is not null then
      -- Intentar insertar o actualizar, manejando posibles conflictos de unique key
      insert into public.push_subscriptions(client_contact_id, endpoint, keys)
      values (v_contact_id, order_payload->'push_subscription'->>'endpoint', order_payload->'push_subscription'->'keys')
      on conflict on constraint push_contact_endpoint_unique do update set keys = excluded.keys;
    end if;

  -- Loop de reintento para short_id
  for i in 1..3 loop
    begin
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
      
      -- Si llegamos aquí, insert exitoso
      exit;
    exception when unique_violation then
      -- Si es error de short_id (constraint unique), reintentar.
      -- Si es otro constraint, fallará igual en el siguiente intento o lanzará error.
      if i = 3 then raise; end if;
    end;
  end loop;
  else
    if order_payload->'push_subscription' is not null and order_payload->'push_subscription'->>'endpoint' is not null then
      -- Intentar insertar o actualizar, manejando posibles conflictos de unique key
      insert into public.push_subscriptions(user_id, endpoint, keys)
      values (v_client_id, order_payload->'push_subscription'->>'endpoint', order_payload->'push_subscription'->'keys')
      on conflict on constraint push_user_endpoint_unique do update set keys = excluded.keys;
    end if;

  -- Loop de reintento para short_id
  for i in 1..3 loop
    begin
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
      
      exit;
    exception when unique_violation then
      if i = 3 then raise; end if;
    end;
  end loop;
  end if;
  return v_order;
end;
$$;

-- Transition Validator
create or replace function public.validate_transition(old_s public.order_status, new_s public.order_status)
returns boolean language sql as $$
select
  (old_s = 'pending' and new_s = 'accepted') or
  (old_s = 'accepted' and new_s = 'in_progress') or
  (old_s = 'in_progress' and new_s in ('completed','cancelled')) or
  (old_s = 'pending' and new_s = 'cancelled') or 
  (old_s = 'accepted' and new_s = 'cancelled');
$$;

-- Update Order Status (Core Logic)
create or replace function public.update_order_status(
  p_order_id bigint,
  p_new_status text,
  p_collaborator_id uuid default null,
  p_tracking_entry jsonb default null
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public as $$
declare 
  v_updated jsonb;
  v_normalized public.order_status;
  v_current_status public.order_status;
  v_uid uuid;
  v_target_collab uuid;
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  v_uid := auth.uid();
  v_normalized := public.normalize_order_status(p_new_status);

  -- Determinar colaborador objetivo (explícito > en json > usuario actual)
  v_target_collab := p_collaborator_id;
  if v_target_collab is null and p_tracking_entry ? 'assigned_to' then
     begin
       v_target_collab := (p_tracking_entry->>'assigned_to')::uuid;
     exception when others then
       v_target_collab := null;
     end;
  end if;

  select status into v_current_status from public.orders where id = p_order_id;
  
  -- Validaciones (Admin puede saltarse algunas, Colaborador no)
  if not (public.is_admin(v_uid) or public.is_owner(v_uid)) then
    if not public.validate_transition(v_current_status, v_normalized) then
      raise exception 'Transición de estado inválida: % -> %', v_current_status, v_normalized;
    end if;
    -- Colaborador solo puede asignarse a sí mismo
    if v_target_collab is not null and v_target_collab <> v_uid then
       raise exception 'No puedes asignar a otros';
    end if;
  end if;

  update public.orders o
  set
    status = v_normalized,
    assigned_to = CASE 
      WHEN v_normalized = 'pending' THEN NULL 
      WHEN v_target_collab IS NOT NULL THEN v_target_collab
      ELSE COALESCE(o.assigned_to, v_uid) 
    END,
    assigned_at = CASE WHEN v_normalized = 'accepted' AND o.assigned_at IS NULL THEN now() ELSE assigned_at END,
    completed_by = CASE WHEN v_normalized = 'completed' THEN v_uid ELSE completed_by END,
    completed_at = CASE WHEN v_normalized = 'completed' THEN now() ELSE completed_at END,
    tracking_data = CASE WHEN p_tracking_entry IS NOT NULL THEN COALESCE(o.tracking_data,'[]'::jsonb) || jsonb_build_array(p_tracking_entry) ELSE o.tracking_data END
    updated_at = now()
  where o.id = p_order_id
  returning to_jsonb(o) into v_updated;

  if v_normalized in ('accepted','in_progress') then
    -- Verificar si el colaborador objetivo ya tiene trabajo (si se está asignando)
    -- Nota: Si es admin asignando, quizás queramos permitir override, pero por seguridad mantenemos la regla
    -- Usamos v_target_collab si existe, sino v_uid (auto-asignación)
    if exists (select 1 from public.collaborator_active_jobs j where j.collaborator_id = coalesce(v_target_collab, v_uid) and j.order_id <> p_order_id) then
      raise exception 'Ya tienes otra orden activa' using errcode = 'P0001';
    end if;
    insert into public.collaborator_active_jobs(collaborator_id, order_id)
    values (coalesce(v_target_collab, v_uid), p_order_id)
    on conflict (collaborator_id) do update set order_id = excluded.order_id;
  elsif v_normalized in ('completed','cancelled') then
    delete from public.collaborator_active_jobs where order_id = p_order_id;
  end if;

  return v_updated;
end;
$$;

-- Accept Order Wrapper
create or replace function public.accept_order_by_short_id(p_short_id text)
returns table (order_id bigint, success boolean, message text)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_order_id bigint;
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  
  if not exists (select 1 from public.collaborators c where c.id = auth.uid() and c.status = 'activo' and lower(c.role) = 'colaborador') then
    return query select null::bigint, false, 'Colaborador no activo o sin permisos'::text;
    return;
  end if;

  update public.orders
  set
    status = 'accepted',
    accepted_at = now(),
    accepted_by = auth.uid(),
    assigned_to = auth.uid(),
    assigned_at = now(),
    tracking_data = coalesce(tracking_data, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('status', 'accepted', 'date', now(), 'description', 'Orden aceptada'))
  where upper(short_id) = upper(p_short_id)
    and status = 'pending'
  returning id into v_order_id;

  if v_order_id is null then
    return query select null::bigint, false, 'Orden no encontrada o ya está asignada'::text;
    return;
  end if;

  -- Active Job Maintenance
  insert into public.collaborator_active_jobs(collaborator_id, order_id)
  values (auth.uid(), v_order_id)
  on conflict (collaborator_id) do update set order_id = excluded.order_id, started_at = now();

  return query select v_order_id, true, 'Orden aceptada exitosamente'::text;
end;
$$;

-- Notification Resolver
create or replace function public.resolve_notification_targets(
  p_event_type text,
  p_payload jsonb,
  p_order_id bigint
)
returns table (
  recipient_type text,
  recipient_id uuid,
  recipient_contact_id uuid
)
language sql stable security definer
set search_path = pg_catalog, public
as $$
  -- CLIENTE
  select 'client', o.client_id, o.client_contact_id
  from public.orders o
  where o.id = p_order_id
  union all
  -- COLABORADOR
  select 'collaborator', o.assigned_to, null
  from public.orders o
  where o.id = p_order_id
    and o.assigned_to is not null
  union all
  -- ADMINS
  select 'admin', c.id, null
  from public.collaborators c
  where c.role in ('admin', 'administrador')
    and c.status = 'activo';
$$;

-- Trigger: Events -> Outbox
create or replace function public.enqueue_event_to_outbox()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r record;
  t_id bigint;
begin
  if new.payload is null then raise exception 'Payload vacío'; end if;

  for r in
    select * from public.resolve_notification_targets(new.event_type, new.payload, new.order_id)
  loop
    select id into t_id
    from public.notification_templates
    where event_type = new.event_type
      and role = r.recipient_type
      and (status is null or status = new.payload->>'new_status')
      and is_active = true
    limit 1;

    if t_id is not null then
      insert into public.notification_outbox(
        event_id, event_type, recipient_type, recipient_id, recipient_contact_id,
        template_id, payload, dedup_key, next_retry_at, channel, created_at
      )
      values (
        new.id, new.event_type, r.recipient_type, r.recipient_id, r.recipient_contact_id,
        t_id, new.payload,
        format('order:%s|event:%s|recipient:%s|status:%s', new.order_id, new.event_type, coalesce(r.recipient_id::text, r.recipient_contact_id::text, 'unknown'), coalesce(new.payload->>'new_status','')),
        now(), 'push', now()
      )
      on conflict (dedup_key, created_at) do nothing;
    end if;
  end loop;
  return new;
end;
$$;

drop function if exists public.trg_events_to_outbox() cascade;

drop trigger if exists trg_events_to_outbox on public.order_events;
create trigger trg_events_to_outbox
after insert on public.order_events
for each row execute function public.enqueue_event_to_outbox();

-- Trigger: Orders -> Events
create or replace function public.trg_orders_emit_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events(order_id, event_type, payload, actor_id)
    values (new.id, 'order_created', jsonb_build_object('new_status', new.status), auth.uid());
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.order_events(order_id, event_type, payload, actor_id)
    values (new.id, 'status_changed', jsonb_build_object('old_status', old.status, 'new_status', new.status), auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_emit_event on public.orders;
create trigger trg_orders_emit_event
after insert or update on public.orders
for each row execute function public.trg_orders_emit_event();

-- Metrics Logic
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
    completed_count, canceled_count, total_amount,
    avg_rating, avg_completion_minutes, updated_at,
    sum_completion_minutes, sum_rating, count_ratings
  ) values (
    p_collaborator_id, p_metric_date,
    greatest(p_accept_inc,0), greatest(p_in_progress_inc,0), greatest(p_complete_inc,0), greatest(p_cancel_inc,0),
    coalesce(p_amount,0), null, null, now(),
    coalesce(p_completion_minutes, 0), coalesce(p_rating, 0), case when p_rating is not null then 1 else 0 end
  )
  on conflict (collaborator_id, metric_date)
  do update set
    accepted_count = public.collaborator_performance.accepted_count + greatest(p_accept_inc,0),
    in_progress_count = public.collaborator_performance.in_progress_count + greatest(p_in_progress_inc,0),
    completed_count = public.collaborator_performance.completed_count + greatest(p_complete_inc,0),
    canceled_count = public.collaborator_performance.canceled_count + greatest(p_cancel_inc,0),
    total_amount = public.collaborator_performance.total_amount + coalesce(p_amount,0),
    sum_completion_minutes = public.collaborator_performance.sum_completion_minutes + coalesce(p_completion_minutes, 0),
    sum_rating = public.collaborator_performance.sum_rating + coalesce(p_rating, 0),
    count_ratings = public.collaborator_performance.count_ratings + (case when p_rating is not null then 1 else 0 end),
    avg_rating = case
      when (public.collaborator_performance.count_ratings + (case when p_rating is not null then 1 else 0 end)) > 0 
      then (public.collaborator_performance.sum_rating + coalesce(p_rating, 0)) / (public.collaborator_performance.count_ratings + (case when p_rating is not null then 1 else 0 end))
      else null
    end,
    avg_completion_minutes = case
      when (public.collaborator_performance.completed_count + greatest(p_complete_inc,0)) > 0
      then (public.collaborator_performance.sum_completion_minutes + coalesce(p_completion_minutes, 0)) / (public.collaborator_performance.completed_count + greatest(p_complete_inc,0))
      else null
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

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
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
end;$$;

drop trigger if exists trg_orders_track_metrics on public.orders;
create trigger trg_orders_track_metrics
after insert or update on public.orders
for each row execute function public.track_order_metrics();

-- 9) VISTAS
create or replace view public.v_notification_dashboard as
select
  (select count(*) from public.notification_outbox where status='pending') as pending,
  (select count(*) from public.notification_outbox where status='processing') as processing,
  (select count(*) from public.notification_outbox where status='failed') as failed,
  (select count(*) from public.notification_dlq) as dlq;

-- 10) RLS POLICIES (Consolidated)
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
alter table public.clients enable row level security;
alter table public.notification_templates enable row level security;
alter table public.notification_outbox disable row level security; -- Worker access needed
alter table public.collaborator_active_jobs enable row level security;
alter table public.collaborator_locations enable row level security;
alter table public.testimonials enable row level security;

-- Public Read
create policy public_read_vehicles on public.vehicles for select using (true);
create policy public_read_services on public.services for select using (true);
create policy public_read_testimonials on public.testimonials for select using (is_public = true);

-- Orders
create policy orders_insert_public on public.orders for insert with check (
  status = 'pending' and assigned_to is null
);

create policy orders_select_policy on public.orders for select using (
  (client_id = auth.uid())
  or (
    exists (select 1 from public.collaborators c where c.id = auth.uid() and c.status = 'activo')
    and (
      assigned_to = auth.uid()
      or (
        status = 'pending'
        and exists (
          select 1 from public.collaborators c2
          where c2.id = auth.uid()
          and c2.can_take_orders = true
        )
      )
    )
  )
  or (public.is_owner(auth.uid()) or public.is_admin(auth.uid()))
);

create policy orders_update_collaborator on public.orders for update using (
  exists (select 1 from public.collaborators c where c.id = auth.uid() and c.status = 'activo')
  and assigned_to = auth.uid()
);

create policy orders_all_admin on public.orders for all using (
  public.is_owner(auth.uid()) or public.is_admin(auth.uid())
);

-- Profiles
create policy public_read_profiles on public.profiles for select using (true);
create policy users_update_own_profile on public.profiles for update using (auth.uid() = id);

-- Collaborators
create policy collaborator_select_self on public.collaborators for select using (auth.uid() = id or public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy collaborator_update_self on public.collaborators for update using (auth.uid() = id or public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Business
create policy owner_all_business on public.business for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Notifications
create policy user_own_notifications on public.notifications for all using (user_id = auth.uid());
create policy admin_notifications on public.notifications for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Push
create policy user_own_push on public.push_subscriptions for all using (user_id = auth.uid());
create policy anon_insert_push on public.push_subscriptions for insert with check (client_contact_id is not null);

-- Active Jobs
create policy active_jobs_all on public.collaborator_active_jobs for all using (
  collaborator_id = auth.uid() or public.is_owner(auth.uid()) or public.is_admin(auth.uid())
);

-- Locations
create policy location_upsert_own on public.collaborator_locations for insert with check (auth.uid() = collaborator_id);
create policy location_update_own on public.collaborator_locations for update using (auth.uid() = collaborator_id);
create policy location_select_auth on public.collaborator_locations for select using (auth.role() = 'authenticated');

-- 11) SEEDS & CRON
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

insert into public.notification_templates(event_type, role, status, locale, title, body, is_active)
values
  ('order_created','client','pending','es','Orden creada','Tu orden #{{id}} fue creada correctamente.',true),
  ('order_created','admin','pending','es','Nueva orden creada','Se creó la orden #{{id}}.',true),
  ('order_created','collaborator','pending','es','Nueva orden disponible','Hay una nueva orden #{{id}} pendiente.',true),
  ('status_changed','client','accepted','es','Orden aceptada','Tu orden #{{id}} ha sido aceptada',true),
  ('status_changed','client','in_progress','es','En camino','Tu orden #{{id}} está en curso',true),
  ('status_changed','client','completed','es','Completada','Tu orden #{{id}} ha sido completada',true)
on conflict (event_type, role, status_key, locale) do nothing;

-- 12) PERMISOS FINALES
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all functions in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant select on table public.vehicles to anon, authenticated;
grant select on table public.services to anon, authenticated;
grant select on table public.testimonials to anon, authenticated;

grant execute on function public.create_order_with_contact(jsonb) to anon;
grant execute on function public.accept_order_by_short_id(text) to authenticated;
grant execute on function public.update_order_status(bigint, text, uuid, jsonb) to authenticated;

-- =============================================================
-- 13) WORKER API & EXTENSIONS (Notificaciones)
-- =============================================================

-- A) Worker Heartbeat & Health Check
create table if not exists public.worker_heartbeat(
  worker_name text primary key,
  last_seen timestamptz not null
);

create or replace function public.check_worker_health()
returns boolean
language sql stable security definer
as $$
  select exists(
    select 1
    from public.worker_heartbeat
    where worker_name = 'process-notifications'
      and last_seen > now() - interval '2 minutes'
  );
$$;

-- B) Claim (Reclamar tareas)
create or replace function public.claim_notification_outbox(
  p_batch_size int default 50
)
returns table (
  id bigint,
  event_type text,
  recipient_id uuid,
  recipient_contact_id uuid,
  payload jsonb,
  channel text,
  attempts int,
  template_data jsonb
)
language plpgsql security definer
as $$
begin
  return query
  with locked_rows as (
    select id
    from public.notification_outbox
    where status = 'pending'
      and (next_retry_at is null or next_retry_at <= now())
      and (hold_until is null or hold_until <= now())
    order by created_at asc
    limit p_batch_size
    for update skip locked
  )
  update public.notification_outbox n
  set 
    status = 'processing',
    processed_at = now(),
    attempts = attempts + 1
  from locked_rows lr
  left join public.notification_templates t on n.template_id = t.id
  where n.id = lr.id
  returning 
    n.id,
    n.event_type,
    n.recipient_id,
    n.recipient_contact_id,
    n.payload,
    n.channel,
    n.attempts,
    to_jsonb(t.*) as template_data;
end;
$$;

-- C) Mark Sent
create or replace function public.mark_notification_sent(p_id bigint)
returns void
language plpgsql security definer
as $$
begin
  -- Delivery Log
  insert into public.notification_delivery(outbox_id, channel, success, response)
  values (p_id, 'push', true, 'ok');

  update public.notification_outbox
  set 
    status = 'sent',
    processed_at = now()
  where id = p_id;
end;
$$;

-- D) Mark Failed (con Retry Exponencial y DLQ)
create or replace function public.mark_notification_failed(
  p_id bigint, 
  p_error text
)
returns void
language plpgsql security definer
as $$
declare
  v_attempts int;
  v_max int;
  v_hold timestamptz;
  v_row public.notification_outbox;
begin
  select * into v_row from public.notification_outbox where id = p_id;
  if not found then return; end if;

  v_attempts := v_row.attempts; -- Ya incrementado en claim
  v_max := v_row.max_attempts;

  -- Delivery Log (Error)
  insert into public.notification_delivery(outbox_id, channel, success, response)
  values (p_id, 'push', false, p_error);

  if v_attempts >= v_max then
    -- Mover a DLQ
    insert into public.notification_dlq(
      outbox_id, event_id, event_type, recipient_type, recipient_id, 
      recipient_contact_id, channel, payload, error_log, final_attempts
    ) values (
      v_row.id, v_row.event_id, v_row.event_type, v_row.recipient_type, v_row.recipient_id,
      v_row.recipient_contact_id, v_row.channel, v_row.payload, p_error, v_attempts
    );

    update public.notification_outbox
    set status = 'failed', last_error = p_error, attempts = v_attempts, processed_at = now()
    where id = p_id;
  else
    -- Circuit Breaker: Si falla 3+ veces, esperar 15 mins (evitar martilleo)
    if v_attempts >= 3 then
       v_hold := now() + interval '15 minutes';
    else
       v_hold := null;
    end if;

    -- Retry Exponencial: 30s * 2^attempts
    update public.notification_outbox
    set 
      status = 'pending',
      attempts = v_attempts,
      last_error = p_error,
      hold_until = v_hold,
      next_retry_at = now() + (power(2, v_attempts) * interval '30 seconds')
    where id = p_id;
  end if;
end;
$$;

-- D) Watchdog (Liberar atascados)
create or replace function public.release_stuck_notifications()
returns void
language plpgsql security definer
as $$
begin
  update public.notification_outbox
  set status = 'pending', next_retry_at = now(), last_error = 'Watchdog: Stuck in processing'
  where status = 'processing'
    and processed_at < now() - interval '10 minutes';
end;
$$;

-- F) Permisos Worker
grant execute on function public.claim_notification_outbox(int) to service_role;
grant execute on function public.mark_notification_sent(bigint) to service_role;
grant execute on function public.mark_notification_failed(bigint, text) to service_role;
grant execute on function public.release_stuck_notifications() to service_role;
grant all on public.worker_heartbeat to service_role;

-- =============================================================
-- EJEMPLO DE USO (EDGE FUNCTION LOGIC)
-- =============================================================
/*
  // Deno Edge Function (pseudo-código)
  
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

  Deno.serve(async (req) => {
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
    
    // 0. Heartbeat
    await supabase.from('worker_heartbeat').upsert({ worker_name: 'process-notifications', last_seen: new Date() })

    // 1. Watchdog cleanup (optional here, better in cron)
    await supabase.rpc('release_stuck_notifications')

    // 2. Claim tasks
    const { data: tasks, error } = await supabase.rpc('claim_notification_outbox', { p_batch_size: 50 })
    if (error) return new Response(JSON.stringify({ error }), { status: 500 })
    
    // 3. Process tasks
    const results = await Promise.all(tasks.map(async (task) => {
      try {
        // Send Push/Email/SMS here...
        // Use timeout signal!
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
        
        // 4. Mark success
        await supabase.rpc('mark_notification_sent', { p_id: task.id })
        return { id: task.id, status: 'sent' }
      } catch (err) {
        // 5. Mark failure
        await supabase.rpc('mark_notification_failed', { p_id: task.id, p_error: err.message })
        return { id: task.id, status: 'failed', error: err.message }
      }
    }))
    
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } })
  })
*/

-- =============================================================
-- 14) CRON SCHEDULES (pg_cron)
-- =============================================================

-- ⚠️ IMPORTANTE: 
-- Se recomienda usar un Worker Persistente (supabase functions serve) en lugar de cron.
-- El cron se mantiene solo como mecanismo de respaldo "Dead Man Switch" o "Wake Up".

-- 1. Wake Up / Backup Trigger (cada 30s)
-- Intenta despertar al worker si está dormido. URL DEBE SER CONFIGURADA.
select cron.schedule(
  'process-outbox-wakeup',
  '*/30 * * * * *',
  $$
  select net.http_post(
       url := 'https://fkprllkxyjtosjhtikxy.supabase.co/functions/v1/process-outbox',
       headers := jsonb_build_object(
         'Content-Type','application/json',
         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
       ),
       body := '{}'::jsonb,
       timeout_milliseconds := 5000
  ); 
  $$
);

-- 2. Cleanup Outbox & DLQ (diario 3am)
select cron.schedule(
  'cleanup-outbox',
  '0 3 * * *',
  $$ 
    -- Limpiar entregados antiguos
    delete from public.notification_outbox 
    where status='sent' 
    and created_at < now() - interval '30 days';
    
    -- Limpiar DLQ antiguo
    delete from public.notification_dlq
    where moved_at < now() - interval '90 days';
  $$
);
