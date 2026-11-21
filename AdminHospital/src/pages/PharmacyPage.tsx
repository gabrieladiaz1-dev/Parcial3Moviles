import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { panelError } from '../lib/panel'
import { prescriptionStatusLabel, readPatientPrescriptions, searchPharmacyPatients, setPrescriptionStatus, type PharmacyPatient, type PharmacyPrescription, type PrescriptionStatus } from '../lib/pharmacy'

const when = (value: string) => new Date(value).toLocaleString('es-SV', { timeZone: 'America/El_Salvador', dateStyle: 'medium', timeStyle: 'short' })
const statusTone: Record<PrescriptionStatus, string> = { pendiente: 'bg-amber-50 text-amber-800 ring-amber-200', parcial: 'bg-sky-50 text-sky-800 ring-sky-200', entregada: 'bg-emerald-50 text-emerald-800 ring-emerald-200' }
type View = 'todas' | PrescriptionStatus

export function PharmacyPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PharmacyPatient[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [patient, setPatient] = useState<PharmacyPatient | null>(null)
  const active = query.trim().length >= 2
  const shown = active ? results : []

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) return
    let active = true
    const timer = window.setTimeout(() => {
      setSearching(true); setSearchError('')
      searchPharmacyPatients(term).then(rows => { if (active) setResults(rows) })
        .catch(e => { if (active) setSearchError(panelError(e)) })
        .finally(() => { if (active) setSearching(false) })
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query])

  return <div className="space-y-5">
    <header className="rounded-2xl bg-gradient-to-br from-[#800b2c] to-[#a63659] px-6 py-6 text-white shadow-sm sm:px-8"><span className="text-[10px] font-bold uppercase tracking-[.2em] text-white/70">Gestión de farmacia</span><h2 className="mt-2 text-2xl font-bold">Solicitudes y recetas</h2><p className="mt-2 max-w-2xl text-sm text-white/85">Consulta las recetas de un paciente, revisa los medicamentos indicados y registra su entrega.</p></header>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3"><span className="rounded-xl bg-[#800b2c]/10 p-3 text-[#800b2c]"><Icon name="search" size={20} /></span><div><h3 className="text-base font-semibold text-slate-900">Buscar paciente</h3><p className="mt-1 text-xs text-slate-500">Encuentra sus solicitudes de recetas por nombre, DUI o correo electrónico.</p></div></div>
      <label className="mt-5 block text-xs font-semibold text-slate-700" htmlFor="pharmacy-search">Nombre, DUI o correo</label>
      <div className="mt-2 flex max-w-3xl items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-4 focus-within:border-[#800b2c] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#800b2c]/15">
        <Icon name="search" size={15} />
        <input id="pharmacy-search" className="w-full bg-transparent py-3 text-sm outline-none" type="search" autoComplete="off" value={query} onChange={e => { setQuery(e.target.value); setPatient(null) }} placeholder="Ej.: María López, 01234567-8 o maria@correo.com" />
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Escribe al menos dos caracteres para buscar.</p>
      {active && searching && <p className="mt-3 text-xs text-slate-500" role="status">Buscando pacientes…</p>}
      {active && searchError && <p className="mt-3 rounded-md bg-rose-50 p-2 text-xs text-rose-800" role="alert">{searchError}</p>}
      {!patient && !searching && !searchError && active && !shown.length && <p className="mt-3 text-xs text-slate-500" role="status">No se encontraron pacientes con «{query.trim()}».</p>}
      {!patient && shown.length > 0 && <ul className="mt-4 max-w-3xl divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200" aria-label="Resultados de la búsqueda">
        {shown.map(p => <li key={p.id}><button type="button" className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#800b2c]/5" onClick={() => setPatient(p)}>
          <span className="min-w-0 flex-1"><strong className="block text-sm text-slate-800">{p.full_name}</strong><small className="block truncate text-[11px] text-slate-500">{[p.dui, p.email].filter(Boolean).join(' · ') || 'Sin DUI ni correo'}</small></span><span className="text-xs font-semibold text-[#800b2c]">Ver recetas →</span>
        </button></li>)}
      </ul>}
    </section>
    {patient && <PatientPrescriptions key={patient.id} patient={patient} onClose={() => setPatient(null)} />}
    {!patient && <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-9 text-center"><span className="mx-auto flex w-fit rounded-2xl bg-white p-4 text-[#800b2c] shadow-sm"><Icon name="file" size={26} /></span><h3 className="mt-4 text-sm font-semibold text-slate-800">Las solicitudes del paciente aparecerán aquí</h3><p className="mt-1 text-xs text-slate-500">Selecciona un paciente para ver sus recetas pendientes, parciales y entregadas.</p></section>}
  </div>
}

function PatientPrescriptions({ patient, onClose }: { patient: PharmacyPatient; onClose: () => void }) {
  const [rows, setRows] = useState<PharmacyPrescription[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [view, setView] = useState<View>('todas')
  const lock = useRef(false)

  useEffect(() => {
    let active = true
    readPatientPrescriptions(patient.id).then(r => { if (active) setRows(r) }).catch(e => { if (active) setError(panelError(e)) })
    return () => { active = false }
  }, [patient.id])

  async function change(rx: PharmacyPrescription, status: 'pendiente' | 'entregada') {
    if (lock.current || rx.status === status) return
    lock.current = true; setBusy(rx.id); setError(''); setNotice('')
    try {
      const saved = await setPrescriptionStatus(rx.id, status)
      setRows(current => current?.map(r => r.id === rx.id ? { ...r, status: saved.status, status_updated_at: saved.status_updated_at } : r) ?? null)
      setNotice(`La receta ${rx.code} quedó como «${prescriptionStatusLabel[saved.status]}». El paciente ya puede verlo en su portal.`)
    } catch (e) { setError(panelError(e)) } finally { lock.current = false; setBusy(null) }
  }

  const field = (label: string, value: string | null) => <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-0.5 text-sm text-slate-800">{value || 'No registrado'}</dd></div>

  const visible = rows?.filter(rx => view === 'todas' || rx.status === view) ?? []
  const views: { value: View; label: string }[] = [{ value: 'todas', label: 'Todas' }, { value: 'pendiente', label: 'Pendientes' }, { value: 'parcial', label: 'Parciales' }, { value: 'entregada', label: 'Entregadas' }]

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="pharmacy-patient-name">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><span className="text-[10px] font-bold uppercase tracking-wider text-[#800b2c]">Paciente seleccionado</span><h3 id="pharmacy-patient-name" className="mt-1 text-lg font-semibold text-slate-900">{patient.full_name}</h3></div>
      <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={onClose}>Cambiar paciente</button>
    </div>
    <dl className="mt-5 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3">{field('DUI', patient.dui)}{field('Correo', patient.email)}{field('Teléfono', patient.phone)}</dl>

    <div className="mt-7 flex flex-wrap items-start justify-between gap-3 border-t border-slate-100 pt-6"><div><span className="text-[10px] font-bold uppercase tracking-wider text-[#800b2c]">Solicitudes del paciente</span><h4 className="mt-1 text-base font-semibold text-slate-900">Recetas médicas</h4><p className="mt-1 text-xs text-slate-500">Revisa las indicaciones y consulta el estado de cada receta.</p></div>{rows && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{rows.length} {rows.length === 1 ? 'receta' : 'recetas'}</span>}</div>
    {error && <p className="mt-3 rounded-md bg-rose-50 p-2 text-xs text-rose-800" role="alert">{error}</p>}
    {notice && <p className="mt-3 rounded-md bg-emerald-50 p-2 text-xs text-emerald-800" role="status">{notice}</p>}
    {!rows && !error && <p className="mt-3 text-xs text-slate-500" role="status">Consultando recetas…</p>}
    {rows && !rows.length && <p className="mt-3 text-xs text-slate-500">Este paciente no tiene recetas registradas.</p>}
    {rows && rows.length > 0 && <><div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Filtrar recetas por estado">{views.map(option => { const count = option.value === 'todas' ? rows.length : rows.filter(rx => rx.status === option.value).length; return <button key={option.value} type="button" aria-pressed={view === option.value} onClick={() => setView(option.value)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${view === option.value ? 'border-[#800b2c] bg-[#800b2c] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#800b2c]/40 hover:text-[#800b2c]'}`}>{option.label} <span className="ml-1 opacity-75">{count}</span></button> })}</div>
    {!visible.length && <p className="mt-5 rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-600">No hay recetas en este estado.</p>}
    <ul className="mt-5 space-y-4">{visible.map(rx => <li key={rx.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 px-4 py-4">
        <div><span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Receta médica</span><p className="text-sm font-bold text-slate-800">{rx.code}</p><p className="text-[11px] text-slate-500">Emitida {when(rx.issued_at)}{rx.status_updated_at ? ` · Estado actualizado ${when(rx.status_updated_at)}` : ''}</p></div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${statusTone[rx.status]}`}>{prescriptionStatusLabel[rx.status]}</span>
      </div>
      <div className="px-4 py-4"><h5 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Medicamentos indicados</h5><ul className="mt-3 space-y-2 text-xs text-slate-700">{rx.items.map((item, i) => <li key={i} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3"><div className="flex flex-wrap justify-between gap-2"><b>{item.medication}</b><span className="font-semibold text-[#800b2c]">Cantidad: {item.quantity}</span></div><p className="mt-1">{item.dose} {item.dose_unit} cada {item.frequency_hours} h · Vía {item.route}</p>{item.observations && <p className="mt-1 text-slate-500">{item.observations}</p>}</li>)}</ul>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4" role="group" aria-label={`Estado de ${rx.code}`}>
        {(['pendiente', 'entregada'] as const).map(s => <button key={s} type="button" aria-pressed={rx.status === s} disabled={busy !== null || rx.status === s}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${rx.status === s ? 'bg-[#800b2c] text-white' : 'border border-[#800b2c] text-[#800b2c] hover:bg-[#800b2c]/5'} disabled:cursor-not-allowed disabled:opacity-70`}
          onClick={() => change(rx, s)}>{busy === rx.id && rx.status !== s ? 'Guardando…' : `Marcar ${prescriptionStatusLabel[s].toLowerCase()}`}</button>)}
      </div></div>
    </li>)}</ul></>}
  </section>
}
