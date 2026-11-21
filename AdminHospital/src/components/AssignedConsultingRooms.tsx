import { useState } from 'react'
import { assignedRooms } from '../lib/assignedRooms'
import { formatStaffTime, staffToday } from '../lib/staffWeek'
import type { PlanningData } from '../lib/planning'
import { Icon } from './Icon'
import './AssignedConsultingRooms.css'
const days=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
export function AssignedConsultingRooms({data,loading,canEdit=false,onEdit}:{data:PlanningData;loading:boolean;canEdit?:boolean;onEdit?:(id:string)=>void}){
  const [now]=useState(()=>Date.now())
  const rooms=assignedRooms(data,staffToday(),now)
  if(loading)return <p role="status" className="assigned-rooms-empty">Cargando consultorios…</p>
  if(!rooms.length)return <div className="assigned-rooms-empty"><Icon name="calendar" size={28}/><p>No hay consultorios registrados.</p></div>
  return <div className="assigned-rooms-grid">{rooms.map(room=><article className={`assigned-room ${!room.active?'is-inactive':room.doctors.length?'is-assigned':'is-available'}`} key={room.id}>
    <header><span className="assigned-room-code">{room.code}</span><span className="assigned-room-floor">{room.floor}</span></header>
    <div className="assigned-room-content" tabIndex={0} aria-label={`Asignación de ${room.code}`}>
      {room.doctors.map(doctor=><div className="assigned-room-doctor" key={doctor.id}><span className="assigned-room-avatar"><Icon name="users" size={19}/></span><div><h3>{doctor.name}</h3><ul>{doctor.hours.map(h=><li key={`${h.start}-${h.end}`}><Icon name="clock" size={14}/><div><strong>{formatStaffTime(h.start)} – {formatStaffTime(h.end)}{h.end<h.start?' (+1 día)':''}</strong><small>{h.days.length===7?'Todos los días':h.days.map(d=>days[d]).join(' · ')}</small></div></li>)}</ul></div></div>)}
      {!room.doctors.length&&<p className="assigned-room-unoccupied">{room.active?'Sin asignar':'Inactivo'}</p>}
    </div>
    {onEdit&&<footer><button type="button" className="assigned-room-edit" disabled={!canEdit} onClick={()=>onEdit(room.id)}>Editar consultorio</button></footer>}
  </article>)}</div>
}
