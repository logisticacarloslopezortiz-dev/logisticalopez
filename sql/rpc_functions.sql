-- sql/rpc_functions.sql

-- Función para obtener métricas de rendimiento consolidadas para un colaborador.
-- Esta función es segura para ser llamada desde el cliente (RLS se aplica).
create or replace function get_collaborator_performance(p_collaborator_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  -- Declaración de variables para almacenar los resultados
  v_completed_orders int;
  v_active_orders int;
  v_total_assigned int;
  v_success_rate numeric;
  v_avg_completion_minutes numeric;
  v_weekly_performance jsonb;
  v_services_distribution jsonb;
  v_vehicles_distribution jsonb;
  v_recent_history jsonb;
begin
  -- 1. Calcular órdenes completadas
  select count(*)
  into v_completed_orders
  from public.orders
  where assigned_to = p_collaborator_id and status = 'Completada';

  -- 2. Calcular órdenes activas
  select count(*)
  into v_active_orders
  from public.orders
  where assigned_to = p_collaborator_id and status = 'En proceso';

  -- 3. Calcular total de órdenes asignadas (para tasa de éxito)
  select count(*)
  into v_total_assigned
  from public.orders
  where assigned_to = p_collaborator_id and status in ('Completada', 'Cancelada');

  -- 4. Calcular tasa de éxito
  if v_total_assigned > 0 then
    v_success_rate := (v_completed_orders::numeric / v_total_assigned::numeric) * 100;
  else
    v_success_rate := 100.0; -- Si no hay órdenes, la tasa es del 100%
  end if;

  -- 5. Calcular tiempo promedio de finalización en minutos
  select avg(extract(epoch from (completed_at - created_at)) / 60)
  into v_avg_completion_minutes
  from public.orders
  where assigned_to = p_collaborator_id and status = 'Completada' and completed_at is not null;

  -- 6. Obtener rendimiento semanal (órdenes completadas por día de la semana actual)
  with week_days as (
    select generate_series(
      date_trunc('week', now()),
      date_trunc('week', now()) + interval '6 days',
      '1 day'::interval
    )::date as day
  ),
  completed_this_week as (
    select
      date_trunc('day', completed_at)::date as completion_day,
      count(*) as daily_count
    from public.orders
    where assigned_to = p_collaborator_id
      and status = 'Completada'
      and completed_at >= date_trunc('week', now())
    group by 1
  )
  select jsonb_agg(
    jsonb_build_object(
      'day', to_char(wd.day, 'Dy'),
      'count', coalesce(ctw.daily_count, 0)
    ) order by wd.day
  )
  into v_weekly_performance
  from week_days wd
  left join completed_this_week ctw on wd.day = ctw.completion_day;

  -- 7. Obtener distribución por tipo de servicio
  select jsonb_object_agg(s.name, stats.count)
  into v_services_distribution
  from (
    select service_id, count(*) as count
    from public.orders
    where assigned_to = p_collaborator_id
    group by service_id
  ) stats
  join public.services s on stats.service_id = s.id;

  -- 8. Obtener distribución por tipo de vehículo
  select jsonb_object_agg(v.name, stats.count)
  into v_vehicles_distribution
  from (
    select vehicle_id, count(*) as count
    from public.orders
    where assigned_to = p_collaborator_id
    group by vehicle_id
  ) stats
  join public.vehicles v on stats.vehicle_id = v.id;

  -- 9. Obtener historial reciente (últimas 5 órdenes completadas)
  select jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'short_id', o.short_id,
      'completed_at', to_char(o.completed_at, 'YYYY-MM-DD HH24:MI'),
      'service_name', s.name,
      'vehicle_name', v.name,
      'completion_time_minutes', extract(epoch from (o.completed_at - o.created_at)) / 60
    )
  )
  into v_recent_history
  from (
    select *
    from public.orders
    where assigned_to = p_collaborator_id and status = 'Completada'
    order by completed_at desc
    limit 5
  ) o
  left join public.services s on o.service_id = s.id
  left join public.vehicles v on o.vehicle_id = v.id;

  -- Construir el JSON de respuesta final
  return jsonb_build_object(
    'completed_orders', coalesce(v_completed_orders, 0),
    'active_orders', coalesce(v_active_orders, 0),
    'success_rate', round(coalesce(v_success_rate, 100), 2),
    'avg_completion_minutes', round(coalesce(v_avg_completion_minutes, 0)),
    'weekly_performance', coalesce(v_weekly_performance, '[]'::jsonb),
    'services_distribution', coalesce(v_services_distribution, '{}'::jsonb),
    'vehicles_distribution', coalesce(v_vehicles_distribution, '{}'::jsonb),
    'recent_history', coalesce(v_recent_history, '[]'::jsonb)
  );
end;
$$;
