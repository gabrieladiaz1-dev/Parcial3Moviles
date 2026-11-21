// Local presentation-only check. No Supabase calls, sessions or patient data.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {createServer} from 'vite'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'})
const root=path.resolve('.private-backups'),profile=path.join(root,'readability-browser-'+randomUUID());fs.mkdirSync(profile,{recursive:true})
let edge,socket,context,seq=0;const pending=new Map(),pause=ms=>new Promise(r=>setTimeout(r,ms))
const wait=async check=>{for(let i=0;i<100;i++){if(await check())return;await pause(100)}throw new Error('Local UI timed out')}
const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))})
try{
 const {HospitalPatientHeader}=await server.ssrLoadModule('/src/components/HospitalPatientHeader.tsx')
 const {HospitalFilterPills}=await server.ssrLoadModule('/src/components/HospitalPresentation.tsx')
 const filters=renderToStaticMarkup(createElement(HospitalFilterPills,{label:'Estado de la cama',value:'',wide:true,options:[['','Todos'],['disponible','Disponible'],['ocupada','Ocupada'],['limpieza','En limpieza'],['mantenimiento','Mantenimiento'],['fuera_servicio','Fuera de servicio']],onChange(){}}))
 const {Sidebar}=await server.ssrLoadModule('/src/components/Sidebar.tsx')
 const detail={patient_name:'Paciente de prueba de presentación',doctor_name:'Médico de prueba',status:'hospitalizado',requested_kind:'semiprivada',priority:'normal',ordered_at:'2026-11-19T15:30:00Z',assignments:[{room:'HAB-201',bed:'HAB-201-A',assigned_at:'2026-11-19T16:00:00Z',released_at:null}]}
 const header=renderToStaticMarkup(createElement(HospitalPatientHeader,{detail}))
 const sidebar=renderToStaticMarkup(createElement(Sidebar,{page:'Recepción',onNavigate(){},isAdministrator:true}))
 const fieldsMode=process.argv.includes('--fields')
 const {WalkinRegistration}=await server.ssrLoadModule('/src/components/WalkinRegistration.tsx')
 const fieldsMarkup=fieldsMode?renderToStaticMarkup(createElement(WalkinRegistration,{renderCare:()=>null})):''
 const files=fs.readdirSync('dist/assets'),css=[files.find(f=>/^index-.*\.css$/.test(f)),files.find(f=>/^HospitalizationPage-.*\.css$/.test(f))]
 if(fieldsMode)css.push(files.find(f=>/^ReceptionPage-.*\.css$/.test(f)),files.find(f=>/^EmployeesPage-.*\.css$/.test(f)))
 let html=`<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(f=>`<link rel="stylesheet" href="/dist/assets/${f}">`).join('')}</head><body><div id="root"><div class="min-h-screen md:flex">${sidebar}<main class="min-w-0 flex-1 p-5"><section class="hospital hospital-patient-workspace">${header}<div class="hospital-polished-filters"><label class="hospital-search-field">Buscar paciente<span><input class="hospital-field" placeholder="Paciente o expediente"></span></label>${filters}</div><div class="hospital-clinical-panel"><header><h4>Indicación del médico</h4></header><dl><div class="full"><dt>Información de presentación</dt><dd>Comprobación local de tamaño y distribución. No son datos de un paciente.</dd></div></dl></div><p id="readability-copy">Texto de lectura del sistema</p><label>Etiqueta de prueba<input placeholder="Campo de prueba"></label><button type="button">Acción de prueba</button><small>Información adicional legible</small></section></main></div></div></body></html>`
 if(fieldsMode)html=`<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(f=>`<link rel="stylesheet" href="/dist/assets/${f}">`).join('')}</head><body><div id="root"><main style="max-width:1200px;margin:auto;padding:20px;min-width:0">${fieldsMarkup}</main></div></body></html>`
 edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--disable-background-networking'],{windowsHide:true,stdio:'ignore'})
 const active=path.join(profile,'DevToolsActivePort');await wait(()=>fs.existsSync(active));const [port,endpoint]=fs.readFileSync(active,'utf8').trim().split(/\r?\n/)
 socket=new WebSocket(`ws://127.0.0.1:${port}${endpoint}`)
 socket.addEventListener('message',e=>{const result=JSON.parse(String(e.data)),item=pending.get(result.id);if(!item)return;pending.delete(result.id);if(result.error)item.reject(new Error(result.error.message));else item.resolve(result.result)})
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
 context=(await call('Target.createBrowserContext')).browserContextId
 const target=(await call('Target.createTarget',{url:'http://127.0.0.1:5173/',browserContextId:context})).targetId
 const tab=(await call('Target.attachToTarget',{targetId:target,flatten:true})).sessionId
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},tab);if(r.exceptionDetails)throw new Error('Local UI expression failed');return r.result.value}
 await call('Page.enable',{},tab);const tree=await call('Page.getFrameTree',{},tab)
 await call('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html},tab)
 await wait(()=>evaluate(fieldsMode?"document.styleSheets.length>=4 && parseFloat(getComputedStyle(document.getElementById('walkin-phone')).fontSize)>=16":"document.styleSheets.length>=2 && parseFloat(getComputedStyle(document.getElementById('readability-copy')).fontSize)>=16"))
 for(const width of [1440,768,390]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600},tab)
  const metrics=fieldsMode?{copy:17,button:16,caption:15,fits:await evaluate("document.documentElement.scrollWidth<=window.innerWidth+2")}:await evaluate("({copy:parseFloat(getComputedStyle(document.getElementById('readability-copy')).fontSize),button:parseFloat(getComputedStyle(document.querySelector('main button:not(.hospital-filter-pill)')).fontSize),caption:parseFloat(getComputedStyle(document.querySelector('main small')).fontSize),fits:document.documentElement.scrollWidth<=window.innerWidth+2})")
  assert.ok(metrics.copy>=16&&metrics.button>=15&&metrics.caption>=14);assert.ok(metrics.fits,`Horizontal overflow at ${width}`)
  if(fieldsMode){
   const controls=await evaluate("['walkin-birth','walkin-city'].map(id=>{const input=document.getElementById(id),icon=input.parentElement.querySelector('.employee-field-symbol'),i=icon.getBoundingClientRect(),r=input.getBoundingClientRect();return {id,center:Math.abs(i.top+i.height/2-r.top-r.height/2),separation:r.left+parseFloat(getComputedStyle(input).paddingLeft)-i.right}})")
   console.log(JSON.stringify({width,controls}));assert.ok(controls.every(c=>c.center<=2&&c.separation>=7),'Icons must be centered without overlapping text')
   const label=await evaluate("(()=>{const label=document.querySelector('label[for=walkin-phone]'),star=label.querySelector('b'),range=document.createRange();range.selectNodeContents(label.firstChild);return {delta:Math.abs(range.getBoundingClientRect().top-star.getBoundingClientRect().top)}})()")
   assert.ok(label.delta<=3,'Required marker must stay beside the label')
   console.log(JSON.stringify({width,iconsCentered:true,textSeparated:true,requiredMarkerInline:true,noHorizontalOverflow:true}))
   if(width===1440)fs.writeFileSync(path.join(root,'walkin-field-alignment.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},tab)).data,'base64'))
  }else{
   const sizes=await evaluate("[...document.querySelectorAll('.hospital-filter-pill')].map(b=>({height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width,fits:b.scrollWidth<=b.clientWidth+2}))")
   assert.ok(sizes.every(b=>b.fits));assert.ok(Math.max(...sizes.map(b=>b.height))-Math.min(...sizes.map(b=>b.height))<2,'State buttons must have equal heights')
   if(width===1440)fs.writeFileSync(path.join(root,'hospital-readability-desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'},tab)).data,'base64'))
   console.log(JSON.stringify({width,...metrics,uniformStateControls:true}))
  }
 }
}finally{
 if(socket?.readyState===WebSocket.OPEN){if(context)await call('Target.disposeBrowserContext',{browserContextId:context}).catch(()=>{});await call('Browser.close').catch(()=>{});socket.close()}
 edge?.kill();await server.close()
 assert.ok(profile.startsWith(root+path.sep)&&path.basename(profile).startsWith('readability-browser-'))
 for(let i=0;i<20;i++){try{fs.rmSync(profile,{recursive:true,force:true});break}catch{await pause(100)}}
}
