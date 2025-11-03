-- Agrega columna para guardar la suscripción push por cliente
-- Permite almacenar el objeto de suscripción (endpoint, keys, etc.)
-- en formato JSONB para notificaciones PWA.

begin;

alter table if exists public.clients
  add column if not exists push_subscription jsonb;

comment on column public.clients.push_subscription is 'Suscripción push del cliente (JSON), usada para enviar notificaciones PWA';

commit;