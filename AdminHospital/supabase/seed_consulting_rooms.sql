-- Initial data only, no schema changes. Already executed for Hospital Móviles.
-- Run from SQL Editor as postgres, or an authenticated administrator under RLS.
-- No floor is assumed. Existing codes are not modified.
BEGIN;
INSERT INTO public.consulting_rooms(code,active)
SELECT 'CONS-'||lpad(n::text,2,'0'),true FROM generate_series(1,20)n
ON CONFLICT(code) DO NOTHING;
COMMIT;
