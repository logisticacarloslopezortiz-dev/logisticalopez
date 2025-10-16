-- Esquema de Base de Datos para TLC Admin v2.0
-- Este esquema está diseñado para coincidir con la estructura de datos
-- utilizada en los archivos JavaScript del proyecto (cliente.js, inicio.js, etc.).

-- Habilitar la extensión para generar UUIDs si no está habilitada.
-- create extension if not exists "uuid-ossp"

-- -------------------------------------------------------------
-- Tabla: orders
-- Almacena todas las solicitudes de servicio.
-- -------------------------------------------------------------
CREATE TABLE public.orders (
    -- Columnas principales
    id TEXT PRIMARY KEY, -- ID generado por la app (ej: "TLC-01")
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    -- Datos del cliente
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    rnc TEXT,
    empresa TEXT,

    -- Detalles del servicio
    service TEXT,
    vehicle TEXT,
    service_questions JSONB, -- Para guardar las preguntas y respuestas específicas del servicio.

    -- Detalles de la ruta
    pickup TEXT,
    delivery TEXT,

    -- Fecha y Hora
    "date" DATE,
    "time" TIME,

    -- Estado y Asignación
    status TEXT DEFAULT 'Pendiente', -- Pendiente, En proceso, Completado
    assigned_to TEXT, -- Nombre del colaborador
    assigned_email TEXT, -- Email del colaborador
    assigned_at TIMESTAMP WITH TIME ZONE,
    last_collab_status TEXT, -- Último estado reportado por el colaborador (ej: 'en_camino_recoger')
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by TEXT, -- Email del colaborador que completó

    -- Finanzas y seguimiento
    estimated_price TEXT DEFAULT 'Por confirmar',
    tracking JSONB, -- Historial de estados para el cliente
    synced BOOLEAN DEFAULT false, -- Para futuras sincronizaciones
    push_subscription JSONB -- Almacena el objeto de suscripción para notificaciones push
);

-- Comentarios sobre la tabla 'orders'
COMMENT ON TABLE public.orders IS 'Tabla principal que contiene todas las solicitudes de servicio.';
COMMENT ON COLUMN public.orders.id IS 'ID único de la orden, generado por la aplicación (ej: TLC-01).';
COMMENT ON COLUMN public.orders.service_questions IS 'Almacena un objeto JSON con preguntas y respuestas del modal de servicio.';
COMMENT ON COLUMN public.orders.last_collab_status IS 'Último estado reportado por el colaborador desde su panel.';
COMMENT ON COLUMN public.orders.tracking IS 'Historial de cambios de estado para la vista del cliente.';

-- Índices para optimizar búsquedas comunes
CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_orders_date ON public.orders("date");
CREATE INDEX idx_orders_assigned_email ON public.orders(assigned_email);


-- -------------------------------------------------------------
-- Tabla: collaborators
-- Almacena la información de los colaboradores (chóferes, operadores).
-- -------------------------------------------------------------
CREATE TABLE public.collaborators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    "password" TEXT NOT NULL, -- En un futuro, debería ser un hash.
    "role" TEXT, -- administrador, chofer, operador
    status TEXT DEFAULT 'activo' -- activo, inactivo
);

-- Comentarios sobre la tabla 'collaborators'
COMMENT ON TABLE public.collaborators IS 'Almacena los usuarios internos del sistema (dueños, chóferes, etc.).';


-- -------------------------------------------------------------
-- Tabla: business_settings
-- Almacena la configuración general del negocio.
-- -------------------------------------------------------------
CREATE TABLE public.business_settings (
    id INT PRIMARY KEY DEFAULT 1, -- Solo habrá una fila en esta tabla
    business_name TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    logo_url TEXT,
    quotation_config JSONB, -- Para guardar toda la configuración de tarifas
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT single_row_constraint CHECK (id = 1)
);

-- Comentarios sobre la tabla 'business_settings'
COMMENT ON TABLE public.business_settings IS 'Configuración global del negocio. Solo debe contener una fila.';
COMMENT ON COLUMN public.business_settings.quotation_config IS 'Almacena un objeto JSON con las tarifas base y multiplicadores.';

