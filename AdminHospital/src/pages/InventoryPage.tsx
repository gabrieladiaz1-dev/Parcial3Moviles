import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { Panel, StatCard } from '../components/ui'
import { addStock, medicationLabel, medicationProblem, readInventory, saveMedication, stockState,
  type InventoryOverview, type Medication, type MedicationInput, type StockState } from '../lib/inventory'
import { userMessage } from '../lib/userError'

const emptyForm: MedicationInput = { name: '', presentation: '', strength: '', minimum: 0, active: true, initial: 0 }
const stateStyle: Record<StockState, string> = {
  Disponible: 'bg-emerald-50 text-emerald-700',
  'Stock bajo': 'bg-amber-50 text-amber-700',
  Agotado: 'bg-rose-50 text-rose-700',
  Inactivo: 'bg-slate-100 text-slate-500',
}
const dateTime = (value: string) => new Intl.DateTimeFormat('es-SV', { timeZone: 'America/El_Salvador', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value))

/** Inventario de medicamentos (catálogo real de Hospital Móviles: inventory_overview, save_medication y add_inventory). */
export function InventoryPage() {
  const [data, setData] = useState<InventoryOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'Todos' | StockState>('Todos')
  const [editing, setEditing] = useState<Medication | 'new' | null>(null)
  const [form, setForm] = useState<MedicationInput>(emptyForm)
  const [entry, setEntry] = useState<Medication | null>(null)
  const [entryQuantity, setEntryQuantity] = useState('')
  const [entryReason, setEntryReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await readInventory()) } catch (failure) { setError(userMessage(failure, 'No se pudo cargar el inventario.')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const medications = data?.medications ?? []
  const filtered = medications.filter(item =>
    medicationLabel(item).toLowerCase().includes(query.trim().toLowerCase()) && (status === 'Todos' || stockState(item) === status))
  const low = medications.filter(item => stockState(item) === 'Stock bajo')
  const out = medications.filter(item => stockState(item) === 'Agotado')
  const alerts = [...out, ...low]

  function openForm(item: Medication | 'new') {
    setEditing(item); setEntry(null); setNotice(''); setError('')
    setForm(item === 'new' ? emptyForm : { name: item.name, presentation: item.presentation ?? '', strength: item.strength ?? '', minimum: item.minimum_stock, active: item.active, initial: 0 })
  }
  async function submitForm(event: FormEvent) {
    event.preventDefault()
    const problem = medicationProblem(form)
    if (problem) { setError(problem); return }
    setBusy(true); setError('')
    try {
      await saveMedication(form, editing === 'new' || !editing ? undefined : editing.id)
      setNotice(editing === 'new' ? 'Medicamento registrado en el catálogo.' : 'Medicamento actualizado.')
      setEditing(null); await load()
    } catch (failure) { setError(userMessage(failure, 'No se pudo guardar el medicamento.')) }
    finally { setBusy(false) }
  }
  async function submitEntry(event: FormEvent) {
    event.preventDefault()
    const quantity = Number(entryQuantity)
    if (!entry || !Number.isInteger(quantity) || quantity <= 0) { setError('Indica una cantidad entera mayor que cero.'); return }
    setBusy(true); setError('')
    try {
      await addStock(entry.id, quantity, entryReason)
      setNotice(`Entrada registrada: +${quantity} · ${medicationLabel(entry)}.`)
      setEntry(null); setEntryQuantity(''); setEntryReason(''); await load()
    } catch (failure) { setError(userMessage(failure, 'No se pudo registrar la entrada.')) }
    finally { setBusy(false) }
  }

  const input = 'w-full rounded-md border border-slate-100 bg-slate-50 px-2 py-2 text-[9px] text-slate-700 outline-none focus:border-[#870b30]'
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon="box" label="Medicamentos en catálogo" value={loading ? '—' : String(medications.filter(m => m.active).length)} detail="Activos para recetar" />
        <StatCard icon="activity" label="Stock bajo" value={loading ? '—' : String(low.length)} detail="En o bajo el mínimo" tone="amber" />
        <StatCard icon="clock" label="Agotados" value={loading ? '—' : String(out.length)} detail="Sin existencias" tone="blue" />
        <StatCard icon="check" label="Unidades en existencia" value={loading ? '—' : String(medications.reduce((sum, m) => sum + (m.active ? m.stock : 0), 0))} detail="Medicamentos activos" tone="green" />
      </div>
      {error && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-[9px] text-rose-800" role="alert">{error}</p>}
      {notice && <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-[9px] text-emerald-800" role="status">{notice}</p>}
      <section className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white p-3 shadow-[0_2px_10px_rgba(15,23,42,0.025)]">
        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-slate-400"><Icon name="search" size={13} /><input aria-label="Buscar en inventario" className="w-full bg-transparent text-[9px] text-slate-700 outline-none placeholder:text-slate-400" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre, concentración o presentación..." value={query} /></label>
        <label className="flex items-center gap-2 text-[9px] text-slate-500">Estado:
          <select aria-label="Estado de inventario" className="rounded-md bg-slate-50 px-2 py-2 text-slate-700 outline-none" onChange={(event) => setStatus(event.target.value as 'Todos' | StockState)} value={status}><option>Todos</option><option>Disponible</option><option>Stock bajo</option><option>Agotado</option><option>Inactivo</option></select>
        </label>
        <button className="flex items-center justify-center gap-1 rounded-md bg-[#870b30] px-3 py-2 text-[9px] font-semibold text-white hover:bg-[#6f0827] disabled:opacity-50" disabled={busy} onClick={() => openForm('new')} type="button"><Icon name="plus" size={12} /> Nuevo medicamento</button>
      </section>
      {editing && (
        <Panel className="mb-4" subtitle="El catálogo alimenta las recetas del médico y la entrega en Farmacia." title={editing === 'new' ? 'Nuevo medicamento' : `Editar ${editing.name}`}>
          <form className="grid grid-cols-1 gap-3 md:grid-cols-3" onSubmit={submitForm}>
            <label className="text-[9px] text-slate-500">Nombre<input aria-label="Nombre del medicamento" className={input} maxLength={200} onChange={e => setForm({ ...form, name: e.target.value })} value={form.name} /></label>
            <label className="text-[9px] text-slate-500">Concentración<input aria-label="Concentración" className={input} maxLength={100} onChange={e => setForm({ ...form, strength: e.target.value })} placeholder="500 mg" value={form.strength} /></label>
            <label className="text-[9px] text-slate-500">Presentación<input aria-label="Presentación" className={input} maxLength={200} onChange={e => setForm({ ...form, presentation: e.target.value })} placeholder="Tabletas" value={form.presentation} /></label>
            <label className="text-[9px] text-slate-500">Stock mínimo<input aria-label="Stock mínimo" className={input} min={0} onChange={e => setForm({ ...form, minimum: Number(e.target.value) })} step={1} type="number" value={form.minimum} /></label>
            {editing === 'new' && <label className="text-[9px] text-slate-500">Stock inicial<input aria-label="Stock inicial" className={input} min={0} onChange={e => setForm({ ...form, initial: Number(e.target.value) })} step={1} type="number" value={form.initial} /></label>}
            <label className="flex items-center gap-2 text-[9px] text-slate-500"><input aria-label="Activo para recetar" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} type="checkbox" /> Activo para recetar</label>
            <div className="flex gap-2 md:col-span-3">
              <button className="rounded-md bg-[#870b30] px-3 py-2 text-[9px] font-semibold text-white disabled:opacity-50" disabled={busy} type="submit">Guardar</button>
              <button className="rounded-md px-3 py-2 text-[9px] font-semibold text-[#870b30]" disabled={busy} onClick={() => setEditing(null)} type="button">Cancelar</button>
            </div>
          </form>
        </Panel>
      )}
      {entry && (
        <Panel className="mb-4" subtitle="La entrada suma existencias y queda registrada con tu nombre." title={`Registrar entrada · ${medicationLabel(entry)}`}>
          <form className="grid grid-cols-1 gap-3 md:grid-cols-3" onSubmit={submitEntry}>
            <label className="text-[9px] text-slate-500">Cantidad<input aria-label="Cantidad de entrada" className={input} min={1} onChange={e => setEntryQuantity(e.target.value)} step={1} type="number" value={entryQuantity} /></label>
            <label className="text-[9px] text-slate-500 md:col-span-2">Motivo (opcional)<input aria-label="Motivo de la entrada" className={input} maxLength={200} onChange={e => setEntryReason(e.target.value)} placeholder="Compra, donación, reposición..." value={entryReason} /></label>
            <div className="flex gap-2 md:col-span-3">
              <button className="rounded-md bg-[#870b30] px-3 py-2 text-[9px] font-semibold text-white disabled:opacity-50" disabled={busy} type="submit">Registrar entrada</button>
              <button className="rounded-md px-3 py-2 text-[9px] font-semibold text-[#870b30]" disabled={busy} onClick={() => setEntry(null)} type="button">Cancelar</button>
            </div>
          </form>
        </Panel>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel className="xl:col-span-8" subtitle={`${filtered.length} medicamentos · Existencias y estado según el stock mínimo`} title="Inventario de medicamentos">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[570px] text-left text-[9px]">
              <thead><tr className="border-b border-slate-100 text-slate-400"><th className="pb-3 font-medium">Medicamento</th><th className="pb-3 font-medium">Presentación</th><th className="pb-3 font-medium">Existencia</th><th className="pb-3 font-medium">Mínimo</th><th className="pb-3 font-medium">Estado</th><th className="pb-3 font-medium">Acciones</th></tr></thead>
              <tbody className="divide-y divide-slate-50">{filtered.map(item => { const state = stockState(item); return (
                <tr key={item.id}>
                  <td className="py-3 font-medium text-slate-700">{[item.name, item.strength].filter(Boolean).join(' ')}</td>
                  <td className="py-3 text-slate-500">{item.presentation || '—'}</td>
                  <td className="py-3 font-semibold text-slate-700">{item.stock}</td>
                  <td className="py-3 text-slate-500">{item.minimum_stock}</td>
                  <td className="py-3"><span className={`rounded-full px-2 py-1 text-[8px] ${stateStyle[state]}`}>{state}</span></td>
                  <td className="py-3 space-x-3">
                    <button className="font-medium text-[#870b30] hover:underline disabled:opacity-50" disabled={busy || !item.active} onClick={() => { setEntry(item); setEditing(null); setEntryQuantity(''); setEntryReason(''); setNotice('') }} type="button">Entrada</button>
                    <button className="font-medium text-[#870b30] hover:underline disabled:opacity-50" disabled={busy} onClick={() => openForm(item)} type="button">Editar</button>
                  </td>
                </tr>) })}
                {!loading && filtered.length === 0 && <tr><td className="py-8 text-center text-slate-400" colSpan={6}>{medications.length ? 'No se encontraron medicamentos.' : 'El catálogo está vacío. Registra el primer medicamento.'}</td></tr>}
                {loading && <tr><td className="py-8 text-center text-slate-400" colSpan={6}>Cargando inventario…</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="space-y-4 xl:col-span-4">
          <Panel title="Alertas de inventario">
            <div className="space-y-2">
              {alerts.map(item => { const state = stockState(item); return (
                <div className={`rounded-lg p-2.5 ${state === 'Agotado' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`} key={item.id}>
                  <p className="text-[9px] font-semibold">{medicationLabel(item)} · {state === 'Agotado' ? 'agotado' : 'stock bajo'}</p>
                  <p className="mt-1 text-[8px] opacity-75">{item.stock} en existencia · mínimo {item.minimum_stock}</p>
                </div>) })}
              {!loading && alerts.length === 0 && <p className="text-[9px] text-slate-400">Sin alertas: todos los medicamentos activos están sobre su mínimo.</p>}
            </div>
          </Panel>
        </div>
        <Panel className="xl:col-span-12" subtitle="Entradas, stock inicial y dispensaciones registradas" title="Movimientos recientes">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[9px]">
              <thead><tr className="border-b border-slate-100 text-slate-400"><th className="pb-2 font-medium">Fecha</th><th className="pb-2 font-medium">Movimiento</th><th className="pb-2 font-medium">Medicamento</th><th className="pb-2 font-medium">Cantidad</th><th className="pb-2 font-medium">Motivo</th><th className="pb-2 font-medium">Responsable</th></tr></thead>
              <tbody className="divide-y divide-slate-50">{(data?.movements ?? []).map(move => (
                <tr key={move.id}>
                  <td className="py-2.5 text-slate-500">{dateTime(move.created_at)}</td>
                  <td className={`py-2.5 font-medium ${move.quantity > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{move.quantity > 0 ? 'Entrada' : 'Salida'}</td>
                  <td className="py-2.5 text-slate-600">{move.medication}</td>
                  <td className="py-2.5 font-semibold text-slate-700">{move.quantity > 0 ? `+${move.quantity}` : `−${Math.abs(move.quantity)}`}</td>
                  <td className="py-2.5 text-slate-500">{move.reason || '—'}</td>
                  <td className="py-2.5 text-slate-500">{move.actor}</td>
                </tr>))}
                {!loading && !(data?.movements.length) && <tr><td className="py-6 text-center text-slate-400" colSpan={6}>Todavía no hay movimientos.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  )
}
