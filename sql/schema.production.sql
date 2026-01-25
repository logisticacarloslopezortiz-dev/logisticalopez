-- =====================================================================================
-- 00_HEADER.SQL
-- =====================================================================================
-- PROYECTO: TLC Logística
-- DESCRIPCIÓN: Esquema de base de datos unificado para producción (Supabase/PostgreSQL).
-- FECHA: 2025
-- NOTAS:
--  - Todo el SQL es idempotente (se puede ejecutar múltiples veces sin error).
--  - Se usa RLS (Row Level Security) en todas las tablas sensibles.
--  - Arquitectura de eventos: Order -> Order Events -> Notification Outbox.
-- =====================================================================================

-- =====================================================================================
-- 01_EXTENSIONS.SQL
-- =====================================================================================
-- Extensiones necesarias para criptografía y funcionalidades extra.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Limpieza de extensiones no utilizadas (Legacy)
-- DROP EXTENSION IF EXISTS "pg_cron"; -- LEGACY (Comentado por seguridad en producción)

-- =====================================================================================
-- 02_ENUMS.SQL
-- =====================================================================================
-- Tipos enumerados para garantizar integridad de datos en estados.

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
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'collaborator_status') THEN
        CREATE TYPE public.collaborator_status AS ENUM ('activo', 'inactivo', 'suspendido');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'collaborator_role') THEN
        CREATE TYPE public.collaborator_role AS ENUM ('admin', 'administrador', 'colaborador');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'availability_status') THEN
        CREATE TYPE public.availability_status AS ENUM ('available', 'busy', 'offline');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_status') THEN
        CREATE TYPE public.notification_status AS ENUM ('pending', 'processing', 'retry', 'sent', 'failed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_target') THEN
        CREATE TYPE public.notification_target AS ENUM ('user', 'contact');
    END IF;
END $$;

-- =====================================================================================
-- 03_UTILS.SQL
-- =====================================================================================
-- Funciones utilitarias, helpers de fechas y normalización.

-- Trigger genérico para actualizar el campo updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Generador de IDs cortos para órdenes (ej: ORD-A1B2)
CREATE OR REPLACE FUNCTION public.generate_order_short_id()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    result text := '';
    i int;
BEGIN
    FOR i IN 1..6 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    RETURN 'ORD-' || result;
END;
$$;

-- Normalizador de estados de órdenes (Text -> Enum)
CREATE OR REPLACE FUNCTION public.normalize_order_status(in_status text)
RETURNS public.order_status
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE s text := trim(both from coalesce(in_status, ''));
BEGIN
    IF s = '' THEN RETURN 'pending'; END IF;
    s := replace(lower(s), '_', ' ');
    IF s IN ('pendiente', 'pending') THEN RETURN 'pending'; END IF;
    IF s IN ('aceptada', 'aceptado', 'aceptar', 'accepted') THEN RETURN 'accepted'; END IF;
    IF s IN ('en curso', 'en progreso', 'en proceso', 'en transito', 'en tránsito', 'in_progress', 'en_camino_recoger', 'cargando', 'en_camino_entregar') THEN RETURN 'in_progress'; END IF;
    IF s IN ('completada', 'completado', 'finalizada', 'terminada', 'entregado', 'entregada', 'completed') THEN RETURN 'completed'; END IF;
    IF s IN ('cancelada', 'cancelado', 'anulada', 'cancelled') THEN RETURN 'cancelled'; END IF;
    RETURN 'pending';
END;
$$;

-- =====================================================================================
-- 04_CATALOGS.SQL
-- =====================================================================================
-- Tablas de referencia (Vehículos, Servicios).

CREATE TABLE IF NOT EXISTS public.vehicles (
    id bigserial PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    name text NOT NULL UNIQUE,
    description text,
    image_url text,
    is_active boolean NOT NULL DEFAULT true,
    capacity text -- Legacy support
);

CREATE TABLE IF NOT EXISTS public.services (
    id bigserial PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    name text NOT NULL UNIQUE,
    description text,
    image_url text,
    is_active boolean NOT NULL DEFAULT true,
    base_price numeric DEFAULT 0,
    display_order int DEFAULT 0
);

-- =====================================================================================
-- 05_USERS.SQL
-- =====================================================================================
-- Gestión de usuarios, perfiles, colaboradores y clientes anónimos.

