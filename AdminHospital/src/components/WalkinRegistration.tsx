import { userMessage } from '../lib/userError'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EmployeeBirthDate,EmployeeCity } from './EmployeeFields'
import { WalkinReview } from './WalkinReview'
import { advanceFormOnEnter } from '../lib/formKeyboard'
import './WalkinRegistration.css'
import { Icon } from './Icon'
import { IdentityCheck, PatientCard } from './ReceptionIdentity'
import { PatientRecordDialog } from './ReceptionPatientDirectory'
import { AdmissionAssessment } from '../pages/AdmissionAssessment'
import { localDate, displayTime, readWalkinRegistration, receptionRpc, searchPatients, searchReceptionPatients, type ReceptionPatient, type ReceptionPatientMatch } from '../lib/reception'
import { maskPatientDui } from '../lib/patientSearch'
import { formatWalkinDui, formatWalkinPhone, normalizeDui, validateWalkinFields, walkinAge, type WalkinFields } from '../lib/walkin'

const blank: WalkinFields={first:'',last:'',dui:'',birth:'',phone:'',email:'',city:''}
export function WalkinRegistration({initialPatient=null,renderCare}:{initialPatient?:ReceptionPatient|null;renderCare:(patient:ReceptionPatient,mode:'scheduled'|'immediate')=>ReactNode}) {
 const [form,setForm]=useState<WalkinFields>(blank),[patient,setPatient]=useState<ReceptionPatientMatch|null>(null)
 const [query,setQuery]=useState(''),[matches,setMatches]=useState<ReceptionPatientMatch[]>([]),[phase,setPhase]=useState<'idle'|'loading'|'done'|'error'>('idle')
 const [errors,setErrors]=useState<Partial<Record<keyof WalkinFields,string>>>({}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[identity,setIdentity]=useState(false)
 const [duplicates,setDuplicates]=useState<ReceptionPatientMatch[]>([]),[duplicateConfirmed,setDuplicateConfirmed]=useState(false)
 const [showRecord,setShowRecord]=useState(false),[service,setService]=useState<'scheduled'|'immediate'|'assessment'|null>(null)
 const [review,setReview]=useState(false)
 const today=localDate(),age=walkinAge(form.birth,today)
 const [created,setCreated]=useState(false),lock=useRef(false),savedId=useRef<string|null>(null)
 async function run(work:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work()}catch(e){setError(userMessage(e,'No se pudo completar la operación.'))}finally{lock.current=false;setBusy(false)}}
 async function recover(p:ReceptionPatient){const saved=await readWalkinRegistration(p.id);setPatient(saved);setReview(false);setCreated(false);setIdentity(false);setService(null)}
 useEffect(()=>{if(initialPatient)void Promise.resolve().then(()=>run(()=>recover(initialPatient)))},[initialPatient])
 useEffect(()=>{
  if(query.trim().length<2)return
  const controller=new AbortController();let active=true
  const timer=window.setTimeout(()=>{searchReceptionPatients(query,controller.signal).then(r=>{if(active){setMatches(r.patients);setPhase('done')}}).catch(()=>{if(active)setPhase('error')})},350)
  return()=>{active=false;controller.abort();window.clearTimeout(timer)}
 },[query])
 function edit(key:keyof WalkinFields,value:string){setForm(old=>({...old,[key]:value}));setErrors(old=>({...old,[key]:undefined}));setIdentity(false);setDuplicates([]);setDuplicateConfirmed(false);setError('')}
 async function prepare(){
  if(savedId.current){await create();return}
  const invalid=validateWalkinFields(form,today);setErrors(invalid)
  if(Object.keys(invalid).length){document.getElementById(`walkin-${Object.keys(invalid)[0]}`)?.focus();return}
  const existing=await searchPatients(normalizeDui(form.dui))
  if(existing[0]){await recover(existing[0]);return}
  setReview(true)
 }
 async function create(){
  if(savedId.current){setPatient(await readWalkinRegistration(savedId.current));setCreated(true);return}
  const invalid=validateWalkinFields(form,localDate());setErrors(invalid)
  if(Object.keys(invalid).length){document.getElementById(`walkin-${Object.keys(invalid)[0]}`)?.focus();return}
  if(!identity)throw new Error('Compara el documento y confirma la identidad antes de guardar.')
  const dui=normalizeDui(form.dui),existing=await searchPatients(dui)
  if(existing[0]){await recover(existing[0]);return}
  const similar=await Promise.all([`${form.first} ${form.last}`,form.phone,form.email].filter(v=>v.trim().length>=2).map(v=>searchReceptionPatients(v)))
  const candidates=[...new Map(similar.flatMap(r=>r.patients).filter(p=>p.dui!==dui).map(p=>[p.id,p])).values()]
  if(candidates.length&&(!duplicateConfirmed||JSON.stringify(candidates.map(p=>p.id).sort())!==JSON.stringify(duplicates.map(p=>p.id).sort()))){setDuplicates(candidates);setDuplicateConfirmed(false);return}
  try{
   const id=await receptionRpc<string>('create_walkin_patient',{p_first:form.first.trim(),p_last:form.last.trim(),p_dui:dui,p_phone:form.phone,p_birth:form.birth,p_city:form.city.trim()||null,p_email:form.email.trim()||null})
   savedId.current=id
   const saved=await readWalkinRegistration(id)
   if(saved.dui!==dui||!saved.record_code)throw new Error('No se confirmó el registro. Busca por DUI antes de volver a guardar.')
   setPatient(saved);setReview(false);setCreated(true);setService(null)
  }catch(e){setReview(false);const failure=e as Error&{hint?:string;code?:string};if(failure.hint&&failure.hint in blank)setErrors({[failure.hint]:userMessage(failure,"Revisa este campo.")});if(failure.code==='23505')setErrors({dui:'Este DUI ya está registrado. Busca y recupera el expediente existente.'});throw e}
 }
 const fields: {key:keyof WalkinFields;label:string;type?:string;required?:boolean;placeholder?:string;maxLength?:number}[]=[
  {key:'first',label:'Nombres',required:true,maxLength:100},{key:'last',label:'Apellidos',required:true,maxLength:100},
  {key:'dui',label:'DUI',required:true,placeholder:'00000000-0',maxLength:10},{key:'birth',label:'Fecha de nacimiento',type:'date',required:true},
  {key:'phone',label:'Teléfono',required:true,type:'tel',placeholder:'7777-7777',maxLength:9},{key:'email',label:'Correo electrónico',type:'email',maxLength:254},
  {key:'city',label:'Ciudad o municipio',required:true,maxLength:120}]
 return <section className="walkin walkin-registration space-y-5"><header className="walkin-header"><span className="reception-eyebrow">ATENCIÓN PRESENCIAL</span><h2>{patient?'Paciente y expediente disponibles':'Busca al paciente o registra uno nuevo'}</h2><p>El registro presencial crea su expediente. No crea una cuenta ni una contraseña para la aplicación.</p></header>
 {review&&<WalkinReview form={form} today={today} busy={busy} identity={identity} onIdentity={setIdentity} onBack={()=>setReview(false)} onConfirm={()=>void run(create)} duplicates={duplicates} duplicateConfirmed={duplicateConfirmed} onDuplicate={setDuplicateConfirmed}/>}
 {error&&<p role="alert" className="walkin-alert error">{error}</p>}
 {!patient?<><section className="walkin-card walkin-find"><label htmlFor="walkin-search"><Icon name="search" size={21}/>Buscar paciente existente<input id="walkin-search" value={query} onChange={e=>{setQuery(e.target.value);setMatches([]);setPhase(e.target.value.trim().length<2?'idle':'loading')}} placeholder="Nombre, apellido, DUI o teléfono…" maxLength={120}/></label>
 {phase==='loading'&&<p role="status">Buscando coincidencias…</p>}{phase==='error'&&<p role="alert">No se pudo consultar el directorio. Comprueba tu conexión y vuelve a escribir.</p>}
 {phase==='done'&&!matches.length&&<p role="status">No encontramos coincidencias. Completa los datos del nuevo paciente abajo.</p>}
 {matches.length>0&&<div className="walkin-results">{matches.map(p=><article key={p.id}><div><strong>{p.first_name} {p.last_name}</strong><p>{maskPatientDui(p.dui)} · {p.phone||'Sin teléfono'}</p><small>{p.patient_code}</small><span className={p.record_code?'walkin-record-badge':'walkin-note'}>{p.record_code?`Con expediente · ${p.record_code}`:'Sin expediente disponible · Requiere revisión'}</span></div><button type="button" className="walkin-secondary" disabled={busy||!p.record_code} onClick={()=>void run(()=>recover(p))}>Continuar con este paciente</button></article>)}</div>}
 </section><form noValidate className="walkin-card walkin-registration-form" onSubmit={e=>e.preventDefault()} onKeyDown={advanceFormOnEnter}>
 <div className="walkin-form-banner"><span><Icon name="file" size={28}/></span><div><small>NUEVO PACIENTE PRESENCIAL</small><h3>Su expediente empieza con sus datos</h3><p>Completa la información. Después podrás revisarla antes de guardar.</p></div><span className="walkin-required-note">* Obligatorio</span></div>
 <fieldset disabled={busy||Boolean(savedId.current)}>
 {[["Identidad del paciente","Nombres, documento y fecha de nacimiento.",'users',fields.slice(0,4)],["Contacto y localidad","Datos para comunicarnos con el paciente.",'patient',fields.slice(4)]].map(([title,description,icon,list],index)=><section className="walkin-form-section" key={String(title)}><header><span><Icon name={icon as 'users'|'patient'} size={23}/></span><div><small>0{index+1}</small><h4>{String(title)}</h4><p>{String(description)}</p></div></header><div className="walkin-grid">{(list as typeof fields).map(f=>{
 const fieldError=errors[f.key]||(f.key==='birth'&&form.birth?validateWalkinFields(form,today).birth:undefined)
 return <div className={`walkin-form-field ${fieldError?'has-error':''}`} key={f.key}><label htmlFor={`walkin-${f.key}`}>{f.label}{f.required?<b> *</b>:<small>Opcional</small>}</label>
 {f.key==='birth'?<EmployeeBirthDate inputId="walkin-birth" invalid={Boolean(fieldError)} value={form.birth} today={today} className="walkin-input" onChange={value=>edit('birth',value)}/>:f.key==='city'?<EmployeeCity inputId="walkin-city" invalid={Boolean(fieldError)} strict value={form.city} className="walkin-input" onChange={value=>edit('city',value)}/>:<input id={`walkin-${f.key}`} type={f.type??'text'} required={f.required} inputMode={f.key==='phone'||f.key==='dui'?'numeric':undefined} maxLength={f.maxLength} placeholder={f.placeholder} value={form[f.key]} aria-invalid={Boolean(fieldError)} aria-describedby={`walkin-${f.key}-help`} onPaste={event=>{if(f.key==='phone'||f.key==='dui'){event.preventDefault();edit(f.key,f.key==='phone'?formatWalkinPhone(event.clipboardData.getData('text')):formatWalkinDui(event.clipboardData.getData('text')))}}} onKeyDown={event=>{if((f.key==='phone'||f.key==='dui')&&event.key.length===1&&!/[0-9]/.test(event.key)&&!event.ctrlKey&&!event.metaKey&&!event.altKey)event.preventDefault()}} onChange={event=>edit(f.key,f.key==='phone'?formatWalkinPhone(event.target.value):f.key==='dui'?formatWalkinDui(event.target.value):event.target.value)}/>}
 {f.key==='birth'&&age!==null&&<span className={`walkin-age ${age<18?'is-minor':''}`}><Icon name="clock" size={15}/>{age} años{age<18?' · Debe tener al menos 18 años':' · Mayor de edad'}</span>}
 <small id={`walkin-${f.key}-help`} className="walkin-field-help">{f.key==='phone'?'8 dígitos. El guion se añade solo: 7777-7777.':f.key==='dui'?'9 dígitos. El guion se añade solo: 00000000-0.':f.key==='email'?'Correo de contacto; no crea una cuenta.':f.key==='birth'?'Selecciona mes y año en el calendario.':''}</small>
 {fieldError&&<small id={`walkin-${f.key}-error`} className="walkin-field-error" role="alert">{fieldError}</small>}</div>
 })}</div></section>)}
 </fieldset><footer className="walkin-form-footer"><div><Icon name="check" size={22}/><p>Primero revisas, después confirmas.<small>Enter te lleva al siguiente campo. No guarda el expediente.</small></p></div><button type="button" className="walkin-primary" disabled={busy||(age!==null&&age<18)} onClick={()=>void run(prepare)}>{busy?'Comprobando datos…':savedId.current?'Confirmar el registro guardado':'Crear expediente'}<Icon name="arrow" size={18}/></button></footer>
 </form></>:<><section className="walkin-card space-y-4"><div className="walkin-alert success" role="status"><strong><Icon name="check" size={20}/>{created?'Paciente y expediente guardados correctamente':'Expediente existente recuperado'}</strong><p>{created?'Ambos registros quedaron relacionados. No se creó una cuenta Auth.':'Se conserva el mismo paciente y expediente.'}</p></div><PatientCard patient={patient} code={patient.record_code??undefined}/><dl className="walkin-confirmation"><div><dt>Tipo de registro</dt><dd>{patient.registration_source==='presencial'?'Presencial':'Aplicación'}</dd></div><div><dt>Fecha de creación</dt><dd>{patient.created_at?displayTime(patient.created_at):'No disponible'}</dd></div><div><dt>Correo</dt><dd>{patient.email||'No registrado'}</dd></div><div><dt>Ciudad o municipio</dt><dd>{patient.city||'No registrado'}</dd></div></dl>
 {!identity&&<IdentityCheck checked={identity} onChange={setIdentity} disabled={busy}/>}
 <div className="walkin-confirm-actions"><button type="button" className="walkin-secondary" onClick={()=>setShowRecord(true)}>Ver expediente</button><button type="button" className="walkin-primary" disabled={!identity} onClick={()=>setService('scheduled')}>Agendar cita</button><button type="button" className="walkin-secondary" disabled={!identity} onClick={()=>setService('immediate')}>Continuar atención presencial</button><button type="button" className="walkin-secondary" disabled={!identity} onClick={()=>setService('assessment')}>Solicitar valoración</button></div><button type="button" className="walkin-secondary" onClick={()=>{setPatient(null);setForm(blank);setIdentity(false);setQuery('');setService(null);savedId.current=null;setErrors({});setDuplicates([]);setDuplicateConfirmed(false)}}>Atender otro paciente</button></section>
 {identity&&service&&(service==='assessment'?<AdmissionAssessment key={patient.id} patientId={patient.id}/>:renderCare(patient,service))}
 {showRecord&&<PatientRecordDialog patient={patient} onClose={()=>setShowRecord(false)}/>}</>}
 </section>
}
