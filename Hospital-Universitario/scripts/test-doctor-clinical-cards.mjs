// Tarjetas clínicas del médico (recetas y laboratorio) con transporte simulado y datos sintéticos; sin Supabase.
// Casos: receta con uno y varios medicamentos, entregada y pendiente, formato antiguo sin 'items'; exámenes pendiente, en proceso,
// publicado con varios parámetros y publicado solo con observación; médico sin autorización; paciente sin historial; y la
// misma tarjeta de medicamento en «Mis recetas» del paciente.
import assert from 'node:assert/strict';
import { createApp } from './test-preview.mjs';
import { readFileSync } from 'node:fs';

const P = '00000000-0000-4000-8000-000000000011', NEW = '00000000-0000-4000-8000-000000000012', DENIED = '00000000-0000-4000-8000-000000000013';
const E1 = '00000000-0000-4000-8000-000000000021', E2 = '00000000-0000-4000-8000-000000000022';
const patients = [
  { id: P, full_name: 'Ana Paciente', record_number: 'EXP-ANA', patient_code: 'PAC-1', dui: '01234567-8', email: 'ana@example.test', phone: '7000-0000', age: 35, active_encounter_id: null },
  { id: NEW, full_name: 'Nuevo Paciente', record_number: 'EXP-NEW', patient_code: 'PAC-2', dui: '11111111-1', email: null, phone: null, age: 20, active_encounter_id: null },
  { id: DENIED, full_name: 'Paciente Retirado', record_number: 'EXP-RET', patient_code: 'PAC-3', dui: '22222222-2', email: null, phone: null, age: 50, active_encounter_id: null }];
const history = [
  { id: E1, started_at: '2026-11-10T15:00:00Z', ended_at: '2026-11-10T15:30:00Z', status: 'closed', assessment: 'Faringitis aguda', plan: 'Reposo', doctor_name: 'Ana Médica', reason: 'Dolor de garganta', vitals: {} },
  { id: E2, started_at: '2026-10-01T15:00:00Z', ended_at: '2026-10-01T15:30:00Z', status: 'closed', assessment: 'Control', plan: '', doctor_name: 'Ana Médica', reason: 'Control', vitals: {} }];
const prescriptions = [
  { id: 'rx1', encounter_id: E1, code: 'REC-0001', issued_at: '2026-11-10T15:25:00Z', status: 'entregada', doctor_name: 'Ana Médica', lines: ['texto antiguo'],
    items: [{ name: 'Acetaminofén', strength: '500 mg', presentation: 'Tableta', dose: 1, dose_unit: 'Tabletas', frequency_hours: 8, route: 'oral', duration_days: 5, quantity: 15, observations: 'Tomar con alimentos' },
      { name: 'Amoxicilina', strength: null, presentation: 'Cápsula', dose: 2, dose_unit: 'cápsulas', frequency_hours: 12, route: 'oral', duration_days: 7, quantity: 28, observations: null }] },
  { id: 'rx2', encounter_id: E1, code: 'REC-0002', issued_at: '2026-11-10T15:28:00Z', status: 'pendiente', doctor_name: 'Ana Médica', lines: [],
    items: [{ name: 'Loratadina', strength: '10 mg', dose: 1, dose_unit: 'Tableta', frequency_hours: 24, route: 'oral', duration_days: 3, quantity: 3, observations: null }] },
  { id: 'rx3', encounter_id: E2, code: 'REC-ANTIGUA', issued_at: '2026-10-01T15:25:00Z', status: 'entregada', lines: ['Ibuprofeno 400 mg 1 tableta cada 8 horas oral 3 días'] }];
const labs = [
  { id: 'l1', encounter_id: E1, test_name: 'Hemograma completo', reason: 'Control', status: 'completado', ordered_at: '2026-11-10T15:20:00Z', published_at: '2026-11-11T10:00:00Z', completed_at: '2026-11-11T09:00:00Z',
    result_summary: 'Valores dentro de rango', parameters: [{ label: 'Hemoglobina', value: '13.8', unit: 'g/dL', reference: '12–16', observation: null }, { label: 'Leucocitos', value: '11.2', unit: '10³/µL', reference: '4–10', observation: 'Levemente elevado' }] },
  { id: 'l2', encounter_id: E1, test_name: 'Prueba de embarazo', reason: 'Descartar', status: 'completado', ordered_at: '2026-11-10T15:21:00Z', published_at: '2026-11-11T11:00:00Z', result_summary: 'Negativo', parameters: [] },
  { id: 'l3', encounter_id: E1, test_name: 'Glucosa', reason: 'Ayuno', status: 'en_proceso', ordered_at: '2026-11-10T15:22:00Z', result_summary: null, parameters: [] },
  { id: 'l4', encounter_id: E1, test_name: 'Perfil lipídico', reason: 'Control', status: 'pendiente', ordered_at: '2026-11-10T15:23:00Z', result_summary: null, parameters: [] }];
