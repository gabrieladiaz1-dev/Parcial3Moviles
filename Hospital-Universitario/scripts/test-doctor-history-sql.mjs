// Prueba de supabase/medico-historial-detallado.sql en PostgreSQL 17 LOCAL y desechable (Docker). Nunca toca Supabase.
// 1) Carga la copia de producción (scripts/fixtures/medico-historial-produccion-2026-11-21.sql) y comprueba que el hash normalizado
//    de cada función coincide con el desplegado. 2) Guarda la salida actual como médico autorizado. 3) Aplica la migración y
//    comprueba que la salida anterior se conserva idéntica y solo se AÑADEN items/doctor_name y cancellation_reason/cancelled_at.
// 4) Recetas con uno y varios medicamentos, entregada y pendiente, concentración ausente, médico sin autorización.
// Uso: node scripts/test-doctor-history-sql.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const name = 'hu-doctor-history-' + process.pid;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const psql = sql => execFileSync('docker', ['exec', '-i', name, 'psql', '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const one = sql => psql(sql).split('\n').pop();
const as = (profile, expression) => one(`BEGIN; SET LOCAL "request.jwt.claim.sub" = '${profile}'; SELECT ${expression}; COMMIT;`);
const fails = (sql, pattern, label) => { try { psql(sql); } catch (e) { assert.match(String(e.stderr || e.message), pattern, label); return; } assert.fail('Debía fallar: ' + label); };
const results = []; const ok = (label, fn) => { fn(); results.push(label); console.log('  ✓ ' + label); };
// Hash normalizado de producción (consulta de solo lectura del 21 nov 2026).
const production = { doctor_native_chart: 'e645d5e4e7dcdcb1cc3ae662409587f7', doctor_native_workspace: 'f4b1fc092554f840feea3498211fa5a0',
  has_role: 'a6bc1344bad162140909a1189518085a', my_staff_id: '0ba8add02dd800bc0280563588054653', native_doctor_id: 'a3ff4133ec57e6ce98edd9504b5f2464',
  treats_patient: '120c306ce37668dbfbdc5e82d92c3407' };
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U1 = id(1), U2 = id(2), S1 = id(11), S2 = id(12), PAT = id(21), PAT2 = id(22), REC = id(31), REC2 = id(32);

