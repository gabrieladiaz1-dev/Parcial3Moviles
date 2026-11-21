// Solicitar ambulancia (web-preview) con transporte simulado que imita a supabase/ambulancia-paciente.sql: el servidor guarda las
// solicitudes, aplica la clave de reintento y una sola solicitud activa. Comprueba el flujo del paciente, la doble pulsación, la
// respuesta perdida, la reconexión (prueba F), la cancelación, el modo diseño sin API y la paridad de textos con AmbulanceRules.swift.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from './test-preview.mjs';

const now = Date.now(), iso = offset => new Date(now + offset).toISOString();
let rows = [], offline = false, loseNextSubmitResponse = false;
const context = () => ({ person: { full_name: 'Persona de prueba', phone: '7000-1111' }, unit_available: true, server_time: iso(0), requests: rows.map(r => ({ ...r })) });
const ui = createApp(['patient'], { transport: async (url, params) => {
  if (!url.includes('/rpc/') || !url.includes('ambulance')) return undefined;
  if (offline) throw new TypeError('Failed to fetch');
  if (url.endsWith('/rpc/my_ambulance_context')) return { body: context() };
  if (url.endsWith('/rpc/submit_my_ambulance_request')) {
    const existing = rows.find(r => r.key === params.p_key);
    if (!existing) {
      if (rows.some(r => ['pendiente', 'autorizada', 'despachada'].includes(r.status)))
        return { status: 400, body: { code: '22023', message: 'Ya tienes una solicitud de ambulancia activa. Consulta su estado o cancélala antes de enviar otra.' } };
      rows.push({ id: '5a000000-0000-4000-8000-0000000000' + String(rows.length + 10), key: params.p_key, status: 'pendiente', requested_at: iso(0), updated_at: iso(0),
        contact_phone: params.p_phone, alternate_phone: params.p_alternate_phone, pickup_location: params.p_pickup, pickup_reference: params.p_reference,
        pickup_latitude: params.p_latitude, pickup_longitude: params.p_longitude, pickup_accuracy_m: params.p_accuracy, reason: params.p_reason,
        situation: params.p_situation, pickup_notes: params.p_notes, assigned_at: null, departed_at: null, arrived_at: null, completed_at: null, unit_code: null });
    }
    if (loseNextSubmitResponse) { loseNextSubmitResponse = false; throw new TypeError('Network connection lost'); }
    return { body: (existing || rows.at(-1)).id };
  }
  if (url.endsWith('/rpc/cancel_my_ambulance_request')) {
    const row = rows.find(r => r.id === params.p_request);
    if (row.status === 'despachada') return { status: 400, body: { code: '22023', message: 'La ambulancia ya fue asignada a tu solicitud.' } };
    Object.assign(row, { status: 'cancelada', decision_reason: params.p_reason, updated_at: iso(1000) }); return { body: null };
  }
} });
const text = () => ui.app.textContent;
const rpc = name => ui.calls.filter(c => c.url.endsWith('/rpc/' + name));
const submitButton = () => ui.app.all().find(n => n.tagName === 'button' && n.textContent === 'Solicitar ambulancia');

await ui.login();
// Acceso directo desde Inicio (además de Más → Servicios del hospital).
await ui.click('Solicitar ambulancia');
assert.ok(text().includes('Solicita asistencia de transporte médico'), 'Inicio abre Solicitar ambulancia');
await ui.click('Inicio');
await ui.click('Más');
assert.match(text(), /SERVICIOS DEL HOSPITAL/);
await ui.click('Ambulancia　›');
assert.equal(rpc('my_ambulance_context').length, 2, 'Cada apertura lee el estado del servidor');
for (const value of ['Solicitar ambulancia', 'Solicita asistencia de transporte médico y consulta el estado de tu solicitud.',
  'Si existe peligro inmediato para la vida, llama directamente a los servicios de emergencia. Enviar esta solicitud no garantiza una respuesta inmediata.',
  'Paciente', 'Persona de prueba', 'Ubicación de recogida', 'Usar mi ubicación actual', 'Información de la solicitud'])
  assert.ok(text().includes(value), 'Visible: ' + value);
