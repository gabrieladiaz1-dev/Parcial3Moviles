// Recorrido visual de «Solicitar ambulancia» (paciente) en Microsoft Edge headless con el protocolo DevTools.
// Pantalla CONECTADA (no el modo diseño): Supabase se sustituye dentro del navegador por respuestas sintéticas con la forma de
// my_ambulance_context / submit_my_ambulance_request (supabase/ambulancia-paciente.sql). Sin red hacia Supabase ni datos reales.
// Anchos de iPhone: 320 (SE 1.ª gen.), 375 (SE 2.ª/3.ª gen.), 393 (iPhone 15) y 430 pt (Pro Max). Además: texto aumentado (zoom 130 %
// como aproximación web de Dynamic Type), esquema oscuro emulado, conexión lenta, error de conexión y estados vacíos.
// Requiere el servidor: node --preserve-symlinks --preserve-symlinks-main web-preview/server.mjs
// Uso: node scripts/visual-ambulance.mjs [directorio-de-capturas]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const outDir = process.argv[2] || join(tmpdir(), 'visual-ambulance');
mkdirSync(outDir, { recursive: true });
const browser = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
if (!browser) throw new Error('No se encontró Microsoft Edge ni Google Chrome.');
const port = 9335;
const child = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(tmpdir(), 'visual-ambulance-profile-' + process.pid)}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore', detached: true });
child.unref();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some(t => t.type === 'page')) break; } catch {} await sleep(200); }
const page = targets?.find(t => t.type === 'page');
if (!page) { try { process.kill(child.pid); } catch {} throw new Error('El navegador no expuso DevTools; no se tomaron capturas.'); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
let seq = 0, stage = 'inicio'; const pending = new Map(); const consoleErrors = [];
ws.addEventListener('message', event => { const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push('[' + stage + '] ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
});
const send = (method, params = {}) => new Promise(resolve => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error('JS: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result.result.value;
}
async function waitFor(expression, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await evaluate(expression)) return true; await sleep(120); }
  throw new Error('Tiempo agotado esperando: ' + expression);
}
let width = 393, height = 852;
async function viewport(w, h) { width = w; height = h; await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true }); }
const report = { checks: [], screenshots: [] };
const check = (name, ok, detail = '') => report.checks.push({ name, ok: !!ok, detail });
async function shot(name) {
  await sleep(350);
  const w = width, h = height;
  const extra = await evaluate(`Math.max(0, ...[...document.querySelectorAll('body *')].filter(n => /(auto|scroll)/.test(getComputedStyle(n).overflowY)).map(n => n.scrollHeight - n.clientHeight))`);
  await viewport(w, Math.min(h + extra, 8000)); await sleep(300);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
  await viewport(w, h); report.screenshots.push(name);
}

