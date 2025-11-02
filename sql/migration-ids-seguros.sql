-- =====================================================
-- MIGRACIÓN: Sistema de IDs Seguros para Orders
-- =====================================================
-- Fecha: $(date)
-- Descripción: Implementa sistema dual de IDs:
--   - supabase_seq_id: Secuencial interno (123, 124, 125...)
--   - client_tracking_id: ID aleatorio único para cliente (32 chars hex)

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

-- =====================================================
-- MIGRACIÓN SEGURA: Agregar client_tracking_id
-- =====================================================

DO $$
BEGIN
  -- Agregar client_tracking_id si no existe
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'client_tracking_id'
  ) THEN
    RAISE NOTICE 'Agregando columna client_tracking_id...';
    
    -- Crear la columna
    ALTER TABLE public.orders ADD COLUMN client_tracking_id TEXT;
    
    -- Generar IDs aleatorios únicos para registros existentes
    UPDATE public.orders 
    SET client_tracking_id = encode(gen_random_bytes(16), 'hex')
    WHERE client_tracking_id IS NULL;
    
    -- Hacer la columna NOT NULL y establecer default
    ALTER TABLE public.orders ALTER COLUMN client_tracking_id SET NOT NULL;
    ALTER TABLE public.orders ALTER COLUMN client_tracking_id SET DEFAULT encode(gen_random_bytes(16), 'hex');
    
    RAISE NOTICE 'Columna client_tracking_id agregada exitosamente.';
  ELSE
    RAISE NOTICE 'Columna client_tracking_id ya existe, saltando...';
  END IF;
END $$;

-- =====================================================
-- MIGRACIÓN SEGURA: Agregar supabase_seq_id
-- =====================================================

DO $$
DECLARE
  max_seq_id BIGINT;
BEGIN
  -- Agregar supabase_seq_id si no existe
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'supabase_seq_id'
  ) THEN
    RAISE NOTICE 'Agregando columna supabase_seq_id...';
    
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
    
    -- Obtener el máximo valor asignado
    SELECT COALESCE(MAX(supabase_seq_id), 122) INTO max_seq_id FROM public.orders;
    
    -- Actualizar la secuencia al siguiente valor disponible
    PERFORM setval('orders_supabase_seq_id_seq', max_seq_id + 1, false);
    
    -- Hacer la columna NOT NULL con default de secuencia
    ALTER TABLE public.orders ALTER COLUMN supabase_seq_id SET NOT NULL;
    ALTER TABLE public.orders ALTER COLUMN supabase_seq_id SET DEFAULT nextval('orders_supabase_seq_id_seq');
    
    RAISE NOTICE 'Columna supabase_seq_id agregada. Próximo valor: %', max_seq_id + 1;
  ELSE
    RAISE NOTICE 'Columna supabase_seq_id ya existe, saltando...';
  END IF;
END $$;

-- =====================================================
-- ÍNDICES Y CONSTRAINTS
-- =====================================================

-- Crear índices únicos
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_tracking_id ON public.orders(client_tracking_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_supabase_seq_id ON public.orders(supabase_seq_id);

-- Agregar constraint de validación para client_tracking_id (32 chars hexadecimal)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_client_tracking_id_hex_check'
  ) THEN
    ALTER TABLE public.orders
    ADD CONSTRAINT orders_client_tracking_id_hex_check
    CHECK (client_tracking_id ~ '^[0-9a-f]{32}$');
    
    RAISE NOTICE 'Constraint de validación hexadecimal agregado.';
  ELSE
    RAISE NOTICE 'Constraint de validación ya existe, saltando...';
  END IF;
END $$;

-- =====================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =====================================================

DO $$
DECLARE
  total_orders INTEGER;
  orders_with_tracking_id INTEGER;
  orders_with_seq_id INTEGER;
  min_seq_id BIGINT;
  max_seq_id BIGINT;
BEGIN
  -- Contar registros
  SELECT COUNT(*) INTO total_orders FROM public.orders;
  SELECT COUNT(*) INTO orders_with_tracking_id FROM public.orders WHERE client_tracking_id IS NOT NULL;
  SELECT COUNT(*) INTO orders_with_seq_id FROM public.orders WHERE supabase_seq_id IS NOT NULL;
  
  -- Obtener rango de seq_id
  SELECT MIN(supabase_seq_id), MAX(supabase_seq_id) INTO min_seq_id, max_seq_id FROM public.orders;
  
  -- Mostrar resultados
  RAISE NOTICE '=== VERIFICACIÓN DE MIGRACIÓN ===';
  RAISE NOTICE 'Total de órdenes: %', total_orders;
  RAISE NOTICE 'Órdenes con client_tracking_id: %', orders_with_tracking_id;
  RAISE NOTICE 'Órdenes con supabase_seq_id: %', orders_with_seq_id;
  RAISE NOTICE 'Rango supabase_seq_id: % - %', min_seq_id, max_seq_id;
  
  -- Verificar integridad
  IF total_orders = orders_with_tracking_id AND total_orders = orders_with_seq_id THEN
    RAISE NOTICE '✅ Migración completada exitosamente!';
  ELSE
    RAISE WARNING '⚠️  Posibles inconsistencias detectadas. Revisar manualmente.';
  END IF;
END $$;

COMMIT;

-- =====================================================
-- NOTAS DE USO POST-MIGRACIÓN
-- =====================================================

-- Para mostrar algunos ejemplos de los nuevos IDs:
-- SELECT id, supabase_seq_id, client_tracking_id, status, created_at 
-- FROM public.orders 
-- ORDER BY supabase_seq_id 
-- LIMIT 5;

-- Para buscar por client_tracking_id:
-- SELECT * FROM public.orders WHERE client_tracking_id = 'abc123...';

-- Para buscar por supabase_seq_id:
-- SELECT * FROM public.orders WHERE supabase_seq_id = 123;