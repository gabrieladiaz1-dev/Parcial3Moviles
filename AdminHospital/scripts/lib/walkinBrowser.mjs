import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
export async function verifyWalkinBrowser({session,form,onReview}) {
 const root=path.resolve('.private-backups'),profile=path.join(root,'walkin-browser-'+randomUUID())
 fs.mkdirSync(profile,{recursive:true})
 const edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{windowsHide:true,stdio:'ignore'})
 let socket,context,sequence=0;const pending=new Map()
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
 const deadline=async check=>{for(let i=0;i<150;i++){const value=await check();if(value)return value;await pause(200)}throw new Error('Browser acceptance timed out: '+String(check).slice(0,180))}
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Browser command timed out: '+method))},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))})
 try{
  const active=path.join(profile,'DevToolsActivePort');await deadline(()=>fs.existsSync(active))
  const [port,endpoint]=fs.readFileSync(active,'utf8').trim().split(/\r?\n/)
  socket=new WebSocket(`ws://127.0.0.1:${port}${endpoint}`)
  socket.addEventListener('message',event=>{const data=JSON.parse(String(event.data));const item=pending.get(data.id);if(!item)return;pending.delete(data.id);clearTimeout(item.timer);if(data.error)item.reject(new Error(data.error.message));else item.resolve(data.result)})
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  context=(await call('Target.createBrowserContext')).browserContextId
  const target=(await call('Target.createTarget',{url:'about:blank',browserContextId:context})).targetId
  const tab=(await call('Target.attachToTarget',{targetId:target,flatten:true})).sessionId
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},tab);if(result.exceptionDetails)throw new Error('UI expression failed');return result.result.value}
  await call('Page.enable',{},tab);await call('Page.navigate',{url:'http://127.0.0.1:5173/'},tab)
  await deadline(()=>evaluate("document.readyState==='complete'"))
  // Incognito context: session is never written into the user's browser or a profile on disk.
  await evaluate(`localStorage.setItem('hospital-moviles-auth',${JSON.stringify(JSON.stringify(session))});location.reload();true`)
  await deadline(()=>evaluate("[...document.querySelectorAll('button')].some(b=>b.innerText.includes('Atención presencial'))"))
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Atención presencial')).click();true")
  await deadline(()=>evaluate("Boolean(document.getElementById('walkin-first'))"))
  const setField=async(id,value)=>evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  await evaluate("document.querySelector('.walkin-form-footer button').click();true")
  await deadline(()=>evaluate("document.querySelectorAll('.walkin-field-error').length>=4"))
  for(const [key,value] of Object.entries({first:form.p_first,last:form.p_last,dui:form.p_dui,birth:form.p_birth,phone:form.p_phone,email:form.p_email,city:form.p_city}))await setField('walkin-'+key,value)
  await setField('walkin-phone','7777abc12349')
  assert.equal(await evaluate("document.getElementById('walkin-phone').value"),'7777-1234')
  await setField('walkin-dui','12345678AB9012')
  assert.equal(await evaluate("document.getElementById('walkin-dui').value"),'12345678-9')
  await setField('walkin-phone',form.p_phone);await setField('walkin-dui',form.p_dui)
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/El_Salvador',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  await setField('walkin-birth',String(Number(today.slice(0,4))-17)+today.slice(4))
  assert.equal(await evaluate("document.querySelector('.walkin-form-footer button').disabled"),true)
  await setField('walkin-birth',String(Number(today.slice(0,4))-18)+today.slice(4))
  assert.equal(await evaluate("document.querySelector('.walkin-age').innerText.includes('18')"),true)
  await setField('walkin-birth','2099-01-01')
  assert.equal(await evaluate("document.getElementById('walkin-birth').getAttribute('aria-invalid')"),'true')
  await setField('walkin-birth',form.p_birth)
  const enter=async()=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},tab);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},tab)}
  await evaluate("document.getElementById('walkin-first').focus();true");await enter()
  assert.equal(await evaluate('document.activeElement.id'),'walkin-last')
  await setField('walkin-city','Ciudad inventada')
  await evaluate("document.querySelector('.walkin-form-footer button').click();true")
  await deadline(()=>evaluate("Boolean(document.getElementById('walkin-city-error'))"))
  await setField('walkin-city','San Sal')
  await evaluate("document.getElementById('walkin-city').focus();true")
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},tab)
  await enter()
  assert.equal(await evaluate("document.getElementById('walkin-city').value"),'San Salvador')
  await enter()
  assert.equal(await evaluate("Boolean(document.querySelector('dialog.walkin-review[open]'))"),false)
  if(onReview)await onReview()
  await evaluate("document.querySelector('.walkin-form-footer button').click();true")
  await deadline(()=>evaluate("Boolean(document.querySelector('dialog.walkin-review[open]'))"))
  if(onReview)await onReview()
  assert.equal(await evaluate("document.querySelector('.walkin-review footer .walkin-primary').disabled"),true)
  fs.writeFileSync(path.join(root,'walkin-review-desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'},tab)).data,'base64'))
  await evaluate("document.querySelector('.walkin-review .reception-identity-check input').click();document.querySelector('.walkin-review footer .walkin-primary').click();true")
  await deadline(()=>evaluate("Boolean(document.querySelector('.walkin-alert.success'))||Boolean(document.querySelector('.walkin-check input'))"))
  if(await evaluate("Boolean(document.querySelector('.walkin-check input'))")){
   await evaluate("document.querySelector('.walkin-check input').click();document.querySelector('.walkin-review footer .walkin-primary').click();true")
  }
  await deadline(()=>evaluate("Boolean(document.querySelector('.walkin-alert.success'))"))
  assert.equal(await evaluate("document.body.innerText.includes('Paciente y expediente guardados correctamente')"),true)
  assert.equal(await evaluate("document.body.innerText.includes('Presencial') && document.body.innerText.includes('PAC-') && document.body.innerText.includes('EXP-')"),true)
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText==='Ver expediente').click();true")
  await deadline(()=>evaluate("document.querySelector('dialog[open]')?.innerText.includes('EXP-')"))
  await evaluate("[...document.querySelectorAll('dialog button')].find(b=>b.innerText==='Cerrar expediente').click();true")
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText==='Agendar cita').click();true")
  await deadline(()=>evaluate("Boolean(document.querySelector('.walkin-options'))"))
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},tab)
  assert.equal(await evaluate("document.documentElement.scrollWidth<=window.innerWidth+2"),true)
  console.log(JSON.stringify({step:'browser_interface_verified',fieldErrors:true,digitLimits:true,age17Blocked:true,age18Accepted:true,futureBlocked:true,invalidCityBlocked:true,cityKeyboardSelection:true,enterAdvancesWithoutSaving:true,reviewDoesNotPersist:true,createdPatientAndRecord:true,confirmationCodes:true,openedRecord:true,appointmentFlow:true,mobileLayout:true}))
 }finally{
  if(socket?.readyState===WebSocket.OPEN){if(context)await call('Target.disposeBrowserContext',{browserContextId:context}).catch(()=>{});await call('Browser.close').catch(()=>{});socket.close()}
  edge.kill()
  // Only this run's verified directory can be removed, using one filesystem API.
  assert.ok(profile.startsWith(root+path.sep)&&path.basename(profile).startsWith('walkin-browser-'))
  for(let i=0;i<20;i++){try{fs.rmSync(profile,{recursive:true,force:true});break}catch{await pause(200)}}
 }
}
