import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { announcementProblem, announcementState, isoToLocal, readAnnouncements, retireAnnouncement, saveAnnouncement,
  type Announcement, type AnnouncementInput } from '../lib/announcements'
import { userMessage } from '../lib/userError'

const blank: AnnouncementInput = { title: '', content: '', isPublic: true, publishedAt: '', expiresAt: '' }
const when = (value: string | null) => value ? new Intl.DateTimeFormat('es-SV', { timeZone: 'America/El_Salvador', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'

/** Avisos generales que ve cualquier persona (también sin sesión) en Información general del paciente. */
export function AnnouncementsManager() {
  const [items, setItems] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<AnnouncementInput>(blank)
  const [editing, setEditing] = useState<string | null>(null)
  const lock = useRef(false)

  const load = useCallback(async () => {
    try { setItems(await readAnnouncements()) } catch (failure) { setError(userMessage(failure, 'No se pudieron cargar los avisos.')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  function edit(item: Announcement) {
    setEditing(item.id); setError(''); setNotice('')
    setForm({ title: item.title, content: item.content, isPublic: item.is_public, publishedAt: isoToLocal(item.published_at), expiresAt: isoToLocal(item.expires_at) })
  }
  function reset() { setEditing(null); setForm(blank) }
  async function run(action: () => Promise<unknown>, success: string) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(success); reset(); await load() }
    catch (failure) { setError(userMessage(failure, 'No se pudo guardar el aviso.')) }
    finally { lock.current = false; setBusy(false) }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    const problem = announcementProblem(form)
    if (problem) { setError(problem); return }
    void run(() => saveAnnouncement(form, editing ?? undefined), editing ? 'Aviso actualizado.' : form.isPublic ? 'Aviso publicado.' : 'Borrador guardado.')
  }

  return <section className="ops-card" aria-labelledby="announcements-title">
    <div className="ops-heading"><div><h3 id="announcements-title">Avisos públicos</h3><p>Se muestran a pacientes y visitantes en Información general, también sin iniciar sesión. Publica solo información oficial y no clínica.</p></div></div>
    {error && <p className="ops-alert error" role="alert">{error}</p>}
    {notice && <p className="ops-alert success" role="status">{notice}</p>}
    <form className="space-y-3" onSubmit={submit}>
      <div className="ops-form-grid">
        <label>Título<input aria-label="Título del aviso" className="ops-input" disabled={busy} maxLength={200} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
        <label>Publicar desde (opcional)<input aria-label="Publicar desde" className="ops-input" disabled={busy} type="datetime-local" value={form.publishedAt} onChange={e => setForm({ ...form, publishedAt: e.target.value })} /></label>
        <label>Vence (opcional)<input aria-label="Fecha de vencimiento" className="ops-input" disabled={busy} type="datetime-local" value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })} /></label>
      </div>
      <label className="block">Contenido<textarea aria-label="Contenido del aviso" className="ops-input" disabled={busy} maxLength={2000} rows={3} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} /></label>
      <label className="ops-check"><input aria-label="Aviso público" checked={form.isPublic} disabled={busy} type="checkbox" onChange={e => setForm({ ...form, isPublic: e.target.checked })} /> Público (desmarca para guardarlo como borrador)</label>
      <div className="flex flex-wrap gap-3">
        <button className="ops-primary" disabled={busy}>{busy ? 'Guardando…' : editing ? 'Guardar cambios' : form.isPublic ? 'Publicar aviso' : 'Guardar borrador'}</button>
        {editing && <button className="ops-secondary" disabled={busy} type="button" onClick={reset}>Cancelar edición</button>}
        <p className="ops-hint">Sin fecha de publicación se publica de inmediato. Hora de El Salvador.</p>
      </div>
    </form>
    <div className="mt-5 space-y-3">
      {loading && <p className="ops-hint">Cargando avisos…</p>}
      {!loading && items.length === 0 && <p className="ops-hint">Todavía no hay avisos. Los pacientes verán «Sin avisos publicados».</p>}
      {items.map(item => { const state = announcementState(item); return (
        <article className="ops-form-section" key={item.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><strong>{item.title}</strong><p className="ops-hint">{state} · desde {when(item.published_at)}{item.expires_at ? ` · vence ${when(item.expires_at)}` : ''}{item.author ? ` · ${item.author}` : ''}</p></div>
            <div className="flex gap-2">
              <button className="ops-secondary" disabled={busy} type="button" onClick={() => edit(item)}>Editar</button>
              {(state === 'Visible' || state === 'Programado') && <button className="ops-secondary" disabled={busy} type="button"
                onClick={() => { if (window.confirm(`¿Retirar el aviso «${item.title}»? Dejará de mostrarse de inmediato.`)) void run(() => retireAnnouncement(item.id), 'Aviso retirado.') }}>Retirar</button>}
            </div>
          </div>
          <p className="mt-2 whitespace-pre-line">{item.content}</p>
        </article>) })}
    </div>
  </section>
}
