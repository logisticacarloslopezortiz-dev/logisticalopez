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

-- 2) FUNCIONES UTILITARIAS GENERALES
-- touch_updated_at y set_updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- Programación automática cada minuto para invocar la Edge Function process-outbox
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'process_outbox_every_minute') then
    perform cron.schedule(
      'process_outbox_every_minute',
      '* * * * *',
      $cron$
      with cfg as (
        select
          coalesce(current_setting('app.settings.process_outbox_url', true), 'https://fkprllkxyjtosjhtikxy.functions.supabase.co/process-outbox') as url,
          coalesce(current_setting('app.settings.service_role_token', true), '') as token
      ),
      hdrs as (
        select case when cfg.token <> '' then
          jsonb_build_array(
            jsonb_build_object('name','Content-Type','value','application/json'),
            jsonb_build_object('name','Authorization','value','Bearer ' || cfg.token)
          )
        else
          jsonb_build_array(
            jsonb_build_object('name','Content-Type','value','application/json')
          ) end as headers
        from cfg
      )
      select net.http_post(
        url := (select url from cfg),
        headers := (select headers from hdrs),
        body := jsonb_build_object('health',0)
      );
      $cron$
    );
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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

-- Matriculas
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

-- Helpers de rol (definición después de crear tablas involucradas)
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
  select coalesce(
    (
      auth.uid() = uid
      and (
        (current_setting('request.jwt.claims', true)::json ->> 'role') = 'admin'
        or exists (
          select 1
          from json_array_elements_text(
            coalesce(
              current_setting('request.jwt.claims', true)::json -> 'app_metadata' -> 'roles',
              '[]'::json
            )
          ) as r(value)
          where r.value = 'admin'
        )
      )
    ),
    false
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
  status text not null default 'Pendiente',
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
  estimated_price text default 'Por confirmar',
  monto_cobrado numeric,
  metodo_pago text,
  tracking_data jsonb,
  tracking_url text,
  last_collab_status text,
  client_contact_id uuid,
  updated_at timestamptz not null default now(),
  constraint orders_status_check check (status in ('Pendiente','Aceptada','En curso','Completada','Cancelada'))
);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_date on public.orders("date");
create index if not exists idx_orders_assigned_to on public.orders(assigned_to);
create index if not exists idx_orders_client_id on public.orders(client_id);

-- [CORRECCIÓN] FK client_contact_id -> public.clients (descomentado y activado)
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
for each row execute function public.touch_updated_at();

-- Asegurar metadatos de completado
create or replace function public.ensure_completed_metadata()
returns trigger
language plpgsql set search_path = pg_catalog, public as $$
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
$$;

drop trigger if exists trg_orders_ensure_completed_metadata on public.orders;
create trigger trg_orders_ensure_completed_metadata
before update on public.orders
for each row when (old.status is distinct from new.status)
execute function public.ensure_completed_metadata();

-- Normalización de estado
create or replace function public.normalize_order_status(in_status text)
returns text
language plpgsql set search_path = pg_catalog, public as $$
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
returns trigger
language plpgsql set search_path = pg_catalog, public as $$
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

-- Extensión para notificaciones de clientes/contactos no autenticados
alter table public.notifications add column if not exists contact_id uuid references public.clients(id) on delete cascade;
create index if not exists idx_notifications_contact on public.notifications(contact_id);

-- Ajustes para comisiones y comentarios de clientes
alter table public.collaborators add column if not exists commission_percent numeric default 0.10;
alter table public.orders add column if not exists customer_comment text;

-- RPC: Datos del panel del colaborador (historial y comisiones)
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
    and lower(o.status) = 'completada'
    and (period_start is null or o."date" >= period_start)
    and (period_end is null or o."date" <= period_end)
  order by o."date" desc
$$;
grant execute on function public.get_collaborator_dashboard_data(uuid, date, date) to authenticated;

-- RPC: Enviar calificación del cliente (5 estrellas + comentario)
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
    and (lower(status) = 'completada' or completed_at is not null);
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
    and (lower(status) = 'completada' or completed_at is not null);
  return true;
end;
$$;
grant execute on function public.submit_rating_v2(bigint, int, int, text) to anon, authenticated;

-- RPC: Testimonios públicos para marketing
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
-- Asegurar índice único para ON CONFLICT, incluso si la tabla ya existía
create unique index if not exists uniq_push_subscriptions_user_endpoint
  on public.push_subscriptions(user_id, endpoint);

-- Extender para clientes anónimos
alter table public.push_subscriptions add column if not exists client_contact_id uuid references public.clients(id) on delete cascade; -- [CORRECCIÓN] Ahora funciona porque `clients` ya existe.
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

-- Backfill inicial idempotente
do $$ begin
  insert into public.push_subscriptions(user_id, endpoint, keys, created_at)
  select c.id,
         c.push_subscription->>'endpoint',
         coalesce(c.push_subscription->'keys','{}'::jsonb), now()
  from public.collaborators c
  where c.push_subscription is not null and (c.push_subscription->>'endpoint') is not null
  on conflict (user_id, endpoint) do update set keys = excluded.keys;
