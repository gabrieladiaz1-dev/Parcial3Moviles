-- Advance a future recurring definition without rewriting its original dates.
DO $$
DECLARE definition text;
BEGIN
 definition=pg_get_functiondef('public.save_recurring_journey_scope(jsonb,uuid,text,uuid,integer,jsonb,boolean)'::regprocedure);
 IF position('effective<old.valid_from OR (' in definition)=0 OR position('effective<today' in definition)=0 THEN
  RAISE EXCEPTION 'Unexpected deployed guards; inspect before applying';
 END IF;
 definition=replace(definition,'effective<old.valid_from OR (old.valid_until IS NOT NULL AND effective>old.valid_until)', '(old.valid_until IS NOT NULL AND effective>old.valid_until)');
 definition=replace(definition,'SET closed_on=effective,active=false', 'SET closed_on=greatest(effective,valid_from),active=false');
 definition=replace(definition,'old.specialty_id,effective,old.valid_until', 'old.specialty_id,greatest(effective,old.valid_from),old.valid_until');
 definition=replace(definition,'j.valid_from>effective OR NOT EXISTS', 'NOT EXISTS');
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