assert.equal(ui.app.all().some(n => n.attributes['aria-label'] === 'Nombre del paciente'), false, 'La identidad no es un campo editable');
assert.equal(ui.app.all().find(n => n.attributes['aria-label'] === 'Teléfono de contacto').value, '7000-1111', 'Teléfono precargado del perfil');
assert.equal(ui.app.all().some(n => n.tagName === 'a' && String(n.href || '').startsWith('tel:')), false, 'Sin número de emergencias configurado no se inventa ninguno');

// Validación: sin dirección ni motivo no se envía nada.
assert.equal(submitButton().disabled, true);
await ui.input('Dirección', 'Col');
assert.match(text(), /dirección de recogida/);
await ui.submit('Solicitar ambulancia');
assert.equal(rpc('submit_my_ambulance_request').length, 0, 'Datos inválidos: ninguna llamada');

// Envío con doble pulsación: una sola llamada; la identidad no viaja desde el cliente.
await ui.input('Dirección', 'Colonia Escalón, calle 3, casa 14');
await ui.input('Punto de referencia (opcional)', 'Portón negro');
await ui.input('Motivo de la solicitud', 'Traslado al hospital');
assert.equal(submitButton().disabled, false);
await ui.submit('Solicitar ambulancia', true);
assert.equal(rpc('submit_my_ambulance_request').length, 1, 'Doble pulsación → un solo envío');
const sent = rpc('submit_my_ambulance_request')[0].params;
assert.deepEqual(Object.keys(sent).sort(), ['p_accuracy', 'p_alternate_phone', 'p_key', 'p_latitude', 'p_longitude', 'p_notes', 'p_phone', 'p_pickup', 'p_reason', 'p_reference', 'p_situation'].sort());
assert.equal(sent.p_latitude, null, 'Sin ubicación compartida no se envían coordenadas');
assert.equal(rows.length, 1);
for (const value of ['Solicitud enviada al hospital. Queda pendiente de revisión: todavía no hay una ambulancia asignada.', 'Solicitud recibida', 'Pendiente',
  'Tu solicitud fue enviada al hospital y está pendiente de revisión.', 'SA-5A000000', 'Colonia Escalón, calle 3, casa 14', 'Portón negro', 'Última actualización', 'Cancelar solicitud'])
  assert.ok(text().includes(value), 'Seguimiento: ' + value);
assert.equal(/en camino/i.test(text()) && !text().includes('En camino'), false);
assert.equal(text().includes('Ambulancia en camino'), false, 'Registrar la solicitud no significa que la ambulancia esté en camino');
assert.equal(/minutos|llegará|tiempo estimado/i.test(text()), false, 'Sin tiempos estimados inventados');
assert.equal(ui.app.all().some(n => n.attributes['aria-label'] === 'Dirección'), false, 'Con una solicitud activa no se muestra otro formulario');

// Prueba F (reconexión): sin conexión se conserva el último estado marcado; al volver se lee el estado real.
offline = true;
await ui.click('Actualizar estado');
assert.match(text(), /No se pudo actualizar\. Se muestra el último estado recibido/);
assert.ok(text().includes('Solicitud recibida'), 'Se conserva el último estado conocido');
Object.assign(rows[0], { status: 'despachada', assigned_at: iso(60000), departed_at: iso(120000), updated_at: iso(120000), unit_code: 'AMB-001', destination: 'Hospital Universitario' });
offline = false;
await ui.click('Actualizar estado');
for (const value of ['Ambulancia en camino', 'La ambulancia ha salido para atender tu solicitud.', 'En camino', 'AMB-001', 'Hospital Universitario',
  'La ambulancia ya fue asignada. Para cancelar, comunícate con el hospital'])
  assert.ok(text().includes(value), 'Tras reconectar: ' + value);
assert.equal(text().includes('No se pudo actualizar'), false);
assert.equal(ui.app.all().some(n => n.tagName === 'button' && n.textContent === 'Cancelar solicitud'), false, 'Despachada: el paciente no la cancela');

// Servicio finalizado → vuelve el formulario; la anterior queda en el historial.
Object.assign(rows[0], { status: 'finalizada', arrived_at: iso(180000), completed_at: iso(240000), updated_at: iso(240000) });
await ui.click('Actualizar estado');
assert.ok(text().includes('Solicitudes anteriores') && text().includes('Finalizada'));
assert.ok(ui.app.all().some(n => n.attributes['aria-label'] === 'Dirección'), 'Sin solicitud activa se puede solicitar de nuevo');

