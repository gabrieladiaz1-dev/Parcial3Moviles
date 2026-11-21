import { userMessage } from '../lib/userError'
import { useRef, useState } from 'react'
import { localDate, receptionRpc, searchReceptionPatients, type AttentionRequest, type ReceptionPatient } from '../lib/reception'
import { IdentityCheck } from './ReceptionIdentity'

export function ReceptionRecordPreparation({ patient, request, onReady, onCancel }: { patient?: ReceptionPatient | null; request?: AttentionRequest; onReady: (patient: ReceptionPatient, code: string) => void; onCancel?: () => void }) {
  const source = patient ?? request?.applicant_data ?? {}
  const [values, setValues] = useState({ first_name: source.first_name ?? '', last_name: source.last_name ?? '', dui: source.dui ?? '', birth_date: source.birth_date ?? '', phone: source.phone ?? '', email: source.email ?? '', city: source.city ?? '' })
  const [identity, setIdentity] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [duplicates, setDuplicates] = useState<ReceptionPatient[]>([])
  const [distinct, setDistinct] = useState(false)
  const lock = useRef(false)
  async function save() {
    if (lock.current || !identity) return
    lock.current = true; setBusy(true); setError('')
    try {
      if (!patient) {
        const queries = [`${values.first_name} ${values.last_name}`, values.dui, values.phone].filter(v => v.trim().length >= 2)
        const found = await Promise.all(queries.map(q => searchReceptionPatients(q)))
        const matches = [...new Map(found.flatMap(result => result.patients).map(p => [p.id, p])).values()]
        if (matches.some(p => p.dui?.replaceAll('-', '') === values.dui.replaceAll('-', ''))) throw new Error('Ya existe un paciente con este DUI. Vuelve a la búsqueda y selecciona su registro; no crees otro expediente.')
        if (matches.length && !distinct) { setDuplicates(matches); return }
      }
      const result = await receptionRpc<{ patient: ReceptionPatient; record_code: string }>('reception_prepare_record', { p_values: values, p_identity_confirmed: identity, p_patient: patient?.id ?? null, p_request: request?.id ?? null })
      onReady(result.patient, result.record_code)
    } catch (e) { setError((e as { code?: string }).code === 'PGRST202' ? 'La creación de expedientes no está disponible en este momento. No se realizó ningún cambio; contacta al administrador del sistema.' : userMessage(e, 'No se pudo guardar el expediente.')) }
    finally { lock.current = false; setBusy(false) }
  }
  return <form className="booking-workspace" onSubmit={e => { e.preventDefault(); void save() }}><h3>Completar expediente</h3><p>Comprueba estos datos con el documento. Se conservará el paciente existente y no se creará una cuenta de acceso.</p><div className="agenda-controls">{(['first_name', 'last_name', 'dui', 'birth_date', 'phone', 'email', 'city'] as const).map(field => <label key={field}>{({ first_name: 'Nombres', last_name: 'Apellidos', dui: 'DUI', birth_date: 'Fecha de nacimiento', phone: 'Teléfono', email: 'Correo de contacto', city: 'Ciudad' })[field]}<input required={['first_name', 'last_name', 'dui', 'birth_date'].includes(field)} readOnly={Boolean(source[field])} type={field === 'birth_date' ? 'date' : field === 'email' ? 'email' : 'text'} max={field === 'birth_date' ? localDate() : undefined} maxLength={field === 'dui' ? 10 : 254} value={values[field]} onChange={e => { setValues(v => ({ ...v, [field]: e.target.value })); setDistinct(false); setDuplicates([]); setIdentity(false) }} /></label>)}</div><IdentityCheck checked={identity} onChange={setIdentity} disabled={busy} />{duplicates.length > 0 && <div className="agenda-warning"><div><strong>Hay posibles coincidencias. Revisa antes de crear.</strong><ul>{duplicates.map(p => <li key={p.id}>{p.first_name} {p.last_name} · Documento terminado en {p.dui?.slice(-1) ?? 'no registrado'}</li>)}</ul><label><input type="checkbox" checked={distinct} onChange={e => setDistinct(e.target.checked)} />Verifiqué los documentos: son personas distintas. No se vinculará ninguna cuenta por nombre o teléfono.</label></div></div>}{error && <p role="alert" className="agenda-warning">{error}</p>}<button className="agenda-primary" disabled={!identity || busy}>{busy ? 'Guardando expediente…' : 'Guardar expediente y continuar'}</button>{onCancel && <button type="button" className="agenda-back" disabled={busy} onClick={onCancel}>Volver a buscar al paciente</button>}</form>
}