-- Perfiles (Extensión de auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name text,
    email text,
    phone text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Colaboradores (Staff)
CREATE TABLE IF NOT EXISTS public.collaborators (
    id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    name text,
    email text,
    phone text,
    matricula text,
    status public.collaborator_status NOT NULL DEFAULT 'activo',
    role public.collaborator_role NOT NULL DEFAULT 'colaborador',
    push_subscription jsonb, -- Legacy field, syncs to push_subscriptions table
    notes text,
    commission_percent numeric DEFAULT 0.10,
    can_take_orders boolean DEFAULT false,
    puede_ver_todas_las_ordenes boolean DEFAULT false,
    availability public.availability_status DEFAULT 'available'
);
CREATE INDEX IF NOT EXISTS idx_collaborators_status ON public.collaborators(status);
CREATE INDEX IF NOT EXISTS idx_collaborators_role ON public.collaborators(role);
CREATE INDEX IF NOT EXISTS idx_collaborators_availability ON public.collaborators(availability);

-- Clientes Anónimos/Invitados
CREATE TABLE IF NOT EXISTS public.clients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    phone text,
    email text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================================
-- 06_BUSINESS.SQL
-- =====================================================================================
-- Configuración global del negocio.

CREATE TABLE IF NOT EXISTS public.business (
    id integer PRIMARY KEY DEFAULT 1,
    business_name text,
    address text,
    phone text,
    email text,
    rnc text,
    quotation_rates jsonb,
    owner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    vapid_public_key text,
    push_vapid_key text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT business_rnc_check CHECK (rnc ~ '^\d{3}-\d{5}-\d{1}$' OR rnc IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_business_owner ON public.business(owner_user_id);

-- Seed inicial idempotente
INSERT INTO public.business (id, business_name) VALUES (1, 'Logística López Ortiz') ON CONFLICT (id) DO NOTHING;

-- =====================================================================================
-- 07_ORDERS.SQL
-- =====================================================================================
-- Núcleo del sistema: Órdenes, Trabajos Activos, Facturas.

CREATE TABLE IF NOT EXISTS public.orders (
    id bigserial PRIMARY KEY,
    short_id text UNIQUE DEFAULT public.generate_order_short_id(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    
    -- Cliente (Autenticado o Anónimo)
    client_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    client_contact_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
    name text NOT NULL,
    phone text NOT NULL,
    email text,
    rnc text,
    empresa text,
    
    -- Detalles del Servicio
    service_id bigint REFERENCES public.services(id) ON DELETE SET NULL,
    vehicle_id bigint REFERENCES public.vehicles(id) ON DELETE SET NULL,
    service_questions jsonb,
    
    -- Ubicación
    pickup text,
    delivery text,
    origin_coords jsonb,
    destination_coords jsonb,
    pickup_address text, -- Legacy compat
    delivery_address text, -- Legacy compat
    pickup_lat float, -- Legacy compat
    pickup_lng float, -- Legacy compat
    delivery_lat float, -- Legacy compat
    delivery_lng float, -- Legacy compat
    
    -- Tiempo
    "date" date,
    "time" time,
    
    -- Estado y Asignación
    status public.order_status NOT NULL DEFAULT 'pending',
    assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    assigned_at timestamptz,
    accepted_by uuid, -- LEGACY: Mantener por compatibilidad, no usar para nueva lógica
    accepted_at timestamptz, -- LEGACY: Mantener por compatibilidad, no usar para nueva lógica
    
    -- Finalización
    completed_at timestamptz,
    completed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    
    -- Finanzas
    estimated_price numeric,
    price numeric DEFAULT 0, -- Legacy compat
    monto_cobrado numeric,
    metodo_pago text,
    
    -- Tracking y Datos
    tracking_data jsonb DEFAULT '[]'::jsonb,
    tracking_url text,
    evidence_photos jsonb,
    rating jsonb DEFAULT '{}'::jsonb,
    customer_comment text,
    
    -- Métricas
    distance_km numeric,
    duration_min numeric
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_short_id ON public.orders(short_id);
CREATE INDEX IF NOT EXISTS idx_orders_client_id ON public.orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_assigned_to ON public.orders(assigned_to);

-- Trabajos activos (Lock para evitar múltiples órdenes simultáneas por colaborador)
CREATE TABLE IF NOT EXISTS public.collaborator_active_jobs (
    collaborator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    order_id bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    started_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (collaborator_id),
    UNIQUE(order_id)
);

-- Ubicación en tiempo real
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

-- Facturas
CREATE TABLE IF NOT EXISTS public.invoices (
    id bigserial PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    order_id bigint REFERENCES public.orders(id) ON DELETE SET NULL,
    client_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    file_path text NOT NULL,
    file_url text,
    total numeric,
    status public.invoice_status DEFAULT 'generada',
    data jsonb,
    recipient_email text
);

-- Actas de entrega
CREATE TABLE IF NOT EXISTS public.order_completion_receipts (
    id bigserial PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    order_id bigint REFERENCES public.orders(id) ON DELETE CASCADE,
    client_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    collaborator_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL,
    signed_by_collaborator_at timestamptz,
    signed_by_client_at timestamptz,
    data jsonb
);

-- =====================================================================================
-- 08_EVENTS.SQL
-- =====================================================================================
-- Sistema de Event Sourcing para auditoría y disparador de notificaciones.

CREATE TABLE IF NOT EXISTS public.notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id bigint NOT NULL, -- Referencia opcional, pero aquí parece obligatoria según el user input
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status notification_status DEFAULT 'pending',
  attempts int DEFAULT 0,
  last_error text,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  failed_at timestamptz,
  failed_reason text
);

CREATE INDEX IF NOT EXISTS idx_notification_events_pending 
ON public.notification_events(status, created_at);

-- Historial de eventos de órdenes (event sourcing ligero)
CREATE TABLE IF NOT EXISTS public.order_events (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_events_order_created ON public.order_events(order_id, created_at);

-- =====================================================================================
-- 09_NOTIFICATIONS.SQL
-- =====================================================================================
-- Sistema de notificaciones, plantillas y cola de salida (Outbox).

-- Plantillas de mensajes
CREATE TABLE IF NOT EXISTS public.notification_templates (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  role text NOT NULL, -- client | collaborator | admin
  status text,
  locale text NOT NULL DEFAULT 'es',
  title text NOT NULL,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_notification_templates_lookup ON public.notification_templates(event_type, role, status);

-- Cola de salida (Outbox Pattern)
DROP TABLE IF EXISTS public.notification_outbox CASCADE;
CREATE TABLE public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.notification_events(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  recipient_type notification_target NOT NULL,
  recipient_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status notification_status DEFAULT 'pending',
  attempts int DEFAULT 0,
  dedup_key text NOT NULL UNIQUE,
  last_error text,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  failed_at timestamptz,
  failed_reason text
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending 
ON public.notification_outbox(status, created_at);

-- Cola de salida para Emails (Outbox Email)
CREATE TABLE IF NOT EXISTS public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id bigint REFERENCES public.invoices(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  status notification_status DEFAULT 'pending',
  attempts int DEFAULT 0,
  dedup_key text NOT NULL UNIQUE,
  last_error text,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  failed_at timestamptz,
  failed_reason text,
  next_attempt_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_pending
ON public.email_outbox(status, created_at);

-- Notificaciones In-App (Se mantiene para compatibilidad Frontend si se usa)
CREATE TABLE IF NOT EXISTS public.notifications (
    id bigserial PRIMARY KEY,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    contact_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
    title text NOT NULL,
    body text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz,
    delivered_at timestamptz,
    delivered boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id) WHERE read_at IS NULL;

-- Suscripciones Push (Web Push)
DROP TABLE IF EXISTS public.push_subscriptions CASCADE;
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  client_contact_id uuid,
  endpoint text NOT NULL UNIQUE,
  keys jsonb NOT NULL,
  user_agent text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_contact ON public.push_subscriptions(client_contact_id);

-- Logs de entrega Push
CREATE TABLE IF NOT EXISTS public.push_delivery_attempts (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL,
  endpoint text NOT NULL,
  status_code int,
  error text,
  created_at timestamptz DEFAULT now()
);

-- Logs de sistema (Debugging)
CREATE TABLE IF NOT EXISTS public.notification_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now(),
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    success boolean NOT NULL DEFAULT false,
    error_message text
);

CREATE TABLE IF NOT EXISTS public.function_logs (
    id bigserial PRIMARY KEY,
    fn_name text NOT NULL,
    level text NOT NULL CHECK (level IN ('debug','info','warn','error')),
    message text NOT NULL,
    payload jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================================
-- 10_METRICS.SQL
-- =====================================================================================
-- Tablas y vistas para análisis de rendimiento.

CREATE TABLE IF NOT EXISTS public.collaborator_performance (
    id bigserial PRIMARY KEY,
    collaborator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    metric_date date NOT NULL DEFAULT (current_date),
    accepted_count int NOT NULL DEFAULT 0,
    in_progress_count int NOT NULL DEFAULT 0,
    completed_count int NOT NULL DEFAULT 0,
    canceled_count int NOT NULL DEFAULT 0,
    avg_completion_minutes numeric,
    sum_completion_minutes numeric DEFAULT 0,
    sum_rating numeric DEFAULT 0,
    count_ratings int DEFAULT 0,
    total_amount numeric NOT NULL DEFAULT 0,
    avg_rating numeric,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(collaborator_id, metric_date)
);

CREATE TABLE IF NOT EXISTS public.testimonials (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    created_at timestamptz DEFAULT now(),
    client_name text NOT NULL,
    comment text NOT NULL,
    stars int DEFAULT 5,
    is_public boolean DEFAULT true,
    display_order int DEFAULT 0,
    avatar_url text
);

CREATE OR REPLACE VIEW public.collaborator_performance_view AS
SELECT
    cp.collaborator_id,
    p.full_name AS collaborator_name,
    date_trunc('day', cp.metric_date)::date AS metric_date,
    cp.accepted_count,
    cp.in_progress_count,
    cp.completed_count,
    cp.canceled_count,
    cp.total_amount,
    cp.avg_rating,
    cp.avg_completion_minutes
FROM public.collaborator_performance cp
LEFT JOIN public.profiles p ON p.id = cp.collaborator_id;

-- Helpers de Roles y Permisos (Movidos aquí para asegurar que las tablas existen)
CREATE OR REPLACE FUNCTION public.is_owner(uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS(SELECT 1 FROM public.business b WHERE b.owner_user_id = uid);
$$;

CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.collaborators
        WHERE id = uid
          AND lower(role::text) IN ('admin', 'administrador')
          AND lower(status::text) IN ('activo', 'active')
    );
$$;

-- Resolución de destinatarios para notificaciones
CREATE OR REPLACE FUNCTION public.resolve_notification_targets(
  p_order_id bigint
)
RETURNS TABLE (recipient_type notification_target, recipient_id uuid)
LANGUAGE sql STABLE
AS $$
  -- 1. Contacto (Cliente Anónimo)
  SELECT 'contact'::public.notification_target, o.client_contact_id
  FROM public.orders o
  WHERE o.id = p_order_id AND o.client_contact_id IS NOT NULL

  UNION ALL

  -- 2. Usuario Asignado (Colaborador)
  SELECT 'user'::public.notification_target, o.assigned_to
  FROM public.orders o
  WHERE o.id = p_order_id AND o.assigned_to IS NOT NULL

  UNION ALL

  -- 3. Cliente Autenticado (Usuario App)
  SELECT 'user'::public.notification_target, o.client_id
  FROM public.orders o
  WHERE o.id = p_order_id AND o.client_id IS NOT NULL;
$$;

-- =====================================================================================
-- 11_RPCS.SQL
-- =====================================================================================
-- Funciones de lógica de negocio (Remote Procedure Calls).

-- 11.1 Crear orden (Maneja usuarios anónimos y autenticados)
CREATE OR REPLACE FUNCTION public.create_order_with_contact(order_payload jsonb)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_client_id uuid := auth.uid();
    v_contact_id uuid;
    v_order public.orders;
    v_status public.order_status;
BEGIN
    v_status := public.normalize_order_status(order_payload->>'status');

    IF v_client_id IS NULL THEN -- Usuario anónimo
        INSERT INTO public.clients(name, phone, email)
        VALUES (
            nullif(order_payload->>'name',''),
            nullif(order_payload->>'phone',''),
            nullif(order_payload->>'email','')
        ) RETURNING id INTO v_contact_id;

        -- Guardar push subscription si existe
        IF order_payload->'push_subscription' IS NOT NULL AND order_payload->'push_subscription'->>'endpoint' IS NOT NULL THEN
            INSERT INTO public.push_subscriptions(client_contact_id, endpoint, keys)
            VALUES (v_contact_id, order_payload->'push_subscription'->>'endpoint', order_payload->'push_subscription'->'keys')
            ON CONFLICT (client_contact_id, endpoint) DO UPDATE SET keys = EXCLUDED.keys;
        END IF;

        INSERT INTO public.orders (
            name, phone, email, rnc, empresa,
            service_id, vehicle_id, service_questions,
            pickup, delivery, origin_coords, destination_coords,
            "date", "time", status, estimated_price, tracking_data,
            client_contact_id
        ) VALUES (
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
            v_contact_id
        ) RETURNING * INTO v_order;
    ELSE -- Usuario autenticado
        IF order_payload->'push_subscription' IS NOT NULL AND order_payload->'push_subscription'->>'endpoint' IS NOT NULL THEN
            INSERT INTO public.push_subscriptions(user_id, endpoint, keys)
            VALUES (v_client_id, order_payload->'push_subscription'->>'endpoint', order_payload->'push_subscription'->'keys')
            ON CONFLICT (user_id, endpoint) DO UPDATE SET keys = EXCLUDED.keys;
        END IF;

        INSERT INTO public.orders (
            name, phone, email, rnc, empresa,
            service_id, vehicle_id, service_questions,
            pickup, delivery, origin_coords, destination_coords,
            "date", "time", status, estimated_price, tracking_data,
            client_id
        ) VALUES (
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
        ) RETURNING * INTO v_order;
    END IF;
    RETURN v_order;
END;
$$;

-- 11.2 Actualizar estado de orden (Core Logic)
DROP FUNCTION IF EXISTS public.update_order_status(bigint, text, uuid, jsonb);
CREATE OR REPLACE FUNCTION public.update_order_status(
    p_order_id bigint,
    p_new_status text,
    p_collaborator_id uuid,
    p_tracking_entry jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE 
    v_updated jsonb;
    v_normalized public.order_status;
    v_uid uuid;
    v_target_collab uuid;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;

    v_normalized := public.normalize_order_status(p_new_status);

    UPDATE public.orders o
    SET
        status = v_normalized,
        assigned_to = CASE 
            WHEN v_normalized = 'pending' THEN NULL
            WHEN p_collaborator_id IS NOT NULL AND (public.is_admin(v_uid) OR public.is_owner(v_uid)) THEN p_collaborator_id
            ELSE COALESCE(o.assigned_to, v_uid)
        END,
        assigned_at = CASE WHEN v_normalized = 'pending' THEN NULL WHEN v_normalized = 'accepted' AND o.assigned_at IS NULL THEN now() ELSE assigned_at END,
        completed_by = CASE WHEN v_normalized = 'completed' THEN v_uid ELSE completed_by END,
        completed_at = CASE WHEN v_normalized = 'completed' THEN now() ELSE completed_at END,
        tracking_data = CASE WHEN p_tracking_entry IS NOT NULL THEN o.tracking_data || p_tracking_entry ELSE o.tracking_data END
    WHERE o.id = p_order_id
      AND (o.assigned_to = v_uid OR o.assigned_to IS NULL)
      AND o.status NOT IN ('cancelled', 'completed')
    RETURNING to_jsonb(o) INTO v_updated;

    IF v_updated IS NULL THEN
        RAISE EXCEPTION 'Orden no encontrada o no autorizada' USING ERRCODE = 'P0002';
    END IF;

    RETURN v_updated;
END;
$$;

-- 11.3 Aceptar orden (Wrapper)
CREATE OR REPLACE FUNCTION public.accept_order_with_price(
    p_order_id bigint,
    p_price numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    _now timestamptz := now();
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
    
    -- Verificar si ya tiene orden activa
    IF EXISTS (SELECT 1 FROM public.orders o WHERE o.assigned_to = auth.uid() AND o.status IN ('accepted', 'in_progress')) THEN
        RAISE EXCEPTION 'Ya tienes una orden activa' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.orders
    SET
        status = 'accepted',
        accepted_at = COALESCE(accepted_at, _now),
        accepted_by = COALESCE(accepted_by, auth.uid()),
        assigned_to = COALESCE(assigned_to, auth.uid()),
        assigned_at = COALESCE(assigned_at, _now),
        estimated_price = COALESCE(p_price, estimated_price),
        tracking_data = COALESCE(tracking_data, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
                'status', 'accepted',
                'date', _now,
                'description', CASE WHEN p_price IS NOT NULL THEN 'Orden aceptada con tarifa ajustada: ' || p_price ELSE 'Orden aceptada' END
            )
        )
    WHERE id = p_order_id
      AND status = 'pending'
      AND (assigned_to IS NULL OR assigned_to = auth.uid());

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se pudo aceptar la orden. Puede que ya no esté disponible.' USING ERRCODE = 'P0002';
    END IF;

    -- Registrar trabajo activo
    INSERT INTO public.collaborator_active_jobs(collaborator_id, order_id)
    VALUES (auth.uid(), p_order_id)
    ON CONFLICT (collaborator_id) DO UPDATE SET order_id = EXCLUDED.order_id, started_at = now();
END;
$$;

-- 11.4 Obtener datos del dashboard
CREATE OR REPLACE FUNCTION public.get_collaborator_dashboard_data(collab_id uuid, period_start date, period_end date)
RETURNS TABLE (
    order_id bigint,
    "date" date,
    client_name text,
    commission_amount numeric,
    rating_stars int,
    customer_comment text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT 
        o.id AS order_id,
        o."date"::date AS "date",
        COALESCE(o.name, '') AS client_name,
        ROUND(COALESCE(o.monto_cobrado, 0) * COALESCE(c.commission_percent, 0.10), 2) AS commission_amount,
        COALESCE((o.rating->>'service')::int, (o.rating->>'stars')::int, NULL) AS rating_stars,
        o.customer_comment
    FROM public.orders o
    LEFT JOIN public.collaborators c ON c.id = o.assigned_to
    WHERE o.assigned_to = collab_id
      AND o.status = 'completed'
      AND (period_start IS NULL OR o."date" >= period_start)
      AND (period_end IS NULL OR o."date" <= period_end)
    ORDER BY o."date" DESC;
$$;

-- 11.5 Calificar orden
CREATE OR REPLACE FUNCTION public.submit_rating_v2(order_id bigint, service_stars int, collab_stars int, comment text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE exists_order boolean;
BEGIN
    SELECT EXISTS(SELECT 1 FROM public.orders WHERE id = order_id) INTO exists_order;
    IF NOT exists_order THEN RETURN false; END IF;

    IF EXISTS (SELECT 1 FROM public.orders WHERE id = order_id AND rating IS NOT NULL AND rating <> '{}'::jsonb) THEN
        RAISE EXCEPTION 'Este pedido ya fue calificado';
    END IF;

    UPDATE public.orders
    SET rating = jsonb_build_object(
            'service', greatest(1, least(5, service_stars)),
            'collab', greatest(1, least(5, collab_stars)),
            'stars', greatest(1, least(5, service_stars)),
            'comment', nullif(comment, '')
        ),
        customer_comment = nullif(comment, '')
    WHERE id = order_id
      AND (status = 'completed' OR completed_at IS NOT NULL);
    RETURN true;
END;
$$;

-- 11.6 Obtener testimonios públicos
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

-- 11.7 Obtener VAPID Key
CREATE OR REPLACE FUNCTION public.get_vapid_key()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_key text;
BEGIN
    SELECT vapid_public_key INTO v_key FROM public.business LIMIT 1;
    IF v_key IS NULL THEN 
        SELECT push_vapid_key INTO v_key FROM public.business LIMIT 1;
    END IF;
    RETURN v_key;
END;
$$;

-- 11.8 Validar colaborador activo
CREATE OR REPLACE FUNCTION public.validate_active_collaborator(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_status text;
BEGIN
    SELECT status INTO v_status FROM public.collaborators WHERE id = p_user_id;
    IF v_status = 'activo' THEN
        RETURN '{"isValid": true}'::jsonb;
    ELSE
        RETURN '{"isValid": false}'::jsonb;
    END IF;
END;
$$;

-- 11.9 Resolver orden para rating (por ID o Short ID)
CREATE OR REPLACE FUNCTION public.resolve_order_for_rating(p_code text)
RETURNS TABLE (id bigint, is_completed boolean)
SECURITY DEFINER LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE v_clean text;
BEGIN
    -- Intento por ID numérico
    BEGIN
        RETURN QUERY SELECT o.id, (o.status = 'completed' OR o.completed_at IS NOT NULL)
        FROM public.orders o WHERE o.id = p_code::bigint LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Intento por Short ID
    v_clean := upper(regexp_replace(trim(p_code), '^ORD-', '', 'i'));
    RETURN QUERY SELECT o.id, (o.status = 'completed' OR o.completed_at IS NOT NULL)
    FROM public.orders o
    WHERE upper(trim(o.short_id)) = v_clean OR upper(trim(o.short_id)) = 'ORD-' || v_clean LIMIT 1;
END;
$$;

-- 11.10 Set Order Amount (Admin)
CREATE OR REPLACE FUNCTION public.set_order_amount_admin(order_id bigint, amount numeric, method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE updated jsonb;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
    IF NOT (public.is_admin(auth.uid()) OR public.is_owner(auth.uid())) THEN
        RAISE EXCEPTION 'Acceso restringido' USING ERRCODE = '42501';
    END IF;
    UPDATE public.orders o SET monto_cobrado = amount, metodo_pago = method WHERE o.id = order_id
    RETURNING to_jsonb(o) INTO updated;
    IF updated IS NULL THEN RAISE EXCEPTION 'Orden no encontrada' USING ERRCODE = 'P0002'; END IF;
    RETURN updated;
END;
$$;

-- 11.11 Start Order Work (Wrapper)
CREATE OR REPLACE FUNCTION public.start_order_work(p_order_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    RETURN public.update_order_status(
        p_order_id, 'in_progress', auth.uid(),
        jsonb_build_object('status','in_progress','date', now(), 'description','Trabajo iniciado')
    );
END;
$$;

-- 11.12 Accept Order by Short ID (Wrapper)
CREATE OR REPLACE FUNCTION public.accept_order_by_short_id(p_short_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id bigint;
BEGIN
    SELECT id INTO v_id FROM public.orders WHERE short_id = p_short_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;
    PERFORM public.accept_order_with_price(v_id, NULL);
END;
$$;

-- 11.14 Obtener órdenes visibles para colaborador
CREATE OR REPLACE FUNCTION public.get_visible_orders_for_collaborator()
RETURNS SETOF public.orders
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT o.*
  FROM public.orders o
  JOIN public.collaborators c ON c.id = auth.uid()
  WHERE
    c.status = 'activo' AND
    o.status IN ('pending', 'accepted', 'in_progress') AND
    (
      -- Lógica espejo a RLS para consistencia
      (c.puede_ver_todas_las_ordenes = true AND (o.assigned_to IS NULL OR o.assigned_to = auth.uid()))
      OR
      (c.puede_ver_todas_las_ordenes = false AND o.assigned_to = auth.uid())
    )
  ORDER BY o.created_at DESC;
$$;

-- 11.13 Upsert Metrics (Helper)
CREATE OR REPLACE FUNCTION public.upsert_collaborator_metric_fixed(
  p_collaborator_id uuid,
  p_metric_date date,
  p_accept_inc int,
  p_in_progress_inc int,
  p_complete_inc int,
  p_cancel_inc int,
  p_amount numeric,
  p_rating numeric,
  p_completion_minutes numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.collaborator_performance(
    collaborator_id, metric_date, accepted_count, in_progress_count,
    completed_count, canceled_count, total_amount, avg_rating, avg_completion_minutes, updated_at,
    sum_completion_minutes, sum_rating, count_ratings
  ) VALUES (
    p_collaborator_id, p_metric_date,
    greatest(p_accept_inc,0), greatest(p_in_progress_inc,0), greatest(p_complete_inc,0), greatest(p_cancel_inc,0),
    coalesce(p_amount,0), null, null, now(),
    coalesce(p_completion_minutes, 0), coalesce(p_rating, 0), CASE WHEN p_rating IS NOT NULL THEN 1 ELSE 0 END
  )
  ON CONFLICT (collaborator_id, metric_date) DO UPDATE SET
    accepted_count = public.collaborator_performance.accepted_count + greatest(p_accept_inc,0),
    in_progress_count = public.collaborator_performance.in_progress_count + greatest(p_in_progress_inc,0),
    completed_count = public.collaborator_performance.completed_count + greatest(p_complete_inc,0),
    canceled_count = public.collaborator_performance.canceled_count + greatest(p_cancel_inc,0),
    total_amount = public.collaborator_performance.total_amount + coalesce(p_amount,0),
    sum_completion_minutes = public.collaborator_performance.sum_completion_minutes + coalesce(p_completion_minutes, 0),
    sum_rating = public.collaborator_performance.sum_rating + coalesce(p_rating, 0),
    count_ratings = public.collaborator_performance.count_ratings + (CASE WHEN p_rating IS NOT NULL THEN 1 ELSE 0 END),
    avg_rating = CASE WHEN (public.collaborator_performance.count_ratings + (CASE WHEN p_rating IS NOT NULL THEN 1 ELSE 0 END)) > 0 
                 THEN (public.collaborator_performance.sum_rating + coalesce(p_rating, 0)) / (public.collaborator_performance.count_ratings + (CASE WHEN p_rating IS NOT NULL THEN 1 ELSE 0 END)) ELSE NULL END,
    avg_completion_minutes = CASE WHEN (public.collaborator_performance.completed_count + greatest(p_complete_inc,0)) > 0
                             THEN (public.collaborator_performance.sum_completion_minutes + coalesce(p_completion_minutes, 0)) / (public.collaborator_performance.completed_count + greatest(p_complete_inc,0)) ELSE NULL END,
    updated_at = now();
END;$$;

-- =====================================================================================
-- 12_TRIGGERS.SQL
-- =====================================================================================
-- Lógica reactiva de la base de datos.

-- 1. Updated At (Genérico)
DROP TRIGGER IF EXISTS trg_profiles_set_updated ON public.profiles;
CREATE TRIGGER trg_profiles_set_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_collaborators_touch_updated ON public.collaborators;
CREATE TRIGGER trg_collaborators_touch_updated BEFORE UPDATE ON public.collaborators FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_business_touch_updated ON public.business;
CREATE TRIGGER trg_business_touch_updated BEFORE UPDATE ON public.business FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_orders_touch_updated ON public.orders;
CREATE TRIGGER trg_orders_touch_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_perf_touch_updated ON public.collaborator_performance;
CREATE TRIGGER trg_perf_touch_updated BEFORE UPDATE ON public.collaborator_performance FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Sincronización Profile -> Collaborator
CREATE OR REPLACE FUNCTION public.sync_profile_name() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, email, phone, created_at, updated_at)
    VALUES (NEW.id, NEW.name, NEW.email, NEW.phone, now(), now())
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, phone = EXCLUDED.phone, updated_at = now();
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_profile_name ON public.collaborators;
CREATE TRIGGER trg_sync_profile_name AFTER INSERT OR UPDATE OF name, email, phone ON public.collaborators FOR EACH ROW EXECUTE FUNCTION public.sync_profile_name();

-- 3. Sincronización Push Subscription
CREATE OR REPLACE FUNCTION public.sync_collaborator_push_subscription() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.push_subscription IS NULL THEN RETURN NEW; END IF;
    INSERT INTO public.push_subscriptions(user_id, endpoint, keys, created_at)
    VALUES (NEW.id, NEW.push_subscription->>'endpoint', COALESCE(NEW.push_subscription->'keys', '{}'::jsonb), now())
    ON CONFLICT (user_id, endpoint) DO UPDATE SET keys = EXCLUDED.keys;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_collaborators_sync_push_subscription ON public.collaborators;
CREATE TRIGGER trg_collaborators_sync_push_subscription AFTER UPDATE OF push_subscription ON public.collaborators FOR EACH ROW EXECUTE FUNCTION public.sync_collaborator_push_subscription();

-- 4. Orders: Tracking URL
CREATE OR REPLACE FUNCTION public.set_order_tracking_url() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.tracking_url IS NULL OR NEW.tracking_url = '' THEN
        NEW.tracking_url := '/seguimiento.html?orderId=' || COALESCE(NEW.short_id::text, NEW.id::text);
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_orders_set_tracking ON public.orders;
CREATE TRIGGER trg_orders_set_tracking BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_order_tracking_url();

-- 5. Orders: Completed Metadata
CREATE OR REPLACE FUNCTION public.ensure_completed_metadata() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'completed' THEN
        IF NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
        IF NEW.completed_by IS NULL THEN NEW.completed_by := COALESCE(NEW.assigned_to, auth.uid()); END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_orders_ensure_completed_metadata ON public.orders;
CREATE TRIGGER trg_orders_ensure_completed_metadata BEFORE UPDATE ON public.orders FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.ensure_completed_metadata();

-- 6. Orders: Create Receipt
CREATE OR REPLACE FUNCTION public.create_completion_receipt_on_order_complete() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' THEN
        IF NOT EXISTS (SELECT 1 FROM public.order_completion_receipts r WHERE r.order_id = NEW.id) THEN
            INSERT INTO public.order_completion_receipts(order_id, client_id, collaborator_id, signed_by_collaborator_at)
            VALUES (NEW.id, NEW.client_id, NEW.assigned_to, COALESCE(NEW.completed_at, now()));
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_orders_create_receipt_on_complete ON public.orders;
CREATE TRIGGER trg_orders_create_receipt_on_complete AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.create_completion_receipt_on_order_complete();

-- 7. Orders: Active Jobs Management
CREATE OR REPLACE FUNCTION public.cleanup_active_job_on_status() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IN ('completed', 'cancelled') THEN
        DELETE FROM public.collaborator_active_jobs WHERE order_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cleanup_active_job ON public.orders;
CREATE TRIGGER trg_cleanup_active_job AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.cleanup_active_job_on_status();

CREATE OR REPLACE FUNCTION public.create_active_job_on_start() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status <> 'in_progress' AND NEW.status = 'in_progress' THEN
        INSERT INTO public.collaborator_active_jobs(collaborator_id, order_id) VALUES (NEW.assigned_to, NEW.id) ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_create_active_job ON public.orders;
CREATE TRIGGER trg_create_active_job AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.create_active_job_on_start();

-- 8. Orders: Event Sourcing
CREATE OR REPLACE FUNCTION public.trg_orders_emit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notification_events (
      order_id, event_type, payload
    ) VALUES (
      NEW.id,
      'order_created',
      jsonb_build_object('new_status', NEW.status)
    );

  ELSIF TG_OP = 'UPDATE' AND OLD.assigned_to IS DISTINCT FROM NEW.assigned_to AND NEW.assigned_to IS NOT NULL THEN
    INSERT INTO public.notification_events (
      order_id, event_type, payload
    ) VALUES (
      NEW.id,
      'order_assigned',
      jsonb_build_object(
        'collaborator_id', NEW.assigned_to,
        'new_status', NEW.status
      )
    );

  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.notification_events (
      order_id, event_type, payload
    ) VALUES (
      NEW.id,
      'order_status_changed',
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status
      )
    );
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_orders_events ON public.orders;
DROP TRIGGER IF EXISTS trg_orders_emit_event ON public.orders;
CREATE TRIGGER trg_orders_events
AFTER INSERT OR UPDATE OF status
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_orders_emit_event();

-- 9. Events: Outbox Generation
CREATE OR REPLACE FUNCTION public.build_notification_message(
  p_event_type text,
  p_status text,
  p_order_short text
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE p_event_type
        WHEN 'order_created' THEN '📦 Nueva orden'
        WHEN 'order_status_changed' THEN '🔄 Estado actualizado'
        WHEN 'order_assigned' THEN '👤 Orden asignada'
        ELSE '🔔 Notificación'
      END,
    'body',
      CASE p_event_type
        WHEN 'order_created' THEN 'Orden #' || p_order_short || ' creada'
        WHEN 'order_status_changed' THEN 'Orden #' || p_order_short || ' ahora está ' || p_status
        WHEN 'order_assigned' THEN 'Te asignaron la orden #' || p_order_short
        ELSE 'Tienes una notificación nueva'
      END,
    'data', jsonb_build_object(
      'order_id', p_order_short,
      'url', '/orders/' || p_order_short
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.trg_events_to_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  v_message jsonb;
BEGIN
  v_message := public.build_notification_message(
    NEW.event_type,
    NEW.payload->>'new_status',
    NEW.order_id::text
  );

  FOR r IN
    SELECT * FROM public.resolve_notification_targets(NEW.order_id)
  LOOP
    INSERT INTO public.notification_outbox (
      event_id,
      event_type,
      recipient_type,
      recipient_id,
      payload,
      dedup_key
    ) VALUES (
      NEW.id,
      NEW.event_type,
      r.recipient_type,
      r.recipient_id,
      v_message,
      format(
        'order:%s|event:%s|to:%s|uid:%s',
        NEW.order_id,
        NEW.event_type,
        r.recipient_type,
        r.recipient_id
      )
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_events_to_outbox ON public.notification_events;
DROP TRIGGER IF EXISTS trg_events_outbox ON public.notification_events;
CREATE TRIGGER trg_events_outbox
AFTER INSERT ON public.notification_events
FOR EACH ROW
EXECUTE FUNCTION public.trg_events_to_outbox();

-- Trigger: Invoices -> Email Outbox
CREATE OR REPLACE FUNCTION public.trg_invoices_to_email_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE v_subject text; v_html text; v_dedup text;
BEGIN
  -- Requiere email y URL pública del PDF
  IF NEW.recipient_email IS NULL OR TRIM(NEW.recipient_email) = '' THEN
    RETURN NEW;
  END IF;
  IF NEW.file_url IS NULL OR TRIM(NEW.file_url) = '' THEN
    RETURN NEW;
  END IF;

  -- Construir contenido mínimo
  v_subject := COALESCE(
    '📄 Factura de tu servicio - Orden #' || COALESCE((SELECT short_id FROM public.orders WHERE id = NEW.order_id), NEW.order_id::text),
    '📄 Factura generada'
  );
  v_html := format(
    '<p>Tu factura ha sido generada.</p><p>Puedes descargarla aquí: <a href="%s" target="_blank" rel="noopener">Descargar factura (PDF)</a></p>',
    NEW.file_url
  );

  -- Dedup por invoice_id + email
  v_dedup := format('invoice:%s|to:%s', NEW.id, NEW.recipient_email);

  INSERT INTO public.email_outbox (invoice_id, to_email, subject, html, dedup_key)
  VALUES (NEW.id, NEW.recipient_email, v_subject, v_html, v_dedup)
  ON CONFLICT (dedup_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_email_outbox ON public.invoices;
CREATE TRIGGER trg_invoices_email_outbox
AFTER INSERT ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.trg_invoices_to_email_outbox();

-- 10. Metrics: Track Order Metrics
CREATE OR REPLACE FUNCTION public.track_order_metrics() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_collab uuid; v_when date := current_date; v_amount numeric := null; v_rating numeric := null; v_minutes numeric := null;
BEGIN
    v_collab := COALESCE(NEW.assigned_to, OLD.assigned_to);
    IF v_collab IS NULL THEN RETURN NEW; END IF;

    IF NEW.status = 'completed' AND NEW.completed_at IS NOT NULL THEN
        v_minutes := extract(epoch from (NEW.completed_at - COALESCE(NEW.assigned_at, NEW.created_at))) / 60.0;
        v_rating := COALESCE((NEW.rating->>'stars')::numeric, null);
        v_amount := NEW.monto_cobrado;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        IF NEW.status = 'accepted' THEN PERFORM public.upsert_collaborator_metric_fixed(v_collab, v_when, 1, 0, 0, 0, null, null, null);
        ELSIF NEW.status = 'in_progress' THEN PERFORM public.upsert_collaborator_metric_fixed(v_collab, v_when, 0, 1, 0, 0, null, null, null);
        ELSIF NEW.status = 'completed' THEN PERFORM public.upsert_collaborator_metric_fixed(v_collab, v_when, 0, 0, 1, 0, v_amount, v_rating, v_minutes);
        ELSIF NEW.status = 'cancelled' THEN PERFORM public.upsert_collaborator_metric_fixed(v_collab, v_when, 0, 0, 0, 1, null, null, null);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_orders_track_metrics ON public.orders;
CREATE TRIGGER trg_orders_track_metrics AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.track_order_metrics();

-- =====================================================================================
-- 13_RLS.SQL
-- =====================================================================================
-- Políticas de seguridad a nivel de fila.

-- Habilitar RLS
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY; -- New
ALTER TABLE public.push_delivery_attempts ENABLE ROW LEVEL SECURITY; -- New
ALTER TABLE public.order_completion_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.function_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaborator_active_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaborator_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaborator_performance ENABLE ROW LEVEL SECURITY;

-- Limpieza de políticas previas (para evitar conflictos)
DO $$ BEGIN
    -- Se omiten los DROP individuales por brevedad, asumiendo que se pueden recrear o que el script se corre en limpio.
    -- En producción real, es mejor hacer DROP IF EXISTS de cada política específica.
END $$;

-- Vehicles & Services (Público lectura, Admin escritura)
DROP POLICY IF EXISTS public_read_vehicles ON public.vehicles;
CREATE POLICY public_read_vehicles ON public.vehicles FOR SELECT USING (true);
DROP POLICY IF EXISTS admin_write_vehicles ON public.vehicles;
CREATE POLICY admin_write_vehicles ON public.vehicles FOR ALL USING (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS public_read_services ON public.services;
CREATE POLICY public_read_services ON public.services FOR SELECT USING (true);
DROP POLICY IF EXISTS admin_write_services ON public.services;
CREATE POLICY admin_write_services ON public.services FOR ALL USING (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

-- Profiles (Lectura pública, Update propio, Admin todo)
DROP POLICY IF EXISTS public_read_profiles ON public.profiles;
CREATE POLICY public_read_profiles ON public.profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS users_update_own_profile ON public.profiles;
CREATE POLICY users_update_own_profile ON public.profiles FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS admin_manage_profiles ON public.profiles;
CREATE POLICY admin_manage_profiles ON public.profiles FOR ALL USING (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

-- Collaborators (Lectura pública, Update propio, Admin todo)
DROP POLICY IF EXISTS public_read_collaborators ON public.collaborators;
CREATE POLICY public_read_collaborators ON public.collaborators FOR SELECT USING (true);
DROP POLICY IF EXISTS collaborator_update_self ON public.collaborators;
CREATE POLICY collaborator_update_self ON public.collaborators FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS admin_manage_collaborators ON public.collaborators;
CREATE POLICY admin_manage_collaborators ON public.collaborators FOR ALL USING (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

-- Business (Lectura pública, Admin escritura)
DROP POLICY IF EXISTS public_read_business ON public.business;
CREATE POLICY public_read_business ON public.business FOR SELECT USING (true);
DROP POLICY IF EXISTS admin_write_business ON public.business;
CREATE POLICY admin_write_business ON public.business FOR ALL USING (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

-- Orders
-- 1. Insert (Público, estado pending)
DROP POLICY IF EXISTS orders_insert_public ON public.orders;
CREATE POLICY orders_insert_public ON public.orders FOR INSERT WITH CHECK (
  status = 'pending' AND assigned_to IS NULL AND (client_id IS NOT NULL OR client_contact_id IS NOT NULL)
);

-- Helper function for permissions
CREATE OR REPLACE FUNCTION public.can_view_all_orders(uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT puede_ver_todas_las_ordenes
     FROM public.collaborators
     WHERE id = uid),
    false
  );
$$;

-- 2. Select (Cliente propio, Colaborador asignado/pendiente/activo, Admin)
DROP POLICY IF EXISTS orders_select_policy ON public.orders;
CREATE POLICY orders_select_policy ON public.orders FOR SELECT USING (
  (client_id = auth.uid()) OR
  (
    -- Colaborador: Ver todas si tiene permiso, o solo las asignadas
    (public.can_view_all_orders(auth.uid()) AND status = 'pending')
    OR
    assigned_to = auth.uid()
  ) OR
  (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()))
);
-- 3. Update (Colaborador asignado, Admin)
DROP POLICY IF EXISTS orders_update_policy ON public.orders;
CREATE POLICY orders_update_policy ON public.orders FOR UPDATE USING (
  (assigned_to = auth.uid() AND EXISTS (SELECT 1 FROM public.collaborators c WHERE c.id = auth.uid() AND c.status = 'activo')) OR
  (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()))
);
-- 4. Delete (Admin)
DROP POLICY IF EXISTS orders_delete_admin ON public.orders;
CREATE POLICY orders_delete_admin ON public.orders FOR DELETE USING (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

-- Notifications & Push
DROP POLICY IF EXISTS user_manage_own_notifications ON public.notifications;
CREATE POLICY user_manage_own_notifications ON public.notifications FOR ALL USING (user_id = auth.uid());
DROP POLICY IF EXISTS admin_manage_notifications ON public.notifications;
CREATE POLICY admin_manage_notifications ON public.notifications FOR ALL USING (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS user_manage_own_push ON public.push_subscriptions;
CREATE POLICY user_manage_own_push ON public.push_subscriptions FOR ALL USING (user_id = auth.uid());
DROP POLICY IF EXISTS anon_insert_push ON public.push_subscriptions;
CREATE POLICY anon_insert_push ON public.push_subscriptions FOR INSERT TO anon, authenticated WITH CHECK (client_contact_id IS NOT NULL AND endpoint LIKE 'https://%');
DROP POLICY IF EXISTS admin_manage_push ON public.push_subscriptions;
CREATE POLICY admin_manage_push ON public.push_subscriptions FOR ALL USING (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

-- Active Jobs & Locations
DROP POLICY IF EXISTS active_jobs_select ON public.collaborator_active_jobs;
CREATE POLICY active_jobs_select ON public.collaborator_active_jobs FOR SELECT USING (collaborator_id = auth.uid() OR public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS active_jobs_write ON public.collaborator_active_jobs;
CREATE POLICY active_jobs_write ON public.collaborator_active_jobs FOR ALL USING (collaborator_id = auth.uid() OR public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

-- Notification Outbox & Events (Admin/System)
DROP POLICY IF EXISTS admin_all_outbox ON public.notification_outbox;
CREATE POLICY admin_all_outbox ON public.notification_outbox FOR ALL USING (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

-- Order Events (Admin read)
DROP POLICY IF EXISTS admin_read_events ON public.order_events;
CREATE POLICY admin_read_events ON public.order_events FOR SELECT USING (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS locations_read_auth ON public.collaborator_locations;
CREATE POLICY locations_read_auth ON public.collaborator_locations FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS locations_write_own ON public.collaborator_locations;
CREATE POLICY locations_write_own ON public.collaborator_locations FOR ALL USING (collaborator_id = auth.uid());

-- Templates
-- CREATE POLICY admin_manage_templates ON public.notification_templates FOR ALL USING (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

-- Testimonials
DROP POLICY IF EXISTS public_read_testimonials ON public.testimonials;
CREATE POLICY public_read_testimonials ON public.testimonials FOR SELECT USING (is_public = true);
DROP POLICY IF EXISTS admin_manage_testimonials ON public.testimonials;
CREATE POLICY admin_manage_testimonials ON public.testimonials FOR ALL USING (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

-- Metrics
DROP POLICY IF EXISTS perf_view_self_admin ON public.collaborator_performance;
CREATE POLICY perf_view_self_admin ON public.collaborator_performance FOR SELECT USING (collaborator_id = auth.uid() OR public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

-- Clients
DROP POLICY IF EXISTS clients_insert_any ON public.clients;
CREATE POLICY clients_insert_any ON public.clients FOR INSERT TO anon, authenticated WITH CHECK (length(coalesce(phone, '')) >= 7 OR length(coalesce(email, '')) >= 5);
DROP POLICY IF EXISTS clients_select_admin ON public.clients;
CREATE POLICY clients_select_admin ON public.clients FOR SELECT USING (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

-- Logs
DROP POLICY IF EXISTS logs_read_admin ON public.function_logs;
CREATE POLICY logs_read_admin ON public.function_logs FOR SELECT USING (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()));

-- Grants
GRANT EXECUTE ON FUNCTION public.get_collaborator_dashboard_data(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_rating(bigint, int, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_rating_v2(bigint, int, int, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_order_for_rating(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_with_contact(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_order_by_short_id(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_status(bigint, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_order_work(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_amount_admin(bigint, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_order_with_price(bigint, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_testimonials(int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_visible_orders_for_collaborator() TO authenticated;

-- =====================================================================================
-- 14_SEED.SQL
-- =====================================================================================
-- Datos iniciales.

-- Vehículos
INSERT INTO public.vehicles (name, description, image_url, is_active) VALUES
('Camión Pequeño','14 pies','https://i.postimg.cc/DynCkfnV/camionpequeno.jpg', true),
('Furgoneta','Paquetería y cargas ligeras','https://i.postimg.cc/RV4P5C9f/furgoneta.jpg', true),
('Grúa Vehicular','Remolque de autos y jeepetas','https://i.postimg.cc/hvgBTFmy/grua-vehiculos.jpg', true),
('Camión Grande','22 a 28 pies','https://i.postimg.cc/44z8SHCc/camiongrande.jpg', true),
('Grúa de Carga','Izado y movimiento de carga','https://i.postimg.cc/0yHZwpSf/grua.png', true),
('Motor','Entregas rápidas','https://i.postimg.cc/JMNgTvmd/motor.jpg', true),
('Camión Abierto','Materiales y mineros','https://i.postimg.cc/Kvx9ScFT/camionminero.jpg', true)
ON CONFLICT (name) DO NOTHING;

-- Servicios
INSERT INTO public.services (name, description, image_url, is_active, display_order) VALUES
('Transporte Comercial','Mercancías comerciales.','https://i.postimg.cc/sXCdCFTD/transporte-comercial.png', true, 1),
('Paquetería','Envíos rápidos.','https://i.postimg.cc/zBYZYmx8/paqueteria.png', true, 2),
('Carga Pesada','Especialistas carga pesada.','https://i.postimg.cc/B65b1fbv/pesado.jpg', true, 3),
('Flete','Flete nacional.','https://i.postimg.cc/15vQnj3w/flete.png', true, 4),
('Mudanza','Residencial y comercial.','https://i.postimg.cc/HszyJd5m/mudanza.jpg', true, 5),
('Grúa Vehículo','Remolque.','https://i.postimg.cc/hvgBTFmy/grua-vehiculos.jpg', true, 6),
('Botes Mineros','Alquiler/transporte.','https://i.postimg.cc/gzL29mkt/botes-minenos.png', true, 7),
('Grúa de Carga','Movimiento de carga.','https://i.postimg.cc/sDjz2rsx/grua-carga.png', true, 8)
ON CONFLICT (name) DO NOTHING;

-- Templates de Notificación (Legacy - Deprecated)
-- INSERT INTO public.notification_templates(event_type, role, status, locale, title, body, is_active)
-- VALUES
--   ('order_created','client','pending','es','Orden creada','Tu orden #{{id}} fue creada correctamente. Te avisaremos cada avance.',true),
--   ('order_created','admin','pending','es','Nueva orden creada','Se creó la orden #{{id}}. Requiere asignación.',true),
--   ('order_created','collaborator','pending','es','Nueva orden disponible','Hay una nueva orden #{{id}} pendiente de asignación.',true),
--   ('status_changed','client','accepted','es','Actualización de tu orden','Tu orden #{{id}} ha sido aceptada',true),
--   ('status_changed','client','in_progress','es','Actualización de tu orden','Tu orden #{{id}} está en curso',true),
--   ('status_changed','client','completed','es','Actualización de tu orden','Tu orden #{{id}} ha sido completada',true),
--   ('status_changed','client','cancelled','es','Actualización de tu orden','Tu orden #{{id}} ha sido cancelada',true),
--   ('status_changed','collaborator','accepted','es','Actualización de tu trabajo','Orden #{{id}} aceptada',true),
--   ('status_changed','collaborator','in_progress','es','Actualización de tu trabajo','Orden #{{id}} en curso',true),
--   ('status_changed','collaborator','completed','es','Actualización de tu trabajo','Orden #{{id}} completada',true),
--   ('status_changed','collaborator','cancelled','es','Actualización de tu trabajo','Orden #{{id}} cancelada',true)
-- ON CONFLICT (event_type, role, status, locale) DO NOTHING;

-- Testimonios (Seed)
INSERT INTO public.testimonials (client_name, comment, stars, display_order, created_at)
SELECT 'María González', 'Excelente servicio, llegaron súper rápido y cuidaron mis muebles.', 5, 1, now()
WHERE NOT EXISTS (SELECT 1 FROM public.testimonials);

INSERT INTO public.testimonials (client_name, comment, stars, display_order, created_at)
SELECT 'Juan Pérez', 'Muy profesionales. El seguimiento en tiempo real es una maravilla.', 5, 2, now() - interval '1 day'
WHERE NOT EXISTS (SELECT 1 FROM public.testimonials WHERE client_name = 'Juan Pérez');

-- Limpieza de funciones legacy
DROP FUNCTION IF EXISTS public.dispatch_notification(uuid, uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.dispatch_notification(text, jsonb, text);
DROP FUNCTION IF EXISTS public.notify_admins CASCADE;

-- Ensure columns exist in notification_outbox (for DLQ and Backoff)
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz DEFAULT now();
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS processed_at timestamptz;
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS failed_at timestamptz;
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS failed_reason text;

-- Initialize next_attempt_at for old records
UPDATE public.notification_outbox SET next_attempt_at = created_at WHERE next_attempt_at IS NULL;

-- Claim Notification Outbox Function (RPC) - Atomic
CREATE OR REPLACE FUNCTION public.claim_notification_outbox(p_limit int)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.notification_outbox
  SET status = 'processing',
      attempts = attempts + 1,
      processed_at = now()
  WHERE id IN (
    SELECT id
    FROM public.notification_outbox
    WHERE status IN ('pending', 'retry')
      AND attempts < 5
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- Claim Email Outbox Function (RPC) - Atomic
CREATE OR REPLACE FUNCTION public.claim_email_outbox(p_limit int)
RETURNS SETOF public.email_outbox
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.email_outbox
  SET status = 'processing',
      attempts = attempts + 1,
      processed_at = now()
  WHERE id IN (
    SELECT id
    FROM public.email_outbox
    WHERE status IN ('pending', 'retry')
      AND attempts < 5
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- Legacy backoff function (not used in new schema)
DROP FUNCTION IF EXISTS public.calc_notification_backoff(int);
