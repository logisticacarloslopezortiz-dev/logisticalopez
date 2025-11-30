CREATE OR REPLACE FUNCTION get_collaborator_earnings_report(start_date date, end_date date)
RETURNS TABLE(
    collaborator_id uuid,
    collaborator_name text,
    service_count bigint,
    total_collected numeric,
    collaborator_commission numeric,
    partner_fee numeric
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id AS collaborator_id,
        p.full_name AS collaborator_name,
        COUNT(o.id) AS service_count,
        SUM(o.monto_cobrado) AS total_collected,
        SUM(o.monto_cobrado) * (p.commission_rate / 100.0) AS collaborator_commission,
        SUM(o.monto_cobrado) * 0.05 AS partner_fee
    FROM
        public.orders o
    JOIN
        public.profiles p ON o.completed_by = p.id
    WHERE
        o.status = 'Completada' AND
        o.completed_at >= start_date AND
        o.completed_at <= end_date
    GROUP BY
        p.id, p.full_name, p.commission_rate
    ORDER BY
        collaborator_name;
END;
$$ LANGUAGE plpgsql;