end $$;

-- RPC: crear orden con contacto cuando no hay auth.uid()
create or replace function public.create_order_with_contact(order_payload jsonb)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_client_id uuid := (select auth.uid());
  v_contact_id uuid;
  v_order public.orders;
begin
  if v_client_id is null then -- Usuario anónimo
    -- [CORRECCIÓN] Ya no se guarda la suscripción en la tabla `clients`.
    -- Se inserta el cliente y luego se maneja la suscripción por separado.
    insert into public.clients(name, phone, email)
    values (
      nullif(order_payload->>'name',''),
      nullif(order_payload->>'phone',''),
      nullif(order_payload->>'email','')
    ) returning id into v_contact_id;

    -- [NUEVO] Insertar la suscripción en la tabla `push_subscriptions` vinculada al cliente.
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
      coalesce(order_payload->>'status','Pendiente'),
      order_payload->>'estimated_price',
      order_payload->'tracking_data', v_contact_id
    ) returning * into v_order;
  else
    -- [CORRECCIÓN] Para usuarios autenticados, también guardar la suscripción en la tabla correcta.
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
      coalesce(order_payload->>'status','Pendiente'),
      order_payload->>'estimated_price',
      order_payload->'tracking_data',
      v_client_id
    ) returning * into v_order;
  end if;
  return v_order;
end;
$$;

grant execute on function public.create_order_with_contact(jsonb) to anon, authenticated;

-- 8) RPCs operativas
-- Aceptar orden
create or replace function public.accept_order(order_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare _now timestamptz := now();
begin
  update public.orders
  set
    status = 'En curso',
    accepted_at = coalesce(accepted_at, _now),
    accepted_by = coalesce(accepted_by, auth.uid()),
    assigned_to = coalesce(assigned_to, auth.uid()),
    assigned_at = coalesce(assigned_at, _now),
    tracking_data = coalesce(tracking_data, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('status','cargando','date',_now,'description','Orden aceptada, en proceso'))
  where id = order_id or short_id = order_id::text;
end;
$$;

grant execute on function public.accept_order(bigint) to authenticated; -- limitar a usuarios autenticados

-- Actualizar estado de orden
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
    and (
      -- permitir si está asignada al colaborador o aún sin asignar
      o.assigned_to = collaborator_id or o.assigned_to is null
    )
  returning to_jsonb(o) into updated;

  if updated is null then
    raise exception 'No autorizado o no encontrada' using errcode = '42501';
  end if;
  return updated;
end;
$$;

grant execute on function public.update_order_status(bigint, text, uuid, jsonb) to authenticated;

-- Modificar monto (solo admin/owner)
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

-- Invoices
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

alter table public.invoices add column if not exists recipient_email text;

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

-- Function logs (solo lectura admin/owner)
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

-- Limpieza de políticas previas (seguros si existen)
-- Vehicles/Services
drop policy if exists public_read_vehicles on public.vehicles;
drop policy if exists admin_all_access_vehicles on public.vehicles;
drop policy if exists public_read_services on public.services;
drop policy if exists admin_all_access_services on public.services;
-- Profiles
drop policy if exists public_read_profiles on public.profiles;
drop policy if exists users_update_own_profile on public.profiles;
drop policy if exists admin_manage_profiles on public.profiles;
-- Orders
drop policy if exists public_insert_pending_orders on public.orders;
drop policy if exists clients_view_own_orders on public.orders;
drop policy if exists public_read_pending_orders on public.orders;
drop policy if exists collaborator_all_on_own_orders on public.orders;
drop policy if exists orders_select_assigned_collab on public.orders;
drop policy if exists admin_all_orders on public.orders;
-- Collaborators
drop policy if exists collaborator_self_manage on public.collaborators;
drop policy if exists collaborator_self_select on public.collaborators;
drop policy if exists collaborator_self_update on public.collaborators;
drop policy if exists admin_manage_collaborators on public.collaborators;
-- Business
drop policy if exists owner_full_access_business on public.business;
-- Notifications
drop policy if exists user_manage_own_notifications on public.notifications;
drop policy if exists admin_manage_notifications on public.notifications;
-- Push
drop policy if exists user_manage_own_push_subscriptions on public.push_subscriptions;
drop policy if exists admin_read_push_subscriptions on public.push_subscriptions;
-- Receipts
drop policy if exists client_read_own_receipts on public.order_completion_receipts;
drop policy if exists collaborator_manage_assigned_receipts on public.order_completion_receipts;
drop policy if exists admin_manage_receipts on public.order_completion_receipts;
-- Invoices
drop policy if exists owner_admin_all_invoices on public.invoices;
drop policy if exists client_read_own_invoices on public.invoices;
-- function_logs
drop policy if exists function_logs_read_admin on public.function_logs;
-- clients
drop policy if exists clients_insert_any on public.clients;
drop policy if exists clients_select_any on public.clients;

-- Vehicles
create policy public_read_vehicles on public.vehicles for select using (true);
create policy admin_all_access_vehicles on public.vehicles
for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()))
with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Services
create policy public_read_services on public.services for select using (true);
create policy admin_all_access_services on public.services
for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()))
with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Profiles
create policy public_read_profiles on public.profiles for select using (true);
create policy users_update_own_profile on public.profiles for update using (auth.uid() = id);
create policy admin_manage_profiles on public.profiles
for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()))
with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Crear acta de completado automáticamente
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