-- Insertar la fila de configuración inicial
INSERT INTO public.business_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------
-- Tabla: services
-- Almacena los servicios que ofrece el negocio.
-- -------------------------------------------------------------
CREATE TABLE public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    image_url TEXT,
    is_active BOOLEAN DEFAULT true
);

COMMENT ON TABLE public.services IS 'Catálogo de servicios ofrecidos por el negocio.';

-- -------------------------------------------------------------
-- Tabla: vehicles
-- Almacena los vehículos disponibles para los servicios.
-- -------------------------------------------------------------
CREATE TABLE public.vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    name TEXT NOT NULL UNIQUE,
    description TEXT, -- ej: "14 pies", "Capacidad para 5 toneladas"
    image_url TEXT,
    is_active BOOLEAN DEFAULT true
);

COMMENT ON TABLE public.vehicles IS 'Catálogo de vehículos disponibles para los servicios.';

-- -------------------------------------------------------------
-- Datos Iniciales (Semillas)
-- Ejecuta estas inserciones para poblar las tablas con los datos
-- que actualmente tienes en tu frontend.
-- -------------------------------------------------------------



-- Insertar vehículos iniciales
INSERT INTO public.vehicles (name, description, image_url, is_active) VALUES
('Camión Pequeño', '14 pies', 'https://images.pexels.com/photos/2199293/pexels-photo-2199293.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true),
('Furgoneta', 'Ideal para paquetería y cargas ligeras', 'https://images.pexels.com/photos/4392036/pexels-photo-4392036.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true),
('Grúa Vehicular', 'Para remolque de autos y jeepetas', 'https://images.pexels.com/photos/6871636/pexels-photo-6871636.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true),
('Camión Grande', '22 a 28 pies', 'https://images.pexels.com/photos/1437593/pexels-photo-1437593.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true),
('Camión Especial', 'Configuración para necesidades específicas', 'https://images.pexels.com/photos/7213431/pexels-photo-7213431.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true),
('Grúa de Carga', 'Para izado y movimiento de carga', 'https://images.pexels.com/photos/5969512/pexels-photo-5969512.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true),
('Motor', 'Para paquetería y entregas rápidas', 'https://images.pexels.com/photos/8435503/pexels-photo-8435503.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true),
('Camión Abierto', 'Carga y transporte de materiales y mineros', 'https://images.pexels.com/photos/8995733/pexels-photo-8995733.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  image_url = EXCLUDED.image_url,
  is_active = EXCLUDED.is_active;

-- Insertar servicios con imágenes
INSERT INTO public.services (name, description, image_url, is_active) VALUES
('Mudanza', 'Servicios completos de mudanza residencial y comercial.', 'https://images.pexels.com/photos/424620/pexels-photo-424620.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true),
('Transporte Comercial', 'Transporte seguro de mercancías comerciales.', 'https://images.pexels.com/photos/7675638/pexels-photo-7675638.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true),
('Carga Pesada', 'Especialistas en transporte de carga pesada.', 'https://images.pexels.com/photos/11785533/pexels-photo-11785533.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true),
('Flete', 'Servicios de flete a todo nivel nacional.', 'https://images.pexels.com/photos/5025517/pexels-photo-5025517.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true),
('Grúa Vehículo', 'Servicio con grúa para vehículos.', 'https://images.pexels.com/photos/6871636/pexels-photo-6871636.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true),
('Paquetería', 'Envíos de paquetes seguros y rápidos.', 'https://images.pexels.com/photos/7709293/pexels-photo-7709293.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true),
('Grúa de Carga', 'Servicio con grúa para mover carga pesada.', 'https://images.pexels.com/photos/5969512/pexels-photo-5969512.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true),
('Botes Mineros', 'Servicio de alquiler y transporte de botes para desechos.', 'https://images.pexels.com/photos/6755436/pexels-photo-6755436.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1', true)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    image_url = EXCLUDED.image_url,
    is_active = EXCLUDED.is_active;
