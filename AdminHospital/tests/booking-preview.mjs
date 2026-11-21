// Local visual review only. All data is synthetic; mutations and remote traffic are disabled.
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
const source='src/components/ReceptionAppointmentScheduler.tsx'
const before=execFileSync('git',['show','HEAD:'+source],{encoding:'utf8'})
const oldCSS=execFileSync('git',['show','HEAD:src/components/ReceptionAgenda.css'],{encoding:'utf8'})
const mock=`
export const localDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guatemala',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const date=localDate();
const fixture=['08:00','08:30','09:00','09:30','13:00','13:30','22:00','22:30'].map(time=>({doctor_id:'synthetic-doctor',doctor_name:'Medico de prueba',consulting_room_id:'synthetic-room',room_code:'C-01',starts_at:date+'T'+time+':00-06:00',ends_at:new Date(Date.parse(date+'T'+time+':00-06:00')+1800000).toISOString(),slot_minutes:30}));
export const receptionDoctors=async()=>({complete:true,doctors:[{id:'synthetic-doctor',name:'Medico de prueba',specialty:'Medicina general',shifts:[],consultations:[],breaks:[]}]});
export const availableSlots=async()=>fixture;
export const nextAvailableDate=async()=>null;
export const requestAppointment=async()=>null;
export const receptionRpc=async()=>{throw Error('Visual fixture: saving disabled')};
export const displayTime=v=>new Date(v).toLocaleString('es-GT',{timeZone:'America/Guatemala',hour12:true});
`
const server=await createServer({server:{host:'127.0.0.1',port:5181,strictPort:true},plugins:[{name:'booking-visual-fixtures',enforce:'pre',
 resolveId(id){if(id.startsWith('virtual:booking-'))return '\0'+id;if(id.includes('__booking-')&&id.endsWith('.tsx'))return resolve('src/components',id.split('/').at(-1))},
 async load(id){if(id.includes('__booking-entry-')){const v=id.includes('before')?'before':'after';return `import React from 'react';import{createRoot}from'react-dom/client';import{ReceptionAppointmentScheduler}from'./__booking-${v}.tsx';createRoot(document.getElementById('root')).render(React.createElement(ReceptionAppointmentScheduler,{patient:{id:'synthetic-patient',first_name:'Paciente',last_name:'de prueba',patient_code:'TEST'},code:'EXP-TEST',specialties:[{id:1,name:'Medicina general'}],specialtyId:1,onSaved:()=>{}}));`;}if(id==='\0virtual:booking-reception')return mock;if(id==='\0virtual:booking-realtime')return 'export const usePlanningRealtime=()=>({revision:0,connected:false})';if(id.endsWith('__booking-before.tsx')||id.endsWith('__booking-after.tsx')){let s=id.endsWith('__booking-before.tsx')?before:await readFile(source,'utf8');return s.replaceAll("'../lib/reception'","'virtual:booking-reception'").replaceAll("'../lib/usePlanningRealtime'","'virtual:booking-realtime'").replace("import './ReceptionAgenda.css'",'')}} ,
 configureServer(s){s.middlewares.use(async(req,res,next)=>{if(!req.url.startsWith('/booking-review/'))return next();const version=req.url.includes('/before')?'before':'after';res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Segoe UI,Arial;background:#faf6f8;margin:0;padding:24px;color:#382b33}*{box-sizing:border-box}button,input,select,textarea{font:inherit}button{cursor:pointer}#root{max-width:1080px;margin:auto}.fixture-banner{background:#800b2c;color:white;padding:12px;margin-bottom:20px;border-radius:8px}h3,h4,p{margin-top:0}${version==='before'?oldCSS:await readFile('src/components/ReceptionAgenda.css','utf8')}</style></head><body><div class="fixture-banner">PRUEBA VISUAL LOCAL - DATOS SINTETICOS - GUARDADO DESACTIVADO</div><div id="root"></div><script type="module" src="/src/components/__booking-entry-${version}.tsx"></script></body></html>`))})}
}]});await server.listen();console.log('Synthetic review: http://127.0.0.1:5181/booking-review/before and /booking-review/after');
