import { userMessage } from '../lib/userError'
import { usePlanningRealtime } from '../lib/usePlanningRealtime'
import { AgendaDatePicker } from './AgendaDatePicker'
import { useEffect, useState, type ReactNode } from 'react'
import { displayTime, loadAgenda, loadRequests, localDate, recordCode, type AttentionRequest, type ReceptionAppointment, type ReceptionPatient } from '../lib/reception'
import { agendaCounts, agendaMatches, appointmentLabels } from '../lib/receptionBooking'
import { ReceptionPatientDirectory } from './ReceptionPatientDirectory'
import { ReceptionRecordPreparation } from './ReceptionRecordPreparation'
import { ReceptionAppointmentScheduler } from './ReceptionAppointmentScheduler'
import { IdentityCheck, PatientCard } from './ReceptionIdentity'
import { Icon } from './Icon'
import './ReceptionAgenda.css'

export function ReceptionAgenda({ specialties, renderRequest }: { specialties: { id: number; name: string }[]; renderRequest: (request: AttentionRequest, onBack: () => void, onSaved: (appointment: ReceptionAppointment) => void) => ReactNode }) {
  const [mode, setMode] = useState<'day' | 'requests' | 'walkin'>('day')
  const [date, setDate] = useState(localDate())
  const [revision, setRevision] = useState(0)
  usePlanningRealtime(() => setRevision(r => r + 1))
  const [rows, setRows] = useState<ReceptionAppointment[]>([])
  const [requests, setRequests] = useState<AttentionRequest[]>([])
  const [more, setMore] = useState(false)
  const [selected, setSelected] = useState<AttentionRequest | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  useEffect(() => {
    let active = true
    setBusy(true); setError(''); setRows([]); setRequests([])
    Promise.all([loadAgenda(date), loadRequests()]).then(([appointments, pending]) => { if (active) { setRows(appointments); setRequests(pending.items.filter(r => r.requester_id)); setMore(pending.hasMore) } }).catch(e => { if (active) setError(userMessage(e)) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [date, revision])
  const counts = agendaCounts(rows)
  const visible = rows.filter(a => agendaMatches(status, a) && `${a.patient_name} ${a.doctor_name} ${a.room_code}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  function saved(a: ReceptionAppointment) { setDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(a.starts_at))); setNotice(`Cita guardada: ${displayTime(a.starts_at)} · ${a.doctor_name} · Consultorio ${a.room_code}.`); setRevision(v => v + 1); setSelected(null); setMode('day') }
  function move(days: number) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); setDate(d.toISOString().slice(0, 10)) }
  return <section className="agenda-workspace"><header className="agenda-hero"><div><span>ORGANIZA LA ATENCIÓN</span><h2>Agenda de citas</h2><p>Recibe solicitudes y programa citas en un solo lugar.</p></div><div className="agenda-hero-actions"><button type="button" onClick={() => { setSelected(null); setMode('requests') }}><Icon name="file" size={18} />Solicitudes de la app</button><button type="button" className="agenda-primary" onClick={() => { setSelected(null); setMode('walkin') }}><Icon name="plus" size={18} />Nueva cita presencial</button></div></header>
    {notice && <p className="agenda-success" role="status"><Icon name="check" size={20} />{notice}</p>}
    {mode !== 'day' && <button type="button" className="agenda-back" onClick={() => { setSelected(null); setMode('day'); setRevision(v => v + 1) }}>← Volver a la agenda</button>}
    {mode === 'walkin' && <WalkinBooking specialties={specialties} onSaved={saved} />}
    {mode === 'requests' && (selected ? renderRequest(selected, () => { setSelected(null); setRevision(v => v + 1) }, saved) : <div className="agenda-card"><h3>Solicitudes de pacientes desde la app</h3><p>Abre una solicitud, verifica su expediente y elige una cita.</p>{busy && <p role="status">Consultando solicitudes…</p>}{error && <p role="alert" className="agenda-warning">{error}</p>}{!busy && !error && !requests.length && <div className="agenda-empty">No hay solicitudes pendientes ni en revisión.</div>}<div className="agenda-request-list">{requests.map(r => <button type="button" key={r.id} onClick={() => setSelected(r)}><Icon name="patient" size={23} /><div><strong>{r.applicant_data.first_name} {r.applicant_data.last_name}</strong><span>{specialties.find(s => s.id === r.specialty_id)?.name} · {displayTime(r.created_at)}</span></div><span>{r.status === 'pendiente' ? 'Pendiente' : 'En revisión'}</span><Icon name="arrowRight" size={18} /></button>)}</div>{more && <p className="agenda-note">Mostrando la primera página de solicitudes. Las restantes siguen disponibles en «Solicitudes de atención».</p>}</div>)}
    {mode === 'day' && <><div className="agenda-counters">{[[counts.total, 'Citas del día'], [counts.scheduled, 'Programadas'], [counts.waiting, 'Pendientes de atención'], [counts.attending, 'En atención']].map(([value, label]) => <div key={label}><Icon name="calendar" size={20} /><strong>{busy ? '—' : value}</strong><span>{label}</span></div>)}</div><div className="agenda-card agenda-daily-card"><div className="agenda-day"><div className="agenda-daily-heading"><span><Icon name="calendar" size={24}/></span><div><small>ATENCIÓN DEL DÍA</small><h3>Tu agenda diaria</h3><p>Horario local de El Salvador</p></div></div><div><button type="button" className="agenda-day-arrow" aria-label="Día anterior" onClick={() => move(-1)}>←</button><AgendaDatePicker value={date} onChange={setDate}/><button type="button" className="agenda-day-arrow" aria-label="Día siguiente" onClick={() => move(1)}>→</button><button type="button" className="agenda-today" onClick={() => setDate(localDate())}>Hoy</button><button type="button" className="agenda-refresh" disabled={busy} onClick={() => setRevision(v => v + 1)}><Icon name="clock" size={16}/>Actualizar</button></div></div><div className="agenda-daily-filters"><label className="agenda-daily-search">Buscar en este día<span><Icon name="search" size={19}/><input placeholder="Paciente, médico o consultorio" value={query} onChange={e => setQuery(e.target.value)} /></span></label><div className="agenda-status-filter"><span>Estado de la cita</span><div role="group" aria-label="Filtrar citas por estado" data-options={Object.keys(appointmentLabels).length+1}>{[['','Todas'],['history','Historial'],...Object.entries({...appointmentLabels, programada: 'Programadas vigentes'})].map(([value,label])=><button type="button" key={value} className={`agenda-filter-chip state-${value||'all'}`} aria-pressed={status===value} onClick={()=>setStatus(value)}><i aria-hidden="true"/>{label}</button>)}</div></div></div>{busy && <p role="status">Consultando agenda…</p>}{error && <p role="alert" className="agenda-warning">{error}</p>}{!busy && !error && !visible.length && <div className="agenda-empty agenda-daily-empty"><span className="agenda-empty-calendar"><Icon name="calendar" size={34} /></span><h4>No hay citas para esta selección</h4><p>Prueba otra fecha o programa una nueva cita.</p></div>}<div className="agenda-appointments">{!busy && !error && visible.map(a => <article key={a.id}><time>{new Date(a.starts_at).toLocaleTimeString('es-SV', { timeZone: 'America/El_Salvador', hour: '2-digit', minute: '2-digit' })}</time><div><h4>{a.patient_name}</h4><p>{a.doctor_name}</p></div><span>Consultorio {a.room_code}</span><span className={`agenda-state state-${a.status}`}>{appointmentLabels[a.status] ?? a.status}</span></article>)}</div><p className="agenda-note">Hasta 200 citas por día. Los indicadores corresponden a las citas cargadas.</p></div></>}
  </section>
}

function WalkinBooking({ specialties, onSaved }: { specialties: { id: number; name: string }[]; onSaved: (appointment: ReceptionAppointment) => void }) {
  const [patient, setPatient] = useState<ReceptionPatient | null>(null)
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState<'search' | 'verify' | 'record' | 'schedule'>('search')
  const [identity, setIdentity] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function select(p: ReceptionPatient) { setPatient(p); setIdentity(false); setCode(''); setPhase('verify'); setBusy(true); setError(''); try { setCode(await recordCode(p.id) ?? '') } catch (e) { setError(userMessage(e, 'No se pudo comprobar el expediente.')) } finally { setBusy(false) } }
  return <div className="agenda-card"><h3>Nueva cita presencial</h3><p>1. Busca al paciente · 2. Verifica su expediente · 3. Programa la cita</p>{phase === 'search' && <ReceptionPatientDirectory onSelectPatient={p => void select(p)} onStartRegistration={p => { if (p) void select(p); else { setPatient(null); setPhase('record') } }} />}{phase === 'verify' && patient && <><PatientCard patient={patient} code={code} />{busy ? <p role="status">Comprobando expediente…</p> : <p className={code ? 'agenda-success' : 'agenda-warning'}>{code ? `Tiene expediente: ${code}` : 'Sin expediente. Completa su registro antes de programar.'}</p>}{error && <p role="alert" className="agenda-warning">{error}</p>}<IdentityCheck checked={identity} onChange={setIdentity} disabled={busy} /><button className="agenda-primary" disabled={!identity || busy || Boolean(error)} onClick={() => setPhase(code ? 'schedule' : 'record')}>{code ? 'Continuar a los horarios' : 'Crear expediente'}</button><button className="agenda-back" onClick={() => setPhase('search')}>Buscar otro paciente</button></>}{phase === 'record' && <ReceptionRecordPreparation patient={patient} onCancel={() => setPhase('search')} onReady={(p, c) => { setPatient(p); setCode(c); setPhase('schedule') }} />}{phase === 'schedule' && patient && <ReceptionAppointmentScheduler patient={patient} code={code} specialties={specialties} onSaved={onSaved} />}</div>
}