-- Collaborators
-- Limpieza de políticas antiguas
drop policy if exists collaborator_self_manage on public.collaborators;
drop policy if exists admin_manage_collaborators on public.collaborators;
-- Regla #1: Un colaborador autenticado puede leer sus propios datos. (Soluciona el login del colaborador)
create policy "Allow collaborators to select their own record"
on public.collaborators for select
using ( auth.uid() = id );
-- Regla #2: Un administrador puede leer los datos de TODOS los colaboradores. (Soluciona el JOIN del historial)
create policy "Allow admins to select all collaborator records"
on public.collaborators for select
using ( public.is_admin(auth.uid()) );
-- Mantener permisos de escritura para administradores y para que un colaborador edite su perfil
create policy "Allow collaborators to update their own record" on public.collaborators
for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "Allow admins to manage collaborators" on public.collaborators
for insert, update, delete using (public.is_admin(auth.uid()) or public.is_owner(auth.uid()))
with check (public.is_admin(auth.uid()) or public.is_owner(auth.uid()));


-- Business y Business Settings
create policy owner_full_access_business on public.business
for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()))
with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Push Subscriptions
create policy user_manage_own_push_subscriptions on public.push_subscriptions
for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy admin_read_push_subscriptions on public.push_subscriptions
for select using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

create policy anon_insert_push_by_contact on public.push_subscriptions

for insert to anon, authenticated
with check (client_contact_id is not null);

-- Notifications
create policy user_manage_own_notifications on public.notifications
for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy admin_manage_notifications on public.notifications
for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()))
with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Receipts
create policy client_read_own_receipts on public.order_completion_receipts for select using (client_id = auth.uid());
create policy collaborator_manage_assigned_receipts on public.order_completion_receipts
for all using (exists (select 1 from public.orders o where o.id = order_id and o.assigned_to = auth.uid()))
with check (exists (select 1 from public.orders o where o.id = order_id and o.assigned_to = auth.uid()));
create policy admin_manage_receipts on public.order_completion_receipts
for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()))
with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Invoices
create policy owner_admin_all_invoices on public.invoices
for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()))
with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
create policy client_read_own_invoices on public.invoices for select using (client_id = auth.uid());

-- Function logs
create policy function_logs_read_admin on public.function_logs
for select using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Clients (pedidos anónimos permitidos)
create policy clients_insert_any on public.clients for insert to anon, authenticated with check (true);
create policy clients_select_any on public.clients for select to anon, authenticated using (true);

drop trigger if exists trg_orders_create_receipt_on_complete on public.orders;
create trigger trg_orders_create_receipt_on_complete
after update of status on public.orders
for each row execute function public.create_completion_receipt_on_order_complete();

-- Orders: RLS clave
-- Limpieza de políticas antiguas
drop policy if exists public_insert_pending_orders on public.orders;
drop policy if exists public_read_pending_orders on public.orders;
drop policy if exists collaborator_all_on_own_orders on public.orders;
drop policy if exists admin_all_orders on public.orders;
-- Regla #1: Clientes/público pueden crear órdenes en estado 'Pendiente'.
create policy "Allow public to insert pending orders" on public.orders
for insert with check (
  status = 'Pendiente' and assigned_to is null
);
-- Regla #2: Un colaborador puede ver las órdenes que tiene asignadas Y las que están pendientes de asignar.
create policy "Allow collaborators to select assigned or pending orders"
on public.orders for select
using (
  (assigned_to = auth.uid() and status <> 'Cancelada') OR (status = 'Pendiente')
);
-- Regla #3: Un colaborador puede actualizar las órdenes que tiene asignadas.
create policy "Allow collaborators to update their assigned orders" on public.orders
for update using (
  assigned_to = auth.uid()
) with check (
  assigned_to = auth.uid()
);
-- Regla #4: Un administrador puede leer TODAS las órdenes sin restricción. (Soluciona la carga de datos del historial)
create policy "Allow admins to select all orders"
on public.orders for select
using ( public.is_admin(auth.uid()) );
-- Regla #5: Los administradores tienen acceso total para gestionar (actualizar/borrar) todas las órdenes.
create policy "Allow admins to manage all orders" on public.orders
for update, delete using (
  public.is_admin(auth.uid()) or public.is_owner(auth.uid())
);

