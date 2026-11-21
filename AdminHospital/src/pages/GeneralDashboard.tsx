import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { readDashboardCounts, type DashboardCounts } from '../lib/dashboard'
import { bedDisplayState, readHospitalInventory, type HospitalInventory } from '../lib/hospitalization'
import { loadAgenda, localDate, type ReceptionAppointment } from '../lib/reception'
import type { Page, IconName } from '../types'
import type { ReceptionTab } from './ReceptionPage'
import './GeneralDashboard.css'

interface DashboardData { counts: DashboardCounts | null; inventory: HospitalInventory | null; agenda: ReceptionAppointment[] | null; errors: string[]; updatedAt: Date }
const time = (date: string | Date) => new Date(date).toLocaleTimeString('es-SV', { timeZone: 'America/El_Salvador', hour: '2-digit', minute: '2-digit' })
const statuses: Record<string, string> = { programada: 'Programada', confirmada: 'Confirmada', en_atencion: 'En atención', completada: 'Completada', cancelada: 'Cancelada', no_asistio: 'No asistió' }

export function GeneralDashboard({ onNavigate, onOpenReception }: { onNavigate: (page: Page) => void; onOpenReception: (tab: ReceptionTab) => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0)
  const today = localDate()
  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.allSettled([readDashboardCounts(), readHospitalInventory(), loadAgenda(today)]).then(([counts, inventory, agenda]) => {
      if (!active) return
      const errors: string[] = []
      if (counts.status === 'rejected') errors.push('indicadores de recepción y personal')
      else errors.push(...counts.value.errors)
      if (inventory.status === 'rejected') errors.push('ocupación de camas')
      if (agenda.status === 'rejected') errors.push('agenda del día')
      setData({ counts: counts.status === 'fulfilled' ? counts.value : null, inventory: inventory.status === 'fulfilled' ? inventory.value : null, agenda: agenda.status === 'fulfilled' ? agenda.value : null, errors, updatedAt: new Date() })
      setLoading(false)
    })
    return () => { active = false }
  }, [revision, today])
  const counts = data?.counts
  const inventory = data?.inventory
  const bedCount = (state: string) => inventory ? inventory.beds.filter(b => bedDisplayState(b, inventory.rooms.find(r => r.id === b.room_id)) === state).length : null
  const available = bedCount('disponible'); const occupied = bedCount('ocupada'); const cleaning = bedCount('limpieza')
  const totalBeds = inventory?.beds.length ?? 0
  const occupancy = inventory && totalBeds ? Math.round(((occupied ?? 0) / totalBeds) * 100) : 0
  const metrics: { label: string; value: number | null | undefined; detail: string; icon: IconName; tone: string; action: () => void }[] = [
    { label: 'Solicitudes pendientes', value: counts?.pending, detail: 'Pacientes que esperan revisión', icon: 'file', tone: 'wine', action: () => onOpenReception('Solicitudes de atención') },
    { label: 'Ingresos por gestionar', value: counts?.admissions, detail: 'Solicitudes del médico pendientes', icon: 'patient', tone: 'amber', action: () => onOpenReception('Hospitalización') },
    { label: 'Camas disponibles', value: available, detail: 'Listas para recibir pacientes', icon: 'bed', tone: 'green', action: () => onNavigate('Habitaciones y Camas') },
    { label: 'Altas pendientes de salida', value: counts?.discharges, detail: 'Con autorización médica registrada', icon: 'check', tone: 'blue', action: () => onOpenReception('Hospitalización') },
  ]
  const actions: { title: string; detail: string; icon: IconName; action: () => void }[] = [
    { title: 'Gestionar recepción', detail: 'Solicitudes, pacientes y citas', icon: 'patient', action: () => onOpenReception('Solicitudes de atención') },
    { title: 'Personal hospitalario', detail: 'Doctores y recepcionistas', icon: 'users', action: () => onNavigate('Personal hospitalario') },
    { title: 'Horarios y consultorios', detail: 'Jornadas y asignaciones médicas', icon: 'clock', action: () => onNavigate('Horarios y turnos') },
    { title: 'Hospitalización', detail: 'Ingresos, camas y salidas', icon: 'bed', action: () => onOpenReception('Hospitalización') },
  ]
  const appointments = data?.agenda ?? []
  return <div className="admin-dashboard">
    <section className="dashboard-welcome"><div><span className="dashboard-eyebrow">HOSPITAL MÓVILES · ADMINISTRACIÓN</span><h2>Bienvenido a tu panel.</h2><p>Una vista clara de lo que necesita atención y de la operación del hospital.</p><div className="dashboard-date"><Icon name="calendar" size={15} />{new Date(`${today}T12:00:00-06:00`).toLocaleDateString('es-SV', { timeZone: 'America/El_Salvador', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div></div><div className="dashboard-welcome-art" aria-hidden="true"><span /><span /><Icon name="plus" size={54} /></div></section>
    <div className="dashboard-section-heading"><div><h3>El hospital de un vistazo</h3><p>{loading ? 'Consultando la información…' : `Última consulta a las ${time(data!.updatedAt)}`}</p></div><button className="dashboard-secondary" disabled={loading} onClick={() => setRevision(v => v + 1)}><Icon name="clock" size={15} />{loading ? 'Actualizando…' : 'Actualizar'}</button></div>
    {!!data?.errors.length && <div className="dashboard-error" role="alert">No se pudieron consultar: {data.errors.join(', ')}. Los indicadores sin datos aparecen con «—». Usa Actualizar para reintentar.</div>}
    {loading && <p className="sr-only" role="status">Actualizando los indicadores del hospital.</p>}
    <div className="dashboard-metrics" aria-busy={loading}>{metrics.map(m => <button key={m.label} onClick={m.action} className={`dashboard-metric ${m.tone}`}><div className="dashboard-metric-top"><span className="dashboard-icon"><Icon name={m.icon} size={22} /></span><Icon name="arrowRight" size={16} /></div><span className="dashboard-metric-label">{m.label}</span><strong>{loading && !data ? '—' : m.value ?? '—'}</strong><small>{m.detail}</small></button>)}</div>
    <section className="dashboard-quick-section"><div className="dashboard-section-heading"><div><h3>¿Qué necesitas hacer?</h3><p>Entra directamente al área que vas a gestionar.</p></div></div><div className="dashboard-quick-actions">{actions.map(a => <button key={a.title} onClick={a.action}><span className="dashboard-icon"><Icon name={a.icon} size={23} /></span><div><strong>{a.title}</strong><small>{a.detail}</small></div><Icon name="chevron" size={17} /></button>)}</div></section>
    <div className="dashboard-detail-grid">
      <section className="dashboard-panel"><div className="dashboard-section-heading"><div><h3>Estado de las camas</h3><p>Inventario registrado del hospital</p></div><Icon name="bed" size={21} /></div>{!inventory ? <div className="dashboard-empty"><Icon name="bed" size={30} /><p>{loading ? 'Consultando ocupación…' : 'No se pudo consultar el inventario.'}</p></div> : <><div className="dashboard-occupancy"><div className="dashboard-donut" role="img" aria-label={`${occupancy}% de camas registradas ocupadas`} style={{ background: `conic-gradient(#870b30 ${occupancy}%, #f0e7eb 0)` }}><div><strong>{occupancy}%</strong><small>ocupación</small></div></div><div><strong>{occupied}<span> / {totalBeds}</span></strong><p>camas registradas ocupadas</p><small>{inventory.rooms.length} habitaciones en el inventario</small></div></div><div className="dashboard-bed-legend">{[['Disponibles', available, 'green'], ['Ocupadas', occupied, 'wine'], ['En limpieza', cleaning, 'amber'], ['Mantenimiento', bedCount('mantenimiento'), 'amber'], ['Fuera de servicio', bedCount('fuera_servicio'), 'gray']].map(([label, value, tone]) => <div key={label}><span><i className={String(tone)} />{label}</span><strong>{value}</strong></div>)}</div>{!totalBeds && <p className="dashboard-note">Registra las habitaciones y camas reales para consultar su ocupación.</p>}</>}<button className="dashboard-text-button" onClick={() => onNavigate('Habitaciones y Camas')}>Ver habitaciones y camas <Icon name="arrowRight" size={16} /></button></section>
      <section className="dashboard-panel"><div className="dashboard-section-heading"><div><h3>Agenda de hoy</h3><p>Horarios de El Salvador</p></div><span className="dashboard-pill">{data?.agenda ? `${appointments.length}${appointments.length === 200 ? '+' : ''} citas` : '—'}</span></div>{!data?.agenda ? <div className="dashboard-empty"><Icon name="calendar" size={30} /><p>{loading ? 'Consultando la agenda…' : 'No se pudo consultar la agenda.'}</p></div> : appointments.length === 0 ? <div className="dashboard-empty"><Icon name="calendar" size={32} /><h4>Hoy no hay citas registradas</h4><p>Las citas programadas desde Recepción aparecerán aquí.</p></div> : <div className="dashboard-agenda">{appointments.slice(0, 5).map(a => <div key={a.id}><time>{time(a.starts_at)}</time><div><strong>{a.patient_name || 'Paciente registrado'}</strong><small>{a.doctor_name || 'Médico asignado'} · Consultorio {a.room_code || 'asignado'}</small></div><span className={`dashboard-agenda-state ${a.status === 'cancelada' ? 'cancelled' : ''}`}>{statuses[a.status] ?? a.status}</span></div>)}</div>}<button className="dashboard-text-button" onClick={() => onOpenReception('Agenda de citas')}>Consultar agenda completa <Icon name="arrowRight" size={16} /></button></section>
    </div>
    <section className="dashboard-follow-up"><span className="dashboard-icon"><Icon name="activity" size={22} /></span><div><strong>Seguimiento de la operación</strong><p><b>{counts?.reviewing ?? '—'}</b> solicitudes en revisión <span>·</span> <b>{counts?.staff ?? '—'}</b> empleados activos registrados</p></div><button className="dashboard-secondary" onClick={() => onOpenReception('Solicitudes de atención')}>Ir a Recepción <Icon name="arrowRight" size={16} /></button></section>
  </div>
}
