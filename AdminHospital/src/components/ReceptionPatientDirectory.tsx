import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { displayTime, readReceptionRecord, searchReceptionPatients, type ReceptionPatient, type ReceptionPatientMatch } from '../lib/reception'
import { maskPatientDui, patientMatch, possiblePatientDuplicates, searchText } from '../lib/patientSearch'
import './ReceptionPatientDirectory.css'

export function ReceptionPatientDirectory({ onStartRegistration, onSelectPatient }: { onStartRegistration: (patient: ReceptionPatient | null) => void; onSelectPatient?: (patient: ReceptionPatient) => void }) {
  const [query, setQuery] = useState('')
  const [patients, setPatients] = useState<ReceptionPatientMatch[]>([])
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [retry, setRetry] = useState(0)
  const [record, setRecord] = useState<ReceptionPatientMatch | null>(null)
  const [registration, setRegistration] = useState<{ patient: ReceptionPatientMatch | null } | null>(null)
  useEffect(() => {
    if (searchText(query).length < 2) return
    const controller = new AbortController()
    let current = true
    const timer = window.setTimeout(() => {
      setPhase('loading')
      searchReceptionPatients(query, controller.signal).then(result => {
        if (current) { setPatients(result.patients); setHasMore(result.hasMore); setPhase('done') }
      }).catch(() => { if (current) { setError('No se pudo buscar en los registros autorizados. Revisa tu conexión e inténtalo de nuevo.'); setPhase('error') } })
    }, 350)
    return () => { current = false; controller.abort(); window.clearTimeout(timer) }
  }, [query, retry])
  const duplicates = possiblePatientDuplicates(patients)
  function change(value: string) { setQuery(value); setPatients([]); setHasMore(false); setError(''); setPhase(searchText(value).length >= 2 ? 'waiting' : 'idle') }
  return <section className="patient-directory" aria-labelledby="patient-directory-title">
    <header className="patient-directory-header"><span className="patient-directory-emblem"><Icon name="patient" size={28} /></span><div><span className="patient-directory-eyebrow">PACIENTES Y EXPEDIENTES</span><h3 id="patient-directory-title">Encuentra a tu paciente</h3><p>Busca con el dato que tengas a mano. No necesitas recordar su DUI.</p></div></header>
    <div className="patient-directory-search"><label htmlFor="patient-smart-search">Nombre, apellido, DUI, teléfono, correo o expediente</label><div><Icon name="search" size={22} /><input id="patient-smart-search" placeholder="Empieza a escribir para buscar…" autoComplete="off" maxLength={120} value={query} aria-describedby="patient-search-help" aria-controls="patient-search-results" onChange={event => change(event.target.value)} />{query && <button type="button" aria-label="Limpiar búsqueda" onClick={() => change('')}>×</button>}</div><p id="patient-search-help">Escribe al menos 2 caracteres. Los resultados se actualizan automáticamente.</p></div>
    <div className="patient-directory-toolbar"><p role="status">{phase === 'done' ? `${patients.length} ${patients.length === 1 ? 'paciente encontrado' : 'pacientes encontrados'}${hasMore ? ' · Afina la búsqueda para ver más coincidencias' : ''}` : phase === 'waiting' || phase === 'loading' ? 'Buscando coincidencias…' : 'Solo se consultan los registros permitidos para tu cuenta.'}</p><button type="button" disabled={phase !== 'done'} onClick={() => setRegistration({ patient: null })}><Icon name="plus" size={16} />Iniciar registro presencial</button></div>
    {phase === 'done' && patients.length > 0 && <div className="patient-record-summary" aria-label="Expedientes en estos resultados"><span>En estos resultados</span><div><span className="has-record"><Icon name="check" size={16} /><strong>{patients.filter(patient => patient.record_code).length}</strong> con expediente</span><span className="no-record"><Icon name="file" size={16} /><strong>{patients.filter(patient => !patient.record_code).length}</strong> sin expediente disponible</span></div></div>}
    {duplicates.size > 0 && <p className="patient-duplicate-notice"><Icon name="help" size={19} /><span>Hay registros con nombre o teléfono similares. <strong>Comprueba el documento antes de continuar.</strong> Una coincidencia no demuestra que sean la misma persona.</span></p>}
    <div id="patient-search-results" className="patient-directory-results" aria-busy={phase === 'waiting' || phase === 'loading'}>
      {(phase === 'waiting' || phase === 'loading') && <div className="patient-search-empty" role="status"><Icon name="search" size={30} /><h4>Buscando al paciente…</h4><p>Puedes seguir escribiendo para precisar la búsqueda.</p></div>}
      {phase === 'idle' && <div className="patient-search-empty"><Icon name="file" size={34} /><h4>Un dato es suficiente para empezar</h4><p>Prueba con parte del nombre, un teléfono o el código del expediente. No se vinculan cuentas desde esta búsqueda.</p></div>}
      {phase === 'error' && <div className="patient-search-empty"><Icon name="help" size={29} /><p role="alert">{error}</p><button type="button" onClick={() => { setPhase('waiting'); setRetry(value => value + 1) }}>Volver a buscar</button></div>}
      {phase === 'done' && !patients.length && <div className="patient-search-empty"><Icon name="search" size={32} /><h4>No encontramos coincidencias</h4><p>Prueba otro dato y comprueba el documento antes de iniciar un registro nuevo.</p></div>}
      {patients.map(patient => <article className={`patient-result ${patient.record_code ? 'has-record' : 'no-record'}`} key={patient.id}>
        <header><span className="patient-result-avatar" aria-hidden="true">{`${patient.first_name.charAt(0)}${patient.last_name.charAt(0)}`.toLocaleUpperCase()}</span><div><h4>{patient.first_name} {patient.last_name}</h4><p>Código de paciente · {patient.patient_code}</p><span className="patient-match-reason">Coincidencia en {patientMatch(patient, query)?.label.toLocaleLowerCase('es')}</span></div></header>
        <div className={`patient-record-state ${patient.record_code ? 'available' : ''}`}><span className="patient-record-state-icon"><Icon name={patient.record_code ? 'check' : 'file'} size={23} /></span><div><strong>{patient.record_code ? 'Tiene expediente' : 'Sin expediente disponible'}</strong><span>{patient.record_code ? patient.record_code : 'Requiere revisión antes de continuar'}</span></div></div>
        <dl><div><dt>Documento de identidad</dt><dd>{maskPatientDui(patient.dui)}</dd></div><div><dt>Teléfono</dt><dd>{patient.phone || 'No registrado'}</dd></div><div className="patient-result-email"><dt>Correo de contacto</dt><dd>{patient.email || 'No registrado'}</dd></div></dl>
        {duplicates.has(patient.id) && <p className="patient-result-duplicate"><Icon name="help" size={14} />Verifica la identidad: hay coincidencias similares.</p>}
        <footer><span>La búsqueda no autoriza vincular cuentas.</span>{onSelectPatient ? <button type="button" onClick={() => onSelectPatient(patient)}><Icon name="check" size={16} />Seleccionar paciente</button> : patient.record_code ? <button type="button" onClick={() => setRecord(patient)}><Icon name="eye" size={16} />Abrir expediente</button> : <button type="button" onClick={() => setRegistration({ patient })}><Icon name="plus" size={16} />Iniciar registro presencial</button>}</footer>
      </article>)}
    </div>
    {record && <PatientRecordDialog key={record.id} patient={record} onClose={() => setRecord(null)} />}
    {registration && <RegistrationReview patient={registration.patient} onClose={() => setRegistration(null)} onContinue={() => { onStartRegistration(registration.patient); setRegistration(null) }} />}
  </section>
}