-- 10) MÉTRICAS DE COLABORADOR
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
language plpgsql security definer set search_path = public as $$
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
    p_rating,
    p_completion_minutes,
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
      else coalesce((public.collaborator_performance.avg_rating + p_rating) / 2.0, p_rating)
    end,
    avg_completion_minutes = case
      when p_completion_minutes is null then public.collaborator_performance.avg_completion_minutes
      else coalesce((public.collaborator_performance.avg_completion_minutes + p_completion_minutes) / 2.0, p_completion_minutes)
    end,
    updated_at = now();
end;$$;

create or replace function public.track_order_metrics()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_collab uuid;
  v_when date := current_date;
  v_amount numeric := null;
  v_rating numeric := null;
  v_minutes numeric := null;
begin
  v_collab := coalesce(new.assigned_to, old.assigned_to);
  if v_collab is null then return new; end if;

  if new.status = 'Completada' and new.completed_at is not null then
    v_minutes := extract(epoch from (new.completed_at - coalesce(new.assigned_at, new.created_at))) / 60.0;
    v_rating := coalesce((new.rating->>'stars')::numeric, null);
    v_amount := new.monto_cobrado;
  end if;

  if tg_op = 'INSERT' then
    -- sin incrementos al crear en 'Pendiente'
    return new;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      if new.status = 'Aceptada' then
        perform public.upsert_collaborator_metric_fixed(v_collab, v_when, 1, 0, 0, 0, null, null, null);
      elsif new.status = 'En curso' then
        perform public.upsert_collaborator_metric_fixed(v_collab, v_when, 0, 1, 0, 0, null, null, null);
      elsif new.status = 'Completada' then
        perform public.upsert_collaborator_metric_fixed(v_collab, v_when, 0, 0, 1, 0, v_amount, v_rating, v_minutes);
      elsif new.status = 'Cancelada' then
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

-- Trigger para crear acta de completado


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

-- 11) SEEDS BÁSICOS
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
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  PERFORM 1;
END $$;

-- [MODIFICADO] Función para notificar la creación de una orden (a Clientes y Admins)
CREATE OR REPLACE FUNCTION public.notify_order_creation()
RETURNS trigger AS $$
DECLARE
  client_payload jsonb;
  admin_payload jsonb;
BEGIN
  -- 1. Payload para el Cliente
  IF NEW.client_id IS NOT NULL THEN
    client_payload := jsonb_build_object('userId', NEW.client_id, 'orderId', NEW.id, 'title', '✅ Solicitud Recibida', 'body', 'Hemos recibido tu solicitud #' || NEW.short_id || '. Pronto será revisada.');
  ELSIF NEW.client_contact_id IS NOT NULL THEN
    client_payload := jsonb_build_object('contactId', NEW.client_contact_id, 'orderId', NEW.id, 'title', '✅ Solicitud Recibida', 'body', 'Hemos recibido tu solicitud #' || NEW.short_id || '. Pronto será revisada.');
  ELSE
    client_payload := null;
  END IF;

  -- 2. Payload para el Administrador
  admin_payload := jsonb_build_object(
    'role', 'administrador',
    'orderId', NEW.id,
    'title', '📢 Nueva Solicitud Recibida',
    'body', 'Se ha creado la solicitud #' || NEW.short_id || ' por ' || coalesce(NEW.name, 'No especificado') || '.',
    'data', jsonb_build_object('url', 'https://logisticalopezortiz.com/inicio.html?orderId=' || coalesce(NEW.short_id::text, NEW.id::text))
  );
  IF client_payload IS NOT NULL THEN
    IF NEW.client_id IS NOT NULL THEN
      INSERT INTO public.notification_outbox(order_id, new_status, target_role, target_user_id, payload)
      VALUES (NEW.id, NEW.status, 'cliente', NEW.client_id, client_payload);
    ELSIF NEW.client_contact_id IS NOT NULL THEN
      INSERT INTO public.notification_outbox(order_id, new_status, target_role, target_contact_id, payload)
      VALUES (NEW.id, NEW.status, 'cliente', NEW.client_contact_id, client_payload);
    END IF;
  END IF;

  IF admin_payload IS NOT NULL THEN
    INSERT INTO public.notification_outbox(order_id, new_status, target_role, payload)
    VALUES (NEW.id, NEW.status, 'administrador', admin_payload);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_orders_notify_status ON public.orders;

-- [NUEVO] Trigger para notificar al crear una orden
DROP TRIGGER IF EXISTS trg_orders_notify_creation ON public.orders;
CREATE TRIGGER trg_orders_notify_creation
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_order_creation();

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id bigint generated by default as identity primary key,
  order_id bigint not null,
  new_status text not null,
  target_role text,
  target_user_id uuid,
  payload jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

ALTER TABLE public.notification_outbox
ADD COLUMN IF NOT EXISTS target_contact_id uuid;

-- Reintentos y error último para process-outbox
ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS attempts integer default 0;
ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS last_error text;



CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_idx ON public.notifications (
  user_id, title, body, ((data->>'orderId'))
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_contact_idx ON public.notifications (
  contact_id, title, body, ((data->>'orderId'))
);

CREATE INDEX IF NOT EXISTS notification_outbox_processed_created_idx ON public.notification_outbox (processed_at, created_at);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON public.notifications (user_id, created_at);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx ON public.notification_outbox (created_at) WHERE processed_at IS NULL;

create or replace view public.notification_outbox_pending as
select id, order_id, new_status, target_role, target_user_id, target_contact_id, created_at, processed_at
from public.notification_outbox
where processed_at is null
order by created_at asc;

create or replace view public.function_logs_process_outbox_recent as
select *
from public.function_logs
where fn_name = 'process-outbox'
order by created_at desc
limit 100;

-- (definiciones anteriores de notify_evidence_upload y notify_alert_update removidas; se usan las versiones posteriores corregidas)

DROP TRIGGER IF EXISTS trg_notify_price_update ON public.orders;
CREATE TRIGGER trg_notify_price_update
AFTER UPDATE OF estimated_price ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_price_update();

DROP TRIGGER IF EXISTS trg_notify_amount_update ON public.orders;
CREATE TRIGGER trg_notify_amount_update
AFTER UPDATE OF monto_cobrado ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_amount_update();

DROP TRIGGER IF EXISTS trg_notify_evidence_upload ON public.orders;
CREATE TRIGGER trg_notify_evidence_upload
AFTER UPDATE OF evidence_photos ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_evidence_upload();

DROP TRIGGER IF EXISTS trg_notify_alert_update ON public.orders;
CREATE TRIGGER trg_notify_alert_update
AFTER UPDATE OF last_collab_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_alert_update();

CREATE OR REPLACE FUNCTION public.get_order_details_public(identifier text)
RETURNS jsonb AS $$
DECLARE
  o RECORD;
  res jsonb;
BEGIN
  o := NULL;

  IF identifier ~ '^[0-9]+$' THEN
    SELECT o2.*, s.name AS service_name, v.name AS vehicle_name INTO o
    FROM public.orders o2
    LEFT JOIN public.services s ON s.id = o2.service_id
    LEFT JOIN public.vehicles v ON v.id = o2.vehicle_id
    WHERE o2.id = identifier::bigint
    LIMIT 1;
  ELSIF identifier ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT o2.*, s.name AS service_name, v.name AS vehicle_name INTO o
    FROM public.orders o2
    LEFT JOIN public.services s ON s.id = o2.service_id
    LEFT JOIN public.vehicles v ON v.id = o2.vehicle_id
    WHERE o2.id::text = identifier
    LIMIT 1;
  ELSE
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'short_id'
    ) THEN
      SELECT o2.*, s.name AS service_name, v.name AS vehicle_name INTO o
      FROM public.orders o2
      LEFT JOIN public.services s ON s.id = o2.service_id
      LEFT JOIN public.vehicles v ON v.id = o2.vehicle_id
      WHERE o2.short_id = identifier
      LIMIT 1;
    END IF;
    IF o IS NULL AND identifier ~ '^[0-9a-f]{32}$' THEN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'client_tracking_id'
      ) THEN
        SELECT o2.*, s.name AS service_name, v.name AS vehicle_name INTO o
        FROM public.orders o2
        LEFT JOIN public.services s ON s.id = o2.service_id
        LEFT JOIN public.vehicles v ON v.id = o2.vehicle_id
        WHERE o2.client_tracking_id = identifier
        LIMIT 1;
      END IF;
    END IF;
  END IF;

  IF o IS NULL THEN
    RETURN NULL;
  END IF;

  IF auth.uid() IS NULL THEN
    IF o.created_at < now() - interval '30 days' THEN
      RETURN NULL;
    END IF;
  END IF;

  res := jsonb_build_object(
    'id', o.id,
    'short_id', o.short_id,
    'created_at', o.created_at,
    'status', o.status,
    'name', o.name,
    'phone', o.phone,
    'email', o.email,
    'pickup', o.pickup,
    'delivery', o.delivery,
    'tracking_data', o.tracking_data,
    'estimated_price', o.estimated_price,
    'monto_cobrado', o.monto_cobrado,
    'service', jsonb_build_object('name', o.service_name),
    'vehicle', jsonb_build_object('name', o.vehicle_name)
  );

  RETURN res;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;



