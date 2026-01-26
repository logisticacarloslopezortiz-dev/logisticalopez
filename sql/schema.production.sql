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
      and lower(status) in ('activo','active')
  );
$$;

-- 6) ÓRDENES Y RELACIONADOS
-- Generador de short_id
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
create index if not exists idx_orders_short_id_upper on public.orders(upper(short_id));
create index if not exists idx_orders_assigned_to on public.orders(assigned_to);
create index if not exists idx_orders_client_id on public.orders(client_id);
create index if not exists idx_orders_created_at on public.orders(created_at);
create index if not exists idx_orders_completed_at on public.orders(completed_at);
create index if not exists idx_orders_status_assigned_to on public.orders(status, assigned_to);
create index if not exists idx_orders_status_created_at on public.orders(status, created_at);
create index if not exists idx_collab_status_role on public.collaborators(status, role);

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
end;
$$;

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
  read_at timestamptz,
  delivered_at timestamptz
);
create index if not exists idx_notifications_user on public.notifications(user_id);
create index if not exists idx_notifications_created_at on public.notifications(created_at);
create index if not exists idx_notifications_unread on public.notifications((read_at is null)) where read_at is null;

alter table public.notifications add column if not exists contact_id uuid references public.clients(id) on delete cascade;
create index if not exists idx_notifications_contact on public.notifications(contact_id);
create index if not exists idx_notifications_user_read_at on public.notifications(user_id, read_at);
alter table public.notifications add column if not exists delivered boolean default false;

-- Ajustes para comisiones
alter table public.collaborators add column if not exists commission_percent numeric default 0.10;
alter table public.collaborators add column if not exists can_take_orders boolean default false;
alter table public.collaborators add column if not exists puede_ver_todas_las_ordenes boolean default false;
create index if not exists idx_collaborators_can_take on public.collaborators(can_take_orders);

-- Disponibilidad dinámica del colaborador (no confundir con activación)
alter table public.collaborators add column if not exists availability text default 'available';
create index if not exists idx_collaborators_availability on public.collaborators(availability);

-- 📬 CAPA 3 — OUTBOX (cola de notificaciones)
create table if not exists public.notification_outbox (
  id bigserial primary key,
  event_id bigint, -- Referencia opcional a order_events
  event_type text not null,
  recipient_type text not null, -- client | collaborator | admin
  recipient_id uuid,
  template_id bigint,
  payload jsonb not null,
  dedup_key text not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz default now()
);
-- 🧠 dedup_key (clave mágica) para eliminar duplicados sin lógica
create unique index if not exists uniq_notification_dedup on public.notification_outbox(dedup_key);
create index if not exists idx_notification_outbox_status on public.notification_outbox(status);
create index if not exists idx_notification_outbox_dedup_status on public.notification_outbox(dedup_key, status);

-- Normalizar estados incorrectos previamente guardados en 'status'
do $$
begin
  -- Copiar availability desde status cuando estaba mal usado
  -- (Bloque de migración existente mantenido)
  update public.collaborators
     set availability = lower(status)
   where lower(status) in ('available','busy')
     and (availability is null or availability not in ('available','busy'));

  -- Volver status a 'activo' cuando estaba en 'available'/'busy'
  update public.collaborators
     set status = 'activo'
   where lower(status) in ('available','busy');

  -- Refuerzo: asegurar que administradores nunca queden con status busy/available
  update public.collaborators
     set status = 'activo'
   where lower(role) = 'administrador'
     and lower(status) in ('available','busy');
end $$;

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
  -- 1. Verificar si existe la orden
  select exists(select 1 from public.orders where id = order_id) into exists_order;
  if not exists_order then
    return false;
  end if;

  -- 2. Evitar doble calificación
  if exists (
    select 1 from public.orders
    where id = order_id
    and rating is not null
  ) then
    raise exception 'Este pedido ya fue calificado';
  end if;

  -- 3. Actualizar
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

-- (deprecated implementation removed to avoid return type conflicts)

drop function if exists public.resolve_order_for_rating(text);
create or replace function public.resolve_order_for_rating(p_code text)
returns table (
  id bigint,
  is_completed boolean
)
security definer
language plpgsql
as $$
declare
  v_clean text;
begin
  -- 1. Si es número, buscar por ID
  if p_code ~ '^[0-9]+$' then
    return query
    select o.id, (o.status = 'completed' or o.completed_at is not null) as is_completed
    from public.orders o
    where o.id = p_code::bigint
    limit 1;
    return;
  end if;

  -- 2. Búsqueda por short_id (con/sin prefijo ORD-)
  v_clean := upper(regexp_replace(trim(p_code), '^ORD-', '', 'i'));
  
  return query
  select o.id, (o.status = 'completed' or o.completed_at is not null) as is_completed
  from public.orders o
  where upper(trim(o.short_id)) = v_clean
     or upper(trim(o.short_id)) = 'ORD-' || v_clean
  limit 1;
end;
$$;
grant execute on function public.resolve_order_for_rating(text) to anon, authenticated;

-- Push subscriptions
create table if not exists public.push_subscriptions (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  endpoint text not null,
  keys jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);
