-- Inventario de medicamentos para administración (enunciado: «Administración de recursos e inventarios»).
-- Sin cambios de tablas ni de RLS: lecturas y escrituras por RPC SECURITY DEFINER exclusivas de administración.
--   inventory_overview(): catálogo con estado de stock y últimos 30 movimientos (con responsable).
--   save_medication(): alta y edición del catálogo; el stock inicial se registra como movimiento de entrada.
-- Las entradas posteriores siguen usando public.add_inventory (ya desplegada) y la dispensación de farmacia descuenta stock.
BEGIN;

CREATE OR REPLACE FUNCTION public.inventory_overview()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object(
  'medications', coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'presentation',m.presentation,'strength',m.strength,
      'stock',m.stock,'minimum_stock',m.minimum_stock,'active',m.active) ORDER BY m.active DESC, m.name) FROM public.medications m),'[]'::jsonb),
  'movements', coalesce((SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
      SELECT jsonb_build_object('id',v.id,'created_at',v.created_at,'quantity',v.quantity_delta,'reason',v.reason,
        'medication',concat_ws(' ',m.name,m.strength),'actor',coalesce(nullif(concat_ws(' ',p.first_name,p.last_name),''),'Sistema')) x
      FROM public.inventory_movements v JOIN public.medications m ON m.id=v.medication_id LEFT JOIN public.profiles p ON p.id=v.actor_id
      ORDER BY v.created_at DESC, v.id DESC LIMIT 30) t),'[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION public.save_medication(p_name text, p_presentation text, p_strength text, p_minimum integer,
  p_active boolean, p_initial integer DEFAULT 0, p_id uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF nullif(trim(p_name),'') IS NULL OR length(p_name)>200 OR coalesce(length(p_presentation),0)>200 OR coalesce(length(p_strength),0)>100
    OR p_minimum IS NULL OR p_minimum<0 OR p_active IS NULL OR coalesce(p_initial,0)<0 THEN
   RAISE EXCEPTION 'Revisa nombre, presentación, concentración y stock mínimo' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.medications WHERE lower(name)=lower(trim(p_name)) AND coalesce(lower(strength),'')=coalesce(lower(trim(p_strength)),'')
    AND (p_id IS NULL OR id<>p_id)) THEN
   RAISE EXCEPTION 'Ya existe un medicamento con ese nombre y concentración' USING ERRCODE='23505'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.medications(name,presentation,strength,stock,minimum_stock,active)
  VALUES(trim(p_name),nullif(trim(p_presentation),''),nullif(trim(p_strength),''),coalesce(p_initial,0),p_minimum,p_active) RETURNING id INTO v;
  IF coalesce(p_initial,0)>0 THEN
   INSERT INTO public.inventory_movements(medication_id,quantity_delta,reason,actor_id) VALUES(v,p_initial,'Stock inicial',auth.uid());
  END IF;
 ELSE
  UPDATE public.medications SET name=trim(p_name),presentation=nullif(trim(p_presentation),''),strength=nullif(trim(p_strength),''),
    minimum_stock=p_minimum,active=p_active WHERE id=p_id RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'Medicamento inexistente' USING ERRCODE='P0002'; END IF;
 END IF;
 RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.inventory_overview(), public.save_medication(text,text,text,integer,boolean,integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_overview(), public.save_medication(text,text,text,integer,boolean,integer,uuid) TO authenticated;

COMMIT;
