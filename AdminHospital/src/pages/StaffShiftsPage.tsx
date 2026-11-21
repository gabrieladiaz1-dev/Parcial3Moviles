import { userMessage } from '../lib/userError'
import { usePlanningRealtime } from '../lib/usePlanningRealtime'
import { AssignedConsultingRooms } from '../components/AssignedConsultingRooms'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { JourneyEditorDialog } from '../components/JourneyEditorDialog'
import { RecurringJourneyForm } from '../components/RecurringJourneyForm'
import { FriendlyTimeField } from '../components/FriendlyTimeField'
import { editableJourney } from '../lib/recurringJourney'
import { Panel } from '../components/ui'
import { StaffScheduleSearch } from '../components/StaffScheduleSearch'
import { StaffWeekCalendar } from '../components/StaffWeekCalendar'
import { formatStaffTime, scheduleForDate, staffToday, staffWeek } from '../lib/staffWeek'
import { Icon } from '../components/Icon'
import './AdminExperience.css'
import { addDays, monday, weekday } from '../lib/planningDates'
import { planningWritesEnabled, readPlanning, readStaffSchedule, savePlanning, savePlanningSet, searchPlanningStaff, staffName, type PlanningData, type PlanningStaff, type RecurringJourney } from '../lib/planning'
import { savedScheduleGroups, scheduleDates, toggleDay, type BreakInput, type MedicalInput, type OriginalPeriod, type ScheduleGroup, type StaffRole } from '../lib/planningGroups'