create index if not exists idx_push_endpoint on public.push_subscriptions(endpoint);
create unique index if not exists uniq_push_subscriptions_user_endpoint
  on public.push_subscriptions(user_id, endpoint)
  where user_id is not null;

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
  on conflict (user_id, endpoint) where user_id is not null do update set keys = excluded.keys;
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
  v_client_id uuid := auth.uid();
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
      on conflict (user_id, endpoint) where user_id is not null do update set keys = excluded.keys;
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

-- ==========================================
-- 07. SISTEMA DE ASIGNACIÓN (ASSIGNMENT SYSTEM)
-- ==========================================

-- RPC: Aceptar orden por Short ID (Corregido y Optimizado)
drop function if exists public.accept_order_by_short_id(text);
create or replace function public.accept_order_by_short_id(p_short_id text)
returns table (
  order_id bigint,
  success boolean,
  message text
)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  _now timestamptz := now();
  v_order_id bigint;
begin
  -- 1. Validar que el colaborador está activo
  if not exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() 
      and c.status = 'activo'
      and lower(c.role) = 'colaborador'
  ) then
    return query select null::bigint, false, 'Colaborador no activo o sin permisos'::text;
    return;
  end if;

  -- 2. UPDATE atómico: asignar orden si está pending y no tiene asignación
  update public.orders
  set
    status = 'accepted'::public.order_status,
    accepted_at = _now,
    accepted_by = auth.uid(),
    assigned_to = auth.uid(),
    assigned_at = _now,
    tracking_data = jsonb_build_array(
      jsonb_build_object('status', 'accepted', 'date', _now, 'description', 'Orden aceptada'))
  where upper(short_id) = upper(p_short_id)
    and status = 'pending'::public.order_status
  returning id into v_order_id;

  if v_order_id is null then
    return query select null::bigint, false, 'Orden no encontrada o ya está asignada'::text;
    return;
  end if;

  return query select v_order_id, true, 'Orden aceptada exitosamente'::text;
end;
$$;
grant execute on function public.accept_order_by_short_id(text) to authenticated;

