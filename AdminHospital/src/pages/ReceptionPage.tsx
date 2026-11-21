import { userMessage } from '../lib/userError'
import { usePlanningRealtime } from '../lib/usePlanningRealtime'
import { useEffect, useRef, useState } from 'react'
import { ReceptionPatientDirectory } from '../components/ReceptionPatientDirectory'
import { ReceptionAgenda } from '../components/ReceptionAgenda'
import { ReceptionAppointmentScheduler } from '../components/ReceptionAppointmentScheduler'
import { ReceptionRecordPreparation } from '../components/ReceptionRecordPreparation'
import { WalkinReception } from './WalkinReception'
import { IdentityCheck, PatientCard } from '../components/ReceptionIdentity'
import { HospitalizationPage } from './HospitalizationPage'
import { Icon } from '../components/Icon'
import './ReceptionPage.css'
import { displayTime, linkedPatient, loadRequests, localDate, periodLabels, receptionRows, receptionRpc, recordCode, requestSymptoms, requestAppointment, searchPatientsWithRecordCodes, stateLabels, readAttentionCounts, readAttentionRequest } from '../lib/reception'
import { orderAttentionRequests, type RequestOrder } from '../lib/receptionOrdering'
import type { AttentionRequest, ReceptionAppointment, ReceptionPatient } from '../lib/reception'

const button = 'rounded-lg bg-[#800b2c] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50'
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm'
const panel = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm'
const message = (error: unknown) => userMessage(error, 'No se pudo completar la operación. Intenta nuevamente.')

export type ReceptionTab = 'Atención presencial' | 'Solicitudes de atención' | 'Pacientes y expedientes' | 'Agenda de citas' | 'Hospitalización'

