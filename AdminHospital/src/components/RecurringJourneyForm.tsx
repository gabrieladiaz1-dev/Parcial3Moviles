import { userMessage } from '../lib/userError'
import { useRef, useState } from 'react'
import { weekday, addDays } from '../lib/planningDates'
import { planningWritesEnabled, saveRecurringJourney, staffName, type PlanningData, type RecurringJourney } from '../lib/planning'
import { findScheduleStaff, formatStaffTime, staffToday } from '../lib/staffWeek'
import { editableJourney, journeyEnd, journeyOverlaps, journeyFieldErrors, roomConflicts, roomConflictMessage, validateJourney, type JourneyValues } from '../lib/recurringJourney'
import { StaffScheduleSearch } from './StaffScheduleSearch'
import { FriendlyTimeField } from './FriendlyTimeField'
import { Icon } from './Icon'
import './RecurringJourneyForm.css'

const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const weekDays = [1, 2, 3, 4, 5, 6, 0]
const repeatedDays = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados']
function initialValues(journey: RecurringJourney | undefined, employee: string): JourneyValues {
  return { staff_id: journey?.staff_id ?? employee, weekdays: journey?.weekdays ?? [1, 2, 3, 4, 5], start_time: journey?.start_time.slice(0, 5) ?? '08:00', end_time: journey?.end_time.slice(0, 5) ?? '16:00', shift_type: journey?.shift_type ?? 'ordinario', valid_from: journey ? staffToday() : addDays(staffToday(), 1), valid_until: null, breaks: journey?.breaks.map(b => ({ ...b, start_time: b.start_time.slice(0, 5), end_time: b.end_time.slice(0, 5) })) ?? [], consultations: journey?.consultations.map(c => ({ ...c, start_time: c.start_time.slice(0, 5), end_time: c.end_time.slice(0, 5) })) ?? [], room_id: journey?.consulting_room_id ?? null, specialty_id: journey?.specialty_id ?? null, specialty_ids: journey?.specialty_ids?.length ? journey.specialty_ids : journey?.specialty_id ? [journey.specialty_id] : [] }
}
export function RecurringJourneyForm({ data, initialEmployee = '', initialJourney: providedJourney, initialRole = 'doctor', initialDeactivate = false, editWeekday: initialWeekday = null, editDate = null, initialDate = null, loading, onBusy, onSaved, onManage, onCancel, onRefresh }: { data: PlanningData; initialEmployee?: string; initialJourney?: RecurringJourney; initialRole?: 'doctor' | 'recepcionista'; initialDeactivate?: boolean; editWeekday?: number | null; editDate?: string | null; initialDate?: string | null; loading: boolean; onBusy: (busy: boolean) => void; onSaved: (employee: string, date: string) => void; onManage: (journey: RecurringJourney) => void; onCancel?: () => void; onRefresh?: () => void }) {
  const [initialJourney] = useState(providedJourney)
  const [originals] = useState(() => data.recurring_journeys ?? [])
  const [scope, setScope] = useState<'day' | 'weekday' | 'all'>(editDate ? 'day' : initialWeekday === null ? 'all' : 'weekday')
  const editWeekday = scope === 'all' ? null : initialWeekday
  const [values, setValues] = useState(() => {
    const defaults = initialValues(initialJourney, initialEmployee)
    if (initialDeactivate && defaults.valid_from <= staffToday()) defaults.valid_from = addDays(staffToday(), 1)
    if (initialJourney) {
      const active = (data.recurring_journeys ?? []).filter(j => j.staff_id === initialJourney.staff_id && j.active && !j.closed_on && (!j.valid_until || j.valid_until >= staffToday()))
      defaults.weekdays = editWeekday === null ? [...new Set(active.flatMap(j => j.weekdays))] : [editWeekday]
    }
    if (!initialJourney && initialEmployee && initialRole === 'doctor') {
      defaults.consultations = [{ start_time: '08:00', end_time: '16:00', slot_minutes: 30 }]
      const assigned = data.doctor_specialties?.filter(s => s.doctor_id === initialEmployee) ?? []
      if (assigned.length) { defaults.specialty_id = assigned[0].specialty_id; defaults.specialty_ids = [assigned[0].specialty_id] }
    }
    // An effective date before the edited version's start is allowed: the server also closes the versions in force on those days.
    if (editDate) { defaults.valid_from = editDate; if (!initialJourney) defaults.weekdays = [weekday(editDate)] }
    else if (initialDate) {
      defaults.valid_from = initialDate >= staffToday() ? initialDate : staffToday()
      defaults.weekdays = initialJourney ? [...new Set([...defaults.weekdays, weekday(initialDate)])] : [weekday(initialDate)]
    }
    return defaults
  })
  const [role, setRole] = useState(initialJourney?.staff_role ?? initialRole)
  const [query, setQuery] = useState('')
  const [specialtyQuery, setSpecialtyQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deactivate, setDeactivate] = useState(initialDeactivate)
  const [confirmed, setConfirmed] = useState(false)
  const [step, setStep] = useState(1)
  const [stepError, setStepError] = useState('')
  const [pending, setPending] = useState<Record<string, unknown> | null>(null)
  const lock = useRef(false)
  const operation = useRef(crypto.randomUUID())
  const person = data.staff.find(p => p.id === values.staff_id)
  const doctor = role === 'doctor'
  const specialties = data.doctor_specialties?.filter(s => s.doctor_id === values.staff_id) ?? []
  const selectedSpecialties = specialties.filter(s => values.specialty_ids.includes(s.specialty_id))
  const journeys = (data.recurring_journeys ?? []).filter(j => j.staff_id === values.staff_id)
  const current = journeys.filter(j => !j.closed_on && (!j.valid_until || j.valid_until >= staffToday()))
  const fieldErrors = deactivate ? {} : journeyFieldErrors(values, doctor)
  if (!initialJourney && values.valid_from < (initialDate ? staffToday() : addDays(staffToday(), 1))) fieldErrors.valid_from = initialDate ? 'La jornada debe comenzar hoy o después.' : 'La vigencia de una nueva jornada debe comenzar mañana o después.'
  const conflicts = (scope === 'day' ? [] : current).filter(j => j.id !== initialJourney?.id && !(initialJourney && editWeekday === null) && j.weekdays.some(d => values.weekdays.includes(d)) && journeyOverlaps(j, values.valid_from, values.valid_until))
  const roomUntil = scope === 'day' ? values.valid_from : null
  const roomHolder = (roomId: string | null) => roomConflicts(data.recurring_journeys ?? [], roomId, values.staff_id, values.valid_from, roomUntil, initialJourney?.id)[0]
  const holderName = (j: { staff_id: string }) => { const p = data.staff.find(s => s.id === j.staff_id); return p ? staffName(p) : 'otro doctor' }
  const roomClash = doctor && !deactivate ? roomHolder(values.room_id) : undefined
  const roomClashText = roomClash ? roomConflictMessage(roomClash, data.rooms.find(r => r.id === roomClash.consulting_room_id)?.code ?? 'seleccionado', holderName(roomClash)) : ''
  if (roomClashText) fieldErrors.room_id = roomClashText
  const oldDated = (data.saved_shifts ?? data.shifts).filter(s => !s.recurring_id && s.staff_id === values.staff_id && s.status !== 'cancelado' && s.ends_at > `${values.valid_from}T00:00:00-06:00`)
  const stale = Boolean(initialJourney && !loading && data.recurring_journeys?.find(j => j.id === initialJourney.id)?.version !== initialJourney.version)
  const ready = (!stale || Boolean(pending)) && data.ready && data.recurring_ready && planningWritesEnabled && !loading && !initialJourney?.closed_on
  const canConfigure = Boolean(person && (person.active || initialJourney))
  const fieldError = (key: string) => {
    const message = fieldErrors[key]
    return message ? <small id={`journey-error-${key.replace(/\W/g, '-')}`} className="recurring-field-error">{message}</small> : null
  }
  const fieldInvalid = (key: string) => Boolean(fieldErrors[key])
  function change<K extends keyof JourneyValues>(key: K, value: JourneyValues[K]) { setValues(old => ({ ...old, [key]: value })); setConfirmed(false); setError(''); setStepError('') }
  function toggleSpecialty(id: number) {
    setValues(old => {
      const selected = old.specialty_ids.includes(id) ? old.specialty_ids.filter(value => value !== id) : [...old.specialty_ids, id]
      return { ...old, specialty_ids: selected, specialty_id: selected.includes(old.specialty_id ?? -1) ? old.specialty_id : selected[0] ?? null }
    })
    setConfirmed(false); setError(''); setStepError('')
  }
  function nextStep() {
    if (step === 1 && (!person || (!person.active && !initialJourney) || (!initialJourney && current.length))) { setStepError('Elige una persona activa. Si ya tiene jornada, abre su jornada para editarla.'); return }
    if (step === 2 && (!values.weekdays.length || fieldErrors.weekdays || fieldErrors.valid_from)) { setStepError('Elige los días y la fecha de inicio antes de continuar.'); return }
    if (step === 3 && (fieldErrors.start_time || fieldErrors.end_time)) { setStepError('Revisa la hora de entrada y salida.'); return }
    if (step === 4 && !deactivate && Object.keys(fieldErrors).some(key => key !== 'weekdays' && key !== 'valid_from' && key !== 'start_time' && key !== 'end_time')) { setStepError('Revisa los descansos y la atención médica antes de continuar.'); return }
    setStepError(''); setStep(value => Math.min(5, value + 1))
  }
  function choose(id: string) {
    const existing = editableJourney(data.recurring_journeys ?? [], id, staffToday())
    if (existing) { onManage(existing); return }
    const found = data.staff.find(p => p.id === id)
    const assigned = data.doctor_specialties?.filter(s => s.doctor_id === id) ?? []
    setValues({ ...initialValues(undefined, id), specialty_id: found?.category === 'doctor' && assigned.length ? assigned[0].specialty_id : null, specialty_ids: found?.category === 'doctor' && assigned.length ? [assigned[0].specialty_id] : [], consultations: found?.category === 'doctor' ? [{ start_time: '08:00', end_time: '16:00', slot_minutes: 30 }] : [] })
    setConfirmed(false); setError('')
  }
  async function save() {
    if (lock.current || !ready || !confirmed) return
    const invalid = !initialJourney && values.valid_from < (initialDate ? staffToday() : addDays(staffToday(), 1)) ? 'La jornada no puede comenzar antes de la fecha permitida.' : deactivate ? (!initialJourney ? 'Selecciona la jornada.' : !values.valid_from ? 'Indica la fecha efectiva.' : '') : validateJourney(values, doctor)
    if (invalid) { setError(invalid); return }
    if (roomClashText) { setError(roomClashText); return }
    if (!deactivate && conflicts.length) { setError('El empleado ya tiene una jornada vigente. Abre «Editar jornada» para establecer una nueva versión.'); return }
    const payload = pending ?? (deactivate ? { staff_id: values.staff_id, valid_from: values.valid_from, active: false } : { ...values, valid_until: scope === 'day' ? values.valid_from : null, active: true })
    lock.current = true; setBusy(true); onBusy(true); setError(''); setPending(payload)
    try {
      await saveRecurringJourney(payload, operation.current, initialJourney, initialJourney ? { weekday: editWeekday, originals: originals.filter(j => j.staff_id === values.staff_id), date: scope === 'day' ? values.valid_from : undefined } : undefined)
      onSaved(values.staff_id, values.valid_from)
    } catch (e) {
      const code = (e as { code?: string }).code ?? ''
      if (/^(22|23|40|42)/.test(code) || ['P0001', 'PGRST202', '42883'].includes(code)) { setPending(null); operation.current = crypto.randomUUID() }
      setError(userMessage(e, 'No se confirmó el guardado. Reintenta con los mismos datos.'))
    } finally { lock.current = false; setBusy(false); onBusy(false) }
  }
  return <form className="recurring-form" data-step={step} noValidate onSubmit={e => { e.preventDefault(); if (step < 5) nextStep(); else void save() }}><header className="recurring-form-heading"><span><Icon name="calendar" size={29} /></span><div><small>JORNADA HABITUAL DEL PERSONAL</small><h2>{initialJourney ? scope === 'day' ? 'Editar una fecha' : editWeekday === null ? 'Editar jornada completa' : `Editar ${dayNames[editWeekday].toLowerCase()}` : 'Asignar jornada fija'}</h2>{initialJourney && scope === 'weekday' && editWeekday !== null && <p role="status">Este cambio se repetirá todos los {repeatedDays[editWeekday]} futuros desde la fecha efectiva. Los otros días conservarán sus horarios.</p>}{initialJourney && editWeekday === null && <p>Los horarios que guardes se aplicarán a todos los días marcados y sustituirán su configuración actual desde la fecha efectiva.</p>}<p>{scope === 'day' ? 'Solo se sustituye esta fecha. Las demás conservan su horario.' : 'Se repite cada semana durante su vigencia. Te guiaremos paso a paso. Al final podrás revisar todo antes de guardar.'}</p></div>{onCancel && <button type="button" className="recurring-cancel recurring-header-back" disabled={busy} onClick={onCancel}>Volver al horario</button>}</header>
    <nav className="recurring-progress" aria-label="Pasos para asignar la jornada">{["Persona", "Días", "Horario", "Detalles", "Revisar"].map((label, index) => <button type="button" key={label} className={step === index + 1 ? "is-current" : ""} aria-current={step === index + 1 ? "step" : undefined} disabled={index + 1 > step || busy} onClick={() => { setStep(index + 1); setStepError('') }}><b>{index + 1}</b><span>{label}</span></button>)}</nav>
    <aside className="recurring-current-summary" aria-label="Jornada que estás preparando"><small>JORNADA EN PREPARACIÓN</small><strong>{person ? staffName(person) : 'Elige una persona'}</strong><span>{person?.employee_code ?? 'Nombre y código pendientes'}</span><div><b>Días</b><span>{scope === 'day' ? `Solo ${values.valid_from}` : values.weekdays.length ? weekDays.filter(day => values.weekdays.includes(day)).map(day => dayNames[day]).join(', ') : 'Elige los días'}</span></div><div><b>Desde</b><span>{values.valid_from || 'Elige una fecha'}</span></div><div><b>Horario</b><span>{formatStaffTime(values.start_time)} – {formatStaffTime(values.end_time)}{values.end_time < values.start_time ? ' · Sale al día siguiente' : ''}</span></div><p>Revisa estos datos antes de confirmar.</p></aside>
    {initialJourney && editDate && <label className="recurring-summary">Alcance del cambio<select disabled={busy || Boolean(pending)} value={scope} onChange={e => { const next = e.target.value as typeof scope; setScope(next); change('weekdays', next === 'all' ? [...new Set(originals.filter(j => j.staff_id === values.staff_id && j.active && !j.closed_on).flatMap(j => j.weekdays))] : [weekday(values.valid_from)]); setDeactivate(false) }}><option value="day">Solo esta fecha</option><option value="weekday">Este día de la semana y los futuros</option><option value="all">Jornada completa</option></select></label>}
    {stale && !pending && <p className="recurring-error" role="alert">La jornada cambió desde que abriste el editor. Cierra y vuelve a abrir la fecha para revisar los cambios antes de guardar.</p>}
    {onRefresh && <button type="button" className="recurring-add" style={{ justifySelf: 'start' }} disabled={busy || Boolean(pending) || loading} onClick={onRefresh}><Icon name="calendar" size={16} />{loading ? 'Actualizando…' : 'Actualizar datos'}</button>}
    {data.ready && !data.recurring_ready && !loading && <p className="recurring-warning" role="status">No podemos guardar jornadas en este momento. Actualiza los datos. Si continúa, avisa al administrador del sistema.</p>}
    {!planningWritesEnabled && <p className="recurring-warning" role="status">La asignación de jornadas está temporalmente desactivada. Puedes consultar el horario.</p>}
    {initialJourney?.closed_on && <p className="recurring-warning" role="status">Estás consultando una versión histórica. Sus datos se conservan y no se pueden sobrescribir. Para cambiar la jornada actual, abre su definición vigente en el historial.</p>}
    <fieldset disabled={busy || Boolean(pending) || Boolean(initialJourney?.closed_on)} className="recurring-sections">
      <section className="wizard-panel wizard-person"><div className="recurring-step"><b>01</b><div><h3>Busca y selecciona al empleado</h3><p>Escribe su nombre, código o identificador. Después podrás configurar su jornada.</p></div></div><div className="recurring-employee-search"><label>Tipo de personal<select value={role} disabled={Boolean(initialJourney)} onChange={e => { setRole(e.target.value as typeof role); setValues(initialValues(undefined, '')); setQuery(''); setConfirmed(false) }}><option value="doctor">Doctor</option><option value="recepcionista">Recepcionista</option></select></label>{!initialJourney && <StaffScheduleSearch matches={findScheduleStaff(data.staff, role, query)} query={query} onQuery={setQuery} onSelect={choose} selectedId={values.staff_id} disabled={busy} loading={loading} searchRequired placeholder="Nombre, código o identificador…" helpText="Busca por nombre, código de empleado o identificador. Debes elegir un resultado para continuar." />}</div>{person && <div className="recurring-selected"><Icon name="patient" size={23} /><div><strong>{staffName(person)}</strong><span>{person.employee_code} · {doctor ? 'Doctor' : 'Recepcionista'}{!person.active ? ' · Inactivo' : ''}</span></div></div>}
      {!initialJourney && !editDate && current.length > 0 && <div className="recurring-warning"><div><strong>Este empleado ya tiene una jornada fija.</strong><p>Edita su jornada para que el cambio respete las fechas y conserve el historial.</p>{current.map(j => <button type="button" key={j.id} onClick={() => onManage(j)}>Editar jornada · Desde {j.valid_from}</button>)}</div></div>}
      {oldDated.length > 0 && <p className="recurring-warning">Tiene {oldDated.length} jornadas anteriores por fecha desde la vigencia elegida. Se conservarán. Revisa posibles cruces antes de guardar; el servidor rechazará una superposición.</p>}</section>
      {person && !person.active && !initialJourney && <p className="recurring-warning" role="status">Este empleado está inactivo. Selecciona a una persona activa para asignar una jornada.</p>}
      {canConfigure && <>
      <section className="recurring-panel wizard-panel wizard-days">
        <div className="recurring-step"><b>02</b><div><h3>Días y vigencia</h3><p>Selecciona los días que repetirá todas las semanas.</p></div></div>
        <div className="recurring-panel-content"><div className="recurring-days" aria-describedby={fieldInvalid('weekdays') ? 'journey-error-weekdays' : undefined}>{weekDays.map(d => <button type="button" key={d} disabled={initialJourney !== undefined && editWeekday !== null} aria-pressed={values.weekdays.includes(d)} onClick={() => change('weekdays', values.weekdays.includes(d) ? values.weekdays.filter(v => v !== d) : [...values.weekdays, d])}>{dayNames[d]}{values.weekdays.includes(d) && <Icon name="check" size={15} />}</button>)}</div>{fieldError('weekdays')}<div className="recurring-columns"><label>{initialJourney ? 'Fecha efectiva del cambio' : 'Vigente desde'}<input required type="date" aria-invalid={fieldInvalid('valid_from')} aria-describedby={fieldInvalid('valid_from') ? 'journey-error-valid_from' : undefined} disabled={scope === 'day'} min={(!initialJourney && !initialDate) || (deactivate && scope !== 'day') ? addDays(staffToday(), 1) : staffToday()} value={values.valid_from} onChange={e => change('valid_from', e.target.value)} />{fieldError('valid_from')}</label><p className="recurring-note">{scope === 'day' ? 'Este cambio afecta únicamente la fecha seleccionada.' : 'Se repite cada semana, sin fecha final, hasta que modifiques o desactives la jornada.'}</p></div>{initialJourney && <p className="recurring-note">El cambio se aplicará desde esta fecha. La definición anterior se conservará para consultar su historial.</p>}</div>
      </section>
      <section className="recurring-panel wizard-panel wizard-hours">
        <div className="recurring-step"><b>03</b><div><h3>Horario laboral</h3><p>Usa AM para la mañana y PM para la tarde o noche.</p></div></div>
        <div className="recurring-panel-content"><div className="recurring-columns"><FriendlyTimeField label="Hora de entrada" value={values.start_time} error={fieldErrors.start_time} onChange={v => change('start_time', v)} /><FriendlyTimeField label="Hora de salida" value={values.end_time} error={fieldErrors.end_time} onChange={v => change('end_time', v)} /><label>Tipo de jornada<select value={values.shift_type} onChange={e => change('shift_type', e.target.value)}><option value="ordinario">Ordinaria</option><option value="guardia">Guardia</option></select></label></div>{values.end_time < values.start_time && <p className="recurring-note">La salida corresponde al día siguiente.</p>}</div>
      </section>
      <section className="recurring-panel wizard-panel wizard-extras">
        <div className="recurring-step"><b>04</b><div><h3>Descansos</h3><p>Incluye almuerzo y pausas dentro de la jornada.</p></div></div>
        <div className="recurring-panel-content">{values.breaks.map((pause, index) => <div className="recurring-period recurring-pause" key={index}><FriendlyTimeField label="Inicio del descanso" value={pause.start_time} error={fieldErrors[`breaks.${index}.start_time`]} onChange={v => change('breaks', values.breaks.map((b, i) => i === index ? { ...b, start_time: v } : b))} /><FriendlyTimeField label="Fin del descanso" value={pause.end_time} error={fieldErrors[`breaks.${index}.end_time`]} onChange={v => change('breaks', values.breaks.map((b, i) => i === index ? { ...b, end_time: v } : b))} /><label>Descripción<input required maxLength={450} aria-invalid={fieldInvalid(`breaks.${index}.reason`)} aria-describedby={fieldInvalid(`breaks.${index}.reason`) ? `journey-error-breaks-${index}-reason` : undefined} value={pause.reason} placeholder="Por ejemplo: almuerzo" onChange={e => change('breaks', values.breaks.map((b, i) => i === index ? { ...b, reason: e.target.value } : b))} />{fieldError(`breaks.${index}.reason`)}</label><button type="button" onClick={() => change('breaks', values.breaks.filter((_, i) => i !== index))}>Quitar descanso</button></div>)}{!values.breaks.length && <p className="recurring-note">No hay descansos configurados. Añade los que correspondan.</p>}<button className="recurring-add" type="button" disabled={values.breaks.length >= 16} onClick={() => change('breaks', [...values.breaks, { start_time: '12:00', end_time: '12:30', reason: 'Almuerzo' }])}><Icon name="plus" size={15} />Añadir descanso</button></div>
      </section>
      {doctor && <section className="recurring-panel wizard-panel wizard-extras">
        <div className="recurring-step"><b>04</b><div><h3>Consultorio y atención médica</h3><p>El consultorio permanece asignado a este doctor hasta el fin de vigencia o un cambio autorizado.</p></div></div>
        <div className="recurring-panel-content"><div className="recurring-columns recurring-medical-fields"><label>Consultorio fijo<select required aria-invalid={fieldInvalid('room_id')} aria-describedby={fieldInvalid('room_id') ? 'journey-error-room_id' : undefined} value={values.room_id ?? ''} onChange={e => change('room_id', e.target.value || null)}><option value="">Selecciona el consultorio</option>{data.rooms.filter(r => r.active || r.id === values.room_id).map(r => { const reserved = roomHolder(r.id); return <option key={r.id} value={r.id} disabled={!r.active || Boolean(reserved)}>{r.code}{reserved ? ` · Ocupado por ${holderName(reserved)}` : !r.active ? ' · Inactivo' : ''}</option> })}</select>{fieldError('room_id')}</label><div className="recurring-specialties" role="group" aria-labelledby="journey-specialties-title"><strong id="journey-specialties-title">Especialidades para esta jornada</strong><details className="recurring-specialty-picker"><summary aria-describedby="journey-specialties-help">{selectedSpecialties.length ? selectedSpecialties.map(s => s.name).join(', ') : 'Selecciona especialidades'}<span aria-hidden="true">?</span></summary><div className="recurring-specialty-menu"><p id="journey-specialties-help">Marca todas las especialidades en las que atender? citas.</p>{specialties.length > 5 && <label>Buscar especialidad<input type="search" value={specialtyQuery} onChange={e => setSpecialtyQuery(e.target.value)} placeholder="Nombre de la especialidad" /></label>}<div className="recurring-specialty-options">{specialties.filter(s => s.name.toLocaleLowerCase().includes(specialtyQuery.toLocaleLowerCase())).map(s => <label key={s.specialty_id} className="recurring-specialty-option"><input type="checkbox" checked={values.specialty_ids.includes(s.specialty_id)} onChange={() => toggleSpecialty(s.specialty_id)} /><span>{s.name}</span></label>)}</div>{!specialties.length && <p className="recurring-note">Este doctor no tiene especialidades registradas. As?gnalas en Personal antes de guardar la jornada.</p>}<span className="recurring-specialty-count">{values.specialty_ids.length} {values.specialty_ids.length === 1 ? 'especialidad seleccionada' : 'especialidades seleccionadas'}</span></div></details>{fieldError('specialty_ids')}</div></div>{values.consultations.map((c, index) => <div className="recurring-period" key={index}><FriendlyTimeField label="Atención desde" value={c.start_time} error={fieldErrors[`consultations.${index}.start_time`]} onChange={v => change('consultations', values.consultations.map((b, i) => i === index ? { ...b, start_time: v } : b))} /><FriendlyTimeField label="Atención hasta" value={c.end_time} error={fieldErrors[`consultations.${index}.end_time`]} onChange={v => change('consultations', values.consultations.map((b, i) => i === index ? { ...b, end_time: v } : b))} /><label>Minutos por cita<input required type="number" min={5} max={180} aria-invalid={fieldInvalid(`consultations.${index}.slot_minutes`)} aria-describedby={fieldInvalid(`consultations.${index}.slot_minutes`) ? `journey-error-consultations-${index}-slot_minutes` : undefined} value={c.slot_minutes} onChange={e => change('consultations', values.consultations.map((b, i) => i === index ? { ...b, slot_minutes: Number(e.target.value) } : b))} />{fieldError(`consultations.${index}.slot_minutes`)}</label><button type="button" onClick={() => change('consultations', values.consultations.filter((_, i) => i !== index))}>Quitar atención</button></div>)}{fieldError('consultations')}<button className="recurring-add" type="button" disabled={values.consultations.length >= 8} onClick={() => change('consultations', [...values.consultations, { start_time: values.start_time, end_time: values.end_time, slot_minutes: 30 }])}><Icon name="plus" size={15} />Añadir periodo de atención</button><p className="recurring-note">Los descansos se excluyen automáticamente de los horarios disponibles para citas.</p></div>
      </section>}
      </>}
    </fieldset>
    {canConfigure && <section className="recurring-panel recurring-review wizard-panel wizard-review"><div className="recurring-step"><b>05</b><div><h3>Revisar y guardar</h3><p>Confirma el resumen para terminar la asignación.</p></div></div><div className="recurring-panel-content">{initialJourney && (scope === 'all' || scope === 'day') && <section className="recurring-close"><label><input type="checkbox" checked={deactivate} onChange={e => { setDeactivate(e.target.checked); setConfirmed(false) }} />{scope === 'day' ? 'Desactivar solo esta fecha.' : 'Desactivar esta jornada desde la fecha efectiva indicada.'}</label><p>Se conservarán el empleado, las versiones anteriores y las citas. Si el cambio afecta citas vigentes, el servidor lo rechazará.</p></section>}<section className="recurring-summary"><span>RESUMEN DE LA JORNADA</span><h3>{person ? staffName(person) : 'Empleado'}</h3><p>{weekDays.filter(d => values.weekdays.includes(d)).map(d => dayNames[d]).join(' · ') || 'Sin días seleccionados'}</p><strong>{formatStaffTime(values.start_time)} — {formatStaffTime(values.end_time)}</strong><p>Desde {values.valid_from}{values.valid_until ? ` hasta ${values.valid_until}` : ' · Sin fecha final'}</p>{doctor && <><p>Especialidades: {selectedSpecialties.length ? selectedSpecialties.map(s => s.name).join(', ') : 'por seleccionar'}</p><p>Consultorio {data.rooms.find(r => r.id === values.room_id)?.code ?? 'por seleccionar'}</p></>}{values.breaks.map((b, i) => <p key={i}>{b.reason}: {formatStaffTime(b.start_time)} — {formatStaffTime(b.end_time)}</p>)}{deactivate && <p className="recurring-warning">La jornada quedará desactivada desde {values.valid_from}.</p>}<label><input type="checkbox" disabled={busy || Boolean(pending)} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Revisé el empleado, los días, la vigencia y los horarios.</label>{error && <p className="recurring-error" role="alert">{error}</p>}{pending && !busy && <p role="status">El resultado aún no está confirmado. Reintenta la misma operación para evitar duplicados.</p>}<div className="recurring-actions">{onCancel && <button type="button" className="recurring-cancel" disabled={busy} onClick={onCancel}>Volver al horario</button>}<button className="recurring-save" disabled={!ready || busy || !person || (!deactivate && !person.active) || !confirmed || (!deactivate && conflicts.length > 0)}>{busy ? 'Guardando jornada…' : pending ? 'Reintentar el mismo guardado' : deactivate ? 'Confirmar desactivación' : initialJourney ? 'Guardar cambios' : 'Asignar jornada'}</button></div></section></div></section>}
    <div className="recurring-wizard-controls">{stepError && <p role="alert" className="recurring-error">{stepError}</p>}<div><button type="button" className="recurring-cancel" disabled={step === 1 || busy} onClick={() => { setStep(value => Math.max(1, value - 1)); setStepError('') }}>Anterior</button>{step < 5 && <button type="button" className="recurring-save" disabled={busy || Boolean(pending)} onClick={nextStep}>Continuar: {['Días', 'Horario', 'Detalles', 'Revisar'][step - 1]}</button>}</div><span>Paso {step} de 5</span></div>
    {journeys.length > 0 && <details className="recurring-history"><summary>Historial de definiciones de este empleado ({journeys.length})</summary><ul>{journeys.map(j => <li key={j.id}><strong>{j.valid_from} — {journeyEnd(j) ?? 'Sin fecha final'}</strong><span>{formatStaffTime(j.start_time)} — {formatStaffTime(j.end_time)} · {j.closed_on ? 'Versión anterior' : 'Definición vigente'}</span>{!j.closed_on && <button type="button" disabled={busy || Boolean(pending)} onClick={() => onManage(j)}>Editar jornada</button>}</li>)}</ul></details>}
  </form>
}