const ui = createApp(['doctor'], { transport: async (url, p) => {
  if (url.endsWith('/rpc/doctor_native_patients')) return { body: { patients, total: patients.length, has_more: false, next_offset: null } };
  if (url.endsWith('/rpc/doctor_native_chart')) {
    if (p.p_patient === DENIED) return { status: 403, body: { code: '42501', message: 'Paciente no asignado' } };
    const mine = p.p_patient === P;
    return { body: { patient: { ...patients.find(x => x.id === p.p_patient), identification: '01234567-8' }, allergies: [], conditions: [], medical_history: [], history: mine ? history : [], prescriptions: mine ? prescriptions : [] } };
  }
  if (url.endsWith('/rpc/doctor_native_patient_labs')) return { body: { items: p.p_patient === P ? labs : [], total: p.p_patient === P ? labs.length : 0, has_more: false, next_offset: null } };
  if (url.endsWith('/rpc/doctor_native_lab_orders')) return { body: { items: labs.map(l => ({ ...l, patient_name: 'Ana Paciente', record_number: 'EXP-ANA' })), total: labs.length, has_more: false, next_offset: null } };
} });
const text = () => ui.app.textContent;
await ui.login(); await ui.click('Pacientes');
await ui.click('Abrir expediente de Ana Paciente'); await ui.click('VER HISTORIAL MÉDICO');
await ui.click(ui.app.all().find(n => n.attributes['aria-label']?.startsWith('Consulta del ') && n.textContent.includes('Faringitis')).attributes['aria-label']);

// Recetas resumidas: identificador, fecha, médico, estado y número de medicamentos; sin párrafos de texto plano.
for (const value of ['REC-0001', 'Entregada', 'REC-0002', 'Pendiente de entrega', 'Ana Médica', 'Ver receta']) assert.ok(text().includes(value), 'Receta resumida: ' + value);
assert.equal(text().includes('Acetaminofén'), false, 'Empieza resumida');
assert.equal(text().includes('texto antiguo'), false, 'Con items no se muestra la cadena antigua');
const verRecetas = () => ui.app.all().filter(n => n.tagName === 'button' && n.textContent === 'Ver receta');
verRecetas()[0].listeners.click(); await new Promise(r => setImmediate(r));
for (const value of ['Acetaminofén', 'Concentración:', '500 mg', '1 Tabletas', '8 horas', 'Oral', '5 días', '15', 'Tomar con alimentos', 'Amoxicilina', '2 cápsulas', '12 horas', '7 días', '28', 'Sin indicaciones adicionales.', 'Ocultar receta'])
  assert.ok(text().includes(value), 'Receta con varios medicamentos: ' + value);
assert.equal(text().split('Concentración:').length - 1, 1, 'Sin concentración registrada no se inventa');
verRecetas()[0].listeners.click(); await new Promise(r => setImmediate(r));
assert.ok(text().includes('Loratadina') && text().includes('24 horas'), 'Receta con un medicamento');

// Exámenes de la consulta: estados y resultados.
for (const value of ['Hemograma completo', 'Resultado publicado', 'Glucosa', 'En proceso', 'Perfil lipídico', 'Pendiente', 'Prueba de embarazo'])
  assert.ok(text().includes(value), 'Exámenes: ' + value);
assert.equal(ui.app.all().filter(n => n.tagName === 'button' && n.textContent === 'Ver resultado').length, 2, 'Solo los publicados tienen «Ver resultado»');
assert.ok(text().includes('aún no ha publicado un resultado validado'), 'Pendientes sin resultado inventado');
const verResultado = () => ui.app.all().filter(n => n.tagName === 'button' && n.textContent === 'Ver resultado');
verResultado()[0].listeners.click(); await new Promise(r => setImmediate(r));
for (const value of ['Parámetros analizados', 'Hemoglobina', '13.8', 'g/dL', 'Referencia: 12–16', 'Leucocitos', '11.2', 'Observación: Levemente elevado', 'Comentario del laboratorio', 'Valores dentro de rango', 'Resultado validado y publicado por el laboratorio'])
  assert.ok(text().includes(value), 'Resultado con varios parámetros: ' + value);