GRANT EXECUTE ON FUNCTION public.get_order_details_public(text) TO anon, authenticated;
-- Notificar al colaborador cuando se le asigna una orden
create or replace function public.notify_assigned_collaborator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.assigned_to is not null and (OLD.assigned_to is distinct from NEW.assigned_to) then
    insert into public.notification_outbox(order_id, new_status, target_user_id, payload)
    values (
      NEW.id,
      'Asignada',
      NEW.assigned_to,
      jsonb_build_object(
        'title','🛠️ Orden asignada',
        'body','Se te asignó la orden #' || coalesce(NEW.short_id::text, NEW.id::text),
        'data', jsonb_build_object('url','https://logisticalopezortiz.com/panel-colaborador.html?orderId=' || coalesce(NEW.short_id::text, NEW.id::text))
      )
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_notify_assigned_collaborator on public.orders;
create trigger trg_notify_assigned_collaborator
after update of assigned_to on public.orders
for each row
execute function public.notify_assigned_collaborator();

-- ==== PATCH: Redefiniciones para llenar correctamente target_user_id / target_contact_id ====

CREATE OR REPLACE FUNCTION public.notify_order_status_change()
RETURNS trigger AS $$
DECLARE
  client_payload jsonb;
  admin_payload jsonb;
BEGIN
  IF (OLD.status IS DISTINCT FROM NEW.status) THEN
    -- Cliente (usuario autenticado o contacto anónimo)
    IF NEW.client_id IS NOT NULL THEN
      client_payload := jsonb_build_object('userId', NEW.client_id, 'orderId', NEW.id, 'title', 'Tu orden ha sido actualizada', 'body', 'El estado de tu orden #' || NEW.short_id || ' ahora es: ' || NEW.status);
    ELSIF NEW.client_contact_id IS NOT NULL THEN
      client_payload := jsonb_build_object('contactId', NEW.client_contact_id, 'orderId', NEW.id, 'title', 'Tu orden ha sido actualizada', 'body', 'El estado de tu orden #' || NEW.short_id || ' ahora es: ' || NEW.status);
    ELSE
      client_payload := null;
    END IF;
    IF client_payload IS NOT NULL THEN
      IF NEW.client_id IS NOT NULL THEN
        INSERT INTO public.notification_outbox(order_id, new_status, target_role, target_user_id, payload)
        VALUES (NEW.id, NEW.status, 'cliente', NEW.client_id, client_payload);
      ELSIF NEW.client_contact_id IS NOT NULL THEN
        INSERT INTO public.notification_outbox(order_id, new_status, target_role, target_contact_id, payload)
        VALUES (NEW.id, NEW.status, 'cliente', NEW.client_contact_id, client_payload);
      END IF;
    END IF;

    -- Administrador
    admin_payload := jsonb_build_object(
      'role', 'administrador',
      'orderId', NEW.id,
      'title', 'Estado de orden actualizado',
      'body', 'La orden #' || NEW.short_id || ' cambió a: ' || NEW.status,
      'data', jsonb_build_object('url', 'https://logisticalopezortiz.com/inicio.html?orderId=' || coalesce(NEW.short_id::text, NEW.id::text))
    );
    INSERT INTO public.notification_outbox(order_id, new_status, target_role, payload)
    VALUES (NEW.id, NEW.status, 'administrador', admin_payload);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

CREATE TRIGGER trg_orders_notify_status
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_order_status_change();

CREATE OR REPLACE FUNCTION public.notify_price_update()
RETURNS trigger AS $$
DECLARE
  client_payload jsonb;
  admin_payload jsonb;
BEGIN
  IF (OLD.estimated_price IS DISTINCT FROM NEW.estimated_price) THEN
    IF NEW.client_id IS NOT NULL THEN
      client_payload := jsonb_build_object('userId', NEW.client_id, 'orderId', NEW.id, 'title', 'Precio estimado actualizado', 'body', 'El precio estimado de tu orden fue actualizado.');
    ELSIF NEW.client_contact_id IS NOT NULL THEN
      client_payload := jsonb_build_object('contactId', NEW.client_contact_id, 'orderId', NEW.id, 'title', 'Precio estimado actualizado', 'body', 'El precio estimado de tu orden fue actualizado.');
    END IF;
    IF client_payload IS NOT NULL THEN
      IF NEW.client_id IS NOT NULL THEN
        INSERT INTO public.notification_outbox(order_id, new_status, target_role, target_user_id, payload)
        VALUES (NEW.id, NEW.status, 'cliente', NEW.client_id, client_payload);
      ELSIF NEW.client_contact_id IS NOT NULL THEN
        INSERT INTO public.notification_outbox(order_id, new_status, target_role, target_contact_id, payload)
        VALUES (NEW.id, NEW.status, 'cliente', NEW.client_contact_id, client_payload);
      END IF;
    END IF;
    admin_payload := jsonb_build_object('role','administrador','orderId',NEW.id,'title','Precio estimado actualizado','body','La orden #' || COALESCE(NEW.short_id::text, NEW.id::text) || ' actualizó su precio estimado.');
    INSERT INTO public.notification_outbox(order_id, new_status, target_role, payload)
    VALUES (NEW.id, NEW.status, 'administrador', admin_payload);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.notify_amount_update()
RETURNS trigger AS $$
DECLARE
  client_payload jsonb;
  admin_payload jsonb;
BEGIN
  IF (OLD.monto_cobrado IS DISTINCT FROM NEW.monto_cobrado) THEN
    IF NEW.client_id IS NOT NULL THEN
      client_payload := jsonb_build_object('userId', NEW.client_id, 'orderId', NEW.id, 'title', 'Monto actualizado', 'body', 'El monto cobrado de tu orden fue actualizado.');
    ELSIF NEW.client_contact_id IS NOT NULL THEN
      client_payload := jsonb_build_object('contactId', NEW.client_contact_id, 'orderId', NEW.id, 'title', 'Monto actualizado', 'body', 'El monto cobrado de tu orden fue actualizado.');
    END IF;
    IF client_payload IS NOT NULL THEN
      IF NEW.client_id IS NOT NULL THEN
        INSERT INTO public.notification_outbox(order_id, new_status, target_role, target_user_id, payload)
        VALUES (NEW.id, NEW.status, 'cliente', NEW.client_id, client_payload);
      ELSIF NEW.client_contact_id IS NOT NULL THEN
        INSERT INTO public.notification_outbox(order_id, new_status, target_role, target_contact_id, payload)
        VALUES (NEW.id, NEW.status, 'cliente', NEW.client_contact_id, client_payload);
      END IF;
    END IF;
    admin_payload := jsonb_build_object('role','administrador','orderId',NEW.id,'title','Monto actualizado','body','La orden #' || COALESCE(NEW.short_id::text, NEW.id::text) || ' actualizó su monto cobrado.');
    INSERT INTO public.notification_outbox(order_id, new_status, target_role, payload)
    VALUES (NEW.id, NEW.status, 'administrador', admin_payload);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.notify_evidence_upload()
RETURNS trigger AS $$
DECLARE
  client_payload jsonb;
  admin_payload jsonb;
BEGIN
  IF (OLD.evidence_photos IS DISTINCT FROM NEW.evidence_photos AND NEW.evidence_photos IS NOT NULL) THEN
    IF NEW.client_id IS NOT NULL THEN
      client_payload := jsonb_build_object('userId', NEW.client_id, 'orderId', NEW.id, 'title', 'Nueva evidencia subida', 'body', 'Se ha subido evidencia a tu orden.');
    ELSIF NEW.client_contact_id IS NOT NULL THEN
      client_payload := jsonb_build_object('contactId', NEW.client_contact_id, 'orderId', NEW.id, 'title', 'Nueva evidencia subida', 'body', 'Se ha subido evidencia a tu orden.');
    END IF;
    IF client_payload IS NOT NULL THEN
      IF NEW.client_id IS NOT NULL THEN
        INSERT INTO public.notification_outbox(order_id, new_status, target_role, target_user_id, payload)
        VALUES (NEW.id, NEW.status, 'cliente', NEW.client_id, client_payload);
      ELSIF NEW.client_contact_id IS NOT NULL THEN
        INSERT INTO public.notification_outbox(order_id, new_status, target_role, target_contact_id, payload)
        VALUES (NEW.id, NEW.status, 'cliente', NEW.client_contact_id, client_payload);
      END IF;
    END IF;
    admin_payload := jsonb_build_object('role','administrador','orderId',NEW.id,'title','Nueva evidencia subida','body','La orden #' || COALESCE(NEW.short_id::text, NEW.id::text) || ' tiene nueva evidencia.');
    INSERT INTO public.notification_outbox(order_id, new_status, target_role, payload)
    VALUES (NEW.id, NEW.status, 'administrador', admin_payload);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.notify_alert_update()
RETURNS trigger AS $$
DECLARE
  client_payload jsonb;
  admin_payload jsonb;
BEGIN
  IF (OLD.last_collab_status IS DISTINCT FROM NEW.last_collab_status AND NEW.last_collab_status IS NOT NULL) THEN
    IF NEW.client_id IS NOT NULL THEN
      client_payload := jsonb_build_object('userId', NEW.client_id, 'orderId', NEW.id, 'title', 'Aviso de la orden', 'body', NEW.last_collab_status);
    ELSIF NEW.client_contact_id IS NOT NULL THEN
      client_payload := jsonb_build_object('contactId', NEW.client_contact_id, 'orderId', NEW.id, 'title', 'Aviso de la orden', 'body', NEW.last_collab_status);
    END IF;
    IF client_payload IS NOT NULL THEN
      IF NEW.client_id IS NOT NULL THEN
        INSERT INTO public.notification_outbox(order_id, new_status, target_role, target_user_id, payload)
        VALUES (NEW.id, NEW.status, 'cliente', NEW.client_id, client_payload);
      ELSIF NEW.client_contact_id IS NOT NULL THEN
        INSERT INTO public.notification_outbox(order_id, new_status, target_role, target_contact_id, payload)
        VALUES (NEW.id, NEW.status, 'cliente', NEW.client_contact_id, client_payload);
      END IF;
    END IF;
    admin_payload := jsonb_build_object('role','administrador','orderId',NEW.id,'title','Aviso importante','body','La orden #' || COALESCE(NEW.short_id::text, NEW.id::text) || ': ' || NEW.last_collab_status);
    INSERT INTO public.notification_outbox(order_id, new_status, target_role, payload)
    VALUES (NEW.id, NEW.status, 'administrador', admin_payload);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

-- Invocador opcional para Edge Function process-outbox mediante pg_net
drop function if exists public.invoke_process_outbox();
create or replace function public.invoke_process_outbox()
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare resp jsonb;
declare v_url text := coalesce(current_setting('app.settings.process_outbox_url', true), 'https://fkprllkxyjtosjhtikxy.functions.supabase.co/process-outbox');
declare v_token text := coalesce(current_setting('app.settings.service_role_token', true), '');
declare v_headers jsonb := case when v_token <> '' then jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_token) else jsonb_build_object('Content-Type','application/json') end;
begin
  begin
    select net.http_post(
      url := v_url,
      headers := v_headers,
      body := '{}'::jsonb
    ) into resp;
  exception when others then
    resp := jsonb_build_object('error', SQLERRM);
  end;
  begin
    insert into public.function_logs(fn_name, level, message, payload)
    values ('invoke_process_outbox', 'info', 'invoked', resp);
  exception when others then null;
  end;
  return resp;
