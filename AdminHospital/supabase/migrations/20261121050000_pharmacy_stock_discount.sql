-- Farmacia descuenta el inventario al entregar una receta.
-- pendiente → entregada: resta la cantidad de cada medicamento (prescription_items.quantity) y registra la salida en
--   inventory_movements; si algún medicamento no alcanza, no se entrega nada (todo en la misma transacción).
-- entregada → pendiente (corrección): devuelve las cantidades y registra la entrada correspondiente.
-- Sustituye a public.pharmacy_set_prescription_status (misma firma y permisos).
BEGIN;

CREATE OR REPLACE FUNCTION public.pharmacy_set_prescription_status(p_prescription uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.prescriptions%ROWTYPE; line record; sign int;
BEGIN
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN('pendiente','entregada') THEN RAISE EXCEPTION 'Estado no permitido: usa Pendiente o Entregada' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.prescriptions WHERE id=p_prescription FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Receta no encontrada' USING ERRCODE='P0002'; END IF;
 IF v.status='anulada' THEN RAISE EXCEPTION 'La receta está anulada y no puede cambiar de estado' USING ERRCODE='22023'; END IF;
 IF v.status<>p_status THEN
  sign := CASE WHEN p_status='entregada' THEN -1 ELSE 1 END;
  -- Bloquea los medicamentos en orden estable para que dos entregas simultáneas no descuenten de más.
  FOR line IN
    SELECT i.medication_id, sum(i.quantity)::int AS qty, m.name, m.stock
    FROM public.prescription_items i JOIN public.medications m ON m.id=i.medication_id
    WHERE i.prescription_id=v.id GROUP BY i.medication_id, m.name, m.stock ORDER BY i.medication_id
  LOOP
   PERFORM 1 FROM public.medications WHERE id=line.medication_id FOR UPDATE;
   IF sign<0 AND (SELECT stock FROM public.medications WHERE id=line.medication_id) < line.qty THEN
    RAISE EXCEPTION 'Stock insuficiente de %: se necesitan % y hay %', line.name, line.qty,
      (SELECT stock FROM public.medications WHERE id=line.medication_id) USING ERRCODE='22023';
   END IF;
   UPDATE public.medications SET stock=stock+sign*line.qty WHERE id=line.medication_id;
   INSERT INTO public.inventory_movements(medication_id,quantity_delta,reason,actor_id)
   VALUES(line.medication_id, sign*line.qty,
     CASE WHEN sign<0 THEN 'Entrega de receta ' ELSE 'Corrección: receta devuelta a pendiente ' END||coalesce(v.prescription_code,''), auth.uid());
  END LOOP;
  UPDATE public.prescriptions SET status=p_status, status_updated_at=now(), status_updated_by=auth.uid() WHERE id=v.id RETURNING * INTO v;
 END IF;
 RETURN jsonb_build_object('id',v.id,'status',v.status,'status_updated_at',v.status_updated_at);
END $$;
REVOKE ALL ON FUNCTION public.pharmacy_set_prescription_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pharmacy_set_prescription_status(uuid,text) TO authenticated;

COMMIT;
