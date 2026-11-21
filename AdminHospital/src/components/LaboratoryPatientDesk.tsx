import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { panelError } from '../lib/panel'
import { labStates, readLaboratoryPatientOrders, searchLaboratoryPatients, sendLaboratoryResults, startLaboratoryOrder, type LabDeskOrder, type LabDeskPatient } from '../lib/laboratory'

const when = (value: string) => new Date(value).toLocaleString('es-SV', { timeZone: 'America/El_Salvador', dateStyle: 'medium', timeStyle: 'short' })
const statusTone: Record<string, string> = { pendiente: 'bg-amber-50 text-amber-800 ring-amber-200', en_proceso: 'bg-sky-50 text-sky-800 ring-sky-200', completado: 'bg-emerald-50 text-emerald-800 ring-emerald-200' }

export function LaboratoryPatientDesk({ onOpenOrder, onChanged }: { onOpenOrder: (id: string) => void; onChanged: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LabDeskPatient[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [patient, setPatient] = useState<LabDeskPatient | null>(null)
  const active = query.trim().length >= 2
  const shown = active ? results : []

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) return
    let alive = true
    const timer = window.setTimeout(() => {
      setSearching(true); setSearchError('')
      searchLaboratoryPatients(term).then(rows => { if (alive) setResults(rows) })
        .catch(e => { if (alive) setSearchError(panelError(e)) })
        .finally(() => { if (alive) setSearching(false) })
    }, 300)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [query])

  return <div className="space-y-5">
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <label className="block text-xs font-semibold text-slate-700" htmlFor="lab-patient-search">Buscar paciente</label>
      <p className="mt-1 text-[11px] text-slate-500">Escribe el nombre, el DUI o el correo electrónico.</p>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-300 px-3 focus-within:border-[#800b2c] focus-within:ring-2 focus-within:ring-[#800b2c]/15">
        <Icon name="search" size={15} />
        <input id="lab-patient-search" className="w-full py-2.5 text-sm outline-none" type="search" autoComplete="off" value={query} onChange={e => { setQuery(e.target.value); setPatient(null) }} placeholder="Ej.: María López, 01234567-8 o maria@correo.com" />
      </div>
      {active && searching && <p className="mt-3 text-xs text-slate-500" role="status">Buscando pacientes…</p>}
      {active && searchError && <p className="mt-3 rounded-md bg-rose-50 p-2 text-xs text-rose-800" role="alert">{searchError}</p>}
      {!patient && !searching && !searchError && active && !shown.length && <p className="mt-3 text-xs text-slate-500" role="status">No se encontraron pacientes con «{query.trim()}».</p>}
      {!patient && shown.length > 0 && <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="Resultados de la búsqueda">
        {shown.map(p => <li key={p.id}><button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-[#800b2c]/5" onClick={() => setPatient(p)}>
          <span className="text-sm font-semibold text-slate-800">{p.full_name}</span>
          <span className="text-[11px] text-slate-500">{[p.dui, p.email].filter(Boolean).join(' · ') || 'Sin DUI ni correo'}</span>
        </button></li>)}
      </ul>}
    </section>
    {patient && <PatientOrders key={patient.id} patient={patient} onClose={() => setPatient(null)} onOpenOrder={onOpenOrder} onChanged={onChanged} />}
  </div>
}

function PatientOrders({ patient, onClose, onOpenOrder, onChanged }: { patient: LabDeskPatient; onClose: () => void; onOpenOrder: (id: string) => void; onChanged: () => void }) {
  const [rows, setRows] = useState<LabDeskOrder[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const lock = useRef(false)

  useEffect(() => {
    let alive = true
    readLaboratoryPatientOrders(patient.id).then(r => { if (alive) setRows(r) }).catch(e => { if (alive) setError(panelError(e)) })
    return () => { alive = false }
  }, [patient.id])

  async function run(order: LabDeskOrder, action: () => Promise<unknown>, success: string) {
    if (lock.current) return
    lock.current = true; setBusy(order.id); setError(''); setNotice('')
    try {
      await action()
      setRows(await readLaboratoryPatientOrders(patient.id))
      setNotice(success); onChanged()
    } catch (e) { setError(panelError(e)) } finally { lock.current = false; setBusy(null) }
  }

  function send(order: LabDeskOrder) {
    const text = (texts[order.id] ?? order.draft_summary ?? '').trim()
    if (!text) { setError(`Escribe los resultados de ${order.order_code} antes de enviarlos.`); return }
    if (!window.confirm(`¿Enviar los resultados de ${order.test_name} a ${patient.full_name}? Quedarán visibles en su portal.`)) return
    void run(order, async () => {
      let current = order
      if (current.status === 'pendiente' || current.version === null) {
        await startLaboratoryOrder(order.id)
        current = (await readLaboratoryPatientOrders(patient.id)).find(o => o.id === order.id) ?? order
      }
      await sendLaboratoryResults(current, text)
    }, `Resultados de ${order.order_code} enviados. El paciente ya puede verlos en su portal.`)
  }

  const field = (label: string, value: string | null) => <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-0.5 text-sm text-slate-800">{value || 'No registrado'}</dd></div>

  return <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="lab-patient-name">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h3 id="lab-patient-name" className="text-base font-semibold text-[#800b2c]">{patient.full_name}</h3>
      <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={onClose}>Cambiar paciente</button>
    </div>
    <dl className="mt-3 grid gap-3 sm:grid-cols-4">{field('Nombre', patient.full_name)}{field('Correo', patient.email)}{field('DUI', patient.dui)}{field('Teléfono', patient.phone)}</dl>

    <h4 className="mt-6 text-sm font-semibold text-slate-800">Exámenes</h4>
    {error && <p className="mt-3 rounded-md bg-rose-50 p-2 text-xs text-rose-800" role="alert">{error}</p>}
    {notice && <p className="mt-3 rounded-md bg-emerald-50 p-2 text-xs text-emerald-800" role="status">{notice}</p>}
    {!rows && !error && <p className="mt-3 text-xs text-slate-500" role="status">Consultando exámenes…</p>}
    {rows && !rows.length && <p className="mt-3 text-xs text-slate-500">Este paciente no tiene exámenes de laboratorio registrados.</p>}
    {rows && rows.length > 0 && <ul className="mt-3 space-y-3">{rows.map(o => {
      const done = o.status === 'completado'
      const working = busy === o.id
      return <li key={o.id} className="rounded-lg border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="text-sm font-semibold text-slate-800">{o.test_name} <span className="font-normal text-slate-500">· {o.order_code}</span></p><p className="text-[11px] text-slate-500">Solicitado {when(o.ordered_at)}{o.reason ? ` · ${o.reason}` : ''}</p></div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${statusTone[o.status]}`}>{labStates[o.status]}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={`Estado de ${o.order_code}`}>
          {(['pendiente', 'en_proceso', 'completado'] as const).map(s => <button key={s} type="button" aria-pressed={o.status === s}
            disabled={busy !== null || o.status === s || s !== 'en_proceso' || o.status !== 'pendiente'}
            title={s === 'completado' ? 'Se completa al enviar los resultados' : s === 'pendiente' ? 'Una orden iniciada no vuelve a pendiente' : undefined}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${o.status === s ? 'bg-[#800b2c] text-white' : 'border border-[#800b2c] text-[#800b2c] hover:bg-[#800b2c]/5'} disabled:cursor-not-allowed disabled:opacity-60`}
            onClick={() => void run(o, () => startLaboratoryOrder(o.id), `${o.order_code} quedó En proceso.`)}>{working && s === 'en_proceso' ? 'Guardando…' : labStates[s]}</button>)}
        </div>
        {done ? <div className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-700">
          <p className="font-semibold text-slate-800">Resultados enviados{o.published_at ? ` · ${when(o.published_at)}` : ''}</p>
          <p className="mt-1 whitespace-pre-wrap">{o.published_summary || 'Sin texto registrado.'}</p>
          <p className="mt-1 text-[11px] text-slate-500">{o.published_to_patient_at ? 'Visible en el portal del paciente.' : 'Aún no está liberado al paciente; ábrelo en el detalle de la orden.'}</p>
        </div> : <div className="mt-3">
          <label className="block text-xs font-semibold text-slate-700" htmlFor={`lab-result-${o.id}`}>Resultados</label>
          <textarea id={`lab-result-${o.id}`} rows={4} disabled={busy !== null} className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-[#800b2c] focus:ring-2 focus:ring-[#800b2c]/15"
            value={texts[o.id] ?? o.draft_summary ?? ''} onChange={e => setTexts(t => ({ ...t, [o.id]: e.target.value }))} placeholder="Escribe aquí los resultados del examen…" />
          {o.has_required_parameters && <p className="mt-1 text-[11px] text-amber-700">Este examen tiene parámetros obligatorios. Si el envío los solicita, complétalos en <button type="button" className="font-semibold underline" onClick={() => onOpenOrder(o.id)}>el detalle de la orden</button>.</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy !== null} className="rounded-md bg-[#800b2c] px-4 py-2 text-xs font-semibold text-white hover:bg-[#6a0924] disabled:cursor-not-allowed disabled:opacity-60" onClick={() => send(o)}>{working ? 'Enviando…' : 'Enviar resultados'}</button>
            <button type="button" disabled={busy !== null} className="rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" onClick={() => onOpenOrder(o.id)}>Ver detalle</button>
          </div>
        </div>}
      </li>
    })}</ul>}
  </section>
}