const input = 'mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#870b30] focus:ring-2 focus:ring-[#870b30]/10'
const primary = 'rounded-lg bg-[#870b30] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#6f0827] disabled:cursor-not-allowed disabled:opacity-40'
const secondary = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40'
const weekdays = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const order = [1, 2, 3, 4, 5, 6, 0]
const empty: PlanningData = { ready: false, staff: [], rooms: [], floors: [], shifts: [], absences: [], consultations: [] }
interface Draft {
  role: StaffRole; kind: ScheduleGroup['kind']; staffId: string; from: string; until: string; days: number[]
  exactDates: string[] | null; start: string; end: string; shiftType: string; reason: string
  consultations: MedicalInput[]; breaks: BreakInput[]; originals: OriginalPeriod[]
}
const labelClass = 'block text-xs font-medium text-slate-600'
const dateLabel = (date: string) => `${weekdays[weekday(date)]} ${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
const hours = (start: string, end: string) => `${formatStaffTime(start)}–${formatStaffTime(end)}${end < start ? ' (+1 día)' : ''}`

export function StaffShiftsPage({ initialStaffId = '' }: { initialStaffId?: string }) {
  const [view, setView] = useState<'schedule' | 'assign' | 'rooms'>('schedule')
  const [role, setRole] = useState<StaffRole>('doctor')
  const section = view === 'rooms' ? 'rooms' : role
  const [week, setWeek] = useState(() => staffWeek())
  const [data, setData] = useState<PlanningData>(empty)
  const [employee, setEmployee] = useState(initialStaffId)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<PlanningStaff[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [recurringId, setRecurringId] = useState<string | null>(null)
  const [recurringClose, setRecurringClose] = useState(false)
  const [editDate, setEditDate] = useState<string | null>(null)
  const [assignDate, setAssignDate] = useState<string | null>(null)
  const realtime = usePlanningRealtime()
  const [editWeekday, setEditWeekday] = useState<number | null>(null)
  const [roomDraft, setRoomDraft] = useState<{ id: string; version: string; code: string; floor: string; active: boolean } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const appliedInitial = useRef(false)
  const loadedRequest = useRef('')
  const formAnchor = useRef<HTMLDivElement>(null)
  const canWrite = data.ready && planningWritesEnabled && !loading
  useEffect(() => {
    let current = true
    const requestKey = `${view}:${week}:${employee}`
    const foreground = loadedRequest.current !== requestKey
    async function load() {
      if (foreground) { setLoading(true); setError('') }
      try {
        if (view === 'schedule' && !employee) {
          if (current) { setData(empty); loadedRequest.current = requestKey }
          return
        }
        const result = view === 'schedule' ? await readStaffSchedule(week, employee) : await readPlanning(week)
        if (!current) return
        loadedRequest.current = requestKey
        setData(result)
        setError('')
        setRefreshError('')
        if (!appliedInitial.current) {
          if (initialStaffId) {
            const person = result.staff.find(s => s.id === initialStaffId)
            if (person && (person.category === 'doctor' || person.category === 'recepcionista') && person.roles?.includes(person.category)) setRole(person.category)
            else setEmployee('')
          }
          appliedInitial.current = true
        }
      } catch (err) { if (current) { if (foreground) { loadedRequest.current = requestKey; setData(previous => ({ ...previous, ready: false, shifts: [], consultations: [], absences: [], saved_shifts: [], saved_consultations: [], saved_absences: [] })); setError(userMessage(err, 'No se pudo cargar la programación.')) } else setRefreshError('No se pudo actualizar el horario. Se muestran los datos de la última carga. Pulsa Actualizar para reintentar.') } }
      finally { if (current && foreground) setLoading(false) }
    }
    void load()
    return () => { current = false }
  }, [week, revision, initialStaffId, realtime.revision, view, employee])
  useEffect(() => {
    if (view !== 'schedule' || employee || !query.trim()) return
    let current = true
    const timer = window.setTimeout(() => {
      setSearchLoading(true); setSearchError('')
      void searchPlanningStaff(query, role).then(result => {
        if (current) setMatches(result)
      }).catch(err => {
        if (current) { setMatches([]); setSearchError(userMessage(err, 'No se pudo buscar el personal.')) }
      }).finally(() => { if (current) setSearchLoading(false) })
    }, 180)
    return () => { current = false; window.clearTimeout(timer) }
  }, [view, query, role, employee])
  const people = data.staff.filter(s => s.category === section && s.roles?.includes(section))
  const selectedPerson = people.find(p => p.id === employee)
  const groups = useMemo(() => savedScheduleGroups(data), [data])
  function searchEmployees(value: string) { setQuery(value); setMatches([]); setSearchError(''); setSearchLoading(Boolean(value.trim())); if (employee) setEmployee('') }
  function selectEmployee(id: string) { setEmployee(id); setMatches([]); setSearchLoading(false); setDraft(null); setError(''); setSearchError(''); setNotice('') }
  const allConsultations = data.saved_consultations ?? data.consultations
  const roomCode = (id: string) => data.rooms.find(r => r.id === id)?.code ?? 'Consultorio'
  let dates: string[] = [], previewError = ''
  if (draft) {
    try { dates = draft.exactDates ?? scheduleDates(draft.from, draft.until, draft.days) }
    catch (err) { previewError = userMessage(err, 'Selecciona fechas y días.') }
  }
  function switchRole(next: StaffRole) { setRole(next); setEmployee(''); setQuery(''); setDraft(null); setError(''); setNotice('') }
  function switchView(next: typeof view) { if (next === 'assign') { setEditDate(null); setAssignDate(null); setEditWeekday(null); setDraft(null); setRecurringId(editableJourney(data.recurring_journeys ?? [], employee, staffToday())?.id ?? null); setRecurringClose(false) }; setView(next); setError(''); setNotice('') }
  function manageRecurring(journey: RecurringJourney) { setEditDate(null); setAssignDate(null); setEditWeekday(null); setView('assign'); setDraft(null); setRecurringId(journey.id); setEmployee(journey.staff_id); setRole(journey.staff_role); setRecurringClose(false) }

  function editRecurringDay(date: string) {
    // The version in force on that date, even if it already has an end date (closed_on or valid_until).
    const journey = (data.recurring_journeys ?? []).filter(j => j.staff_id === employee && j.weekdays.includes(weekday(date)) && j.valid_from <= date
      && (!j.closed_on || j.closed_on > date) && (!j.valid_until || j.valid_until >= date)).sort((a,b) => b.valid_from.localeCompare(a.valid_from))[0]
    if (!journey) {
      const dated = groups.find(group => group.kind === 'shift' && group.staffId === employee && group.active && !group.recurringId && group.dates.includes(date))
      if (dated) { edit(dated, date); return }
      // No journey covers this date: create one for this date only, never edit the whole journey.
      setEditDate(date); setEditWeekday(weekday(date)); setAssignDate(date); setRecurringId(null); setRecurringClose(false); setDraft(null); setView('assign')
      return
    }
    setAssignDate(null)
    setEditDate(date); setRecurringId(journey.id); setRecurringClose(false); setEditWeekday(weekday(date)); setDraft(null); setView('assign')
  }

  function startForm(kind: Draft['kind'] = 'shift', date?: string) {
    if (section === 'rooms' || !selectedPerson?.active) return
    setEditDate(null); setAssignDate(date ?? null); setView('assign'); setRecurringId(null); setRecurringClose(false)
    if (kind === 'shift') { setRecurringId(editableJourney(data.recurring_journeys ?? [], employee, staffToday())?.id ?? null); setDraft(null); return }
    const from = date ?? (week < staffToday() ? staffToday() : week)
    setDraft({ role: section, kind, staffId: people.find(p => p.id === employee && p.active)?.id ?? '', from, until: '', days: [weekday(from)], exactDates: null,
      start: '08:00', end: '16:00', shiftType: 'ordinario', reason: 'Ausencia', consultations: [], breaks: [], originals: [] })
    setError(''); setNotice('')
    window.requestAnimationFrame(() => formAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  function edit(group: ScheduleGroup, onlyDate?: string) {
    const editRole = data.staff.find(person => person.id === group.staffId)?.category
    if (editRole !== 'doctor' && editRole !== 'recepcionista') return
    setAssignDate(null); setView('assign')
    if (group.recurringId) { setEditDate(onlyDate ?? null); setView('assign'); setEditWeekday(onlyDate ? weekday(onlyDate) : null); setRecurringId(group.recurringId); setRecurringClose(false); setDraft(null); return }
    const selected = onlyDate ? scheduleForDate(group, onlyDate) : group
    const chosen = [...selected.dates]
    setDraft({ role: editRole, kind: group.kind, staffId: group.staffId, from: chosen[0], until: chosen.at(-1)!, days: [...new Set(chosen.map(weekday))], exactDates: chosen,
      start: group.start, end: group.end, shiftType: group.shiftType, reason: group.reason || 'Ausencia', consultations: group.consultations.map(c => ({ ...c })), breaks: group.breaks.map(b => ({ ...b })), originals: selected.originals })
    setError(''); setNotice('')
    window.requestAnimationFrame(() => formAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  function change<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(p => p ? { ...p, [key]: value, ...(['from', 'until'].includes(key) ? { exactDates: null } : {}) } : p) }
  function updateMedical(index: number, values: Partial<MedicalInput>) { setDraft(p => p ? { ...p, consultations: p.consultations.map((c, i) => i === index ? { ...c, ...values } : c) } : p) }
  function updateBreak(index: number, values: Partial<BreakInput>) { setDraft(p => p ? { ...p, breaks: p.breaks.map((b, i) => i === index ? { ...b, ...values } : b) } : p) }
  function occupied(roomId: string, medical: MedicalInput): number {
    if (!draft) return 0
    const ignored = new Set(draft.originals.filter(o => o.kind === 'consultation').map(o => o.id))
    return dates.filter(date => {
      const next = draft.end < draft.start && medical.start < draft.start ? addDays(date, 1) : date
      const start = new Date(`${next}T${medical.start}:00-06:00`).getTime()
      const end = new Date(`${medical.end < medical.start ? addDays(next, 1) : next}T${medical.end}:00-06:00`).getTime()
      return allConsultations.some(c => c.active && c.consulting_room_id === roomId && !ignored.has(c.id) && new Date(c.starts_at).getTime() < end && new Date(c.ends_at).getTime() > start)
    }).length
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || busy || !canWrite || previewError) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (!people.some(p => p.id === draft.staffId && p.active && p.roles.includes(draft.role))) throw new Error('Selecciona un empleado con el rol activo de esta sección.')
      const values: Record<string, unknown> = { staff_id: draft.staffId, dates, start_time: draft.start, end_time: draft.end, active: true, shift_type: draft.shiftType, reason: draft.reason }
      if (draft.kind === 'shift') {
        values.breaks = draft.breaks.map(b => ({ start_time: b.start, end_time: b.end, reason: b.reason }))
        if (draft.role === 'doctor') values.consultations = draft.consultations.map(c => ({ start_time: c.start, end_time: c.end, room_id: c.roomId, slot_minutes: c.minutes }))
      }
      if (draft.kind === 'consultation') {
        const medical = draft.consultations[0]
        if (!medical) throw new Error('Falta el horario médico.')
        Object.assign(values, { start_time: medical.start, end_time: medical.end, room_id: medical.roomId, slot_minutes: medical.minutes })
      }
      await savePlanningSet(draft.role, draft.kind, values, draft.originals)
      setNotice(`Guardadas ${dates.length} fechas: ${order.filter(d => dates.some(date => weekday(date) === d)).map(d => weekdays[d]).join(', ')}. Jornada, atención y descansos se guardaron juntos.`)
      setEmployee(draft.staffId); setWeek(monday(dates[0])); setDraft(null); setView('schedule'); setRevision(r => r + 1)
    } catch (err) { setError(userMessage(err, 'No se pudo guardar.')) }
    finally { setBusy(false) }
  }
  async function saveRoom(event: FormEvent) {
    event.preventDefault()
    if (!roomDraft || busy || !canWrite) return
    setBusy(true); setError('')
    try {
      await savePlanning('room', { code: roomDraft.code.trim(), floor_id: roomDraft.floor || null, active: roomDraft.active }, roomDraft.id, roomDraft.version)
      const confirmed = await readPlanning(week)
      const room = confirmed.rooms.find(r => r.id === roomDraft.id)
      if (!room || room.code !== roomDraft.code.trim() || room.floor_id !== (roomDraft.floor ? Number(roomDraft.floor) : null) || room.active !== roomDraft.active) throw new Error('No se pudo confirmar el cambio. Actualiza los consultorios antes de reintentar.')
      setData(confirmed); setRoomDraft(null); setNotice('Consultorio actualizado correctamente.')
    } catch (err) { setError(userMessage(err, 'No se pudo guardar el consultorio.')) }
    finally { setBusy(false) }
  }
  const recurringEditor = <RecurringJourneyForm key={`${recurringId ?? 'new'}-${employee}-${recurringClose}-${editWeekday}-${assignDate ?? ''}`} data={data} initialEmployee={employee} initialJourney={data.recurring_journeys?.find(j => j.id === recurringId)} initialRole={role} initialDeactivate={recurringClose} editWeekday={editWeekday} editDate={editDate} initialDate={assignDate} loading={loading} onBusy={setBusy} onRefresh={() => setRevision(r => r + 1)} onManage={manageRecurring} onCancel={() => { setRecurringId(null); setRecurringClose(false); setEditDate(null); setAssignDate(null); setEditWeekday(null); setDraft(null); setView('schedule') }} onSaved={(id, date) => { const person = data.staff.find(p => p.id === id); if (person?.category === 'doctor' || person?.category === 'recepcionista') setRole(person.category); setEmployee(id); setWeek(monday(date)); setRecurringId(null); setAssignDate(null); setEditWeekday(null); setView('schedule'); setNotice('Cambios guardados y verificados. Consulta el calendario actualizado.'); setRevision(r => r + 1) }} />
  return <div className="staff-planning-view"><div className="staff-workspace-bar"><div><span className="staff-workspace-eyebrow">PLANIFICACIÓN DEL PERSONAL</span><h2>{view === 'rooms' ? 'Consultorios' : view === 'assign' ? 'Preparar una jornada' : 'Horario del personal'}</h2><p>{view === 'rooms' ? 'Revisa los consultorios y sus asignaciones.' : view === 'assign' ? 'Completa los datos y revisa el resumen antes de guardar.' : 'Elige una persona y consulta sus días de trabajo.'}</p></div><div className="staff-workspace-actions"><nav className="staff-section-nav" aria-label="Secciones de programación"><button type="button" disabled={busy} aria-current={view === 'schedule' ? 'page' : undefined} onClick={() => switchView('schedule')}><Icon name="calendar" size={18}/>Ver horario</button><button type="button" disabled={busy} aria-current={view === 'assign' ? 'page' : undefined} onClick={() => switchView('assign')}><Icon name="plus" size={18}/>Asignar jornada</button><button type="button" disabled={busy} aria-current={view === 'rooms' ? 'page' : undefined} onClick={() => switchView('rooms')}>Consultorios</button></nav><p role="status" className="planning-live">{realtime.connected ? '● Horarios al día' : '○ Reconectando horarios'}</p></div></div>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
    {refreshError && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{refreshError}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}
    {!loading && (view !== 'schedule' || employee) && !error && !canWrite && <p className="rounded-lg bg-amber-50 p-3 text-sm">
      {planningWritesEnabled ? 'La programación no está lista para editarse. Verifica el acceso y el estado del servidor.' : 'La edición está deshabilitada en esta compilación. Activa VITE_STAFF_PLANNING_ENABLED y reinicia o recompila el ADMIN.'}
    </p>}
    {roomDraft && <JourneyEditorDialog title="Editar consultorio" busy={busy} onClose={() => setRoomDraft(null)}><Panel title={`Editar ${roomDraft.code}`}><form onSubmit={saveRoom} className="space-y-4"><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-3"><label className={labelClass}>Consultorio<input required maxLength={40} className={input} value={roomDraft.code} onChange={e => setRoomDraft({ ...roomDraft, code: e.target.value })}/></label><label className={labelClass}>Piso<select className={input} value={roomDraft.floor} onChange={e => setRoomDraft({ ...roomDraft, floor: e.target.value })}><option value="">Piso sin asignar</option>{data.floors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={roomDraft.active} onChange={e => setRoomDraft({ ...roomDraft, active: e.target.checked })}/>Activo</label></fieldset>{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}<button className={primary} disabled={busy}>{busy ? 'Guardando?' : 'Guardar cambios'}</button></form></Panel></JourneyEditorDialog>}
    {section === 'rooms' ? <>
      <AssignedConsultingRooms data={data} loading={loading} canEdit={canWrite && !busy} onEdit={id => { const room = data.rooms.find(r => r.id === id); if (room) { setError(''); setRoomDraft({ id: room.id, version: room.version, code: room.code, floor: room.floor_id?.toString() ?? '', active: room.active }) } }} />
    </> : <>
      {view === 'schedule' && <section className="staff-selector" aria-labelledby="staff-selector-title">
        <header><span className="staff-selector-icon"><Icon name="users" size={26} /></span><div><span className="staff-selector-eyebrow">PASO 1 · ELIGE UNA PERSONA</span><h2 id="staff-selector-title">¿De quién quieres ver el horario?</h2><p>Busca por nombre o código. Verás solo el horario de la persona elegida.</p></div></header>
        <div className="staff-selector-controls">
          <label>Tipo de personal<select value={section} disabled={busy} onChange={e => switchRole(e.target.value as StaffRole)}><option value="doctor">Doctor</option><option value="recepcionista">Recepcionista</option></select></label>
          <StaffScheduleSearch key={section} matches={matches} query={query} onQuery={searchEmployees} onSelect={selectEmployee} selectedId={employee} disabled={busy} loading={searchLoading} error={searchError} collapseWhenSelected searchRequired />
        </div>

        {selectedPerson && <div className="staff-selected-person"><span><Icon name="patient" size={23} /></span><div><strong>{staffName(selectedPerson)}</strong><p>Código {selectedPerson.employee_code} · {section === 'doctor' ? 'Doctor' : 'Recepcionista'}{!selectedPerson.active ? ' · Inactivo' : ''}</p></div><div className="staff-selected-actions"><button className={secondary} disabled={busy} onClick={() => { setEmployee(''); setQuery('') }}>Cambiar persona</button><button className={secondary} disabled={!canWrite || busy || !selectedPerson.active} onClick={() => startForm('absence')}>Registrar ausencia</button></div></div>}
      </section>}
      {view === 'assign' && !draft && recurringEditor}

      {view === 'schedule' && <StaffWeekCalendar key={employee} data={data} person={selectedPerson} groups={groups} week={week} onWeek={setWeek} canEdit={canWrite && !loading} busy={busy} loading={loading} onEdit={edit} onEditWeekday={editRecurringDay} onEditComplete={() => { const journey = editableJourney(data.recurring_journeys ?? [], employee, staffToday()); if (journey) manageRecurring(journey) }} onRefresh={() => setRevision(r => r + 1)} />}
      <div ref={formAnchor} className="scroll-mt-6">{view === 'assign' && draft && <Panel title={`${draft.originals.length ? 'Editar' : 'Crear'} ${draft.kind === 'absence' ? 'ausencia' : draft.kind === 'consultation' ? 'atención médica' : draft.role === 'doctor' ? 'jornada de doctor' : 'turno de recepcionista'}`} subtitle="Se guardan todas las fechas de la vista previa en una única operación.">
        <form onSubmit={save} className="space-y-5"><fieldset disabled={busy} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3"><label className={labelClass}>Empleado *<select className={input} required disabled value={draft.staffId} onChange={e => change('staffId', e.target.value)}><option value="">Selecciona {draft.role === 'doctor' ? 'un doctor' : 'una recepcionista'}</option>{people.filter(p => p.id === employee).map(p => <option key={p.id} value={p.id}>{staffName(p)} · {p.employee_code}</option>)}</select></label><label className={labelClass}>Fecha de inicio *<input type="date" className={input} required value={draft.from} onChange={e => change('from', e.target.value)} /></label><label className={labelClass}>Fecha final de programación (opcional)<input type="date" className={input} min={draft.from} max={draft.from ? addDays(draft.from, 366) : undefined} value={draft.until} onChange={e => change('until', e.target.value)} /><span className="mt-1 block text-[11px] text-slate-400">Vacía: una semana completa desde el inicio.</span></label></div>
          <fieldset className="rounded-xl bg-slate-50 p-4"><legend className="px-1 text-xs font-semibold text-slate-700">Selecciona los días que quieras *</legend><div className="flex flex-wrap gap-2">{order.map(day => <label key={day} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${draft.days.includes(day) ? 'border-[#870b30] bg-rose-50 text-[#870b30]' : 'border-slate-200 bg-white text-slate-600'}`}><input type="checkbox" checked={draft.days.includes(day)} className="accent-[#870b30]" onChange={() => setDraft(p => p ? { ...p, days: toggleDay(p.days, day), exactDates: null } : p)} />{weekdays[day]}</label>)}</div><p className="mt-3 text-xs text-slate-500">Puedes elegir cualquier combinación. Nunca se descartan días marcados por quedar fuera del rango: se mostrará un aviso.</p></fieldset>
          {draft.kind !== 'consultation' && <section className="rounded-xl border border-emerald-200 p-4"><h3 className="mb-3 text-sm font-semibold text-emerald-900">{draft.kind === 'absence' ? 'Periodo de ausencia' : '1. Jornada laboral'}</h3><div className="grid gap-3 sm:grid-cols-3"><div><FriendlyTimeField label="Entrada" value={draft.start} onChange={value => change('start', value)} /></div><div><FriendlyTimeField label="Salida" value={draft.end} onChange={value => change('end', value)} />{draft.end < draft.start && <span className="text-xs text-amber-700">Salida al día siguiente.</span>}</div>{draft.kind === 'absence' ? <label className={labelClass}>Tipo de ausencia y motivo *<input className={input} required maxLength={480} value={draft.reason} onChange={e => change('reason', e.target.value)} /></label> : <label className={labelClass}>Tipo de jornada<select className={input} value={draft.shiftType} onChange={e => change('shiftType', e.target.value)}><option value="ordinario">Ordinaria</option><option value="guardia">Guardia</option></select></label>}</div></section>}
          {draft.role === 'doctor' && draft.kind !== 'absence' && <section className="space-y-3 rounded-xl border border-sky-200 p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-sky-900">2. Atención de citas dentro de la jornada</h3>{draft.kind === 'shift' && <button className={secondary} type="button" disabled={draft.consultations.length >= 4} onClick={() => change('consultations', [...draft.consultations, { start: draft.start, end: draft.end, roomId: '', minutes: 30 }])}>+ Periodo de atención</button>}</div>{!draft.consultations.length && <p className="text-xs text-slate-500">Se guardará únicamente la jornada laboral. Puedes añadir atención médica.</p>}{draft.consultations.map((c, i) => <div key={i} className="grid items-end gap-3 rounded-lg bg-sky-50/50 p-3 sm:grid-cols-2 lg:grid-cols-5"><FriendlyTimeField label="Desde" value={c.start} onChange={value => updateMedical(i, { start: value })} /><FriendlyTimeField label="Hasta" value={c.end} onChange={value => updateMedical(i, { end: value })} /><label className={labelClass}>Consultorio disponible *<select className={input} required value={c.roomId} onChange={e => updateMedical(i, { roomId: e.target.value })}><option value="">Selecciona</option>{data.rooms.filter(r => r.active || r.id === c.roomId).map(r => { const count = occupied(r.id, c); return <option key={r.id} value={r.id} disabled={!r.active || count > 0}>{r.code}{count ? ` · ocupado en ${count} fecha(s)` : !r.active ? ' · inactivo' : ''}</option> })}</select></label><label className={labelClass}>Minutos por cita<input className={input} required type="number" min={5} max={180} value={c.minutes} onChange={e => updateMedical(i, { minutes: Number(e.target.value) })} /></label>{draft.kind === 'shift' && <button className={secondary} type="button" onClick={() => change('consultations', draft.consultations.filter((_, n) => n !== i))}>Quitar periodo</button>}</div>)}</section>}
          {draft.kind === 'shift' && <section className="space-y-3 rounded-xl border border-amber-200 p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-amber-900">{draft.role === 'doctor' ? '3.' : '2.'} Descansos dentro del turno</h3><button className={secondary} type="button" disabled={draft.breaks.length >= 4} onClick={() => change('breaks', [...draft.breaks, { start: '12:00', end: '12:30', reason: 'Descanso laboral' }])}>+ Descanso</button></div>{!draft.breaks.length && <p className="text-xs text-slate-500">Sin descansos configurados.</p>}{draft.breaks.map((b, i) => <div key={i} className="grid items-end gap-3 sm:grid-cols-4"><FriendlyTimeField label="Desde" value={b.start} onChange={value => updateBreak(i, { start: value })} /><FriendlyTimeField label="Hasta" value={b.end} onChange={value => updateBreak(i, { end: value })} /><label className={labelClass}>Descripción<input className={input} maxLength={450} value={b.reason} onChange={e => updateBreak(i, { reason: e.target.value })} /></label><button type="button" className={secondary} onClick={() => change('breaks', draft.breaks.filter((_, n) => n !== i))}>Quitar descanso</button></div>)}</section>}
        </fieldset>
        <section className="rounded-xl border-2 border-[#870b30]/20 bg-[#fffafb] p-4"><h3 className="font-semibold text-[#870b30]">Confirma los datos antes de guardar</h3>{previewError ? <p className="mt-2 text-sm text-rose-700" role="alert">{previewError}</p> : <><p className="my-2 text-sm">{dates.length} fechas · {order.filter(d => dates.some(date => weekday(date) === d)).map(d => weekdays[d]).join(', ')}</p><p className="text-xs text-slate-500">{draft.exactDates ? 'Se conservan exactamente las fechas guardadas. Cambiar días o fechas recalcula la selección.' : `Programación desde ${draft.from} hasta ${draft.until || addDays(draft.from, 6)}.`}</p><div className="mt-3 max-h-60 overflow-auto"><table className="w-full min-w-[600px] text-left text-xs"><thead><tr className="border-b"><th className="py-2">Fecha</th><th>Jornada / periodo</th>{draft.role === 'doctor' && <th>Atención / consultorio</th>}<th>Descansos</th></tr></thead><tbody>{dates.map(date => <tr key={date} className="border-b border-rose-100"><td className="py-2">{dateLabel(date)}</td><td>{hours(draft.start, draft.end)}</td>{draft.role === 'doctor' && <td>{draft.consultations.map((c, i) => <p key={i}>{hours(c.start, c.end)} · {c.roomId ? roomCode(c.roomId) : 'Falta consultorio'} · {c.minutes} min</p>)}</td>}<td>{draft.breaks.map((b, i) => <p key={i}>{hours(b.start, b.end)}</p>)}</td></tr>)}</tbody></table></div></>}</section>
        <div className="flex gap-2"><button className={primary} disabled={busy || !canWrite || !!previewError || !dates.length}>{busy ? 'Guardando todas las fechas…' : `Guardar ${dates.length} fechas`}</button><button type="button" className={secondary} disabled={busy} onClick={() => setDraft(null)}>Cancelar</button></div></form>
      </Panel>}</div>

    </>}
  </div>
}

