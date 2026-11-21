import { userMessage } from '../lib/userError'
import { useRef, useState } from 'react'
import { availableSlots, displayTime, localDate, receptionRpc, type ReceptionPatient, type Slot } from '../lib/reception'
import { WalkinRegistration } from '../components/WalkinRegistration'
import './WalkinReception.css'
type Mode = 'scheduled' | 'immediate'
const errorText = (e: unknown) => userMessage(e, 'No se pudo completar la operación.')
export function WalkinReception({ specialties, initialPatient = null }: { specialties: { id: number; name: string }[]; initialPatient?: ReceptionPatient | null }) {
  return <WalkinRegistration initialPatient={initialPatient} renderCare={(patient,mode) => <WalkinCare key={`${patient.id}-${mode}`} patient={patient} specialties={specialties} initialMode={mode} />} />
}

function WalkinCare({ patient, specialties, initialMode = 'scheduled' }: { initialMode?: Mode; patient: ReceptionPatient; specialties: { id: number; name: string }[] }) {
  const [mode, setMode] = useState<Mode>(initialMode); const [specialty, setSpecialty] = useState(''); const [date, setDate] = useState(localDate())
  const [reason, setReason] = useState(''); const [symptoms, setSymptoms] = useState(''); const [priority, setPriority] = useState('normal')
  const [slots, setSlots] = useState<Slot[]>([]); const [slot, setSlot] = useState<Slot | null>(null); const [doctor, setDoctor] = useState(''); const [queried, setQueried] = useState(false)
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [result, setResult] = useState<{ appointment_id: string; admission_id: string | null } | null>(null)
  const key = useRef(crypto.randomUUID()); const lock = useRef(false)
  function changed() { key.current = crypto.randomUUID(); setError('') }
  function clearSlots() { setSlots([]); setSlot(null); setQueried(false); setDoctor(''); changed() }
  async function run(work: () => Promise<void>) { if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { await work() } catch (e) { setError(errorText(e)) } finally { lock.current = false; setBusy(false) } }
  async function findSlots() {
    setSlots([]); setSlot(null); setQueried(false)
    const all = await availableSlots(Number(specialty), mode === 'scheduled' ? date : localDate(), patient.id)
    const now = Date.now(); setSlots(all.filter(s => new Date(s.starts_at).getTime() > now && (mode === 'scheduled' || new Date(s.starts_at).getTime() <= now + 2 * 3600000))); setDoctor(''); setQueried(true)
  }
  async function save() {
    if (!slot || !window.confirm(`Reservar esta cita para ${patient.first_name} ${patient.last_name}, ${displayTime(slot.starts_at)}, con ${slot.doctor_name}?`)) return
    const saved = await receptionRpc<{ appointment_id: string; admission_id: string | null }>('reception_walkin_attention', { p_patient: patient.id, p_key: key.current, p_values: { mode, specialty_id: Number(specialty), doctor_id: slot.doctor_id, room_id: slot.consulting_room_id, starts_at: slot.starts_at, ends_at: slot.ends_at, reason, symptoms, priority, identity_confirmed: true } })
    setResult(saved)
  }
  if (result) return <section className="walkin-card"><div className="walkin-alert success" role="status"><strong>Cita registrada correctamente</strong><p>{slot?.doctor_name} · {slot && displayTime(slot.starts_at)} · Consultorio {slot?.room_code}</p></div><p>El médico debe iniciar y registrar la evaluación. Para hospitalizar, debe emitir una solicitud desde su cuenta autenticada; recepción continúa luego en Hospitalización.</p></section>
  const doctors = [...new Map(slots.map(s => [s.doctor_id, s.doctor_name])).entries()]
  return <form className="walkin-card space-y-5" onSubmit={e => { e.preventDefault(); void run(save) }}><h3>¿Cómo continuará la atención?</h3><fieldset disabled={busy} className="space-y-5"><div className="walkin-options">{([['scheduled', 'Agendar cita', 'Elegir fecha y horario'], ['immediate', 'Atención inmediata', 'Próxima disponibilidad de hoy']] as const).map(([v, label, help]) => <button type="button" className={mode === v ? 'active' : ''} aria-pressed={mode === v} key={v} onClick={() => { setMode(v); clearSlots() }}><strong>{label}</strong><small>{help}</small></button>)}</div>
    {(priority === 'urgente' || mode !== 'scheduled') && <p className="walkin-alert">Ante una urgencia, avisa inmediatamente al personal asistencial y sigue el protocolo del hospital. Esta reserva no sustituye el triaje ni confirma que el paciente ya fue atendido.</p>}
    <div className="walkin-grid"><label>Motivo de atención *<textarea required maxLength={2000} value={reason} onChange={e => { setReason(e.target.value); changed() }} /></label><label>Síntomas {mode === 'scheduled' ? '(opcional)' : '*'}<textarea required={mode !== 'scheduled'} maxLength={1000} value={symptoms} onChange={e => { setSymptoms(e.target.value); changed() }} /></label><label>Prioridad *<select value={priority} onChange={e => { setPriority(e.target.value); changed() }}><option value="normal">Normal</option><option value="urgente">Urgente · Avisar al personal asistencial</option></select></label><label>Especialidad *<select required value={specialty} onChange={e => { setSpecialty(e.target.value); clearSlots() }}><option value="">Selecciona una especialidad</option>{specialties.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{mode === 'scheduled' && <label>Fecha *<input required type="date" min={localDate()} value={date} onChange={e => { setDate(e.target.value); clearSlots() }} /></label>}</div>
    <section><div className="walkin-section-head"><div><h4>Médico, horario y consultorio</h4><p>{mode === 'scheduled' ? 'Horarios reales de la fecha elegida.' : 'Horarios de hoy dentro de las próximas dos horas, sujetos a disponibilidad.'}</p></div><button type="button" className="walkin-secondary" disabled={!specialty || busy} onClick={() => void run(findSlots)}>Consultar disponibilidad</button></div>
    {queried && !slots.length && <div className="walkin-alert"><strong>No hay un horario disponible para esta selección.</strong><p>Consulta otra especialidad o agenda una fecha posterior. Si el caso es urgente, solicita valoración asistencial sin esperar esta reserva.</p><button type="button" className="walkin-secondary" onClick={() => { setMode('scheduled'); clearSlots() }}>Buscar una cita programada</button></div>}
    {!!slots.length && <><label>Filtrar por médico<select value={doctor} onChange={e => { setDoctor(e.target.value); setSlot(null); changed() }}><option value="">Todos los médicos disponibles</option>{doctors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><div className="walkin-slots" role="group" aria-label="Horarios disponibles">{slots.filter(s => !doctor || s.doctor_id === doctor).map(s => <button type="button" key={`${s.doctor_id}-${s.consulting_room_id}-${s.starts_at}`} className={slot === s ? 'active' : ''} aria-pressed={slot === s} onClick={() => { setSlot(s); changed() }}><strong>{s.doctor_name}</strong><span>{displayTime(s.starts_at)} – {new Date(s.ends_at).toLocaleTimeString('es-SV', { timeZone: 'America/El_Salvador', hour: '2-digit', minute: '2-digit' })}</span><small>Consultorio {s.room_code} · {s.slot_minutes} minutos</small></button>)}</div></>}
    </section></fieldset>{error && <p className="walkin-alert error" role="alert">{error}</p>}{busy && <p role="status">Procesando, espera un momento…</p>}<button className="walkin-primary" disabled={busy || !slot}>Confirmar cita</button><p className="walkin-note">La disponibilidad se comprueba de nuevo al guardar. Ninguna acción de recepción marca la consulta como realizada.</p></form>
}
