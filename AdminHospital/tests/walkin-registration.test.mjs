import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {formatWalkinDui,formatWalkinPhone,normalizeDui,validateWalkinFields,walkinAge} from '../src/lib/walkin.ts'
const values={first:'Paciente',last:'Prueba',dui:'12345678-9',birth:'1995-03-14',phone:'7777-1234',email:'paciente@example.test',city:'San Salvador'}
test('campos presenciales: exige identidad, DUI, fecha real y teléfono; errores identifican el campo',()=>{
 assert.deepEqual(validateWalkinFields(values,'2026-11-18'),{})
 for(const key of ['first','last','dui','birth','phone'])assert.ok(validateWalkinFields({...values,[key]:''},'2026-11-18')[key])
 for(const birth of ['2027-01-01','2025-02-29','2026-02-30','1890-01-01'])assert.ok(validateWalkinFields({...values,birth},'2026-11-18').birth)
 assert.ok(validateWalkinFields({...values,email:'sin-arroba'},'2026-11-18').email)
 assert.deepEqual(validateWalkinFields({...values,email:''},'2026-11-18'),{})
 assert.ok(validateWalkinFields({...values,city:'Ciudad inventada'},'2026-11-18').city)
 assert.ok(validateWalkinFields({...values,city:''},'2026-11-18').city)
})
test('normaliza DUI y teléfono pegado sin pedir introducir el guion',()=>{
 assert.equal(normalizeDui('123456789'),'12345678-9')
 assert.equal(formatWalkinPhone('+503 7777 1234'),'7777-1234')
 assert.equal(formatWalkinPhone('7777-1234abc99'),'7777-1234')
 assert.throws(()=>normalizeDui('123'),/DUI/)
 assert.equal(formatWalkinDui('123456789012ABC'),'12345678-9')
 assert.equal(formatWalkinPhone('abcdef'),'')
 assert.equal(formatWalkinDui('abcdef'),'')
})
test('edad: 17 se rechaza, cumpleaños 18 se acepta; se respetan cumpleaños pendientes y fechas imposibles',()=>{
 assert.equal(walkinAge('2008-11-18','2026-11-18'),18)
 assert.equal(walkinAge('2008-11-19','2026-11-18'),17)
 assert.equal(walkinAge('2009-11-18','2026-11-18'),17)
 assert.ok(validateWalkinFields({...values,birth:'2009-11-18'},'2026-11-18').birth)
 assert.equal(validateWalkinFields({...values,birth:'2008-11-18'},'2026-11-18').birth,undefined)
 assert.equal(walkinAge('2027-01-01','2026-11-18'),null)
 assert.equal(walkinAge('2025-02-30','2026-11-18'),null)
})
test('interfaz inicial ofrece buscar y crear sin cuenta, con campos accesibles y confirmación de identidad',async()=>{
 const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'})
 try{
  const {WalkinRegistration}=await server.ssrLoadModule('/src/components/WalkinRegistration.tsx')
  const html=renderToStaticMarkup(createElement(WalkinRegistration,{renderCare:()=>null}))
  assert.ok(html.includes('walkin-search')&&html.includes('Nombre, apellido, DUI o teléfono'))
  assert.ok(html.includes('No crea una cuenta ni una contraseña'))
  for(const key of Object.keys(values))assert.ok(html.includes(`id="walkin-${key}"`))
  assert.ok(html.includes('role="combobox"'))
  assert.ok(html.includes('Abrir calendario de nacimiento'))
  assert.ok(html.includes('Enter te lleva al siguiente campo'))
  assert.ok(html.includes('Crear expediente'))
 }finally{await server.close()}
})