export function ReceptionPage({ initialTab = 'Solicitudes de atención', initialRequestId = null, initialHospitalAdmissionId = null }: { initialTab?: ReceptionTab; initialRequestId?: string | null; initialHospitalAdmissionId?: string | null }) {
  const [tab, setTab] = useState<ReceptionTab>(initialTab)
  const [walkinPatient, setWalkinPatient] = useState<ReceptionPatient | null>(null)
  const [requests, setRequests] = useState<AttentionRequest[]>([])
  const [specialties, setSpecialties] = useState<{ id: number; name: string; active: boolean }[]>([])
  const [selected, setSelected] = useState<AttentionRequest | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<RequestOrder>('oldest')
  const [offset, setOffset] = useState(0)
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const [countError, setCountError] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [refresh, setRefresh] = useState(0)
  usePlanningRealtime(() => setRefresh(value => value + 1))
  useEffect(() => { let active = true; if (initialRequestId) readAttentionRequest(initialRequestId).then(r => { if (active) setSelected(r) }).catch(e => { if (active) setError(message(e)) }); return () => { active = false } }, [initialRequestId])
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setCountError(false)
    setRequests([]); setMore(false); setOffset(0)
    Promise.all([loadRequests(filter, 0, sort), receptionRows<{ id: number; name: string; active: boolean }>('specialties', 'id,name,active'), readAttentionCounts()]).then(([rows, catalog, totals]) => {
      if (active) { setRequests(rows.items); setSpecialties(catalog); setMore(rows.hasMore); setCounts(totals); setCountError(Object.values(totals).some(value => value === null)) }
    }).catch(e => { if (active) setError(message(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refresh, filter, sort])
  useEffect(() => {
    if (tab !== 'Solicitudes de atención' || selected) return
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') setRefresh(value => value + 1)
    }
    const timer = window.setInterval(refreshIfVisible, 60_000)
    window.addEventListener('online', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', refreshIfVisible)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [tab, selected])
  const specialtyName = (id: number) => specialties.find(s => s.id === id)?.name ?? 'Sin especialidad disponible'
  async function nextPage() {
    setLoading(true)
    try { const next = offset + 100; const rows = await loadRequests(filter, next, sort); setRequests(old => orderAttentionRequests([...new Map([...old, ...rows.items].map(r => [r.id, r])).values()], sort)); setMore(rows.hasMore); setOffset(next) }
    catch (e) { setError(message(e)) } finally { setLoading(false) }
  }
  const filtered = requests.filter(r => `${Object.values(r.applicant_data ?? {}).join(' ')} ${specialtyName(r.specialty_id)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <div className="reception space-y-5">
    <div className="reception-intro"><div><span className="reception-eyebrow">ATENCIÓN AL PACIENTE</span><h2>Todo listo para recibir y orientar.</h2><p>Consulta solicitudes, encuentra expedientes y organiza las próximas citas.</p></div><span className="reception-intro-icon"><Icon name="patient" size={30} /></span></div>
    <nav aria-label="Apartados de recepción" className="reception-tabs">{(['Solicitudes de atención', 'Pacientes y expedientes', 'Agenda de citas', 'Hospitalización', 'Atención presencial'] as const).map((t, i) => <button key={t} aria-current={tab === t ? 'page' : undefined} className={tab === t ? 'is-active' : ''} onClick={() => { setTab(t); setSelected(null); setWalkinPatient(null) }}><Icon name={i === 0 ? 'file' : i === 1 ? 'patient' : i === 2 ? 'calendar' : i === 3 ? 'bed' : 'patient'} size={20} /><span><strong>{t}</strong><small>{['Revisar y dar seguimiento', 'Consultar por documento', 'Ver las citas del día', 'Ingresos, camas y salidas', 'Registro, citas e ingreso'][i]}</small></span></button>)}</nav>
    {tab === 'Solicitudes de atención' && (selected ? <RequestDetail key={selected.id} request={selected} specialty={specialtyName(selected.specialty_id)} onBack={() => { setSelected(null); setRefresh(v => v + 1) }} /> : <div className="reception-requests-view">
      <div className="request-summary" aria-label="Resumen de solicitudes por estado">{Object.entries(stateLabels).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} disabled={loading} onClick={() => setFilter(value)} className={`request-stat request-stat-${value} ${filter === value ? 'is-selected' : ''}`}><span className="request-stat-top"><span className="request-stat-icon"><Icon name={value === 'pendiente' ? 'clock' : value === 'en_revision' ? 'eye' : value === 'agendada' ? 'calendar' : value === 'rechazada' ? 'file' : 'calendar'} size={19} /></span><span className="request-stat-label">{label}</span>{filter === value && <Icon name="check" size={15} />}</span><strong>{counts[value] ?? '—'}</strong><small>{value === 'pendiente' ? 'Esperan atención' : value === 'en_revision' ? 'Revisión en curso' : value === 'agendada' ? 'Con cita asignada' : value === 'rechazada' ? 'Solicitud no aprobada' : 'Atención cancelada'}</small></button>)}</div>
      <section className="request-inbox" aria-labelledby="request-inbox-title">
        <header className="request-inbox-heading"><span className="request-inbox-icon"><Icon name="file" size={26} /></span><div><span className="request-inbox-eyebrow">SOLICITUDES DE PACIENTES</span><h3 id="request-inbox-title">Bandeja de solicitudes</h3><p>Encuentra al paciente y abre su solicitud para continuar la atención.</p></div><span className="request-visible-count"><strong>{filtered.length}</strong>{filtered.length === 1 ? 'solicitud en pantalla' : 'solicitudes en pantalla'}</span></header>
        <div className="request-filters">
          <div className="request-search"><label htmlFor="reception-request-search">Buscar solicitud</label><div className="request-filter-control"><Icon name="search" size={19} /><input id="reception-request-search" placeholder="Nombre, documento o especialidad" value={query} onChange={e => setQuery(e.target.value)} />{query && <button type="button" aria-label="Limpiar búsqueda" title="Limpiar búsqueda" onClick={() => setQuery('')}>×</button>}</div></div>
          <label><span>Estado de la solicitud</span><div className="request-filter-control"><Icon name="file" size={18} /><select disabled={loading} value={filter} onChange={e => setFilter(e.target.value)}><option value="">Por atender</option>{Object.entries(stateLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div></label>
          <label><span>Orden de llegada</span><div className="request-filter-control"><Icon name="clock" size={18} /><select disabled={loading} value={sort} onChange={e => setSort(e.target.value as RequestOrder)}><option value="oldest">Más antiguas primero</option><option value="newest">Más recientes primero</option></select></div></label>
          <button className="request-refresh" type="button" disabled={loading} onClick={() => setRefresh(v => v + 1)}><Icon name="arrow" size={17} />{loading ? 'Actualizando…' : 'Actualizar'}</button>
        </div>
        <div className="request-view-guide"><span className="request-view-chip"><i />{filter ? stateLabels[filter] : 'Por atender'}</span><p>{!filter ? 'Primero las pendientes y luego las que están en revisión.' : `Estás viendo las solicitudes con estado: ${stateLabels[filter]}.`} <span>{sort === 'oldest' ? 'Las más antiguas aparecen primero dentro de cada estado.' : 'Las más recientes aparecen primero dentro de cada estado.'}</span></p></div>
        {error && <p role="alert" className="request-inbox-error"><Icon name="help" size={18} />{error}</p>}
        {countError && <p role="alert" className="request-inbox-error"><Icon name="help" size={18} />No se pudieron consultar algunos totales. La bandeja sigue disponible; actualiza para volver a intentarlo.</p>}
        {loading && <div className="request-loading" role="status"><span aria-hidden="true" />Buscando las solicitudes del paciente…</div>}
        {!loading && !error && filtered.length === 0 && <div className="request-inbox-empty"><span className="request-empty-icon"><Icon name={query ? 'search' : 'file'} size={30} /></span><h4>{query ? 'No encontramos coincidencias' : !filter ? 'No hay solicitudes por atender' : 'No hay solicitudes en este estado'}</h4><p>{query ? 'Prueba con otro nombre, documento o especialidad de las solicitudes cargadas.' : !filter ? 'Aquí aparecerán las solicitudes pendientes y en revisión. Puedes consultar los otros estados con los filtros de arriba.' : 'Selecciona otro estado para consultar las demás solicitudes.'}</p>{!filter && !query && (counts.agendada ?? 0) > 0 && <button type="button" onClick={() => setFilter('agendada')}><Icon name="calendar" size={17} />Ver citas programadas <span>{counts.agendada}</span></button>}</div>}
        <div className="request-inbox-list">{filtered.map(r => <button key={r.id} type="button" onClick={() => setSelected(r)} className={`reception-request request-${r.status} request-inbox-card`}>
          <div className="request-patient-heading"><span className="request-patient-avatar" aria-hidden="true">{`${r.applicant_data?.first_name?.charAt(0) ?? ''}${r.applicant_data?.last_name?.charAt(0) ?? ''}`.toLocaleUpperCase() || <Icon name="users" size={21} />}</span><div><small>SOLICITUD DE ATENCIÓN</small><strong>{`${r.applicant_data?.first_name ?? ''} ${r.applicant_data?.last_name ?? ''}`.trim() || 'Nombre no registrado'}</strong></div><span className="reception-state-label request-inbox-status"><i />{stateLabels[r.status] ?? r.status}</span></div>
          <dl className="request-inbox-metadata"><div><dt><Icon name="patient" size={15} />Especialidad</dt><dd>{specialtyName(r.specialty_id)}</dd></div><div><dt><Icon name="calendar" size={15} />Horario de preferencia</dt><dd>{periodLabels[r.preferred_period] ?? 'Sin preferencia registrada'}</dd></div></dl>
          <div className="request-created"><Icon name="clock" size={14} /><span>Recibida el <time dateTime={r.created_at}>{displayTime(r.created_at)}</time></span></div><div className="reception-request-footer"><span><Icon name="file" size={15} />{r.patient_id ? 'Paciente vinculado' : 'Consultar expediente'}</span><strong>{r.status === 'en_revision' ? 'Continuar atención' : 'Ver solicitud'}<Icon name="arrowRight" size={16} /></strong></div>
        </button>)}</div>
        <footer className="request-inbox-footer"><p><Icon name="help" size={15} /><span>Mostrando {requests.length} solicitudes cargadas. La búsqueda se aplica a esta lista; los indicadores superiores muestran los totales por estado.</span></p>{more && <button type="button" className="request-load-more" disabled={loading} onClick={() => void nextPage()}>Cargar más solicitudes<Icon name="plus" size={16} /></button>}</footer>
      </section>
    </div>)}
    {tab === 'Atención presencial' && <WalkinReception key={walkinPatient?.id ?? 'new'} specialties={specialties} initialPatient={walkinPatient} />}
    {tab === 'Pacientes y expedientes' && <ReceptionPatientDirectory onStartRegistration={patient => { setWalkinPatient(patient); setTab('Atención presencial'); setSelected(null) }} />}
    {tab === 'Agenda de citas' && <ReceptionAgenda specialties={specialties.filter(s => s.active)} renderRequest={(request, onBack, onScheduled) => <RequestDetail key={request.id} request={request} specialty={specialtyName(request.specialty_id)} onBack={onBack} onScheduled={onScheduled} />} />}
    {tab === 'Hospitalización' && <HospitalizationPage initialAdmissionId={initialHospitalAdmissionId} />}
  </div>
}

function IdentityComparison({ person, patient }: { person: Record<string, string | null>; patient: ReceptionPatient }) {
  const comparisons = [
    { label: 'Nombre completo', applicant: `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim(), registered: `${patient.first_name} ${patient.last_name}`.trim() },
    { label: 'DUI', applicant: person.dui, registered: patient.dui },
    { label: 'Fecha de nacimiento', applicant: person.birth_date, registered: patient.birth_date },
  ]
  return <div className="reception-comparison"><h4>Compara antes de vincular</h4><div className="reception-comparison-scroll"><table><thead><tr><th>Dato a verificar</th><th>En la solicitud</th><th>En el registro encontrado</th></tr></thead><tbody>{comparisons.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.applicant || 'No registrado'}</td><td>{row.registered || 'No registrado'}{row.applicant && row.registered && row.applicant.toLocaleLowerCase() !== row.registered.toLocaleLowerCase() && <small className="reception-mismatch">Revisar diferencia</small>}</td></tr>)}</tbody></table></div><p>Confirma estos datos con el documento de identidad del paciente.</p></div>
}

function RequestDetail({ request, specialty, onBack, onScheduled }: { request: AttentionRequest; specialty: string; onBack: () => void; onScheduled?: (appointment: ReceptionAppointment) => void }) {
  const { revision: requestRevision } = usePlanningRealtime()
  const [r, setRequest] = useState(request); const [step, setStep] = useState(1)
  const [patient, setPatient] = useState<ReceptionPatient | null>(null); const [code, setCode] = useState<string>()
  const [candidates, setCandidates] = useState<ReceptionPatient[]>([]); const [searched, setSearched] = useState(false)
  const [candidateCodes, setCandidateCodes] = useState<Record<string, string>>({})
  const [symptoms, setSymptoms] = useState(''); const [identity, setIdentity] = useState(false)
  const [appointment, setAppointment] = useState<ReceptionAppointment | null>(null)
  const [closing, setClosing] = useState(''); const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const locked = useRef(false)
  const open = ['pendiente', 'en_revision'].includes(r.status)
  useEffect(() => {
    let active = true
    readAttentionRequest(request.id).then(async fresh => {
      const booked = fresh.status === 'agendada' ? await requestAppointment(request.id) : null
      if (!active) return
      setRequest(fresh)
      if (booked) setAppointment(booked)
      if (!['pendiente', 'en_revision'].includes(fresh.status) && ['pendiente', 'en_revision'].includes(request.status)) setNotice('Esta solicitud ya fue gestionada por otro recepcionista. La información se ha actualizado.')
    }).catch(() => { if (active) setError('No se pudo actualizar la solicitud. El servidor comprobará su estado antes de guardar.') })
    return () => { active = false }
  }, [request.id, request.status, requestRevision])
  async function reload() {
    const p = await linkedPatient(r); setPatient(p); setCode(p ? await recordCode(p.id) : undefined)
  }
  useEffect(() => {
    let active = true
    Promise.all([linkedPatient(request), requestSymptoms(request.id), requestAppointment(request.id)]).then(async ([p, s, a]) => {
      const c = p ? await recordCode(p.id) : undefined
      const found = !p && /^\d{8}-\d$/.test(request.applicant_data?.dui ?? '') ? await searchPatientsWithRecordCodes(request.applicant_data.dui!) : null
      const codes = found ? Object.fromEntries(found.map(candidate => [candidate.id, candidate.record_code ?? ''])) : {}
      if (active) { setPatient(p); setCode(c); setSymptoms(s); setAppointment(a); if (found) { setCandidates(found); setCandidateCodes(codes); setSearched(true) } }
    }).catch(e => { if (active) setError(message(e)) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [request])
  async function run(action: () => Promise<void>) {
    if (locked.current) return
    locked.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (e) { setError(message(e)) } finally { locked.current = false; setBusy(false) }
  }
  async function verifyPatient(p: ReceptionPatient) {
    await receptionRpc('link_attention_patient', { p_request: r.id, p_patient: p.id, p_identity_confirmed: identity })
    setRequest({ ...r, patient_id: p.id, status: 'en_revision' }); setPatient(p); setCode(await recordCode(p.id)); setNotice('Expediente vinculado a la cuenta del paciente.'); setCandidates([])
  }
  const person = r.applicant_data ?? {}
  const birth = person.birth_date
  const today = localDate()
  const age = birth ? Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - (today.slice(5) < birth.slice(5) ? 1 : 0) : null
  return <section className={`${panel} space-y-5`}>
    <button className="text-sm font-semibold text-[#800b2c]" disabled={busy} onClick={onBack}>← Volver a solicitudes</button>
    <div className="reception-detail-heading"><span className="reception-avatar"><Icon name="patient" size={26} /></span><div><span className="reception-eyebrow">SOLICITUD DE ATENCIÓN</span><h2 className="text-xl font-semibold">{person.first_name} {person.last_name}</h2><p className="mt-1 text-sm text-slate-500">{specialty} · {displayTime(r.created_at)}</p></div><span className="reception-count">{stateLabels[r.status]}</span></div>
    <ol className="reception-steps">{['Revisar solicitud', 'Verificar expediente', 'Programar cita'].map((label, i) => <li key={label} aria-current={step === i + 1 ? 'step' : undefined} className={step === i + 1 ? 'is-current' : step > i + 1 ? 'is-complete' : ''}><span className="reception-step-number">{step > i + 1 ? <Icon name="check" size={18} /> : i + 1}</span><div><strong>{label}</strong><small>{['Conoce el motivo de atención', 'Busca, verifica o crea el registro', 'Elige y confirma un horario'][i]}</small></div></li>)}</ol>
    {busy && <p role="status">Procesando, espera un momento…</p>}{error && <p role="alert" className="rounded-lg bg-rose-50 p-4 text-rose-800">{error}</p>}{notice && <p role="status" className="rounded-lg bg-emerald-50 p-4 text-emerald-800">{notice}</p>}
    {appointment && <div className="rounded-xl bg-emerald-50 p-5 text-emerald-900"><h3 className="font-semibold">Cita {appointment.status}</h3><p>{displayTime(appointment.starts_at)} — {displayTime(appointment.ends_at)}</p><p>{specialty} · {appointment.doctor_name || 'Médico asignado'} · Consultorio {appointment.room_code || 'asignado'}</p><p>El expediente está asociado a la cuenta del paciente.</p></div>}
    {r.closure_reason && <p className="rounded-lg bg-slate-50 p-4">Motivo: {r.closure_reason}</p>}
    {step === 1 && <>
      {!busy && <div className={code ? 'agenda-success' : 'agenda-warning'} role="status">{code ? `Tiene expediente: ${code}${r.patient_id ? ' · Vinculado a la solicitud' : ' · Verifica su identidad antes de vincular'}` : 'Sin expediente vinculado disponible · Verifica o completa el registro antes de programar.'}</div>}
      <dl className="reception-review-data grid gap-4 sm:grid-cols-2">{[['Nombre', `${person.first_name ?? ''} ${person.last_name ?? ''}`], ['DUI', person.dui], ['Nacimiento y edad', birth ? `${birth} · ${age} años` : null], ['Correo', person.email], ['Teléfono', person.phone], ['Especialidad', specialty], ['Preferencia', periodLabels[r.preferred_period]], ['Síntomas', symptoms], ['Otros síntomas', r.other_symptoms], ['Motivo de atención', r.reason]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{value || 'No registrado'}</dd></div>)}</dl>
      {open && <button className={button} disabled={busy} onClick={() => void run(async () => { await receptionRpc('review_attention_request', { p_request: r.id, p_status: 'en_revision' }); setRequest({ ...r, status: 'en_revision' }); await reload(); setStep(2) })}>Continuar: verificar expediente</button>}
    </>}
    {step === 2 && <>
      <div className="reception-verification-layout"><div className="space-y-5">
        <div className="reception-section-heading"><div><h3>¿El paciente ya tiene expediente?</h3><p>Primero revisa el resultado de la consulta. Después, sigue la acción indicada.</p></div></div>
        {patient ? <>
          <div className={`reception-status ${code && r.patient_id ? 'is-success' : 'is-warning'}`} role="status"><Icon name={code && r.patient_id ? 'check' : 'file'} size={26} /><div><strong>{!code ? 'Paciente encontrado: falta completar su expediente' : r.patient_id ? 'Sí, el paciente ya tiene expediente vinculado' : 'Encontramos un expediente para esta cuenta'}</strong><p>{!code ? 'Completa el expediente con los datos verificados antes de programar.' : r.patient_id ? 'Puedes continuar con la programación de su cita.' : 'Verifica la identidad y confirma el vínculo antes de programar.'}</p></div></div>
          <PatientCard patient={patient} code={code} />
          {!code && <ReceptionRecordPreparation patient={patient} request={r} onReady={(p, c) => { setPatient(p); setCode(c); setRequest({ ...r, patient_id: p.id, status: 'en_revision' }); setStep(3) }} /> }
          {!r.patient_id && code && <><IdentityComparison person={person} patient={patient} /><IdentityCheck checked={identity} onChange={setIdentity} disabled={busy} /><button className={button} disabled={busy || !identity} onClick={() => void run(() => verifyPatient(patient))}>Confirmar que corresponde a este paciente<Icon name="check" size={18} /></button></>}
        </> : <>
          {!searched && <div className="reception-lookup-box"><span className="reception-avatar"><Icon name="search" size={26} /></span><h4>La cuenta aún no tiene un expediente vinculado</h4><p>Esto no significa que el paciente sea nuevo. Busca con su DUI para comprobar si ya existe un registro.</p><div className="reception-document"><span>DUI de la solicitud</span><strong>{person.dui || 'No registrado'}</strong></div><button className={button} disabled={busy || !person.dui} onClick={() => void run(async () => { const found = await searchPatientsWithRecordCodes(person.dui ?? ''); setCandidates(found); setCandidateCodes(Object.fromEntries(found.map(p => [p.id, p.record_code ?? '']))); setIdentity(false); setSearched(true) })}><Icon name="search" size={18} />{busy ? 'Buscando…' : 'Buscar si ya tiene expediente'}</button></div>}
          {searched && candidates.length > 0 && <div className="reception-status is-warning" role="status"><Icon name="file" size={26} /><div><strong>Encontramos un paciente registrado con este DUI</strong><p>Compara los datos con el documento del solicitante antes de vincularlo.</p></div></div>}
          {candidates.map(p => <div key={p.id} className="space-y-4"><PatientCard patient={p} code={candidateCodes[p.id]} />{!candidateCodes[p.id] && <p className="reception-help">No se encontró un expediente disponible para este registro. Solicita revisión administrativa si no puedes continuar.</p>}<IdentityComparison person={person} patient={p} />{p.profile_id && p.profile_id !== r.requester_id ? <div className="reception-status is-warning" role="alert"><Icon name="lock" size={22} /><div><strong>Este registro está vinculado a otra cuenta</strong><p>Solicita una revisión administrativa para resolverlo. No crees otro expediente.</p></div></div> : <><IdentityCheck checked={identity} onChange={setIdentity} disabled={busy} /><button className={button} disabled={busy || !identity} onClick={() => { if (!candidateCodes[p.id]) { setPatient(p); setCode(undefined) } else void run(() => verifyPatient(p)) }}>Continuar con este paciente<Icon name="arrowRight" size={18} /></button></>}</div>)}
          {(searched || !person.dui) && candidates.length === 0 && <>
            <div className="reception-status is-warning" role="status"><Icon name="file" size={26} /><div><strong>No encontramos un paciente con este DUI</strong><p>Si el documento es correcto, puedes crear y vincular un expediente nuevo.</p></div></div>
            <ReceptionRecordPreparation request={r} onReady={(p, c) => { setPatient(p); setCode(c); setRequest({ ...r, patient_id: p.id, status: 'en_revision' }); setStep(3) }} />
          </>}
        </>}
      </div><aside className="reception-applicant-summary"><span className="reception-eyebrow">DATOS DE LA SOLICITUD</span><h4>{person.first_name} {person.last_name}</h4><dl>{[['DUI', person.dui], ['Fecha de nacimiento', person.birth_date], ['Teléfono', person.phone], ['Correo', person.email]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'No registrado'}</dd></div>)}</dl><div className="reception-help"><Icon name="help" size={19} /><p>Busca primero. Crea un expediente nuevo solo cuando hayas comprobado que el paciente no tiene uno.</p></div></aside></div>
      <div className="reception-action-bar"><button className="reception-secondary" disabled={busy} onClick={() => setStep(1)}>← Volver a la solicitud</button><div>{(!code || !r.patient_id) && <p>Primero verifica y vincula el expediente.</p>}<button className={button} disabled={busy || !code || !r.patient_id} onClick={() => setStep(3)}>Continuar a programar cita<Icon name="arrowRight" size={18} /></button></div></div>
    </>}
    {step === 3 && open && patient && code && r.patient_id && <ReceptionAppointmentScheduler patient={patient} code={code} specialties={[{ id: r.specialty_id, name: specialty }]} specialtyId={r.specialty_id} requestId={r.id} onSaved={a => { setAppointment(a); setRequest({ ...r, status: 'agendada' }); setNotice('Cita guardada correctamente.'); onScheduled?.(a) }} />}
    {open && <div className="border-t border-slate-200 pt-4"><div className="flex flex-wrap gap-3"><button className="rounded-lg border border-rose-200 px-4 py-3 text-sm text-rose-800" disabled={busy} onClick={() => setClosing('rechazada')}>Rechazar solicitud</button><button className="rounded-lg border border-slate-200 px-4 py-3 text-sm" disabled={busy} onClick={() => setClosing('cancelada')}>Cancelar solicitud</button></div>{closing && <div className="mt-4 space-y-3"><label className="block text-sm">Motivo obligatorio<textarea className={`${input} mt-1`} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label><button className={button} disabled={busy || !reason.trim()} onClick={() => { if (window.confirm(`¿Confirmar que la solicitud quedará ${closing}?`)) void run(async () => { await receptionRpc('close_attention_request', { p_request: r.id, p_status: closing, p_reason: reason }); setRequest({ ...r, status: closing, closure_reason: reason }); setClosing(''); setNotice('Solicitud actualizada.') }) }}>Confirmar decisión</button><button className="px-4 py-3 text-sm" onClick={() => setClosing('')} disabled={busy}>Volver</button></div>}</div>}
  </section>
}