end;
$$;
-- RPC: métricas del colaborador
CREATE OR REPLACE FUNCTION public.get_collaborator_metrics(collaborator_id uuid)
RETURNS TABLE(
  assigned integer,
  completed integer,
  avg_hours numeric,
  month_earnings numeric,
  total_earnings numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH mine AS (
  SELECT o.* FROM public.orders o WHERE o.assigned_to = collaborator_id
),
assigned_ct AS (
  SELECT count(*) AS c FROM mine WHERE lower(coalesce(status,'')) NOT IN ('completada','cancelada')
),
completed_ct AS (
  SELECT count(*) AS c FROM mine WHERE lower(coalesce(status,'')) = 'completada'
),
dur AS (
  SELECT avg(EXTRACT(EPOCH FROM (o.completed_at - o.accepted_at)) / 3600.0) AS avg_h
  FROM mine o WHERE o.accepted_at IS NOT NULL AND o.completed_at IS NOT NULL AND o.completed_at > o.accepted_at
),
commission_pct AS (
  SELECT coalesce(c.commission_percent,0)::numeric AS pct FROM public.collaborators c WHERE c.id = collaborator_id
),
earn AS (
  SELECT
    sum( coalesce(o.monto_cobrado,0)::numeric * ((SELECT pct FROM commission_pct) / 100.0) ) AS total,
    sum( CASE WHEN o.completed_at >= date_trunc('month', now()) THEN coalesce(o.monto_cobrado,0)::numeric * ((SELECT pct FROM commission_pct) / 100.0) ELSE 0 END ) AS month
  FROM mine o WHERE lower(coalesce(o.status,'')) = 'completada'
)
SELECT
  (SELECT c FROM assigned_ct) AS assigned,
  (SELECT c FROM completed_ct) AS completed,
  coalesce((SELECT avg_h FROM dur), 0) AS avg_hours,
  coalesce((SELECT month FROM earn), 0) AS month_earnings,
  coalesce((SELECT total FROM earn), 0) AS total_earnings;
$$;

-- Tabla: calificaciones
CREATE TABLE IF NOT EXISTS public.calificaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  collaborator_id uuid,
  calificacion_servicio integer CHECK (calificacion_servicio BETWEEN 1 AND 5),
  calificacion_colaborador integer CHECK (calificacion_colaborador BETWEEN 1 AND 5),
  comentario text,
  fecha_creacion timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.calificaciones ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='calificaciones' AND policyname='calificaciones_select_own'
  ) THEN
    CREATE POLICY calificaciones_select_own ON public.calificaciones
      FOR SELECT
      USING ( collaborator_id = auth.uid() );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='calificaciones' AND policyname='calificaciones_insert_any'
  ) THEN
    CREATE POLICY calificaciones_insert_any ON public.calificaciones
      FOR INSERT
      WITH CHECK ( true );
  END IF;
END $$;
select pg_notify('pgrst', 'reload schema');
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='collaborators' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.collaborators', pol.policyname);
  END LOOP;
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='orders' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.orders', pol.policyname);
  END LOOP;
END $$;
alter table if exists public.collaborators enable row level security;
alter table if exists public.orders enable row level security;
create policy collab_self_select on public.collaborators
  for select to authenticated
  using (
    auth.uid() = id
    or lower(coalesce(email,'')) = lower(coalesce(current_setting('request.jwt.claims', true)::json ->> 'email',''))
  );
create policy admin_select_all_collaborators on public.collaborators for select to authenticated using (coalesce(public.is_admin(auth.uid()), false));
create policy collaborator_select_assigned_or_pending on public.orders for select to authenticated using ((assigned_to = auth.uid()) OR assigned_to IS NULL);
create policy admin_select_all_orders on public.orders for select to authenticated using (coalesce(public.is_admin(auth.uid()), false));