verResultado()[0].listeners.click(); await new Promise(r => setImmediate(r));
assert.ok(text().includes('Observación del laboratorio') && text().includes('Negativo'), 'Resultado solo con observación');
assert.equal(text().split('Parámetros analizados').length - 1, 1, 'Sin tabla inventada para la observación');
assert.equal(text().split('EXP-ANA').length - 1, 1, 'El expediente no se repite en cada sección');

// Receta del formato antiguo (sin items): cada línea por separado, marcada como formato anterior.
await ui.click('← Volver al historial');
await ui.click(ui.app.all().find(n => n.attributes['aria-label']?.startsWith('Consulta del ') && n.textContent.includes('Control')).attributes['aria-label']);
await ui.click('Ver receta');
assert.ok(text().includes('Ibuprofeno 400 mg') && text().includes('formato anterior del servidor'), 'Formato antiguo sin inventar campos');

// Mis órdenes de laboratorio (pantalla Laboratorios del médico): paciente, fechas y resultado desplegable.
await ui.click('Laboratorios');
if (ui.app.all().some(n => n.tagName === 'button' && n.textContent === 'Volver al listado de pacientes')) await ui.click('Volver al listado de pacientes');
for (const value of ['Mis órdenes de laboratorio', 'Ana Paciente', 'Solicitado', 'Publicado', 'Resultado publicado']) assert.ok(text().includes(value), 'Órdenes: ' + value);

// Paciente sin historial y médico sin autorización (error real, no «sin registros»).
await ui.click('Pacientes'); await ui.click('Abrir expediente de Nuevo Paciente'); await ui.click('VER HISTORIAL MÉDICO');
assert.match(text(), /Todavía no hay historial/);
await ui.click('← Volver a la búsqueda');
await ui.click('Abrir expediente de Paciente Retirado');
assert.match(ui.get('notice').textContent, /no tiene acceso a esta operación/, 'Sin autorización se informa el permiso');assert.equal(ui.get('notice').hidden, false);
assert.equal(/Todavía no hay historial/.test(text()), false, 'No se disfraza el error de permisos como historial vacío');

// Paciente: «Mis recetas» usa la misma tarjeta de medicamento (concentración real incluida).
const patient = createApp(['patient'], { transport: async url => url.includes('/rest/v1/prescriptions?') ? { body: [{ id: 'p1', prescription_code: 'RX', issued_at: new Date().toISOString(), status: 'pendiente',
  prescription_items: [{ dose: 1, dose_unit: 'Tabletas', frequency_hours: 8, route: 'oral', quantity: 10, duration_days: 5, observations: null, medications: { name: 'Acetaminofén', strength: '500 mg' } }] }] } : undefined });
await patient.login(); await patient.click('Más'); await patient.click('Mis recetas　›');
for (const value of ['Acetaminofén', 'Concentración:', '500 mg', '1 Tabletas', '8 horas', 'Pendiente']) assert.ok(patient.app.textContent.includes(value), 'Paciente: ' + value);
// Paridad de textos con iOS (ClinicalCardRules.swift y DoctorClinicalRules en DoctorModels.swift).
const swift = ['../HospitalUniversitario/HospitalUniversitario/Core/ClinicalCardRules.swift', '../HospitalUniversitario/HospitalUniversitario/Core/DoctorModels.swift', '../HospitalUniversitario/HospitalUniversitario/Design/ClinicalCardViews.swift'].map(f => readFileSync(new URL(f, import.meta.url), 'utf8')).join(' ');
for (const value of ['Pendiente de entrega', 'Entregada', 'Entrega parcial', 'Anulada', 'Estado no disponible', 'Resultado publicado', 'Completado · en validación', 'En proceso', 'La cita venció sin que se iniciara la consulta.', 'Cancelada sin motivo registrado.', 'Motivo de cancelación: ', 'Ver receta', 'Ver resultado', 'Observación del laboratorio', 'Comentario del laboratorio', 'Resultado validado y publicado por el laboratorio', 'Sin indicaciones adicionales.', 'Detalle registrado (formato anterior del servidor).'])
  assert.ok(swift.includes(value), 'Texto idéntico en Swift: ' + value);
console.log('OK Tarjetas clínicas: recetas (uno y varios medicamentos, entregada/pendiente, formato antiguo), exámenes (pendiente, en proceso, varios parámetros, solo observación), sin autorización, sin historial y misma tarjeta en el paciente');
