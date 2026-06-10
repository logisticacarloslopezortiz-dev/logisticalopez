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
          matricula text,
          status text not null default 'activo',
          role text not null default 'colaborador' check (lower(role) in ('administrador','colaborador')),
          notes text,
          commission_percent numeric default 0.10,
          can_take_orders boolean default false,
          puede_ver_todas_las_ordenes boolean default false,
          is_online boolean default false,
          last_seen_at timestamptz default now(),
          updated_at timestamptz not null default now()
        );

        -- Asegurar columnas para compatibilidad con versiones previas
        alter table public.collaborators add column if not exists is_online boolean default false;
        alter table public.collaborators add column if not exists last_seen_at timestamptz default now();
        alter table public.collaborators add column if not exists puede_ver_todas_las_ordenes boolean default false;
        alter table public.collaborators add column if not exists can_take_orders boolean default false;

        create index if not exists idx_collaborators_status on public.collaborators(status);
        create index if not exists idx_collaborators_role on public.collaborators(role);
        create index if not exists idx_collaborators_can_take on public.collaborators(can_take_orders);
        create index if not exists idx_collaborators_is_online on public.collaborators(is_online);

        drop trigger if exists trg_collaborators_touch_updated on public.collaborators;
        create trigger trg_collaborators_touch_updated
        before update on public.collaborators
        for each row execute function public.set_updated_at();

        -- Sincronizar colaborador -> profile (Ya no es necesario si quitamos campos duplicados)
        -- Eliminado: public.sync_profile_name

        -- Tabla de Matriculas
        create table if not exists public.matriculas (
          id bigserial primary key,
          user_id uuid references auth.users(id) on delete cascade,
          matricula text not null unique,
          status text default 'activo',
          created_at timestamptz default now()
        );

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
          id uuid primary key default gen_random_uuid(),
          business_name text,
          address text,
          phone text,
          email text,
          rnc text,
          quotation_rates jsonb,
          owner_user_id uuid references public.profiles(id) on delete set null,
          vapid_public_key text,
          push_vapid_key text,
          feature_flags jsonb default '{}',
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint business_rnc_check check (rnc ~ '^\d{3}-\d{5}-\d{1}$' or rnc is null)
        );
        create index if not exists idx_business_owner on public.business(owner_user_id);

        insert into public.business (business_name) values ('Mi Negocio');

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

        -- 4.1) Tablas de Auditoría y Pagos (Super Admin)
        create table if not exists public.audit_logs (
          id bigserial primary key,
          action text not null,
          detail text,
          user_id uuid,
          user_email text,
          ip_address text,
          created_at timestamptz default now()
        );

        create table if not exists public.fee_payments (
          id bigserial primary key,
          period text,
          amount numeric(12,2),
          status text default 'pending_review',
          created_at timestamptz default now()
        );

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
          created_by uuid references public.profiles(id) on delete set null,
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
          customer_comment text,
          onesignal_id text,
          onesignal_player_id text,
          last_ui_status text,
          driver_name_snapshot text -- ✅ Snapshot del nombre del chofer para historial
        );

        -- Asegurar columnas para compatibilidad con versiones previas
        alter table public.orders add column if not exists created_by uuid references public.profiles(id) on delete set null;
        alter table public.orders add column if not exists last_ui_status text;
        alter table public.orders add column if not exists driver_name_snapshot text;

        -- Índices Orders
        create index if not exists idx_orders_status on public.orders(status);
        create index if not exists idx_orders_status_btree on public.orders using btree (status);
        create index if not exists idx_orders_dashboard_status_date on public.orders (status, created_at desc);
        create index if not exists idx_orders_date on public.orders("date");
        create index if not exists idx_orders_short_id on public.orders(short_id);
        create index if not exists idx_orders_short_id_upper on public.orders(upper(short_id));
        create index if not exists idx_orders_assigned_to on public.orders(assigned_to);
        create index if not exists idx_orders_client_id on public.orders(client_id);
        create index if not exists idx_orders_created_at on public.orders(created_at);
        create index if not exists idx_orders_completed_at on public.orders(completed_at);
        create index if not exists idx_orders_status_assigned_to on public.orders(status, assigned_to);
        create index if not exists idx_orders_status_created_at on public.orders(status, created_at);

        -- ── Auto-asignación de created_by al crear una orden ─────────────────────
        -- Si el usuario está autenticado al crear la orden, se registra como autor fijo.
        -- Este campo nunca cambia aunque assigned_to se actualice al aceptar la orden.
        create or replace function public.set_order_created_by()
        returns trigger
        language plpgsql
        security definer
        set search_path = pg_catalog, public
        as $$
        begin
          if new.created_by is null and auth.uid() is not null then
            new.created_by := auth.uid();
          end if;
          return new;
        end;
        $$;

        drop trigger if exists trg_orders_set_created_by on public.orders;
        create trigger trg_orders_set_created_by
        before insert on public.orders
        for each row execute function public.set_order_created_by();

        -- Columna created_by: quién registró la orden (fijo, no cambia al ser tomada)
        alter table public.orders add column if not exists created_by uuid references public.profiles(id) on delete set null;
        create index if not exists idx_orders_created_by on public.orders(created_by);

        -- Proteger created_by contra sobreescritura después del INSERT
        create or replace function public.protect_order_created_by()
        returns trigger
        language plpgsql
        security definer
        set search_path = pg_catalog, public
        as $$
        begin
          -- Si ya tiene un valor, no permitir cambios (ni siquiera a NULL)
          if old.created_by is not null and new.created_by is distinct from old.created_by then
            new.created_by := old.created_by;
          end if;
          return new;
        end;
        $$;

        drop trigger if exists trg_orders_protect_created_by on public.orders;
        create trigger trg_orders_protect_created_by
        before update on public.orders
        for each row execute function public.protect_order_created_by();

        -- ── Prevención de doble toma (concurrencia) ───────────────────────────────
        -- RPC atómica: acepta la orden solo si assigned_to IS NULL (previene race condition)
        create or replace function public.accept_order_atomic(
          p_order_id bigint,
          p_collaborator_id uuid
        )
        returns jsonb
        language plpgsql
        security definer
        set search_path = pg_catalog, public
        as $$
        declare
          v_updated int;
          v_driver_name text;
          v_last_seen timestamptz;
        begin
          -- 1. Validar disponibilidad del colaborador (last_seen < 10 min)
          select last_seen_at into v_last_seen 
          from public.collaborators 
          where id = p_collaborator_id;

          if v_last_seen is null or v_last_seen < (now() - interval '10 minutes') then
            return jsonb_build_object(
              'success', false,
              'error',   'Tu ubicación no está actualizada. Abre la app para reconectar.'
            );
          end if;

          -- 2. Obtener nombre para el snapshot
          select full_name into v_driver_name from public.profiles where id = p_collaborator_id;

          update public.orders
          set
            status      = 'accepted',
            assigned_to = p_collaborator_id,
            assigned_at = now(),
            driver_name_snapshot = v_driver_name, -- ✅ Snapshot
            updated_at  = now()
          where id          = p_order_id
            and status      = 'pending'
            and assigned_to is null;

          get diagnostics v_updated = row_count;

          if v_updated = 0 then
            return jsonb_build_object(
              'success', false,
              'error',   'Esta orden ya fue tomada por otro colaborador o ya no está disponible'
            );
          end if;

          return jsonb_build_object('success', true);
        end;
        $$;

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
                client_contact_id,
                created_by, -- ✅ Agregado para trazabilidad
                onesignal_id, onesignal_player_id
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
                order_payload->'tracking_data', v_contact_id,
                v_client_id, -- auth.uid()
                nullif(order_payload->>'onesignal_id',''),
                nullif(order_payload->>'onesignal_player_id','')
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
                client_id,
                created_by, -- ✅ Agregado para trazabilidad
                onesignal_id, onesignal_player_id
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
                v_client_id,
                v_client_id, -- auth.uid()
                nullif(order_payload->>'onesignal_id',''),
                nullif(order_payload->>'onesignal_player_id','')
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
          v_driver_name text;
          v_dest jsonb;
          v_curr_loc record;
        begin
          if auth.uid() is null then raise exception 'No autorizado'; end if;
          v_uid := auth.uid();
          v_normalized := public.normalize_order_status(p_new_status);

          select status, destination_coords, assigned_to into v_current_status, v_dest, v_target_collab 
          from public.orders where id = p_order_id;

          -- 1. Geofencing: Validar ubicación al completar (solo si es colaborador)
          if v_normalized = 'completed' and not (public.is_admin(v_uid) or public.is_owner(v_uid)) then
            select lat, lng into v_curr_loc from public.collaborator_locations where collaborator_id = v_uid;
            
            -- Si hay coordenadas de destino y ubicación actual, validar (tolerancia ~500m)
            -- Nota: Simplificado, en producción real usar PostGIS para mayor precisión
            if v_dest is not null and v_curr_loc is not null then
               -- Validación básica de proximidad (aprox 0.005 grados ~= 500m)
               if abs(v_curr_loc.lat - (v_dest->>'lat')::double precision) > 0.005 or 
                  abs(v_curr_loc.lng - (v_dest->>'lng')::double precision) > 0.005 then
                  raise exception 'Debes estar cerca del destino para completar la orden';
               end if;
            end if;
          end if;

          -- Determinar colaborador objetivo
          v_target_collab := coalesce(p_collaborator_id, v_target_collab, v_uid);
          
          -- Obtener nombre para snapshot si se está asignando o completando
          select full_name into v_driver_name from public.profiles where id = v_target_collab;

          -- Validaciones de transición
          if not (public.is_admin(v_uid) or public.is_owner(v_uid)) then
            if not public.validate_transition(v_current_status, v_normalized) then
              raise exception 'Transición de estado inválida';
            end if;
          end if;

          update public.orders o
          set
            status = v_normalized,
            assigned_to = CASE 
              WHEN v_normalized = 'pending' THEN NULL 
              ELSE v_target_collab
            END,
            assigned_at = CASE WHEN v_normalized = 'accepted' AND o.assigned_at IS NULL THEN now() ELSE assigned_at END,
            completed_by = CASE WHEN v_normalized = 'completed' THEN v_uid ELSE completed_by END,
            completed_at = CASE WHEN v_normalized = 'completed' THEN now() ELSE completed_at END,
            driver_name_snapshot = coalesce(o.driver_name_snapshot, v_driver_name), -- ✅ Mantener o crear snapshot
            tracking_data = CASE WHEN p_tracking_entry IS NOT NULL THEN COALESCE(o.tracking_data,'[]'::jsonb) || jsonb_build_array(p_tracking_entry) ELSE o.tracking_data END,
            updated_at = now()
          where o.id = p_order_id
          returning to_jsonb(o) into v_updated;

          -- Mantenimiento de trabajos activos
          if v_normalized in ('accepted','in_progress') then
            insert into public.collaborator_active_jobs(collaborator_id, order_id)
            values (v_target_collab, p_order_id)
            on conflict (collaborator_id) do update set order_id = excluded.order_id;
          elsif v_normalized in ('completed','cancelled') then
            delete from public.collaborator_active_jobs where order_id = p_order_id;
          end if;

          return v_updated;
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

        -- Append Order Evidence (Thread-safe)
        create or replace function public.append_order_evidence(
          p_order_id bigint,
          p_evidence jsonb
        )
        returns void
        language plpgsql security definer
        set search_path = pg_catalog, public as $$
        begin
          update public.orders
          set evidence_photos = coalesce(evidence_photos, '[]'::jsonb) || jsonb_build_array(p_evidence),
              updated_at = now()
          where id = p_order_id;
        end;
        $$;

        create or replace view public.v_collaborator_performance as
        select
          p.id as collaborator_id,
          p.full_name as collaborator_name,
          count(o.id) filter (where o.status = 'completed') as completed_count,
          count(o.id) filter (where o.status = 'cancelled') as canceled_count,
          sum(o.monto_cobrado) as total_earnings,
          avg((o.rating->>'stars')::numeric) as avg_rating,
          avg(extract(epoch from (o.completed_at - o.assigned_at)) / 60) as avg_completion_minutes
        from public.profiles p
        left join public.orders o on p.id = o.assigned_to
        group by p.id, p.full_name;

        create or replace view public.v_notification_dashboard as
        select
          (select count(*) from public.notification_outbox where status='pending') as pending,
          (select count(*) from public.notification_outbox where status='processing') as processing,
          (select count(*) from public.notification_outbox where status='failed') as failed,
          (select count(*) from public.notification_dlq) as dlq;

        create or replace view public.v_operational_alerts as
        select 
            id, short_id, status, created_at,
            extract(epoch from (now() - created_at)) / 60 as minutes_waiting,
            case 
                when extract(epoch from (now() - created_at)) / 60 > 30 then 'CRITICAL'
                when extract(epoch from (now() - created_at)) / 60 > 15 then 'HIGH'
                else 'NORMAL'
            end as priority
        from public.orders
        where status = 'pending'
        order by minutes_waiting desc;

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
        drop policy if exists public_read_vehicles on public.vehicles;
        create policy public_read_vehicles on public.vehicles for select using (true);
        drop policy if exists public_read_services on public.services;
        create policy public_read_services on public.services for select using (true);
        drop policy if exists public_read_testimonials on public.testimonials;
        create policy public_read_testimonials on public.testimonials for select using (is_public = true);

        -- Orders
        drop policy if exists orders_insert_public on public.orders;
        create policy orders_insert_public on public.orders for insert with check (
          status = 'pending' and assigned_to is null
        );

        -- Impedir sobreescribir asignación
        drop policy if exists prevent_overwrite_assignment on public.orders;
        create policy prevent_overwrite_assignment on public.orders 
        for update using (
          (status = 'pending' and assigned_to is null) 
          OR (public.is_admin(auth.uid()) OR public.is_owner(auth.uid()))
        );

        drop policy if exists orders_select_policy on public.orders;
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

        drop policy if exists orders_update_collaborator on public.orders;
        create policy orders_update_collaborator on public.orders for update using (
          exists (select 1 from public.collaborators c where c.id = auth.uid() and c.status = 'activo')
          and assigned_to = auth.uid()
        );

        drop policy if exists orders_all_admin on public.orders;
        create policy orders_all_admin on public.orders for all using (
          public.is_owner(auth.uid()) or public.is_admin(auth.uid())
        );

        -- Profiles
        drop policy if exists public_read_profiles on public.profiles;
        create policy public_read_profiles on public.profiles for select using (true);
        drop policy if exists users_update_own_profile on public.profiles;
        create policy users_update_own_profile on public.profiles for update using (auth.uid() = id);

        -- Collaborators
        drop policy if exists collaborator_select_self on public.collaborators;
        create policy collaborator_select_self on public.collaborators for select using (auth.uid() = id or public.is_owner(auth.uid()) or public.is_admin(auth.uid()));
        drop policy if exists collaborator_update_self on public.collaborators;
        create policy collaborator_update_self on public.collaborators for update using (auth.uid() = id or public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

        -- Business
        drop policy if exists owner_all_business on public.business;
        create policy owner_all_business on public.business for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

        -- Notifications
        drop policy if exists user_own_notifications on public.notifications;
        create policy user_own_notifications on public.notifications for all using (user_id = auth.uid());
        drop policy if exists admin_notifications on public.notifications;
        create policy admin_notifications on public.notifications for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

        -- Push
        drop policy if exists user_own_push on public.push_subscriptions;
        create policy user_own_push on public.push_subscriptions for all using (user_id = auth.uid());
        drop policy if exists anon_insert_push on public.push_subscriptions;
        create policy anon_insert_push on public.push_subscriptions for insert with check (client_contact_id is not null);

        -- Active Jobs
        drop policy if exists active_jobs_all on public.collaborator_active_jobs;
        create policy active_jobs_all on public.collaborator_active_jobs for all using (
          collaborator_id = auth.uid() or public.is_owner(auth.uid()) or public.is_admin(auth.uid())
        );

        -- Locations
        drop policy if exists location_upsert_own on public.collaborator_locations;
        create policy location_upsert_own on public.collaborator_locations for insert with check (auth.uid() = collaborator_id);
        drop policy if exists location_update_own on public.collaborator_locations;
        create policy location_update_own on public.collaborator_locations for update using (auth.uid() = collaborator_id);
        drop policy if exists location_select_auth on public.collaborator_locations;
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

        -- 1. Cleanup Outbox & DLQ (diario 3am)
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

-- =============================================================
--        ONESIGNAL INTEGRATION (ADDED 2026-02-26)
-- =============================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onesignal_id text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS onesignal_id text;
ALTER TABLE public.collaborators ADD COLUMN IF NOT EXISTS onesignal_id text;

-- Add indexes for faster lookups during notification triggers
CREATE INDEX IF NOT EXISTS idx_profiles_onesignal_id ON public.profiles(onesignal_id);
CREATE INDEX IF NOT EXISTS idx_clients_onesignal_id ON public.clients(onesignal_id);
CREATE INDEX IF NOT EXISTS idx_collaborators_onesignal_id ON public.collaborators(onesignal_id);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS onesignal_id text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS onesignal_player_id text;

-- =============================================================
--        PRO-LEVEL OPTIMIZATIONS & VIEWS (PRODUCTION READY)
-- =============================================================

-- 1. Índices adicionales para rendimiento de consultas complejas
CREATE INDEX IF NOT EXISTS idx_orders_service_id ON public.orders(service_id);
CREATE INDEX IF NOT EXISTS idx_orders_vehicle_id ON public.orders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_orders_completed_by ON public.orders(completed_by);
CREATE INDEX IF NOT EXISTS idx_orders_client_contact_id ON public.orders(client_contact_id);

-- 2. Vista Administrativa Full (Simplifica el JS y reportes)
-- Esta vista une las tablas principales para obtener nombres sin Joins complejos en el cliente
CREATE OR REPLACE VIEW public.v_orders_admin AS
SELECT 
    o.*,
    s.name as service_name,
    v.name as vehicle_name,
    p_collab.full_name as collaborator_name,
    p_creator.full_name as creator_name,
    c.name as client_contact_name
FROM public.orders o
LEFT JOIN public.services s ON o.service_id = s.id
LEFT JOIN public.vehicles v ON o.vehicle_id = v.id
LEFT JOIN public.profiles p_collab ON o.assigned_to = p_collab.id
LEFT JOIN public.profiles p_creator ON o.created_by = p_creator.id
LEFT JOIN public.clients c ON o.client_contact_id = c.id;

-- 3. Habilitar Realtime para la tabla de órdenes (Crítico para el Panel)
-- Nota: Esto asume que la publicación 'supabase_realtime' ya existe (estándar en Supabase)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No se pudo habilitar Realtime automáticamente. Asegúrate de activarlo en el Dashboard de Supabase.';
END $$;

-- 4. Función de Auditoría Automática para Órdenes
CREATE OR REPLACE FUNCTION public.audit_order_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        INSERT INTO public.audit_logs (action, detail, user_id, created_at)
        VALUES (
            'ORDER_UPDATE',
            jsonb_build_object(
                'order_id', NEW.id,
                'old_status', OLD.status,
                'new_status', NEW.status,
                'changes', (to_jsonb(NEW) - 'updated_at') -- Guarda el objeto pero quita actualizacion de tiempo
            )::text,
            auth.uid(),
            now()
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_audit_orders ON public.orders;
CREATE TRIGGER trg_audit_orders
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.audit_order_changes();

-- 5. Comentarios de Documentación (Best Practice)
COMMENT ON TABLE public.orders IS 'Tabla principal de solicitudes de transporte y logística.';
COMMENT ON COLUMN public.orders.created_by IS 'Referencia al perfil que registró la orden originalmente.';
COMMENT ON COLUMN public.orders.assigned_to IS 'Referencia al colaborador/chofer que tiene la orden asignada.';