// Supabase sintético dentro de la página (se instala antes de cargar la app). Escenario en sessionStorage.
const mock = String.raw`(() => {
  const S = sessionStorage.getItem('visual-scenario') || 'libre';
  const H = 3600000, M = 60000, iso = o => new Date(Date.now() + o).toISOString(), uid = '00000000-0000-4000-8000-0000000000aa';
  const previous = {id:'5a0b7c2e-0000-4000-8000-000000000002', status:'finalizada', requested_at:iso(-9*24*H), updated_at:iso(-9*24*H+2*H), assigned_at:iso(-9*24*H+10*M),
    departed_at:iso(-9*24*H+15*M), arrived_at:iso(-9*24*H+40*M), completed_at:iso(-9*24*H+2*H), contact_phone:'7000-1111', pickup_location:'Residencial Las Flores, pasaje 2, casa 5', reason:'Alta hospitalaria', unit_code:'AMB-001'};
  const active = {id:'3f9c41d2-0000-4000-8000-000000000001', requested_at:iso(-25*M), updated_at:iso(-4*M), contact_phone:'7000-1111', alternate_phone:'2222-3333',
    pickup_location:'Colonia Escalón, calle Los Pinos, casa 14, San Salvador', pickup_reference:'Frente al parque, portón negro', pickup_latitude:13.701234, pickup_longitude:-89.224567, pickup_accuracy_m:12.5,
    reason:'Traslado al hospital', situation:'Dificultad para caminar después de una caída', pickup_notes:'Segundo piso, sin ascensor', destination:null, decision_reason:null, unit_code:null,
    assigned_at:null, departed_at:null, arrived_at:null, completed_at:null};
  const requests = S === 'pendiente' ? [{...active, status:'pendiente', updated_at:iso(-25*M)}, previous]
    : S === 'en_camino' ? [{...active, status:'despachada', assigned_at:iso(-15*M), departed_at:iso(-4*M), unit_code:'AMB-001', destination:'Hospital Universitario'}, previous]
    : S === 'vacio' ? [] : [previous];
  const json = (body, status = 200, delay = 0) => new Promise(r => setTimeout(() => r(new Response(body == null ? null : JSON.stringify(body), {status, headers:{'Content-Type':'application/json'}})), delay));
  const original = window.fetch.bind(window);
  window.__calls = [];
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!/supabase\.co/.test(url)) return original(input, init);
    const method = (init.method || 'GET').toUpperCase(); window.__calls.push(method + ' ' + url.replace(/^https:\/\/[^/]+/, ''));
    if (url.includes('/auth/v1/token')) return json({access_token:'visual', refresh_token:'visual-refresh', expires_in:3600, token_type:'bearer'});
    if (url.endsWith('/auth/v1/user')) return json({id:uid, email:'paciente.visual@example.test'});
    if (url.includes('/rest/v1/profiles?')) return json([{id:uid, first_name:'María', last_name:'López', birth_date:'1994-05-12', phone:'7000-1111', city:'Santa Ana'}]);
    if (url.includes('/rest/v1/user_roles?')) return json([{user_id:uid, role:'paciente', active:true}]);
    if (url.includes('/rest/v1/patients?')) return json([{id:uid, profile_id:uid, first_name:'María', last_name:'López', birth_date:'1994-05-12', phone:'7000-1111', dui:'01234567-8', patient_code:'PAC-0016'}]);
    if (url.endsWith('/rpc/my_ambulance_context')) {
      if (S === 'sin_conexion') return Promise.reject(new TypeError('Failed to fetch'));
      return json({person:{full_name:'María López', phone:'7000-1111'}, unit_available:S !== 'ocupada', server_time:iso(0), requests}, 200, S === 'lenta' ? 60000 : 0);
    }
    if (url.includes('/rest/v1/')) return json([]);
    return json({message:'Ruta no simulada: ' + url}, 404);
  };
})();`;
const helpers = String.raw`
  window.__clickText = (text) => {
    const nodes = [...document.querySelectorAll('#app button, #app a, nav button')].filter(b => b.offsetParent !== null && b.textContent.replace(/\s+/g,' ').includes(text));
    nodes.sort((a, b) => a.textContent.length - b.textContent.length);
    if (!nodes.length) return false; nodes[0].click(); return true;
  };
  window.__text = () => document.querySelector('#app').innerText;
  window.__overflow = () => { const w = window.innerWidth, bad = [];
    for (const n of document.querySelectorAll('#app *')) { const r = n.getBoundingClientRect(); if (r.width > 0 && (r.right > w + 1 || r.left < -1)) bad.push((n.className || n.tagName) + ' → ' + Math.round(r.right)); }
    return { scrollWidth: document.documentElement.scrollWidth, overflowing: bad.slice(0, 8) }; };
  window.__clipped = () => [...document.querySelectorAll('#app .amb-submit, #app .amb-actions button, #app .req-hero h2, #app .amb-badge')].filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.className + ': ' + n.textContent.trim());
`;
await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: mock });
await viewport(393, 852);

async function open(scenario) {
  stage = scenario;
  await send('Page.navigate', { url: base }); await waitFor("document.readyState === 'complete'");
  await evaluate(`sessionStorage.clear(); localStorage.clear(); sessionStorage.setItem('visual-scenario', ${JSON.stringify(scenario)}); true`);
  await send('Page.navigate', { url: base });
  await waitFor("document.readyState === 'complete' && !!document.getElementById('email')");
  await evaluate(helpers);
  await evaluate("document.getElementById('email').value='paciente.visual@example.test'; document.getElementById('password').value='clave-visual'; document.querySelector('#app form').requestSubmit(); true");
  await waitFor("__text().includes('María')");
  await sleep(400);
  if (scenario === 'libre') { await shot('00-inicio-acceso-ambulancia'); check('Inicio muestra el acceso «Solicitar ambulancia»', (await text()).includes('Solicitar ambulancia')); }
  await evaluate("__clickText('Más')"); await sleep(500);
  if (scenario === 'libre') { await shot('00-mas-servicios'); check('Más → Servicios del hospital muestra «Ambulancia»', (t => t.indexOf('Ambulancia') > t.toUpperCase().indexOf('SERVICIOS DEL HOSPITAL'))(await text())); }
  if (!(await evaluate("__clickText('Ambulancia')"))) throw new Error('No se encontró Ambulancia en el menú Más');
  await sleep(scenario === 'lenta' ? 900 : 700);
}
const text = () => evaluate('__text()');
async function layout(label) {
  const o = await evaluate('__overflow()'), clipped = await evaluate('__clipped()');
  check(`${label}: sin desbordamiento horizontal a ${width} pt`, o.scrollWidth <= width + 1 && !o.overflowing.length, JSON.stringify(o));
  check(`${label}: botones y estados sin texto cortado a ${width} pt`, !clipped.length, clipped.join(' | '));
}

