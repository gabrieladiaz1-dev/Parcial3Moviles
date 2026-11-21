import { useState } from 'react'
import { Icon } from './Icon'
import { staffName, type PlanningStaff } from '../lib/planning'
import { weekday } from '../lib/planningDates'
import type { ScheduleGroup } from '../lib/planningGroups'
import '../pages/AdminExperience.css'

const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const dateLabel = (date: string) => new Date(`${date}T12:00:00-06:00`).toLocaleDateString('es-SV', { timeZone: 'America/El_Salvador', day: 'numeric', month: 'long', year: 'numeric' })
const hours = (start: string, end: string) => `${start} – ${end}${end < start ? ' · termina al día siguiente' : ''}`

export function CompleteStaffSchedule({ people, groups, doctor, canEdit, onEdit, roomCode }: {
  people: PlanningStaff[]; groups: ScheduleGroup[]; doctor: boolean; canEdit: boolean
  onEdit: (group: ScheduleGroup, date?: string) => void; roomCode: (id: string) => string
}) {
  const [day, setDay] = useState('')
  const [from, setFrom] = useState(''); const [until, setUntil] = useState('')
  const matches = (date: string) => (!day || weekday(date) === Number(day)) && (!from || date >= from) && (!until || date <= until)
  return <section className="complete-schedule">
    <div className="experience-heading"><div><span className="experience-eyebrow">PROGRAMACIÓN COMPLETA</span><h2>{doctor ? 'Todos los días de trabajo de cada doctor' : 'Todos los turnos de cada recepcionista'}</h2><p>Fechas guardadas, sin límite a una semana. Cada tarjeta muestra la jornada completa de ese día.</p></div><span className="experience-icon"><Icon name="calendar" size={24} /></span></div>
    <div className="experience-filters"><label>Día de la semana<select value={day} onChange={e => setDay(e.target.value)}><option value="">Todos los días</option>{[1, 2, 3, 4, 5, 6, 0].map(d => <option key={d} value={d}>{days[d]}</option>)}</select></label><label>Desde (opcional)<input type="date" value={from} max={until || undefined} onChange={e => setFrom(e.target.value)} /></label><label>Hasta (opcional)<input type="date" value={until} min={from || undefined} onChange={e => setUntil(e.target.value)} /></label>{(day || from || until) && <button className="experience-outline" onClick={() => { setDay(''); setFrom(''); setUntil('') }}>Ver todos los días</button>}</div>
    {from && until && from > until && <p role="alert" className="experience-empty">La fecha final debe ser igual o posterior a la inicial.</p>}
    <div className="space-y-5">{people.map(person => {
      const personGroups = groups.filter(g => g.staffId === person.id)
      const dates = [...new Set(personGroups.flatMap(g => g.dates))].filter(matches).sort()
      return <article className="complete-person" key={person.id}><header><span className="experience-avatar">{staffName(person).split(/\s+/).slice(0, 2).map(n => n[0]).join('')}</span><div><h3>{staffName(person)}</h3><p>{doctor ? 'Doctor' : 'Recepcionista'} · {person.employee_code}</p></div><span className="experience-pill">{dates.length} días programados</span></header>
        {!dates.length ? <p className="experience-empty">{personGroups.length ? 'No hay días programados para estos filtros.' : 'Este empleado todavía no tiene programación guardada.'}</p> : <div className="complete-days">{dates.map(date => <section className="complete-day" key={date}><div className="complete-day-date"><strong>{days[weekday(date)]}</strong><span>{dateLabel(date)}</span></div><div className="complete-day-content">{personGroups.filter(g => g.dates.includes(date)).sort((a, b) => a.start.localeCompare(b.start)).map(g => <div className={`complete-period ${!g.active ? 'inactive' : ''}`} key={g.key}><div className="complete-period-heading"><span className={`complete-period-label ${g.kind}`}><Icon name={g.kind === 'absence' ? 'clock' : 'calendar'} size={14} />{g.kind === 'shift' ? doctor ? 'Jornada laboral' : 'Turno laboral' : g.kind === 'consultation' ? 'Atención médica' : 'Ausencia'}{!g.active && ' · Desactivado'}</span>{g.active && <button disabled={!canEdit} onClick={() => onEdit(g, date)}>Editar día</button>}</div><strong className="complete-hours">{hours(g.start, g.end)}</strong>{g.consultations.map((c, i) => <div className="complete-medical" key={i}><span>Atención de pacientes</span><strong>{hours(c.start, c.end)}</strong><p>Consultorio {roomCode(c.roomId)} · {c.minutes} min por cita</p></div>)}{g.breaks.map((b, i) => <div className="complete-break" key={i}><strong>Descanso: {hours(b.start, b.end)}</strong><p>{b.reason}</p></div>)}{g.kind === 'absence' && <p className="mt-2 text-xs text-amber-800">{g.reason}</p>}</div>)}</div></section>)}</div>}
      </article>
    })}{!people.length && <p className="experience-empty">No hay empleados para los filtros seleccionados.</p>}</div>
  </section>
}
