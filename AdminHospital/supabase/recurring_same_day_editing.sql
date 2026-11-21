-- Permit complete/weekday edits today; preserve all other deployed guards.
-- Does not rerun the original migration or change employee data.
DO $$
DECLARE definition text;
BEGIN
 definition = pg_get_functiondef('public.save_recurring_journey_scope(jsonb,uuid,text,uuid,integer,jsonb,boolean)'::regprocedure);
 IF position('effective<=today' in definition) = 0 THEN
  RAISE EXCEPTION 'Expected date guard not found; inspect the deployed function before applying';
 END IF;
 definition = replace(definition, 'effective<=today', 'effective<today');
 definition = replace(definition, 'una fecha efectiva futura', 'una fecha efectiva de hoy o posterior');
 EXECUTE definition;
END $$;
NOTIFY pgrst, 'reload schema';
