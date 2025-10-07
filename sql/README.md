# Estructura de Base de Datos para TLC

Este directorio contiene los archivos SQL necesarios para configurar la base de datos en Supabase para el proyecto TLC (Transporte, Logística y Carga).

## Esquema de la Base de Datos

El archivo `schema.sql` contiene todas las definiciones de tablas, índices, funciones y triggers necesarios para el funcionamiento del sistema. A continuación se describe cada tabla:

### Tablas Principales

1. **users**: Almacena información de usuarios, tanto clientes como colaboradores y administradores.
   - Campos clave: id, name, email, phone, role, password_hash

2. **vehicles**: Catálogo de vehículos disponibles para los servicios.
   - Campos clave: id, name, type, capacity, is_active

3. **services**: Catálogo de servicios ofrecidos (Mudanza, Transporte Comercial, Carga Pesada).
   - Campos clave: id, name, description, base_price, is_active

4. **orders**: Registra todas las solicitudes de servicio realizadas por los clientes.
   - Campos clave: id, client_id, service_id, vehicle_id, pickup_address, delivery_address, status, price, assigned_to
   - Incluye coordenadas geográficas (lat/lng) para integración con Google Maps

### Tablas Secundarias

5. **performance**: Métricas de rendimiento de los colaboradores.
   - Campos clave: collaborator_id, orders_completed, total_earnings, average_rating

6. **invoices**: Registro de facturas generadas para cada orden.
   - Campos clave: order_id, invoice_number, subtotal, tax, total

7. **notifications**: Sistema de notificaciones para usuarios.
   - Campos clave: user_id, title, message, type, is_read

## Relaciones entre Tablas

- Un **usuario** puede tener muchas **órdenes** (como cliente) o muchas **órdenes asignadas** (como colaborador)
- Una **orden** está asociada a un **servicio** y un **vehículo** específicos
- Una **orden** puede tener una **factura** asociada
- Un **colaborador** tiene registros de **rendimiento** asociados
- Los **usuarios** reciben **notificaciones**

## Índices

Se han creado índices para optimizar las consultas más frecuentes:

- Búsqueda de órdenes por cliente
- Búsqueda de órdenes por colaborador asignado
- Filtrado de órdenes por estado
- Filtrado de órdenes por fecha programada

## Funciones y Triggers

Se incluye una función `update_updated_at_column()` y triggers asociados para mantener automáticamente actualizado el campo `updated_at` en todas las tablas cuando se modifican registros.

## Implementación en Supabase

Para implementar este esquema en Supabase:

1. Inicia sesión en tu proyecto de Supabase
2. Ve a la sección "SQL Editor"
3. Crea una nueva consulta
4. Copia y pega el contenido de `schema.sql`
5. Ejecuta la consulta

## Integración con la Aplicación

La aplicación web de TLC utiliza almacenamiento local (localStorage) para simular la persistencia de datos. Para migrar a Supabase:

1. Actualiza las funciones de carga/guardado en los archivos JS para usar la API de Supabase
2. Implementa autenticación usando Supabase Auth
3. Actualiza las consultas para usar la API de Supabase en lugar de manipular objetos locales

## Notas Adicionales

- La estructura incluye soporte para coordenadas geográficas para la integración con Google Maps
- El sistema de facturas está diseñado para generar y enviar facturas automáticamente
- El esquema soporta un sistema de notificaciones en tiempo real