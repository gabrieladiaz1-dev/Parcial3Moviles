// Ambulancia: prueba de supabase/ambulancia-paciente.sql en un PostgreSQL 17 LOCAL y desechable (Docker). Nunca toca Supabase.
// Carga la copia de producción (scripts/fixtures/ambulancia-produccion-2026-11-21.sql: tablas, índices, RLS y RPC administrativas
// tal como están desplegadas), aplica la migración y ejecuta las pruebas A–H con sesiones concurrentes reales (procesos psql
// paralelos, transacciones solapadas con pg_sleep). Uso: node scripts/test-ambulance-sql.mjs  (requiere Docker + postgres:17-alpine)
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const name = 'hu-ambulance-test-' + process.pid;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const psqlArgs = ['exec', '-i', name, 'psql', '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'];
const psql = (sql) => execFileSync('docker', psqlArgs, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const psqlAsync = (sql) => new Promise((resolve) => {
  const child = spawn('docker', psqlArgs); let out = '', err = '';
  child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
  child.on('close', code => resolve(code ? { ok: false, error: err.trim() } : { ok: true, value: out.trim() })); child.stdin.end(sql);
});
const fails = (sql, pattern, label) => { try { psql(sql); } catch (error) { assert.match(String(error.stderr || error.message), pattern, label); return; } assert.fail('Debía fallar: ' + label); };
const one = (sql) => psql(sql).split('\n').pop();
// Sesión de un usuario autenticado: rol authenticated + sub del JWT, como PostgREST.
const as = (uid, body) => `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub" = '${uid}'; ${body} COMMIT;`;
const asValue = (uid, expression) => one(as(uid, `SELECT ${expression};`));
const results = [];
const ok = (label, fn) => { fn(); results.push(label); console.log('  ✓ ' + label); };
const okAsync = async (label, fn) => { await fn(); results.push(label); console.log('  ✓ ' + label); };

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P1 = id(1), P2 = id(2), P3 = id(3), P4 = id(4), ADMIN1 = id(11), ADMIN2 = id(12), RECEP = id(13);
const submit = (uid, key, extra = '') => `public.submit_my_ambulance_request(p_key => '${key}', p_phone => '7012-3456', p_pickup => 'Colonia Escalón, calle 3, casa 14', p_reason => 'Traslado al hospital'${extra})`;

docker('run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD=local-only', 'postgres:17-alpine');
try {
  for (let i = 0; i < 60; i++) { try { docker('exec', name, 'pg_isready', '-U', 'postgres'); psql('SELECT 1'); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
  psql(readFileSync(new URL('./fixtures/ambulancia-produccion-2026-11-21.sql', import.meta.url), 'utf8'));
  psql(`INSERT INTO profiles(id, first_name, last_name, phone) VALUES
      ('${P1}','Ana','Pérez','7012-3456'), ('${P2}','Luis','Gómez','7111-2222'), ('${P3}','Marta','Ríos',NULL), ('${P4}','Sin','Expediente',NULL),
      ('${ADMIN1}','Admin','Uno',NULL), ('${ADMIN2}','Admin','Dos',NULL), ('${RECEP}','Recepción','Turno',NULL);
    INSERT INTO user_roles(user_id, role) VALUES ('${P1}','paciente'),('${P2}','paciente'),('${P3}','paciente'),('${P4}','paciente'),
      ('${ADMIN1}','admin'),('${ADMIN2}','admin'),('${RECEP}','recepcionista');
    INSERT INTO patients(id, profile_id, first_name, last_name) VALUES ('${id(101)}','${P1}','Ana','Pérez'), ('${id(102)}','${P2}','Luis','Gómez'), ('${id(103)}','${P3}','Marta','Ríos');
    INSERT INTO medical_records(patient_id, record_code) VALUES ('${id(101)}','EXP-1'), ('${id(102)}','EXP-2');`);

  const migration = readFileSync(new URL('../supabase/ambulancia-paciente.sql', import.meta.url), 'utf8');
  ok('La migración se aplica y se puede volver a aplicar sin errores', () => { psql(migration); psql(migration); });
  ok('Realtime: ambulance_requests queda en supabase_realtime', () =>
    assert.equal(one(`SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='ambulance_requests'`), '1'));

  // Prueba A: dos pacientes envían a la vez. Ambas se registran, ninguna se despacha sola.
  let r1, r2;
  await okAsync('A · Dos solicitudes simultáneas se registran; ninguna genera despacho', async () => {
    const [a, b] = await Promise.all([
      psqlAsync(as(P1, `SELECT pg_sleep(0.2); SELECT ${submit(P1, id(201), ", p_reference => 'Portón negro', p_latitude => 13.701234, p_longitude => -89.224567, p_accuracy => 12.5")};`)),
      psqlAsync(as(P2, `SELECT pg_sleep(0.2); SELECT ${submit(P2, id(202))};`))]);
    assert.ok(a.ok && b.ok, (a.error || '') + (b.error || ''));
    r1 = a.value.split('\n').pop(); r2 = b.value.split('\n').pop();
    assert.notEqual(r1, r2);
    assert.equal(one(`SELECT count(*) FROM ambulance_requests WHERE status='pendiente'`), '2');
    assert.equal(one(`SELECT count(*) FROM ambulance_dispatches`), '0');
    assert.equal(one(`SELECT status FROM ambulances`), 'disponible');
  });
  ok('La identidad sale de la sesión: nombre del perfil, solicitante, expediente, prioridad normal, sin destino', () => {
    assert.equal(one(`SELECT concat_ws('|', contact_name, requester_id, patient_id, priority, coalesce(destination,'-'), pickup_latitude, pickup_longitude, pickup_accuracy_m) FROM ambulance_requests WHERE id='${r1}'`),
      `Ana Pérez|${P1}|${id(101)}|normal|-|13.701234|-89.224567|12.5`);
  });
  ok('Avisos de recepción: uno por paciente y uno por persona de administración/recepción', () => {
    assert.equal(one(`SELECT count(*) FROM notifications WHERE event_key='ambulance:${r1}:recibida' AND recipient_id='${P1}'`), '1');
    assert.equal(one(`SELECT count(*) FROM notifications WHERE event_key='transport:${r1}:pending'`), '3');
    assert.equal(one(`SELECT count(*) FROM notifications WHERE event_key LIKE 'ambulance:${r1}:%' AND recipient_id<>'${P1}'`), '0');
  });

  // Prueba C: doble pulsación (misma clave) y dos envíos con claves distintas al mismo tiempo.
  await okAsync('C · Doble pulsación con la misma clave → una sola solicitud', async () => {
    const both = await Promise.all([0, 1].map(() => psqlAsync(as(P3, `SELECT pg_sleep(0.15); SELECT ${submit(P3, id(301))};`))));
    assert.ok(both.every(x => x.ok), both.map(x => x.error).join(' '));
    assert.equal(both[0].value.split('\n').pop(), both[1].value.split('\n').pop());
    assert.equal(one(`SELECT count(*) FROM ambulance_requests WHERE requester_id='${P3}'`), '1');
    assert.equal(one(`SELECT count(*) FROM notifications WHERE recipient_id='${P3}'`), '1');
  });
  await okAsync('C · Dos claves distintas a la vez → una sola solicitud activa por paciente', async () => {
    const both = await Promise.all([id(401), id(402)].map(key => psqlAsync(as(P4, `SELECT pg_sleep(0.15); SELECT ${submit(P4, key)};`))));
    assert.equal(both.filter(x => x.ok).length, 1);
    assert.match(both.find(x => !x.ok).error, /Ya tienes una solicitud de ambulancia activa/);
    assert.equal(one(`SELECT count(*) FROM ambulance_requests WHERE requester_id='${P4}'`), '1');
    assert.equal(one(`SELECT patient_id IS NULL FROM ambulance_requests WHERE requester_id='${P4}'`), 't', 'Sin expediente: solicitud con requester_id');
  });
  ok('Validaciones del servidor (sin crear filas)', () => {
    psql(`UPDATE ambulance_requests SET status='cancelada', decision_reason='prueba' WHERE requester_id='${P4}'`);
    const before = one(`SELECT count(*) FROM ambulance_requests`);
    fails(as(P4, `SELECT public.submit_my_ambulance_request('${id(403)}', '12', 'Colonia Escalón', 'Traslado');`), /teléfono de contacto válido/, 'teléfono');
    fails(as(P4, `SELECT public.submit_my_ambulance_request('${id(403)}', '7012-3456', 'Col', 'Traslado');`), /dirección de recogida/, 'dirección');
    fails(as(P4, `SELECT public.submit_my_ambulance_request('${id(403)}', '7012-3456', 'Colonia Escalón', 'x');`), /motivo de la solicitud/, 'motivo');
    fails(as(P4, `SELECT ${submit(P4, id(403), ', p_latitude => 13.7')};`), /ubicación compartida no es válida/, 'coordenadas incompletas');
    fails(as(P4, `SELECT ${submit(P4, id(403), ', p_latitude => 95, p_longitude => 10')};`), /ubicación compartida no es válida/, 'latitud fuera de rango');
    fails(as(P4, `SELECT ${submit(P4, id(403), ", p_alternate_phone => 'abc'")};`), /teléfono alternativo/, 'teléfono alterno');
    assert.equal(one(`SELECT count(*) FROM ambulance_requests`), before);
  });

  // Prueba G: permisos y privacidad.
  ok('G · El paciente solo ve sus solicitudes (tabla y RPC)', () => {
    assert.equal(asValue(P2, `count(*) FROM ambulance_requests WHERE id='${r1}'`), '0');
    assert.equal(asValue(P2, `count(*) FROM ambulance_requests`), '1');
    const context = JSON.parse(asValue(P2, `public.my_ambulance_context()::text`));
    assert.deepEqual(context.requests.map(r => r.id), [r2]);
    assert.equal(context.person.full_name, 'Luis Gómez'); assert.equal(context.unit_available, true);
    assert.equal(JSON.stringify(context).includes('Ana'), false, 'Sin datos de otros pacientes');
  });
  ok('G · El paciente no cancela solicitudes ajenas ni opera la ambulancia', () => {
    fails(as(P2, `SELECT public.cancel_my_ambulance_request('${r1}', 'No la necesito');`), /Solicitud no encontrada/, 'cancelar ajena');
    fails(as(P1, `SELECT public.dispatch_ambulance('${r1}');`), /No autorizado/, 'despachar');
    fails(as(P1, `SELECT public.review_medical_transport('${r1}', 'autorizar', 'Hospital');`), /No autorizado/, 'autorizar');
    fails(as(P1, `SELECT public.save_panel_ambulance('AMB-001', NULL, 'disponible', true, NULL, 1::smallint);`), /Solo administración/, 'estado de unidad');
    fails(as(P1, `UPDATE ambulances SET status='en_servicio';`), /permission denied/, 'UPDATE ambulances');
    fails(as(P1, `UPDATE ambulance_requests SET status='despachada' WHERE id='${r1}';`), /permission denied/, 'UPDATE solicitudes');
    fails(as(P1, `INSERT INTO ambulance_requests(patient_id, requester_id, contact_name, contact_phone, pickup_location, reason, priority, requested_at)
      VALUES ('${id(101)}','${P1}','Ana','70123456','Casa','Urgente','urgente', now() - interval '1 day');`), /row-level security/, 'INSERT directo con prioridad/fecha propias');
    fails(as(P1, `SELECT public.ambulance_service_log();`), /No autorizado/, 'bitácora');
    fails(`BEGIN; SET LOCAL ROLE anon; SELECT public.my_ambulance_context(); COMMIT;`, /permission denied/, 'anon');
    fails(as(ADMIN1, `SELECT public.my_ambulance_context();`), /No autorizado/, 'contexto de paciente para administración');
  });

  // Administración autoriza ambas; Prueba B: dos administradores despachan a la vez solicitudes distintas.
  psql(as(ADMIN1, `SELECT public.review_medical_transport('${r1}', 'autorizar', 'Hospital Universitario');`));
  psql(as(ADMIN2, `SELECT public.review_medical_transport('${r2}', 'autorizar', 'Hospital Universitario');`));
  let winner, loser, dispatch;
  await okAsync('B · Dos despachos simultáneos: uno confirmado, el otro rechazado; un solo servicio activo', async () => {
    const [a, b] = await Promise.all([
      psqlAsync(as(ADMIN1, `SELECT pg_sleep(0.2); SELECT public.dispatch_ambulance('${r1}'); SELECT pg_sleep(0.4);`)),
      psqlAsync(as(ADMIN2, `SELECT pg_sleep(0.2); SELECT public.dispatch_ambulance('${r2}'); SELECT pg_sleep(0.4);`))]);
    assert.equal([a, b].filter(x => x.ok).length, 1, 'Exactamente una asignación');
    assert.match([a, b].find(x => !x.ok).error, /La ambulancia ya no está disponible/);
    [winner, loser] = a.ok ? [r1, r2] : [r2, r1];
    dispatch = (a.ok ? a : b).value.split('\n').pop();
    assert.equal(one(`SELECT count(*) FROM ambulance_dispatches WHERE completed_at IS NULL`), '1');
    assert.equal(one(`SELECT status FROM ambulances`), 'en_servicio');
    assert.equal(one(`SELECT status FROM ambulance_requests WHERE id='${winner}'`), 'despachada');
    assert.equal(one(`SELECT status FROM ambulance_requests WHERE id='${loser}'`), 'autorizada', 'La otra solicitud no se pierde');
  });
  ok('B · Aun saltándose las RPC, el índice único impide un segundo servicio activo', () =>
    fails(`INSERT INTO ambulance_dispatches(request_id, ambulance_id) VALUES ('${loser}', 1);`, /only_one_active_dispatch/, 'índice único'));
  ok('Aviso «Ambulancia asignada» solo al paciente asignado', () => {
    const owner = winner === r1 ? P1 : P2, other = winner === r1 ? P2 : P1;
    assert.equal(one(`SELECT count(*) FROM notifications WHERE recipient_id='${owner}' AND event_key='ambulance:${winner}:asignada'`), '1');
    assert.equal(one(`SELECT count(*) FROM notifications WHERE recipient_id='${other}' AND event_key LIKE '%:asignada'`), '0');
  });
  ok('Cancelación tras el despacho: el paciente no puede; la ambulancia no se libera', () => {
    fails(as(winner === r1 ? P1 : P2, `SELECT public.cancel_my_ambulance_request('${winner}', 'Ya no la necesito');`), /ya fue asignada/, 'cancelar despachada');
    assert.equal(one(`SELECT status FROM ambulances`), 'en_servicio');
  });
  ok('D · Con servicio activo no se puede pasar a mantenimiento', () =>
    fails(as(ADMIN1, `SELECT public.save_panel_ambulance('AMB-001', NULL, 'en_mantenimiento', true, 'Revisión', 1::smallint);`), /servicio activo/, 'mantenimiento'));

  // Seguimiento: salida (dos veces) y llegada; avisos sin duplicados; updated_at avanza.
  ok('Salida repetida → un solo aviso «En camino»; llegada registrada; seguimiento visible para el paciente', () => {
    const owner = winner === r1 ? P1 : P2;
    const before = one(`SELECT updated_at FROM ambulance_requests WHERE id='${winner}'`);
    psql(as(ADMIN1, `SELECT public.progress_medical_transport('${dispatch}', 'salida');`));
    psql(as(ADMIN2, `SELECT public.progress_medical_transport('${dispatch}', 'salida');`));
    psql(as(ADMIN1, `SELECT public.progress_medical_transport('${dispatch}', 'llegada');`));
    assert.equal(one(`SELECT count(*) FROM notifications WHERE event_key='ambulance:${winner}:en_camino'`), '1');
    assert.notEqual(one(`SELECT updated_at FROM ambulance_requests WHERE id='${winner}'`), before);
    const row = JSON.parse(asValue(owner, `public.my_ambulance_context()::text`)).requests[0];
    assert.equal(row.status, 'despachada'); assert.ok(row.assigned_at && row.departed_at && row.arrived_at); assert.equal(row.unit_code, 'AMB-001');
    assert.equal('completion_notes' in row, false, 'Sin notas internas');
  });

  // Prueba E: finalización con controles → Disponible; la solicitud pendiente puede despacharse después.
  ok('E · Finalizar con controles y sin mantenimiento deja la ambulancia Disponible', () => {
    fails(as(ADMIN1, `SELECT public.finish_medical_transport('${dispatch}', false, false);`), /Confirma los controles/, 'sin controles');
    psql(as(ADMIN1, `SELECT public.finish_medical_transport('${dispatch}', true, false, 'Sin novedades');`));
    psql(as(ADMIN1, `SELECT public.finish_medical_transport('${dispatch}', true, false, 'Sin novedades');`));
    assert.equal(one(`SELECT status FROM ambulances`), 'disponible');
    assert.equal(one(`SELECT status FROM ambulance_requests WHERE id='${winner}'`), 'finalizada');
    assert.equal(one(`SELECT count(*) FROM notifications WHERE event_key='ambulance:${winner}:finalizada'`), '1');
    psql(as(ADMIN2, `SELECT public.dispatch_ambulance('${loser}');`));
    assert.equal(one(`SELECT status FROM ambulance_requests WHERE id='${loser}'`), 'despachada');
  });
  ok('Cancelación de un servicio despachado: solo administración, con controles y destino explícito de la unidad', () => {
    const d2 = one(`SELECT id FROM ambulance_dispatches WHERE request_id='${loser}'`);
    psql(as(ADMIN1, `SELECT public.progress_medical_transport('${d2}', 'salida');`));
    fails(as(loser === r1 ? P1 : P2, `SELECT public.cancel_dispatched_transport('${d2}', 'x', true, false);`), /No autorizado/, 'paciente');
    fails(as(ADMIN1, `SELECT public.cancel_dispatched_transport('${d2}', 'Paciente trasladado por familiares', false, false);`), /confirma los controles/, 'sin controles');
    psql(as(ADMIN1, `SELECT public.cancel_dispatched_transport('${d2}', 'Paciente trasladado por familiares', true, true);`));
    psql(as(ADMIN1, `SELECT public.cancel_dispatched_transport('${d2}', 'Paciente trasladado por familiares', true, true);`));
    assert.equal(one(`SELECT status FROM ambulances`), 'en_mantenimiento');
    assert.equal(one(`SELECT concat_ws('|', status, decision_reason) FROM ambulance_requests WHERE id='${loser}'`), 'cancelada|Paciente trasladado por familiares');
    assert.equal(one(`SELECT count(*) FROM notifications WHERE event_key='ambulance:${loser}:cancelada'`), '1');
  });

  // Prueba D: en mantenimiento no se despacha y el paciente no recibe una asignación falsa.
  ok('D · Ambulancia en mantenimiento: no se despacha; la solicitud queda autorizada y sin aviso de asignación', () => {
    const r3 = asValue(P1, submit(P1, id(203)));
    psql(as(ADMIN1, `SELECT public.review_medical_transport('${r3}', 'autorizar', 'Hospital Universitario');`));
    fails(as(ADMIN1, `SELECT public.dispatch_ambulance('${r3}');`), /no está disponible/, 'despacho en mantenimiento');
    assert.equal(one(`SELECT status FROM ambulance_requests WHERE id='${r3}'`), 'autorizada');
    assert.equal(one(`SELECT count(*) FROM notifications WHERE event_key='ambulance:${r3}:asignada'`), '0');
    assert.equal(JSON.parse(asValue(P1, `public.my_ambulance_context()::text`)).unit_available, false);
    psql(as(ADMIN1, `SELECT public.save_panel_ambulance('AMB-001', NULL, 'disponible', true, NULL, 1::smallint);`));
    psql(as(ADMIN1, `SELECT public.dispatch_ambulance('${r3}');`));
    assert.equal(one(`SELECT count(*) FROM ambulance_dispatches WHERE completed_at IS NULL`), '1');
  });

  ok('Cancelación por el paciente antes del despacho, idempotente y visible para administración', () => {
    const r = one(`SELECT id FROM ambulance_requests WHERE requester_id='${P3}'`);
    fails(as(P3, `SELECT public.cancel_my_ambulance_request('${r}', '');`), /motivo de la cancelación/, 'sin motivo');
    psql(as(P3, `SELECT public.cancel_my_ambulance_request('${r}', 'Me trasladó un familiar');`));
    psql(as(P3, `SELECT public.cancel_my_ambulance_request('${r}', 'Me trasladó un familiar');`));
    assert.equal(one(`SELECT status FROM ambulance_requests WHERE id='${r}'`), 'cancelada');
    assert.equal(one(`SELECT count(*) FROM notifications WHERE event_key='ambulance:${r}:cancelada' AND recipient_id='${P3}'`), '1');
    assert.equal(one(`SELECT count(*) FROM notifications WHERE event_key='transport:${r}:cancelada'`), '3');
    assert.equal(one(`SELECT actor_id FROM emergency_logs WHERE request_id='${r}' AND event_type='cancelada'`), P3);
  });

  // Prueba H: bitácora con horas reales y filtros.
  ok('H · Bitácora: servicios finalizados conservan sus horas y se filtran por estado, solicitud, fecha e intervalo', () => {
    const all = JSON.parse(asValue(ADMIN1, `public.ambulance_service_log()::text`));
    assert.equal(all.total, Number(one(`SELECT count(*) FROM ambulance_requests`)));
    const done = JSON.parse(asValue(ADMIN1, `public.ambulance_service_log(p_status => 'finalizada')::text`));
    assert.equal(done.total, 1);
    const s = done.items[0];
    assert.equal(s.request_id, winner);
    for (const key of ['requested_at', 'assigned_at', 'departed_at', 'arrived_at', 'completed_at']) assert.ok(s[key], 'Hora registrada: ' + key);
    assert.equal(s.authorized_by, winner === r1 ? 'Admin Uno' : 'Admin Dos'); assert.ok(s.dispatched_by);
    assert.equal(s.unit_code, 'AMB-001'); assert.equal(s.completion_notes, 'Sin novedades'); assert.ok(s.events.length >= 5);
    assert.equal(JSON.parse(asValue(RECEP, `public.ambulance_service_log(p_request => '${loser}')::text`)).items[0].status, 'cancelada');
    assert.equal(JSON.parse(asValue(ADMIN1, `public.ambulance_service_log(p_from => now() + interval '1 day')::text`)).total, 0);
    assert.equal(JSON.parse(asValue(ADMIN1, `public.ambulance_service_log(p_from => date_trunc('day', now()), p_to => date_trunc('day', now()) + interval '1 day')::text`)).total, all.total);
    fails(as(ADMIN1, `SELECT public.ambulance_service_log(p_from => now(), p_to => now() - interval '1 day');`), /Filtro inválido/, 'intervalo invertido');
  });
  ok('El historial no se puede eliminar (ni siquiera con privilegios de servidor)', () => {
    fails(`DELETE FROM ambulance_requests WHERE id='${winner}';`, /historial de ambulancia no se elimina/, 'solicitud');
    fails(`DELETE FROM ambulance_dispatches;`, /historial de ambulancia no se elimina/, 'despacho');
  });
  ok('Ningún aviso duplicado por destinatario y evento', () =>
    assert.equal(one(`SELECT count(*) FROM (SELECT recipient_id, event_key FROM notifications GROUP BY 1, 2 HAVING count(*) > 1) d`), '0'));
  ok('Nunca hubo dos servicios activos en la ambulancia', () =>
    assert.equal(one(`SELECT max(c) FROM (SELECT count(*) c FROM ambulance_dispatches WHERE completed_at IS NULL GROUP BY ambulance_id) x`), '1'));
  ok('La reversión se aplica y restaura la política original; la migración vuelve a aplicarse', () => {
    psql(readFileSync(new URL('../supabase/ambulancia-paciente-revert.sql', import.meta.url), 'utf8'));
    assert.equal(one(`SELECT count(*) FROM pg_proc WHERE proname IN ('my_ambulance_context','submit_my_ambulance_request','ambulance_service_log')`), '0');
    assert.match(one(`SELECT with_check FROM pg_policies WHERE policyname='ambreq_insert'`), /paciente/);
    psql(migration);
  });
  console.log(`OK Ambulancia SQL: ${results.length} comprobaciones en PostgreSQL desechable (pruebas A, B, C, D, E, G, H y servidor de F)`);
} finally {
  try { docker('rm', '-f', name); } catch {}
}