// Respuesta perdida: el servidor confirmó pero el cliente no lo supo. Se reconcilia con el estado real sin duplicar.
await ui.input('Dirección', 'Residencial Las Flores, pasaje 2');
await ui.input('Motivo de la solicitud', 'Alta hospitalaria');
loseNextSubmitResponse = true;
await ui.submit('Solicitar ambulancia');
assert.equal(rows.length, 2);
assert.ok(text().includes('Solicitud recibida'), 'Tras perder la respuesta se muestra la solicitud real registrada');
assert.match(text(), /se conserva el identificador para evitar duplicados/);

// Cancelación antes del despacho: con motivo; queda en el historial como Cancelada.
await ui.click('Cancelar solicitud');
assert.equal(ui.button('Confirmar cancelación').disabled, true, 'Sin motivo no se confirma');
await ui.input('Motivo de la cancelación', 'Me trasladó un familiar');
await ui.submit('Confirmar cancelación');
assert.equal(rpc('cancel_my_ambulance_request')[0].params.p_request, rows[1].id);
assert.equal(rows[1].status, 'cancelada');
assert.ok(text().includes('Solicitud cancelada. El hospital ya ve la cancelación.'));
assert.ok(text().includes('Cancelada') && text().includes('Motivo: Me trasladó un familiar'));

// Sin la migración aplicada (RPC inexistente → 404 PGRST202) se explica claramente.
{ const pending = createApp(['patient'], { transport: async url => url.endsWith('/rpc/my_ambulance_context') ? { status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } } : undefined });
  await pending.login(); await pending.click('Solicitar ambulancia');
  assert.ok(pending.app.textContent.includes('aún no está activado en el servidor del hospital (migración pendiente)'), 'Migración pendiente explicada'); }
// Campana: un aviso de ambulancia lleva a esta pantalla.
const app = readFileSync(new URL('../web-preview/app.js', import.meta.url), 'utf8');
assert.match(app, /t\.includes\('ambulancia'\)\?\['🚑','ambulance'\]/);

// Modo diseño: ejemplo local identificado, sin ninguna llamada a Supabase.
const designUI = createApp(['patient']);
await new Promise(r => setImmediate(r)); designUI.get('design-patient').listeners.click(); await new Promise(r => setImmediate(r));
const before = designUI.calls.length;
await designUI.click('Más'); await designUI.click('Ambulancia　›');
assert.match(designUI.app.textContent, /Datos de ejemplo · No corresponden a una solicitud real/);
assert.match(designUI.app.textContent, /Ambulancia en camino/);
assert.equal(designUI.calls.slice(before).filter(c => c.url.includes('/rest/v1/') || c.url.includes('/auth/v1/')).length, 0, 'Modo diseño sin API');

// Paridad: cada texto de HospitalCore.ambulance existe tal cual en AmbulanceRules.swift.
const swift = readFileSync(new URL('../HospitalUniversitario/HospitalUniversitario/Patient/AmbulanceRules.swift', import.meta.url), 'utf8');
const core = readFileSync(new URL('../HospitalUniversitario/HospitalUniversitario/Shared/hospital-core.js', import.meta.url), 'utf8');
const block = core.slice(core.indexOf('// Ambulancia del paciente (supabase/ambulancia-paciente.sql)'), core.indexOf('root.HospitalCore.ambulance ='));
const strings = [...block.replace(/\/\/[^\n]*/g, '').matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map(m => m[1]).filter(s => s.length >= 12 && /[a-záéíóú] [a-záéíóú]/i.test(s));
assert.ok(strings.length >= 20, 'Textos encontrados: ' + strings.length);
for (const value of strings) assert.ok(swift.includes('"' + value + '"'), 'AmbulanceRules.swift debe contener: ' + value);
console.log(`OK Ambulancia (web): formulario, doble pulsación, seguimiento, reconexión, respuesta perdida, cancelación, diseño sin API y ${strings.length} textos idénticos en Swift`);
