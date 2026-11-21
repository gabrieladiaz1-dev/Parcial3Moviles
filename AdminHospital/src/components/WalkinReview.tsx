import { useEffect,useRef } from 'react'
import { Icon } from './Icon'
import { IdentityCheck } from './ReceptionIdentity'
import { maskPatientDui } from '../lib/patientSearch'
import { walkinAge,type WalkinFields } from '../lib/walkin'
import type { ReceptionPatientMatch } from '../lib/reception'
export function WalkinReview({form,today,busy,identity,onIdentity,onBack,onConfirm,duplicates,duplicateConfirmed,onDuplicate}:{form:WalkinFields;today:string;busy:boolean;identity:boolean;onIdentity:(checked:boolean)=>void;onBack:()=>void;onConfirm:()=>void;duplicates:ReceptionPatientMatch[];duplicateConfirmed:boolean;onDuplicate:(checked:boolean)=>void}) {
 const dialog=useRef<HTMLDialogElement>(null)
 useEffect(()=>{dialog.current?.showModal()},[])
 return <dialog ref={dialog} className="walkin-review" aria-labelledby="walkin-review-title" onCancel={e=>{e.preventDefault();if(!busy)onBack()}}>
  <header><span className="walkin-review-emblem"><Icon name="file" size={28}/></span><div><span>REVISA ANTES DE CREAR</span><h2 id="walkin-review-title">Todo listo para abrir su expediente</h2><p>Compara estos datos con el documento del paciente.</p></div><button type="button" aria-label="Volver a editar los datos" disabled={busy} onClick={onBack}>×</button></header>
  <div className="walkin-review-body"><div className="walkin-review-person"><Icon name="users" size={25}/><div><small>NOMBRE COMPLETO</small><strong>{form.first} {form.last}</strong></div><span>Nuevo paciente</span></div>
   <dl className="walkin-review-grid">{[['DUI',form.dui],['Teléfono',form.phone],['Correo electrónico',form.email||'No registrado'],['Nacimiento',form.birth.split('-').reverse().join('/')],['Edad',`${walkinAge(form.birth,today)} años`],['Ciudad o municipio',form.city]].map(([label,value])=><div key={label}><dt><Icon name={label==='Nacimiento'?'calendar':label==='Edad'?'clock':'file'} size={16}/>{label}</dt><dd>{value}</dd></div>)}</dl>
   <div className="walkin-review-notice"><Icon name="check" size={22}/><div><strong>Un paciente, un expediente</strong><p>Se creará un nuevo paciente presencial y se generará su expediente automáticamente, sin crear una cuenta ni una contraseña.</p></div></div>
   {duplicates.length>0&&<section className="walkin-alert"><strong>Revisa las posibles coincidencias</strong><ul>{duplicates.map(p=><li key={p.id}>{p.first_name} {p.last_name} · {maskPatientDui(p.dui)}</li>)}</ul><label className="walkin-check"><input type="checkbox" checked={duplicateConfirmed} disabled={busy} onChange={e=>onDuplicate(e.target.checked)}/>Comparé los documentos: son personas diferentes.</label></section>}
   <IdentityCheck checked={identity} disabled={busy} onChange={onIdentity} description="Verifiqué nombres, DUI, nacimiento y datos de contacto."/>
  </div><footer><button type="button" className="walkin-secondary" disabled={busy} onClick={onBack}>Volver a editar</button><button type="button" className="walkin-primary" disabled={busy||!identity||(duplicates.length>0&&!duplicateConfirmed)} onClick={onConfirm}>{busy?'Creando expediente…':'Confirmar y crear expediente'}</button></footer>
 </dialog>
}
