-- =============================================================
--        MIGRACIÓN: SISTEMA DE CÓDIGOS DE ORDEN ALEATORIOS
-- =============================================================

-- Eliminar la secuencia antigua que ya no se necesita
DROP SEQUENCE IF EXISTS public.orders_short_id_seq;

-- Crear nueva función para generar códigos de orden aleatorios
CREATE OR REPLACE FUNCTION public.generate_order_short_id()
RETURNS TEXT AS $$
DECLARE
    random_part TEXT;
    date_part TEXT;
BEGIN
    -- Generar parte aleatoria (equivalente a Math.random().toString(36).substring(2, 8).toUpperCase())
    random_part := upper(substring(md5(random()::text) from 1 for 6));
    
    -- Obtener fecha actual en formato YYYYMMDD
    date_part := to_char(current_date, 'YYYYMMDD');
    
    -- Combinar en formato ORD-YYYYMMDD-RANDOM
    RETURN 'ORD-' || date_part || '-' || random_part;
END;
$$ LANGUAGE plpgsql;

-- Actualizar el trigger para usar el nuevo formato de URL
CREATE OR REPLACE FUNCTION public.set_order_tracking_url()
RETURNS trigger AS $$
BEGIN
  IF new.tracking_url IS NULL OR new.tracking_url = '' THEN
    new.tracking_url := '/seguimiento.html?codigo=' || coalesce(new.short_id::text, new.id::text);
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- Crear índice para mejorar búsquedas por short_id
CREATE INDEX IF NOT EXISTS idx_orders_short_id ON public.orders(short_id);

-- =============================================================
--                      FIN DE LA MIGRACIÓN
-- =============================================================