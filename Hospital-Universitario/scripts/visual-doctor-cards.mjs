// Recorrido visual del médico (recetas, laboratorio e historial) en Edge headless con el protocolo DevTools.
// Supabase se sustituye dentro de la página con respuestas sintéticas con la forma de doctor_native_* (sin red ni datos reales).
// Anchos de iPhone: 320, 375 y 393 pt. Sirve para «antes» (otra copia en PREVIEW_URL) y «después».
// Uso: PREVIEW_URL=http://127.0.0.1:4173/ node scripts/visual-doctor-cards.mjs <directorio-de-capturas>
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const outDir = process.argv[2] || join(tmpdir(), 'visual-doctor-cards');
mkdirSync(outDir, { recursive: true });
const browser = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
if (!browser) throw new Error('No se encontró Microsoft Edge ni Google Chrome.');
const port = 9336 + Math.floor(Math.random() * 200);
const child = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(tmpdir(), 'visual-doctor-profile-' + process.pid)}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore', detached: true });
child.unref();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets; for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some(t => t.type === 'page')) break; } catch {} await sleep(200); }
const page = targets?.find(t => t.type === 'page'); if (!page) { try { process.kill(child.pid); } catch {} throw new Error('El navegador no expuso DevTools.'); }
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let seq = 0; const pending = new Map(), errors = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text); });
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error('JS: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result.value; };
const waitFor = async (x, t = 10000) => { const s = Date.now(); while (Date.now() - s < t) { if (await evaluate(x)) return; await sleep(120); } throw new Error('Tiempo agotado: ' + x); };
let width = 393, height = 852;
const viewport = async (w, h) => { width = w; height = h; await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true }); };
const report = { checks: [], screenshots: [] }; const check = (n, ok, d = '') => report.checks.push({ name: n, ok: !!ok, detail: d });
async function shot(name) {
  await sleep(300); const w = width, h = height;
  const extra = await evaluate(`Math.max(0, ...[...document.querySelectorAll('body *')].filter(n => /(auto|scroll)/.test(getComputedStyle(n).overflowY)).map(n => n.scrollHeight - n.clientHeight))`);
  await viewport(w, Math.min(h + extra, 9000)); await sleep(300);
  const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
  await viewport(w, h); report.screenshots.push(name);
}
const mock = String.raw`(() => {
  const uid = '00000000-0000-4000-8000-0000000000dd', P = '00000000-0000-4000-8000-000000000011', E1 = '00000000-0000-4000-8000-000000000021';
  const H = 3600000, D = 86400000, iso = o => new Date(Date.now() + o).toISOString(), pg = x => x.replace('T',' ').replace(/\.\d+Z$/,'+00');
  const slot = o => '["' + pg(iso(o)) + '","' + pg(iso(o + 1800000)) + '")';
  const patient = {id:P, full_name:'Ana Paciente', record_number:'EXP-0001', patient_code:'PAC-0001', dui:'01234567-8', email:'ana@example.test', phone:'7000-0000', age:35, active_encounter_id:null};
  const appointments = [
    {id:'a1', patient_id:P, patient_name:'Ana Paciente', record_number:'EXP-0001', patient_code:'PAC-0001', period:slot(2*H), status:'scheduled', reason:'Control', room_code:'C-3', duration_minutes:30},
    {id:'a2', patient_id:P, patient_name:'Luis Gómez', record_number:'EXP-0002', period:slot(-3*D), status:'cancelled', cancellation_reason:'El paciente viajó fuera del país', room_code:'C-1', duration_minutes:30, reason:'Seguimiento'},
    {id:'a3', patient_id:P, patient_name:'Marta Ríos', record_number:'EXP-0003', period:slot(-1*D), status:'no_show', room_code:'C-2', duration_minutes:30, reason:'Dolor lumbar'},
    {id:'a4', patient_id:P, patient_name:'José Pérez', record_number:'EXP-0004', period:slot(-1*D - 2*H), status:'cancelled', room_code:'C-2', duration_minutes:30}];
  const prescriptions = [
    {id:'rx1', encounter_id:E1, code:'REC-0001', issued_at:iso(-10*D), status:'entregada', doctor_name:'Dra. Ana Médica', lines:['Acetaminofén 500 mg 1.00 Tabletas cada 8 horas oral 5 días Tomar con alimentos','Amoxicilina 500 mg 1.00 cápsulas cada 12 horas oral 7 días'],
     items:[{name:'Acetaminofén', strength:'500 mg', presentation:'Tableta', dose:1, dose_unit:'Tabletas', frequency_hours:8, route:'oral', duration_days:5, quantity:15, observations:'Tomar con alimentos'},
            {name:'Amoxicilina', strength:'500 mg', presentation:'Cápsula', dose:1, dose_unit:'cápsulas', frequency_hours:12, route:'oral', duration_days:7, quantity:14, observations:null}]},
    {id:'rx2', encounter_id:E1, code:'REC-0002', issued_at:iso(-10*D + 600000), status:'pendiente', doctor_name:'Dra. Ana Médica', lines:['Loratadina 10 mg 1.00 Tableta cada 24 horas oral 3 días'],
     items:[{name:'Loratadina', strength:'10 mg', dose:1, dose_unit:'Tableta', frequency_hours:24, route:'oral', duration_days:3, quantity:3, observations:null}]}];
  const labs = [
    {id:'l1', encounter_id:E1, test_name:'Hemograma completo', reason:'Control de infección', status:'completado', ordered_at:iso(-10*D), published_at:iso(-9*D), completed_at:iso(-9*D - H), result_summary:'Leucocitos levemente elevados; resto dentro de rango.',
     parameters:[{label:'Hemoglobina', value:'13.8', unit:'g/dL', reference:'12–16', observation:null},{label:'Leucocitos', value:'11.2', unit:'10³/µL', reference:'4–10', observation:'Levemente elevado'},{label:'Plaquetas', value:'250', unit:'10³/µL', reference:'150–400', observation:null}]},
    {id:'l2', encounter_id:E1, test_name:'Prueba rápida de estreptococo', reason:'Faringitis', status:'completado', ordered_at:iso(-10*D), published_at:iso(-10*D + 2*H), result_summary:'Negativo', parameters:[]},
    {id:'l3', encounter_id:E1, test_name:'Glucosa en ayunas', reason:'Tamizaje', status:'en_proceso', ordered_at:iso(-D), result_summary:null, parameters:[]}];
  const json = (b, s = 200) => Promise.resolve(new Response(b == null ? null : JSON.stringify(b), {status:s, headers:{'Content-Type':'application/json'}}));
  const original = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url; if (!/supabase\.co/.test(url)) return original(input, init);
    const body = init.body ? JSON.parse(init.body) : {};
    if (url.includes('/auth/v1/token')) return json({access_token:'v', refresh_token:'r', expires_in:3600, token_type:'bearer'});
    if (url.endsWith('/auth/v1/user')) return json({id:uid, email:'medico.visual@example.test'});
    if (url.includes('/rest/v1/profiles?')) return json([{id:uid, first_name:'Ana', last_name:'Médica'}]);
    if (url.includes('/rest/v1/user_roles?')) return json([{user_id:uid, role:'doctor', active:true}]);
    if (url.includes('/rest/v1/patients?')) return json([]);
    if (url.includes('/rest/v1/staff?')) return json([{id:'00000000-0000-4000-8000-0000000000ee', profile_id:uid, active:true, category:'doctor'}]);
    if (url.endsWith('/rpc/doctor_native_workspace')) return json({doctor_name:'Ana Médica', facility_name:'Hospital Universitario', appointments, orders:[], tests:[], medications:[], notifications:[], stats:{consultations:4, completed_consultations:0, issued_orders:0, pending_orders:0}});
    if (url.endsWith('/rpc/doctor_native_alerts')) return json({items:[], unread:0, has_more:false, upcoming:[]});
    if (url.endsWith('/rpc/doctor_native_patients')) return json({patients:[patient], total:1, has_more:false, next_offset:null});
    if (url.endsWith('/rpc/doctor_native_chart')) return json({patient:{...patient, identification:patient.dui, birth_date:'1990-01-01'}, allergies:[], conditions:[], medical_history:[],
      history:[{id:E1, started_at:iso(-10*D), ended_at:iso(-10*D + 1800000), status:'closed', subjective:'Fiebre y dolor de garganta', assessment:'Faringitis aguda', objective:'Faringe enrojecida', plan:'Reposo e hidratación', diagnosis_code:'J02', doctor_name:'Dra. Ana Médica', specialty:'Medicina general', reason:'Dolor de garganta', vitals:{weight_kg:'61.5', temperature_c:'38.2'}}],
      prescriptions});
    if (url.endsWith('/rpc/doctor_native_patient_labs')) return json({items:labs, total:labs.length, has_more:false, next_offset:null});
    if (url.endsWith('/rpc/doctor_native_lab_orders')) return json({items:labs.map(l => ({...l, patient_name:'Ana Paciente', record_number:'EXP-0001'})), total:labs.length, has_more:false, next_offset:null});
    if (url.endsWith('/rpc/doctor_native_lab_catalog')) return json([]);
    if (url.endsWith('/rpc/doctor_native_patient_hospitalizations')) return json([]);
    if (url.includes('/rest/v1/')) return json([]);
    return json({message:'Ruta no simulada'}, 404);
  };
})();`;
const helpers = String.raw`
  window.__click = (text, exact) => { const nodes = [...document.querySelectorAll('#app button, #app a')].filter(b => b.offsetParent !== null && (exact ? (b.getAttribute('aria-label') === text || b.textContent.trim() === text) : (b.textContent.replace(/\s+/g,' ').includes(text) || (b.getAttribute('aria-label')||'').includes(text))));
    nodes.sort((a, b) => a.textContent.length - b.textContent.length); if (!nodes.length) return false; nodes[0].click(); return true; };
  window.__clickAll = text => { const nodes = [...document.querySelectorAll('#app button')].filter(b => b.offsetParent !== null && b.textContent.trim() === text); nodes.forEach(n => n.click()); return nodes.length; };
  window.__text = () => document.querySelector('#app').innerText;
  window.__overflow = () => { const w = window.innerWidth, bad = []; for (const n of document.querySelectorAll('#app *')) { const r = n.getBoundingClientRect(); if (r.width > 0 && (r.right > w + 1 || r.left < -1)) bad.push((n.className || n.tagName) + '→' + Math.round(r.right)); } return { scrollWidth: document.documentElement.scrollWidth, bad: bad.slice(0, 6) }; };
  window.__clipped = () => [...document.querySelectorAll('#app .cc-badge, #app .cc-toggle, #app .cc-title h4, #app .patient-rx-line span, #app .agenda-indicator small')].filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.className + ': ' + n.textContent.trim());
`;
await send('Page.enable'); await send('Runtime.enable'); await send('Page.addScriptToEvaluateOnNewDocument', { source: mock });
const go = async (...labels) => { for (const l of labels) { if (!(await evaluate(`__click(${JSON.stringify(l)})`))) throw new Error('No se encontró: ' + l); await sleep(600); } };
async function layout(label) { const o = await evaluate('__overflow()'), c = await evaluate('__clipped()');
  check(`${label} a ${width} pt: sin desbordamiento horizontal`, o.scrollWidth <= width + 1 && !o.bad.length, JSON.stringify(o));
  check(`${label} a ${width} pt: sin textos cortados`, !c.length, c.join(' | ')); }