docker('run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD=local-only', 'postgres:17-alpine');
try {
  for (let i = 0; i < 60; i++) { try { docker('exec', name, 'pg_isready', '-U', 'postgres'); psql('SELECT 1'); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
  psql(readFileSync(new URL('./fixtures/medico-historial-produccion-2026-11-21.sql', import.meta.url), 'utf8'));
  ok('Las funciones de la copia coinciden con las desplegadas (hash normalizado)', () => {
    for (const [fn, hash] of Object.entries(production))
      assert.equal(one(`SELECT md5(regexp_replace(replace(pg_get_functiondef(p.oid), E'\\r', ''), '\\s+', ' ', 'g')) FROM pg_proc p WHERE proname='${fn}'`), hash, fn);
  });
  psql(`INSERT INTO profiles(id, first_name, last_name) VALUES ('${U1}','Ana','Médica'),('${U2}','Otro','Médico');
    INSERT INTO user_roles(user_id, role) VALUES ('${U1}','doctor'),('${U2}','doctor');
    INSERT INTO staff(id, profile_id, employee_code, category) VALUES ('${S1}','${U1}','MED-1','doctor'),('${S2}','${U2}','MED-2','doctor');
    INSERT INTO patients(id, first_name, last_name, patient_code, birth_date) VALUES ('${PAT}','Luis','Paciente','PAC-1','1990-01-01'),('${PAT2}','Sin','Consulta','PAC-2','1985-01-01');
    INSERT INTO medical_records(id, patient_id, record_code) VALUES ('${REC}','${PAT}','EXP-1'),('${REC2}','${PAT2}','EXP-2');
    INSERT INTO appointments(id, patient_id, doctor_id, starts_at, ends_at, status, cancellation_reason, cancelled_at) VALUES
      ('${id(41)}','${PAT}','${S1}', now()-interval '3 days', now()-interval '3 days'+interval '30 min','completada',NULL,NULL),
      ('${id(42)}','${PAT}','${S1}', now()-interval '2 days', now()-interval '2 days'+interval '30 min','cancelada','El paciente viajó', now()-interval '3 days'),
      ('${id(43)}','${PAT}','${S1}', now()-interval '1 day', now()-interval '1 day'+interval '30 min','no_asistio',NULL,NULL),
      ('${id(44)}','${PAT2}','${S2}', now()-interval '1 day', now()-interval '1 day'+interval '30 min','cancelada','Sin motivo',now()-interval '2 days');
    INSERT INTO clinical_encounters(id, record_id, appointment_id, doctor_id, started_at, ended_at, subjective, assessment, version) VALUES
      ('${id(51)}','${REC}','${id(41)}','${S1}', now()-interval '3 days', now()-interval '3 days'+interval '25 min','Fiebre','Faringitis',2);
    INSERT INTO medications(id, name, strength, presentation) VALUES ('${id(61)}','Acetaminofén','500 mg','Tableta'),('${id(62)}','Amoxicilina',NULL,'Cápsula');
    INSERT INTO prescriptions(id, prescription_code, encounter_id, issued_at, status) VALUES
      ('${id(71)}','RX-0001','${id(51)}', now()-interval '3 days','entregada'),('${id(72)}','RX-0002','${id(51)}', now()-interval '3 days'+interval '5 min','pendiente');
    INSERT INTO prescription_items(prescription_id, medication_id, dose, dose_unit, frequency_hours, route, quantity, observations, duration_days) VALUES
      ('${id(71)}','${id(61)}',1,'Tabletas',8,'oral',15,'Tomar con alimentos',5),('${id(71)}','${id(62)}',2,'cápsulas',12,'oral',20,NULL,7),
      ('${id(72)}','${id(61)}',1,'Tabletas',6,'oral',10,NULL,3);`);
  const window = `now()-interval '10 days', now()+interval '10 days'`;
  const beforeChart = JSON.parse(as(U1, `public.doctor_native_chart('${PAT}')::text`));
  const beforeWork = JSON.parse(as(U1, `public.doctor_native_workspace(${window})::text`));
  assert.equal(typeof beforeChart.prescriptions[0].lines[0], 'string', 'Antes: recetas como texto');

  const migration = readFileSync(new URL('../supabase/medico-historial-detallado.sql', import.meta.url), 'utf8');
  ok('La migración se aplica y se puede volver a aplicar', () => { psql(migration); psql(migration); });
  const chart = JSON.parse(as(U1, `public.doctor_native_chart('${PAT}')::text`));
  const work = JSON.parse(as(U1, `public.doctor_native_workspace(${window})::text`));
  const strip = (value, keys) => JSON.parse(JSON.stringify(value, (k, v) => keys.includes(k) ? undefined : v));
  ok('Compatibilidad: la salida anterior se conserva idéntica (solo se añaden campos)', () => {
    assert.deepEqual(strip(chart, ['items', 'doctor_name']), strip(beforeChart, ['doctor_name']));
    assert.deepEqual(chart.history.map(h => h.doctor_name), beforeChart.history.map(h => h.doctor_name), 'doctor_name de la consulta no cambia');
    assert.deepEqual(strip(work, ['cancellation_reason', 'cancelled_at']), beforeWork);
  });
  ok('Receta con varios medicamentos: cada uno con sus campos reales, agrupados en la misma receta', () => {
    const rx = chart.prescriptions.find(r => r.code === 'RX-0001');
    assert.equal(rx.status, 'entregada'); assert.equal(rx.doctor_name, 'Ana Médica'); assert.equal(rx.items.length, 2);
    assert.deepEqual(rx.items[0], { name: 'Acetaminofén', strength: '500 mg', presentation: 'Tableta', dose: 1, dose_unit: 'Tabletas', frequency_hours: 8, route: 'oral', duration_days: 5, quantity: 15, observations: 'Tomar con alimentos' });
    assert.equal(rx.items[1].strength, null, 'Concentración ausente: null, no inventada');
    assert.equal(rx.lines.length, 2, 'lines se conserva');
  });
  ok('Receta con un medicamento y estado pendiente', () => {
    const rx = chart.prescriptions.find(r => r.code === 'RX-0002');
    assert.equal(rx.status, 'pendiente'); assert.equal(rx.items.length, 1); assert.equal(rx.items[0].frequency_hours, 6);
  });
  ok('Agenda: canceladas con motivo y fecha; no atendidas sin motivo inventado', () => {
    const cancelled = work.appointments.find(a => a.status === 'cancelled'), missed = work.appointments.find(a => a.status === 'no_show');
    assert.equal(cancelled.cancellation_reason, 'El paciente viajó'); assert.ok(cancelled.cancelled_at);
    assert.equal(missed.cancellation_reason, null);
    assert.equal(work.appointments.some(a => a.patient_name === 'Sin Consulta'), false, 'Solo citas propias');
  });
  ok('Médico sin autorización: error de permisos (no «sin registros»)', () =>
    fails(`BEGIN; SET LOCAL "request.jwt.claim.sub" = '${U2}'; SELECT public.doctor_native_chart('${PAT}'); COMMIT;`, /Paciente no asignado/, 'otro médico'));
  ok('Paciente atendido una vez sigue autorizado para el médico aunque no tenga citas futuras', () =>
    assert.equal(as(U1, `private.treats_patient('${PAT}')`), 't'));
  ok('Una cita solo cancelada no autoriza el expediente (sin consulta realizada)', () =>
    assert.equal(as(U2, `private.treats_patient('${PAT2}')`), 'f'));
  console.log(`OK Historial del médico SQL: ${results.length} comprobaciones en PostgreSQL desechable`);
} finally { try { docker('rm', '-f', name); } catch {} }
