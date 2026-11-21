import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from './Icon'
const months=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
export function AgendaDatePicker({value,onChange}:{value:string;onChange:(value:string)=>void}){
  const [open,setOpen]=useState(false),[month,setMonth]=useState(value.slice(0,7))
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId()
  const [year,m]=month.split('-').map(Number),count=new Date(Date.UTC(year,m,0)).getUTCDate()
  const first=(new Date(`${month}-01T12:00:00Z`).getUTCDay()+6)%7
  const years=[...new Set([...Array.from({length:41},(_,i)=>new Date().getFullYear()-20+i),year])].sort((a,b)=>a-b)
  useEffect(()=>{
    if(!open)return
    const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)}
    document.addEventListener('pointerdown',close)
    return()=>document.removeEventListener('pointerdown',close)
  },[open])
  function move(step:number){const d=new Date(`${month}-01T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+step);setMonth(d.toISOString().slice(0,7))}
  return <div className="agenda-date-picker" ref={root} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus()}}}>
    <button ref={trigger} type="button" className="agenda-date-trigger" aria-label="Elegir fecha de la agenda" aria-expanded={open} aria-controls={id} onClick={()=>{if(!open)setMonth(value.slice(0,7));setOpen(!open)}}><span className="agenda-date-symbol"><Icon name="calendar" size={21}/></span><span><small>FECHA DE LA AGENDA</small><strong>{new Date(`${value}T12:00:00Z`).toLocaleDateString('es-SV',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'})}</strong></span><Icon name="chevron" size={15}/></button>
    {open&&<div id={id} className="agenda-date-popover" role="group" aria-label="Calendario de la agenda">
      <header><button type="button" aria-label="Mes anterior" onClick={()=>move(-1)}>‹</button><select aria-label="Mes" value={m} onChange={e=>setMonth(`${year}-${e.target.value.padStart(2,'0')}`)}>{months.map((name,i)=><option key={name} value={i+1}>{name}</option>)}</select><select aria-label="Año" value={year} onChange={e=>setMonth(`${e.target.value}-${String(m).padStart(2,'0')}`)}>{years.map(y=><option key={y}>{y}</option>)}</select><button type="button" aria-label="Mes siguiente" onClick={()=>move(1)}>›</button></header>
      <div className="agenda-date-grid" onKeyDown={e=>{const steps:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};if(!(e.key in steps)||!(e.target instanceof HTMLButtonElement))return;e.preventDefault();const buttons=[...e.currentTarget.querySelectorAll('button')];buttons[buttons.indexOf(e.target)+steps[e.key]]?.focus()}}>
        {['L','M','M','J','V','S','D'].map((day,i)=><span key={i}>{day}</span>)}{Array.from({length:first},(_,i)=><i aria-hidden="true" key={`empty-${i}`}/>)}
        {Array.from({length:count},(_,i)=>{const date=`${month}-${String(i+1).padStart(2,'0')}`;return <button type="button" key={date} aria-label={`${i+1} de ${months[m-1]} de ${year}`} aria-pressed={date===value} onClick={()=>{onChange(date);setOpen(false);trigger.current?.focus()}}>{i+1}</button>})}
      </div><p>Selecciona el día que quieres consultar.</p>
    </div>}
  </div>
}