export function PatientRecordDialog({ patient, onClose }: { patient: ReceptionPatientMatch; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [record, setRecord] = useState<Awaited<ReturnType<typeof readReceptionRecord>> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    dialog.current?.showModal()
    const controller = new AbortController()
    let current = true
    readReceptionRecord(patient.id, controller.signal).then(data => { if (current) setRecord(data) }).catch(() => { if (current) setError('No se pudo abrir el expediente autorizado. Cierra la ficha y vuelve a buscar.') })
    return () => { current = false; controller.abort() }
  }, [patient.id])
  return <dialog ref={dialog} className="patient-record-dialog" aria-labelledby="patient-record-title" onCancel={event => { event.preventDefault(); onClose() }}><header><span>EXPEDIENTE · CONSULTA DE RECEPCIÓN</span><button type="button" aria-label="Cerrar expediente" onClick={onClose}>×</button></header><div className="patient-record-content"><h3 id="patient-record-title">{patient.first_name} {patient.last_name}</h3><p>{maskPatientDui(patient.dui)} · {patient.patient_code}</p>{error && <p role="alert" className="patient-duplicate-notice">{error}</p>}{!record && !error && <p role="status">Consultando expediente…</p>}{record && <><div className="patient-record-details"><strong>{record.record_code}</strong><span>Abierto el {displayTime(record.opened_at)}</span></div><h4>Antecedentes disponibles para recepción</h4>{record.history.length ? <ul>{record.history.map(item => <li key={item.id}><strong>{String(item.history_type).replaceAll('_', ' ')}</strong><time>{displayTime(item.created_at)}</time><p>{item.description}</p></li>)}</ul> : <p>No hay antecedentes disponibles en esta consulta.</p>}<small>Se muestran hasta 10 antecedentes recientes autorizados. Esta vista no concede acceso a diagnósticos ni vincula cuentas.</small></>}</div><footer><button type="button" onClick={onClose}>Cerrar expediente</button></footer></dialog>
}

function RegistrationReview({ patient, onClose, onContinue }: { patient: ReceptionPatientMatch | null; onClose: () => void; onContinue: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [verified, setVerified] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="patient-record-dialog patient-registration-review" aria-labelledby="patient-register-review-title" onCancel={event => { event.preventDefault(); onClose() }}><div className="patient-record-content"><span className="patient-directory-eyebrow">VERIFICACIÓN ANTES DEL REGISTRO</span><h3 id="patient-register-review-title">Evitemos expedientes duplicados</h3><p>{patient ? `${patient.first_name} ${patient.last_name} ya tiene un registro de paciente. Se recuperarán sus datos para revisión presencial; no se creará otra persona automáticamente. Si falta su expediente, se solicitará revisión administrativa.` : 'Compara los resultados y verifica el documento del paciente antes de registrar una persona nueva.'}</p><label><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} />Revisé las coincidencias y comprobaré el DUI con el documento del paciente.</label><p>Coincidir por nombre, teléfono o correo no autoriza vincular una cuenta.</p></div><footer><button autoFocus type="button" onClick={onClose}>Volver a revisar</button><button type="button" disabled={!verified} onClick={onContinue}>Continuar al registro presencial</button></footer></dialog>
}
