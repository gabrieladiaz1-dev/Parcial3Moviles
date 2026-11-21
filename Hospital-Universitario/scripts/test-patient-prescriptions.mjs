// Mis recetas del paciente con transporte simulado: cada medicamento muestra sus columnas reales de prescription_items
// (dosis, frecuencia, vía, días, cantidad y observaciones) en su campo, sin «No hay datos reales». Sin Supabase real.
import assert from 'node:assert/strict';
import {createApp} from './test-preview.mjs';

const prescriptions = [{id: '00000000-0000-4000-8000-0000000000c1', prescription_code: 'RX-0001', issued_at: new Date().toISOString(), status: 'pendiente',
  prescription_items: [
    {dose: 2.00, dose_unit: 'tabletas', frequency_hours: 8, route: 'oral', quantity: 10, duration_days: 5, observations: 'Tomar con alimentos', medications: {name: 'Acetaminofén'}},
    {dose: 1, dose_unit: 'cápsula', frequency_hours: 1, route: 'oral', quantity: 1, duration_days: 1, observations: null, medications: {name: 'Amoxicilina'}}]}];
const ui = createApp(['patient'], {transport: async url => {
  if (url.includes('/rest/v1/prescriptions?')) {
    assert.match(decodeURIComponent(url), /duration_days/, 'La consulta pide los días de tratamiento');
    return {body: prescriptions};
  }
}});
await ui.login();
await ui.click('Más'); await ui.click('Mis recetas　›');
const text = ui.app.textContent;
for (const value of ['Mis recetas', 'Acetaminofén', '2 tabletas', '8 horas', 'Oral', '5 días', '10', 'Tomar con alimentos', 'Pendiente',
  'Amoxicilina', '1 cápsula', '1 hora', '1 día', 'Sin observaciones'])
  assert.ok(text.includes(value), 'Mis recetas muestra ' + value);
assert.equal(text.includes('No hay datos reales'), false, 'Con datos registrados no aparece «No hay datos reales»');
assert.equal(text.includes('2 tabletas · cada 8 horas'), false, 'Las observaciones ya no repiten la dosis concatenada');
console.log('OK Mis recetas: dosis, frecuencia, vía, duración, cantidad y observaciones reales en su campo');