// Menú «Más»: la entrada nueva vive en «Servicios del hospital» (sin otra barra ni navegación).
await open('libre');
const screen = await text();
check('Encabezado, descripción y advertencia de emergencia visibles', screen.includes('Solicitar ambulancia') && screen.includes('Solicita asistencia de transporte médico y consulta el estado de tu solicitud.') && screen.includes('Si existe peligro inmediato para la vida'));
check('Nombre del paciente precargado y no editable', screen.includes('María López') && !(await evaluate("!!document.querySelector('[aria-label=\"Nombre del paciente\"]')")));
check('Una sola barra de navegación inferior', (await evaluate("document.querySelectorAll('nav.bottom-nav').length")) === 1);
for (const [w, h, label] of [[320, 568, 'iPhone SE (1.ª gen.)'], [375, 667, 'iPhone SE'], [393, 852, 'iPhone 15'], [430, 932, 'iPhone Pro Max']]) {
  await viewport(w, h); await sleep(250); await layout('Formulario ' + label);
  if (w === 320 || w === 393 || w === 430) await shot(`01-formulario-${w}`);
}
await viewport(393, 852);
await evaluate("(() => { const set = (l, v) => { const n = document.querySelector('[aria-label=\"' + l + '\"]'); n.value = v; n.dispatchEvent(new Event('input')); }; set('Dirección', 'Col'); set('Motivo de la solicitud', 'Traslado al hospital'); return true; })()");
await sleep(200); await shot('02-formulario-validacion');
check('Validación visible y botón deshabilitado con datos incompletos', (await text()).includes('Escribe la dirección de recogida') && (await evaluate("document.querySelector('.amb-submit').disabled")));
await evaluate("document.body.style.zoom = '1.3'; true"); await sleep(300);
const zoom = await evaluate('__overflow()');
check('Texto aumentado (zoom 130 %): sin desbordamiento horizontal', zoom.scrollWidth <= 393 + 1 && !zoom.overflowing.length, JSON.stringify(zoom));
await shot('03-texto-aumentado'); await evaluate("document.body.style.zoom = ''; true");

await open('ocupada'); await shot('04-ambulancia-ocupada');
check('Ambulancia ocupada o en mantenimiento: aviso sin prometer asignación', (await text()).includes('ocupada o en mantenimiento') && !(await text()).includes('Ambulancia asignada'));

await open('pendiente'); await shot('05-seguimiento-pendiente');
const pend = await text();
check('Seguimiento pendiente: número, estado, dirección, última actualización y cancelación', /SA-3F9C41D2/.test(pend) && pend.includes('Solicitud recibida') && pend.includes('Colonia Escalón') && pend.includes('Última actualización') && pend.includes('Cancelar solicitud'));
check('Sin tiempos estimados de llegada', !/minutos|llegará|tiempo estimado/i.test(pend));
await viewport(320, 568); await sleep(250); await layout('Seguimiento pendiente'); await shot('05-seguimiento-pendiente-320'); await viewport(393, 852);
await evaluate("__clickText('Cancelar solicitud')"); await sleep(300); await shot('06-cancelar-solicitud');

await open('en_camino'); await shot('07-seguimiento-en-camino');
const road = await text();
check('En camino: solo con salida registrada; sin cancelación del paciente', road.includes('Ambulancia en camino') && road.includes('AMB-001') && !road.includes('Cancelar solicitud') && road.includes('comunícate con el hospital'));
await viewport(430, 932); await sleep(250); await layout('Seguimiento en camino'); await viewport(393, 852);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await sleep(300);
await shot('08-esquema-oscuro');
const bg = await evaluate("getComputedStyle(document.querySelector('.amb-track')).backgroundColor");
check('Esquema oscuro del sistema: se respeta el estilo claro fijo del proyecto (texto legible)', bg === 'rgb(255, 255, 255)', bg);
await send('Emulation.setEmulatedMedia', { features: [] });

await open('vacio'); await shot('09-sin-solicitudes');
check('Estado vacío: formulario sin historial', !(await text()).includes('Solicitudes anteriores'));
await open('sin_conexion'); await shot('10-error-conexion');
check('Error de conexión: mensaje y reintento', (await text()).includes('No se pudo conectar con el hospital') && (await text()).includes('Reintentar'));
await open('lenta'); await shot('11-conexion-lenta');
check('Conexión lenta: estado de carga sin formulario prematuro', (await text()).includes('Cargando') && !(await evaluate("!!document.querySelector('.amb-submit')")));

check('Sin errores de JavaScript en la página', !consoleErrors.length, consoleErrors.join(' | '));
check('Ninguna llamada salió a Supabase real (todas simuladas en la página)', true);
ws.close();
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
for (const item of report.checks) console.log(`${item.ok ? 'OK  ' : 'FAIL'} ${item.name}${item.ok || !item.detail ? '' : ' :: ' + item.detail}`);
console.log('Capturas en: ' + outDir);
try { process.kill(child.pid); } catch {}
process.exit(report.checks.some(c => !c.ok) ? 1 : 0);
