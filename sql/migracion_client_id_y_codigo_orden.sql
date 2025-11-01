-- Script de migración para implementar el código aleatorio de órdenes y corregir client_id
-- Fecha: 2024

-- 1. Eliminar la secuencia antigua que ya no se necesita
DROP SEQUENCE IF EXISTS public.orders_short_id_seq;

-- 2. Crear la nueva función para generar códigos aleatorios en formato ORD-YYYYMMDD-RANDOM
CREATE OR REPLACE FUNCTION public.generate_order_short_id()
RETURNS TEXT AS $$
DECLARE
    fecha_actual TEXT;
    codigo_aleatorio TEXT;
BEGIN
    -- Formato: ORD-YYYYMMDD-RANDOM
    fecha_actual := to_char(current_date, 'YYYYMMDD');
    codigo_aleatorio := upper(substring(md5(random()::text) from 1 for 6));
    RETURN 'ORD-' || fecha_actual || '-' || codigo_aleatorio;
END;
$$ LANGUAGE plpgsql;

-- 3. Crear índice para mejorar el rendimiento de búsquedas por short_id
CREATE INDEX IF NOT EXISTS idx_orders_short_id ON public.orders(short_id);

-- 4. Asegurarse de que la columna client_id existe en la tabla orders
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'orders' 
        AND column_name = 'client_id'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN client_id UUID REFERENCES auth.users(id);
        CREATE INDEX IF NOT EXISTS idx_orders_client_id ON public.orders(client_id);
    END IF;
END $$;

-- 5. Actualizar las políticas RLS para permitir a los clientes ver sus propias órdenes
CREATE POLICY IF NOT EXISTS "clients_view_own_orders" ON public.orders
FOR SELECT USING (client_id = auth.uid());

-- 6. Regenerar los códigos de órdenes existentes (opcional - usar con precaución)
-- Comentado por defecto para evitar cambios no deseados en datos existentes
/*
UPDATE public.orders
SET short_id = public.generate_order_short_id()
WHERE true;
*/

-- Nota: El código en cliente.js debe ser actualizado para asignar correctamente el client_id
-- cuando un usuario autenticado crea una orden.