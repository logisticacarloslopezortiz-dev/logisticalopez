-- ===========================================
-- PRUEBA COMPLETA DEL SISTEMA DE NOTIFICACIONES
-- ===========================================

-- PASO 1: CONFIGURAR SERVICE ROLE KEY REAL
-- ⚠️ IMPORTANTE: Reemplaza con tu Service Role Key real de Supabase
-- Ve a: https://supabase.com/dashboard/project/[tu-project]/settings/api
-- Copia el "service_role" key

-- select set_config('app.settings.service_role_token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', false);

-- PASO 2: VERIFICAR CONFIGURACIÓN
select
  'process_outbox_url' as config,
  current_setting('app.settings.process_outbox_url', true) as status
union all
select
  'PUSH_INTERNAL_SECRET' as config,
  case when current_setting('PUSH_INTERNAL_SECRET', true) is not null
       then '✓ CONFIGURADO' else '❌ FALTA CONFIGURAR' end as status
union all
select
  'service_role_token' as config,
  case when current_setting('app.settings.service_role_token', true) is not null
       then '✓ CONFIGURADO' else '❌ FALTA CONFIGURAR' end as status;

-- PASO 3: PROBAR FUNCIÓN MANUALMENTE (como admin)
-- Debería devolver: {"ok": true, "status": 200} o un error claro
-- select public.invoke_process_outbox(5);

-- PASO 4: VERIFICAR LOGS DE EJECUCIÓN
-- select fn_name, level, message, payload, created_at
-- from public.function_logs
-- where fn_name = 'process_outbox_tick'
-- order by created_at desc limit 5;

-- PASO 5: VER ESTADO DE NOTIFICACIONES
-- select status, count(*) as cantidad,
--        min(created_at) as mas_antigua,
--        max(created_at) as mas_reciente
-- from public.notification_events
-- group by status
-- order by status;

-- PASO 6: CREAR UNA NOTIFICACIÓN DE PRUEBA
-- insert into public.notifications(user_id, title, body, data)
-- select id, 'Test Push', 'Mensaje de prueba', '{"test": true}'::jsonb
-- from public.profiles
-- where email like '%test%' or email like '%admin%'
-- limit 1;

-- PASO 7: VERIFICAR QUE SE CREÓ EL EVENTO
-- select id, type, target_type, target_id, status, attempts, created_at
-- from public.notification_events
-- where payload->>'test' = 'true'
-- order by created_at desc limit 1;

-- PASO 8: EJECUTAR PROCESAMIENTO MANUAL
-- select public.invoke_process_outbox(10);

-- PASO 9: VERIFICAR QUE SE PROCESÓ
-- select id, status, attempts, processed_at, last_error
-- from public.notification_events
-- where payload->>'test' = 'true'
-- order by created_at desc limit 1;

-- PASO 10: VER LOGS DETALLADOS
-- select * from public.function_logs
-- where created_at > now() - interval '5 minutes'
-- order by created_at desc;

-- ===========================================
-- DIAGNÓSTICO DE PROBLEMAS COMUNES
-- ===========================================

-- Si invoke_process_outbox devuelve error de configuración:
-- ❌ Solución: Configurar service_role_token real

-- Si devuelve {"ok": false, "status": 401}:
-- ❌ Problema: Secreto interno no coincide con Edge Function
-- ✅ Solución: Verificar PUSH_INTERNAL_SECRET en Edge Function

-- Si devuelve {"ok": false, "status": 500}:
-- ❌ Problema: Error en Edge Function
-- ✅ Solución: Ver logs de Edge Function en Supabase Dashboard

-- Si no hay eventos procesados:
-- ❌ Problema: claim_notification_events no encuentra eventos
-- ✅ Solución: Verificar que hay eventos en estado 'pending'

-- Si pg_cron no ejecuta:
-- ❌ Problema: Ver logs de function_logs para confirmar ejecución
-- ✅ Solución: Verificar configuración de pg_cron