-- Actualizar estado de orden
create or replace function public.update_order_status(
  p_order_id bigint,
  p_new_status text,
  p_collaborator_id uuid, -- Ignored, using auth.uid()
  p_tracking_entry jsonb
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare 
  v_updated jsonb;
  v_normalized public.order_status;
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  v_normalized := public.normalize_order_status(p_new_status);

  update public.orders o
  set
    status = v_normalized,
    assigned_to = case when v_normalized = 'pending' then null else coalesce(o.assigned_to, v_uid) end,
    assigned_at = case when v_normalized = 'pending' then null when v_normalized = 'accepted' and o.assigned_at is null then now() else assigned_at end,
    completed_by = case when v_normalized = 'completed' then v_uid else completed_by end,
    completed_at = case when v_normalized = 'completed' then now() else completed_at end,
    -- Preservar historial: agregar nueva entrada al array de tracking
    tracking_data = case when p_tracking_entry is not null then coalesce(o.tracking_data,'[]'::jsonb) || jsonb_build_array(p_tracking_entry) else o.tracking_data end
  where o.id = p_order_id
    and (o.assigned_to = v_uid or o.assigned_to is null)
    and o.status not in ('cancelled', 'completed')
  returning to_jsonb(o) into v_updated;

  if v_updated is null then
    raise exception 'No autorizado o no encontrada' using errcode = '42501';
  end if;
  if v_normalized in ('accepted','in_progress') then
    if exists (
      select 1 from public.collaborator_active_jobs j 
      where j.collaborator_id = v_uid
        and j.order_id <> p_order_id
    ) then
      raise exception 'Ya tienes otra orden activa' using errcode = 'P0001';
    end if;
    insert into public.collaborator_active_jobs(collaborator_id, order_id)
    values (v_uid, p_order_id)
    on conflict (collaborator_id) do update set 
      order_id = excluded.order_id,
      started_at = case when collaborator_active_jobs.order_id <> excluded.order_id then now() else collaborator_active_jobs.started_at end;
  elsif v_normalized in ('completed','cancelled') then
    -- CORRECCIÓN CRÍTICA: Usar parámetro p_order_id para evitar borrado masivo
    delete from public.collaborator_active_jobs where order_id = p_order_id;
  end if;
  return v_updated;
end;
$$;
grant execute on function public.update_order_status(bigint, text, uuid, jsonb) to authenticated;

-- RPC: iniciar trabajo sobre una orden (wrapper con mejor rastreo)
create or replace function public.start_order_work(p_order_id bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  res jsonb;
  v_collaborator_name text;
begin
  -- Obtener nombre del colaborador
  select coalesce(nombre, nombre_completo, 'Colaborador')
  into v_collaborator_name
  from public.profiles
  where id = auth.uid();

  res := public.update_order_status(
    p_order_id,
    'in_progress',
    auth.uid(),
    jsonb_build_object(
      'status', 'in_progress',
      'date', now(),
      'collaborator_id', auth.uid(),
      'collaborator_name', v_collaborator_name,
      'description', 'Trabajo iniciado por ' || coalesce(v_collaborator_name, 'colaborador')
    )
  );
  return res;
end;
$$;
grant execute on function public.start_order_work(bigint) to authenticated;

-- RPC: Modificar monto de orden (Admin Only)
create or replace function public.set_order_amount_admin(
  order_id bigint,
  amount numeric,
  method text
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  updated jsonb;
begin
  if auth.uid() is null then
    raise exception 'Error: No hay usuario autenticado' using errcode = 'P0001';
  end if;
  
  if not (public.is_admin(auth.uid()) or public.is_owner(auth.uid())) then
    raise exception 'Error: Acceso restringido. Solo administradores pueden modificar montos.' using errcode = '42501';
  end if;
  
  if amount is null or amount <= 0 then
    raise exception 'Error: El monto debe ser un valor positivo' using errcode = '22003';
  end if;

  update public.orders o
  set 
    monto_cobrado = amount,
    metodo_pago = coalesce(method, 'indefinido'),
    updated_at = now(),
    tracking_data = jsonb_build_array(
      jsonb_build_object('status','monto_actualizado','date',now(),'monto',amount,'metodo',method,'admin_id',auth.uid())
    )
  where o.id = order_id
  returning to_jsonb(o) into updated;
  
  if updated is null then
    raise exception 'Error: Orden no encontrada. ID: %', order_id using errcode = 'P0002';
  end if;
  
  return updated;
end;
$$;
grant execute on function public.set_order_amount_admin(bigint, numeric, text) to authenticated;

-- ==========================================
-- 07b. SISTEMA DE SOLICITUDES PENDIENTES (PENDING ORDERS VISIBILITY)
-- ==========================================

-- RPC: Obtener órdenes pendientes para colaborador con paginación
create or replace function public.get_pending_orders_for_collaborator(
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  order_id bigint,
  short_id text,
  client_name text,
  service_name text,
  pickup_address text,
  delivery_address text,
  estimated_price numeric,
  created_at timestamptz,
  priority_rank int
)
language sql security definer set search_path = pg_catalog, public as $$
  select
    o.id,
    o.short_id,
    c.full_name,
    s.name,
    o.pickup,
    o.delivery,
    o.estimated_price,
    o.created_at,
    row_number() over (order by o.created_at asc) as priority_rank
  from public.orders o
  left join public.profiles c on o.client_id = c.id
  left join public.services s on o.service_id = s.id
  where o.status = 'pending'::public.order_status
    and o.assigned_to is null
  order by o.created_at asc
  limit p_limit
  offset p_offset;
$$;
grant execute on function public.get_pending_orders_for_collaborator(int, int) to authenticated;

-- RPC: Obtener detalles completos de una orden pendiente
create or replace function public.get_pending_order_details(
  p_order_id bigint
)
returns table (
  order_id bigint,
  short_id text,
  status text,
  client_name text,
  client_phone text,
  client_email text,
  service_name text,
  service_description text,
  pickup_address text,
  delivery_address text,
  estimated_price numeric,
  vehicle_type text,
  customer_comment text,
  created_at timestamptz
)
language sql security definer set search_path = pg_catalog, public as $$
  select
    o.id,
    o.short_id,
    o.status::text,
    c.full_name,
    c.phone,
    c.email,
    s.name,
    s.description,
    o.pickup,
    o.delivery,
    o.estimated_price,
    v.name,
    o.customer_comment,
    o.created_at
  from public.orders o
  left join public.profiles c on o.client_id = c.id
  left join public.services s on o.service_id = s.id
  left join public.vehicles v on o.vehicle_id = v.id
  where o.id = p_order_id
    and o.status = 'pending'::public.order_status
    and o.assigned_to is null;
$$;
grant execute on function public.get_pending_order_details(bigint) to authenticated;

-- ==========================================
-- 07c. SISTEMA DE NOTIFICACIONES (NOTIFICATION SYSTEM)
-- ==========================================

-- NOTA: notify_collaborators_new_order y notify_client_order_status
-- fueron eliminadas. Usa el sistema de eventos automático en su lugar:
-- order_events → dispatch_notification → notification_templates
-- Ver sección "⚙️ CAPA 2 — TRIGGERS" para más detalles.

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
alter table public.clients enable row level security;

-- Limpieza
drop policy if exists public_read_vehicles on public.vehicles;
drop policy if exists admin_all_access_vehicles on public.vehicles;
drop policy if exists admin_insert_vehicles on public.vehicles;
drop policy if exists admin_update_vehicles on public.vehicles;
drop policy if exists admin_delete_vehicles on public.vehicles;
drop policy if exists public_read_services on public.services;
drop policy if exists admin_all_access_services on public.services;
drop policy if exists admin_insert_services on public.services;
drop policy if exists admin_update_services on public.services;
drop policy if exists admin_delete_services on public.services;
drop policy if exists public_read_profiles on public.profiles;
drop policy if exists users_update_own_profile on public.profiles;
drop policy if exists admin_manage_profiles on public.profiles;
drop policy if exists admin_insert_profiles on public.profiles;
drop policy if exists admin_update_profiles on public.profiles;
drop policy if exists admin_delete_profiles on public.profiles;
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
drop policy if exists collaborator_select_self on public.collaborators;
drop policy if exists collaborator_update_self on public.collaborators;
drop policy if exists admin_insert_collaborators on public.collaborators;
drop policy if exists admin_delete_collaborators on public.collaborators;
drop policy if exists owner_full_access_business on public.business;
drop policy if exists owner_select_business on public.business;
drop policy if exists owner_update_business on public.business;
drop policy if exists owner_insert_business on public.business;
drop policy if exists owner_delete_business on public.business;
drop policy if exists user_manage_own_notifications on public.notifications;
drop policy if exists admin_manage_notifications on public.notifications;
drop policy if exists user_select_own_notifications on public.notifications;
drop policy if exists user_update_own_notifications on public.notifications;
drop policy if exists user_delete_own_notifications on public.notifications;
drop policy if exists admin_select_notifications on public.notifications;
drop policy if exists admin_insert_notifications on public.notifications;
drop policy if exists user_manage_own_push_subscriptions on public.push_subscriptions;
drop policy if exists admin_read_push_subscriptions on public.push_subscriptions;
drop policy if exists user_select_own_push on public.push_subscriptions;
drop policy if exists user_insert_own_push on public.push_subscriptions;
drop policy if exists user_update_own_push on public.push_subscriptions;
drop policy if exists user_delete_own_push on public.push_subscriptions;
drop policy if exists client_read_own_receipts on public.order_completion_receipts;
drop policy if exists collaborator_manage_assigned_receipts on public.order_completion_receipts;
drop policy if exists collaborator_select_assigned_receipts on public.order_completion_receipts;
drop policy if exists admin_manage_receipts on public.order_completion_receipts;
drop policy if exists admin_select_receipts on public.order_completion_receipts;
drop policy if exists admin_update_receipts on public.order_completion_receipts;
drop policy if exists admin_delete_receipts on public.order_completion_receipts;
drop policy if exists owner_admin_all_invoices on public.invoices;
drop policy if exists admin_select_invoices on public.invoices;
drop policy if exists admin_insert_invoices on public.invoices;
drop policy if exists admin_update_invoices on public.invoices;
drop policy if exists admin_delete_invoices on public.invoices;
drop policy if exists client_read_own_invoices on public.invoices;
drop policy if exists clients_insert_any on public.clients;
drop policy if exists clients_select_any on public.clients;
drop policy if exists clients_select_auth on public.clients;

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

-- Grants for public catalog tables
grant select on public.vehicles to anon, authenticated;
grant select on public.services to anon, authenticated;

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

drop policy if exists anon_insert_push_by_contact on public.push_subscriptions;
create policy anon_insert_push_by_contact on public.push_subscriptions for insert to anon, authenticated with check (client_contact_id is not null and endpoint like 'https://%');

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

-- Clients
create policy clients_insert_any on public.clients for insert to anon, authenticated with check (
  length(coalesce(phone, '')) >= 7 or length(coalesce(email, '')) >= 5
);
create policy clients_select_auth on public.clients for select using (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

drop trigger if exists trg_orders_create_receipt_on_complete on public.orders;
create trigger trg_orders_create_receipt_on_complete
after update of status on public.orders
for each row execute function public.create_completion_receipt_on_order_complete();

 --Orders RLS
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
drop policy if exists orders_insert_public on public.orders;
drop policy if exists orders_select_policy on public.orders;
drop policy if exists orders_update_collaborator on public.orders;
drop policy if exists orders_all_admin on public.orders;
drop policy if exists "Colaboradores ven ordenes asignadas o pendientes" on public.orders;
drop policy if exists "Usuarios ven sus ordenes" on public.orders;

-- 1. Insert (Public)
create policy orders_insert_public on public.orders for insert with check (
  status = 'pending' and assigned_to is null
  and (client_id is not null or client_contact_id is not null)
);

-- 2. Select (Client + Collaborator + Admin)
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
-- Note: order_events table defined later in CAPA 1 section

drop trigger if exists trg_orders_notify_status on public.orders;
drop function if exists public.trg_orders_notify_status();

-- Note: order_events table defined later in CAPA 1
-- Note: Use trg_orders_emit_event instead of on_order_status_changed

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
    completed_count, canceled_count, total_amount,
    avg_rating, avg_completion_minutes, updated_at,
    sum_completion_minutes, sum_rating, count_ratings
  ) values (
    p_collaborator_id, p_metric_date,
    greatest(p_accept_inc,0),
    greatest(p_in_progress_inc,0),
    greatest(p_complete_inc,0),
    greatest(p_cancel_inc,0),
    coalesce(p_amount,0),
    null,
    null,
    now(),
    coalesce(p_completion_minutes, 0),
    coalesce(p_rating, 0),
    case when p_rating is not null then 1 else 0 end
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
after insert or update on public.orders
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

-- Agregar columnas a vehicles si no existen
alter table public.vehicles add column if not exists description text;
alter table public.vehicles add column if not exists image_url text;

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

-- Agregar columnas a services si no existen
alter table public.services add column if not exists description text;
alter table public.services add column if not exists image_url text;
alter table public.services add column if not exists display_order int;

-- 12) NOTIFICACIONES Y OUTBOX (Refactorizado)

-- Tabla de outbox para procesamiento asincrónico de notificaciones
create table if not exists public.notification_outbox (
  id bigserial primary key,
  event_id bigint,
  event_type text not null,
  recipient_type text not null,
  recipient_id uuid not null,
  template_id bigint references public.notification_templates(id) on delete set null,
  payload jsonb,
  dedup_key text unique,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index if not exists idx_notification_outbox_status on public.notification_outbox(status);
create index if not exists idx_notification_outbox_recipient on public.notification_outbox(recipient_id);

-- Requerido para net.http_post

-- Tabla para logs de funciones (necesaria para debugging)
create table if not exists public.business (
  id uuid primary key default gen_random_uuid(),
  business_name text,
  vapid_public_key text,
  push_vapid_key text,
  created_at timestamptz default now()
);
alter table public.business enable row level security;

create table if not exists public.function_logs (
  id bigserial primary key,
  fn_name text not null,
  level text not null check (level in ('debug','info','warn','error')),
  message text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_function_logs_fn_created
  on public.function_logs(fn_name, created_at);
create index if not exists idx_function_logs_level_created
  on public.function_logs(level, created_at);
alter table public.function_logs enable row level security;
drop policy if exists function_logs_read_admin on public.function_logs;
create policy function_logs_read_admin on public.function_logs for select using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Tabla de clientes anónimos/contactos
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text,
  email text,
  rnc text,
  empresa text,
  created_at timestamptz not null default now()
);
alter table public.clients enable row level security;

-- Plantillas de notificaciones (editable desde panel)
-- 🧾 CAPA 5 — TEMPLATES (contenido puro)
create table if not exists public.notification_templates (
  id bigserial primary key,
  event_type text not null,
  role text not null, -- client | collaborator | admin
  status text,
  locale text not null default 'es',
  title text not null,
  body text not null,
  is_active boolean not null default true
);
alter table public.notification_templates
  add column if not exists status_key text generated always as (coalesce(status, '')) stored;
drop index if exists idx_notification_templates_unique;
create unique index if not exists idx_notification_templates_unique
  on public.notification_templates(event_type, role, status_key, locale);
drop index if exists idx_notification_templates_event_role;
create index if not exists idx_notification_templates_event_role
  on public.notification_templates(event_type, role, status_key);
create index if not exists idx_notification_templates_active
  on public.notification_templates(is_active);
alter table public.notification_templates enable row level security;
-- [ARQUITECTURA SANA] Índice único real para evitar duplicados de templates
drop policy if exists admin_read_templates on public.notification_templates;
create policy admin_read_templates on public.notification_templates for select using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
drop policy if exists admin_manage_templates on public.notification_templates;
create policy admin_manage_templates on public.notification_templates for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid())) with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Seed básico para evento 'created'
insert into public.notification_templates(event_type, role, status, locale, title, body, is_active)
values
  ('order_created','client','pending','es','Orden creada','Tu orden #{{id}} fue creada correctamente. Te avisaremos cada avance.',true),
  ('order_created','admin','pending','es','Nueva orden creada','Se creó la orden #{{id}}. Requiere asignación.',true),
  ('order_created','collaborator','pending','es','Nueva orden disponible','Hay una nueva orden #{{id}} pendiente de asignación.',true)
on conflict (event_type, role, status_key, locale) do nothing;

-- Seed de mensajes para evento 'status_changed'
-- [ARQUITECTURA SANA] Estados estandarizados en INGLÉS (coinciden con ENUM DB)
insert into public.notification_templates(event_type, role, status, locale, title, body, is_active)
values
  -- Cliente
  ('status_changed','client','accepted','es','Actualización de tu orden','Tu orden #{{id}} ha sido aceptada',true),
  ('status_changed','client','in_progress','es','Actualización de tu orden','Tu orden #{{id}} está en curso',true),
  ('status_changed','client','completed','es','Actualización de tu orden','Tu orden #{{id}} ha sido completada',true),
  ('status_changed','client','cancelled','es','Actualización de tu orden','Tu orden #{{id}} ha sido cancelada',true),
  -- Colaborador
  ('status_changed','collaborator','accepted','es','Actualización de tu trabajo','Orden #{{id}} aceptada',true),
  ('status_changed','collaborator','in_progress','es','Actualización de tu trabajo','Orden #{{id}} en curso',true),
  ('status_changed','collaborator','completed','es','Actualización de tu trabajo','Orden #{{id}} completada',true),
  ('status_changed','collaborator','cancelled','es','Actualización de tu trabajo','Orden #{{id}} cancelada',true)
on conflict (event_type, role, status_key, locale) do nothing;

-- Limpieza de restos del sistema outbox anterior
drop view if exists public.v_notification_stats;
-- [ARQUITECTURA SANA] Eliminamos notify_admins porque duplica lógica
drop function if exists public.notify_admins cascade;

drop table if exists public.push_delivery_attempts cascade;
drop table if exists public.notification_events cascade;
drop function if exists public.claim_notification_events cascade;
drop function if exists public.reset_stuck_notification_events cascade;
drop function if exists public.plan_failed_retries cascade;
drop function if exists public.process_outbox_tick cascade;

-- Drop all overloads of invoke_process_outbox
do $$
declare
  func record;
begin
  for func in
    select oid::regprocedure as sig
    from pg_proc
    where proname = 'invoke_process_outbox'
      and pg_function_is_visible(oid)
  loop
    execute 'drop function if exists ' || func.sig || ' cascade';
  end loop;
end $$;

drop extension if exists pg_cron;

-- =========================
-- 🧠 CAPA 4 — RESOLUCIÓN DE DESTINATARIOS
-- =========================
create or replace function public.resolve_notification_targets(
  p_event_type text,
  p_payload jsonb,
  p_order_id bigint
)
returns table (
  recipient_type text,
  recipient_id uuid
)
language sql stable
as $$
  -- CLIENTE
  select 'client', o.client_id
  from public.orders o
  where o.id = p_order_id

  union all

  -- COLABORADOR
  select 'collaborator', o.assigned_to
  from public.orders o
  where o.id = p_order_id
    and o.assigned_to is not null

  union all

  -- ADMINS
  select 'admin', c.id
  from public.collaborators c
  where c.role = 'admin'
    and c.status = 'activo';
$$;

-- ==========================================
-- 10) MÉTRICAS Y EVENTOS (CAPA 1)
-- ==========================================
-- 🧩 CAPA 1 — EVENTOS (fuente de verdad)
create table if not exists public.order_events (
  id bigserial primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  event_type text not null, -- 'order_created', 'status_changed'
  payload jsonb not null,
  created_at timestamptz default now()
);
create index on public.order_events(order_id, created_at);

-- ⚙️ CAPA 2 — TRIGGERS (solo generan eventos)
create or replace function public.trg_orders_emit_event()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events(order_id, event_type, payload)
    values (new.id, 'order_created', jsonb_build_object(
      'status', new.status
    ));
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.order_events(order_id, event_type, payload)
    values (new.id, 'status_changed', jsonb_build_object(
      'old_status', old.status,
      'new_status', new.status
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_emit_event on public.orders;
create trigger trg_orders_emit_event
after insert or update of status on public.orders
for each row
execute function public.trg_orders_emit_event();

-- 🔁 CAPA 6 — GENERADOR DE OUTBOX (automático)
create or replace function public.trg_events_to_outbox()
returns trigger
language plpgsql
security definer
as $$
declare
  r record;
  t_id bigint;
begin
  for r in
    select * from public.resolve_notification_targets(
      new.event_type,
      new.payload,
      new.order_id
    )
  loop
    select id into t_id
    from public.notification_templates
    where event_type = new.event_type
      and role = r.recipient_type
      and (status is null or status = new.payload->>'new_status')
      and is_active = true
    limit 1;

    if t_id is null then
      continue;
    end if;

    insert into public.notification_outbox(
      event_id, event_type, recipient_type, recipient_id,
      template_id, payload, dedup_key
    )
    values (
      new.id,
      new.event_type,
      r.recipient_type,
      r.recipient_id,
      t_id,
      new.payload,
      format(
        'order:%s|event:%s|role:%s|status:%s',
        new.order_id,
        new.event_type,
        r.recipient_type,
        coalesce(new.payload->>'new_status','')
      )
    )
    on conflict (dedup_key) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_events_to_outbox on public.order_events;
create trigger trg_events_to_outbox
after insert on public.order_events
for each row
execute function public.trg_events_to_outbox();

-- ==========================================
-- LIMPIEZA DE TRIGGERS ANTIGUOS
-- ==========================================
-- (Ya manejado arriba con DROP FUNCTION explícitos)

-- ==========================================
-- RESTO DE FUNCIONES DE NEGOCIO (Mantenidas)
-- ==========================================

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
  if auth.uid() is null then
    raise exception 'No autorizado';
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
    and (assigned_to is null or assigned_to = auth.uid());

  if not found then
    raise exception 'No se pudo aceptar la orden. Puede que ya no esté disponible.' using errcode = 'P0002';
  end if;

  -- Insertar/actualizar trabajo activo también para 'accepted' para que aparezca en el panel
  begin
    insert into public.collaborator_active_jobs(collaborator_id, order_id)
    values (auth.uid(), p_order_id)
    on conflict (collaborator_id)
    do update set order_id = excluded.order_id, started_at = now();
  exception when others then
    perform 1;
  end;
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
drop policy if exists active_jobs_select on public.collaborator_active_jobs;
create policy active_jobs_select on public.collaborator_active_jobs for select using (
  collaborator_id = auth.uid() or public.is_owner(auth.uid()) or public.is_admin(auth.uid())
);
drop policy if exists active_jobs_insert on public.collaborator_active_jobs;
create policy active_jobs_insert on public.collaborator_active_jobs for insert with check (
  collaborator_id = auth.uid() or public.is_owner(auth.uid()) or public.is_admin(auth.uid())
);
drop policy if exists active_jobs_delete on public.collaborator_active_jobs;
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
create or replace function public.create_active_job_on_start()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.status <> 'in_progress' and new.status = 'in_progress' then
    insert into public.collaborator_active_jobs(collaborator_id, order_id)
    values (new.assigned_to, new.id)
    on conflict (collaborator_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_create_active_job on public.orders;
create trigger trg_create_active_job
after update of status on public.orders
for each row
execute function public.create_active_job_on_start();


-- Create collaborator_locations table for real-time tracking
CREATE TABLE IF NOT EXISTS public.collaborator_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid REFERENCES public.collaborators(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  speed double precision,
  heading double precision,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_collaborator_location UNIQUE (collaborator_id)
);

-- RLS Policies
ALTER TABLE public.collaborator_locations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid duplicate errors on re-run
DROP POLICY IF EXISTS "Collaborators can upsert their own location" ON public.collaborator_locations;
DROP POLICY IF EXISTS "Collaborators can update their own location" ON public.collaborator_locations;
DROP POLICY IF EXISTS "Authenticated users can view locations" ON public.collaborator_locations;

-- Collaborators can upsert their own location
CREATE POLICY "Collaborators can upsert their own location"
ON public.collaborator_locations
FOR INSERT
WITH CHECK (auth.uid() = collaborator_id);

CREATE POLICY "Collaborators can update their own location"
ON public.collaborator_locations
FOR UPDATE
USING (auth.uid() = collaborator_id);

-- Everyone (authenticated) can view locations (Adjust as needed for privacy)
CREATE POLICY "Authenticated users can view locations"
ON public.collaborator_locations
FOR SELECT
USING (auth.role() = 'authenticated');

-- 1. Create testimonials table
CREATE TABLE IF NOT EXISTS public.testimonials (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    created_at timestamptz DEFAULT now(),
    client_name text NOT NULL,
    comment text NOT NULL,
    stars int DEFAULT 5,
    is_public boolean DEFAULT true,
    display_order int DEFAULT 0,
    avatar_url text -- Optional, for future use
);

-- 2. Enable RLS
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;

-- 3. Create Policy for Public Read
DROP POLICY IF EXISTS "Public can view testimonials" ON public.testimonials;
CREATE POLICY "Public can view testimonials"
ON public.testimonials
FOR SELECT
USING (is_public = true);

-- 4. Grant access to anon and authenticated
GRANT SELECT ON public.testimonials TO anon, authenticated;

DROP FUNCTION IF EXISTS public.get_public_testimonials(int);
CREATE OR REPLACE FUNCTION public.get_public_testimonials(limit_count int DEFAULT 10)
RETURNS TABLE (
  order_id bigint,
  stars int,
  comment text,
  client_name text,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT
    o.id AS order_id,
    COALESCE((o.rating->>'service')::int, (o.rating->>'stars')::int, NULL) AS stars,
    NULLIF(o.customer_comment, '') AS comment,
    NULLIF(o.name, '') AS client_name,
    COALESCE(o.completed_at, o.created_at) AS created_at
  FROM public.orders o
  WHERE o.customer_comment IS NOT NULL
    AND TRIM(o.customer_comment) <> ''
    AND COALESCE((o.rating->>'stars')::int, (o.rating->>'service')::int, 0) >= 4
  ORDER BY o.completed_at DESC NULLS LAST, o.created_at DESC
  LIMIT GREATEST(1, limit_count);
$$;

GRANT EXECUTE ON FUNCTION public.get_public_testimonials(int) TO anon, authenticated;

-- Habilitar funciones críticas para asignación y transición de estado

-- 1) Normalizador de estado (depende de enum public.order_status que ya usa tu tabla orders)
DROP FUNCTION IF EXISTS public.normalize_order_status(text);
CREATE OR REPLACE FUNCTION public.normalize_order_status(in_status text)
RETURNS public.order_status
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE s text := trim(both from coalesce(in_status,''));
BEGIN
  IF s = '' THEN RETURN 'pending'; END IF;
  s := replace(lower(s), '_', ' ');
  IF s IN ('pendiente','pending') THEN RETURN 'pending'; END IF;
  IF s IN ('aceptada','aceptado','aceptar','accepted') THEN RETURN 'accepted'; END IF;
  IF s IN ('en curso','en progreso','en proceso','en transito','en tránsito','in_progress','en_camino_recoger','cargando','en_camino_entregar') THEN RETURN 'in_progress'; END IF;
  IF s IN ('completada','completado','finalizada','terminada','entregado','entregada','completed') THEN RETURN 'completed'; END IF;
  IF s IN ('cancelada','cancelado','anulada','cancelled') THEN RETURN 'cancelled'; END IF;
  RETURN 'pending';
END;
$$;

-- 2) RPC principal: actualizar estado de orden
CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id bigint,
  p_new_status text,
  p_collaborator_id uuid, -- Ignorado, usa auth.uid()
  p_tracking_entry jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE 
  v_updated jsonb;
  v_normalized public.order_status;
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING errcode = '42501';
  END IF;

  v_normalized := public.normalize_order_status(p_new_status);

  UPDATE public.orders o
  SET
    status = v_normalized,
    assigned_to = CASE WHEN v_normalized = 'pending' THEN NULL ELSE COALESCE(o.assigned_to, v_uid) END,
    assigned_at = CASE WHEN v_normalized = 'pending' THEN NULL WHEN v_normalized = 'accepted' AND o.assigned_at IS NULL THEN now() ELSE assigned_at END,
    completed_by = CASE WHEN v_normalized = 'completed' THEN v_uid ELSE completed_by END,
    completed_at = CASE WHEN v_normalized = 'completed' THEN now() ELSE completed_at END,
    tracking_data = CASE WHEN p_tracking_entry IS NOT NULL THEN COALESCE(o.tracking_data,'[]'::jsonb) || jsonb_build_array(p_tracking_entry) ELSE o.tracking_data END
  WHERE o.id = p_order_id
    AND (o.assigned_to = v_uid OR o.assigned_to IS NULL)
    AND o.status NOT IN ('cancelled','completed')
  RETURNING to_jsonb(o) INTO v_updated;

  IF v_normalized IN ('accepted','in_progress') THEN
    IF EXISTS (
      SELECT 1 FROM public.collaborator_active_jobs j 
      WHERE j.collaborator_id = v_uid
        AND j.order_id <> p_order_id
    ) THEN
      RAISE EXCEPTION 'Ya tienes otra orden activa' USING errcode = 'P0001';
    END IF;
    INSERT INTO public.collaborator_active_jobs(collaborator_id, order_id)
    VALUES (v_uid, p_order_id)
    ON CONFLICT (collaborator_id) DO UPDATE SET 
      order_id = excluded.order_id,
      started_at = CASE WHEN collaborator_active_jobs.order_id <> excluded.order_id THEN now() ELSE collaborator_active_jobs.started_at END;
  ELSIF v_normalized IN ('completed','cancelled') THEN
    DELETE FROM public.collaborator_active_jobs WHERE order_id = p_order_id;
  END IF;
  RETURN v_updated;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_order_status(bigint, text, uuid, jsonb) TO authenticated;

-- 3) RPC alternativo para aceptar (usado como fallback)
DROP FUNCTION IF EXISTS public.accept_order_with_price(bigint, numeric);
CREATE OR REPLACE FUNCTION public.accept_order_with_price(p_order_id bigint, p_price numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE _now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.assigned_to = auth.uid()
      AND o.status IN ('accepted','in_progress')
  ) THEN
    RAISE EXCEPTION 'Ya tienes una orden activa' USING errcode = 'P0001';
  END IF;

  UPDATE public.orders
  SET
    status = 'accepted'::public.order_status,
    accepted_at = COALESCE(accepted_at, _now),
    accepted_by = COALESCE(accepted_by, auth.uid()),
    assigned_to = COALESCE(assigned_to, auth.uid()),
    assigned_at = COALESCE(assigned_at, _now),
    estimated_price = COALESCE(p_price, estimated_price),
    tracking_data = COALESCE(tracking_data, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('status','accepted','date',_now,'description', CASE WHEN p_price IS NOT NULL THEN 'Orden aceptada con tarifa ajustada: ' || p_price ELSE 'Orden aceptada' END)
    )
  WHERE id = p_order_id
    AND status = 'pending'
    AND (assigned_to IS NULL OR assigned_to = auth.uid());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se pudo aceptar la orden. Puede que ya no esté disponible.' USING errcode = 'P0002';
  END IF;

  BEGIN
    INSERT INTO public.collaborator_active_jobs(collaborator_id, order_id)
    VALUES (auth.uid(), p_order_id)
    ON CONFLICT (collaborator_id)
    DO UPDATE SET order_id = excluded.order_id, started_at = now();
  EXCEPTION WHEN OTHERS THEN
    PERFORM 1;
  END;
END;
$$;
GRANT EXECUTE ON FUNCTION public.accept_order_with_price(bigint, numeric) TO authenticated;

-- 4) Tabla de trabajos activos (si no existe)
CREATE TABLE IF NOT EXISTS public.collaborator_active_jobs (
  collaborator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collaborator_id),
  UNIQUE(order_id)
);
CREATE INDEX IF NOT EXISTS idx_active_jobs_collab ON public.collaborator_active_jobs(collaborator_id);
CREATE INDEX IF NOT EXISTS idx_active_jobs_order ON public.collaborator_active_jobs(order_id);
ALTER TABLE public.collaborator_active_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS active_jobs_select ON public.collaborator_active_jobs;
CREATE POLICY active_jobs_select ON public.collaborator_active_jobs FOR SELECT USING (
  collaborator_id = auth.uid() OR public.is_owner(auth.uid()) OR public.is_admin(auth.uid())
);
DROP POLICY IF EXISTS active_jobs_insert ON public.collaborator_active_jobs;
CREATE POLICY active_jobs_insert ON public.collaborator_active_jobs FOR INSERT WITH CHECK (
  collaborator_id = auth.uid() OR public.is_owner(auth.uid()) OR public.is_admin(auth.uid())
);
DROP POLICY IF EXISTS active_jobs_delete ON public.collaborator_active_jobs;
CREATE POLICY active_jobs_delete ON public.collaborator_active_jobs FOR DELETE USING (
  collaborator_id = auth.uid() OR public.is_owner(auth.uid()) OR public.is_admin(auth.uid())
);
