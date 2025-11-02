-- Esquema unificado y organizado (referencia: sql/schema.sql)
-- Sistema de IDs seguros para orders:
-- 1. id (UUID): Clave primaria interna de Supabase (compatibilidad)
-- 2. supabase_seq_id (BIGINT): ID secuencial interno (123, 124, 125...)
-- 3. client_tracking_id (TEXT): ID aleatorio único para cliente (seguridad)

-- =====================================================
-- TABLA: public.orders (Reorganizada y con IDs seguros)
-- =====================================================

BEGIN;

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Crear secuencia para supabase_seq_id (empezando en 123)
CREATE SEQUENCE IF NOT EXISTS orders_supabase_seq_id_seq
    START WITH 123
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Tabla orders organizada.
-- Nota: Si ya existe public.orders, más abajo se incluyen migraciones seguras
CREATE TABLE IF NOT EXISTS public.orders (
    -- Clave primaria (compatibilidad con código existente)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- IDs seguros
    supabase_seq_id BIGINT DEFAULT nextval('orders_supabase_seq_id_seq') UNIQUE NOT NULL,
    client_tracking_id TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'), -- ID aleatorio para cliente

    -- Campos de negocio principales
    status TEXT NOT NULL DEFAULT 'Pendiente',
    last_collab_status TEXT,
    
    -- Asignación y aceptación
    assigned_to UUID REFERENCES auth.users(id),
    accepted_by UUID REFERENCES auth.users(id),
    accepted_at TIMESTAMP WITH TIME ZONE,
    
    -- Información del cliente
    client_id UUID,
    client_name TEXT,
    client_phone TEXT,
    client_email TEXT,
    
    -- Servicio y vehículo
    service_id UUID,
    vehicle_id UUID,
    
    -- Ruta y ubicaciones
    pickup TEXT,
    delivery TEXT,
    origin_coords POINT,
    destination_coords POINT,
    
    -- Detalles del servicio
    service_details JSONB,
    additional_questions JSONB,
    
    -- Seguimiento y evidencias
    tracking_data JSONB DEFAULT '[]'::jsonb,
    evidence_photos JSONB DEFAULT '[]'::jsonb,
    
    -- Notificaciones
    notification_subscription JSONB,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Índices únicos para IDs seguros
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_supabase_seq_id ON public.orders(supabase_seq_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_tracking_id ON public.orders(client_tracking_id);

-- Constraint para validar que client_tracking_id sea hexadecimal de 32 caracteres
ALTER TABLE public.orders 
ADD CONSTRAINT IF NOT EXISTS orders_client_tracking_id_hex_check 
CHECK (client_tracking_id ~ '^[0-9a-f]{32}$');

-- Índices adicionales para rendimiento
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_assigned_to ON public.orders(assigned_to);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at);

COMMIT;

-- =====================================================
-- MIGRACIONES SEGURAS PARA TABLA EXISTENTE
-- =====================================================

-- Migración para agregar client_tracking_id a tabla existente
DO $$
BEGIN
  -- Agregar client_tracking_id si no existe
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'client_tracking_id'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN client_tracking_id TEXT;
    
    -- Generar IDs aleatorios para registros existentes
    UPDATE public.orders 
    SET client_tracking_id = encode(gen_random_bytes(16), 'hex')
    WHERE client_tracking_id IS NULL;
    
    -- Hacer la columna NOT NULL y UNIQUE
    ALTER TABLE public.orders ALTER COLUMN client_tracking_id SET NOT NULL;
    ALTER TABLE public.orders ALTER COLUMN client_tracking_id SET DEFAULT encode(gen_random_bytes(16), 'hex');
  END IF;

  -- Agregar supabase_seq_id si no existe
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'supabase_seq_id'
  ) THEN
    -- Crear la columna
    ALTER TABLE public.orders ADD COLUMN supabase_seq_id BIGINT;
    
    -- Asignar valores secuenciales a registros existentes (empezando en 123)
    WITH numbered_orders AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) + 122 as seq_num
      FROM public.orders
      WHERE supabase_seq_id IS NULL
    )
    UPDATE public.orders 
    SET supabase_seq_id = numbered_orders.seq_num
    FROM numbered_orders
    WHERE public.orders.id = numbered_orders.id;
    
    -- Actualizar la secuencia al siguiente valor disponible
    PERFORM setval('orders_supabase_seq_id_seq', COALESCE(MAX(supabase_seq_id), 122) + 1, false)
    FROM public.orders;
    
    -- Hacer la columna NOT NULL con default de secuencia
    ALTER TABLE public.orders ALTER COLUMN supabase_seq_id SET NOT NULL;
    ALTER TABLE public.orders ALTER COLUMN supabase_seq_id SET DEFAULT nextval('orders_supabase_seq_id_seq');
  END IF;
END $$;

-- Crear índices únicos después de la migración
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_tracking_id ON public.orders(client_tracking_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_supabase_seq_id ON public.orders(supabase_seq_id);

-- Agregar constraint de validación para client_tracking_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_client_tracking_id_hex_check'
  ) THEN
    ALTER TABLE public.orders
    ADD CONSTRAINT orders_client_tracking_id_hex_check
    CHECK (client_tracking_id ~ '^[0-9a-f]{32}$');
  END IF;
END $$;