async function login() {
  await send('Page.navigate', { url: base }); await waitFor("document.readyState === 'complete'");
  await evaluate('sessionStorage.clear(); localStorage.clear(); true'); await send('Page.navigate', { url: base });
  await waitFor("document.readyState === 'complete' && !!document.getElementById('email')"); await evaluate(helpers);
  await evaluate("document.getElementById('email').value='medico.visual@example.test'; document.getElementById('password').value='x'; document.querySelector('#app form').requestSubmit(); true");
  await waitFor("__text().includes('Ana')"); await sleep(600);
}
for (const [w, h] of [[393, 852], [375, 667], [320, 568]]) {
  await viewport(w, h); await login();
  // Historial del paciente → consulta → recetas y exámenes.
  await go('Pacientes'); await go('Abrir expediente de Ana Paciente'); await go('VER HISTORIAL MÉDICO');
  await evaluate(`[...document.querySelectorAll('#app button')].find(b => (b.getAttribute('aria-label')||'').startsWith('Consulta del '))?.click(); true`); await sleep(700);
  const opened = await evaluate(`__clickAll('Ver receta') + __clickAll('Ver resultado')`); await sleep(500);
  await shot(`01-historial-consulta-${w}`); await layout('Historial · consulta'); report['historial' + w] = await evaluate('__text()');
  if (w === 393) check('Detalle desplegable disponible (Ver receta / Ver resultado)', opened > 0, String(opened));
  // Mis órdenes de laboratorio.
  await go('Laboratorios'); if (await evaluate(`__click('Volver al listado de pacientes', true)`)) await sleep(500);
  await evaluate(`__clickAll('Ver resultado'); true`); await sleep(500);
  await shot(`02-laboratorio-ordenes-${w}`); await layout('Mis órdenes de laboratorio');
  // Agenda: NO REALIZADAS.
  await go('Consultas'); const hasMissed = await evaluate(`__click('NO REALIZADAS', true)`); await sleep(900);
  await shot(`03-agenda-no-realizadas-${w}`); await layout('Agenda');
  if (w === 393) report.agenda = { hasMissed, text: await evaluate('__text()') };
}
const after = report.historial393 || '';
check('Recetas con campos separados (Concentración, Dosis, Cada, Vía, Durante, Cantidad)', /Concentración:[\s\S]*Dosis:[\s\S]*Cada:[\s\S]*Vía:[\s\S]*Durante:[\s\S]*Cantidad:/.test(after));
check('Resultado con parámetros, unidades y referencias', /Parámetros analizados[\s\S]*Hemoglobina[\s\S]*Referencia: 12–16[\s\S]*13\.8[\s\S]*g\/dL/i.test(after));
check('Resultado solo con observación mostrado como observación', /Observación del laboratorio[\s\S]*Negativo/.test(after));
check('Agenda NO REALIZADAS con motivo y vencida', report.agenda?.hasMissed && /Motivo de cancelación: El paciente viajó/.test(report.agenda.text) && /La cita venció sin que se iniciara la consulta/.test(report.agenda.text));
check('Sin errores de JavaScript', !errors.length, errors.join(' | '));
ws.close(); writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
for (const c of report.checks) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}${c.ok || !c.detail ? '' : ' :: ' + c.detail}`);
console.log('Capturas en: ' + outDir); try { process.kill(child.pid); } catch {}
process.exit(report.checks.some(c => !c.ok) ? 1 : 0);
