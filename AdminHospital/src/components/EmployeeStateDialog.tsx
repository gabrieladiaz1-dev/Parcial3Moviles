import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { Employee } from '../lib/employees'

export function EmployeeStateDialog({ employee, busy, error, authControl, onRefresh, onCancel, onConfirm }: { employee: Employee; busy: boolean; error: string; authControl: boolean; onRefresh: () => void; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  const [acknowledged, setAcknowledged] = useState(false)
  const impact = employee.impact
  const affected = Boolean(impact && impact.pendingAppointments + impact.assignedPatients + impact.openEncounters > 0)
  const ready = authControl && (!employee.active || Boolean(impact))
  const action = employee.active ? 'Desactivar' : 'Reactivar'
  return <dialog ref={dialog} className="employee-state-dialog" aria-labelledby="employee-state-title" aria-describedby="employee-state-description" onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}>
    <div className="employee-state-heading"><span><Icon name="lock" size={25} /></span><div><small>ACCESO DEL EMPLEADO</small><h2 id="employee-state-title">{action} cuenta</h2></div></div>
    <div className="employee-state-person"><strong>{employee.givenNames} {employee.familyNames}</strong><span>Código {employee.employeeCode}</span></div>
    <p id="employee-state-description">{employee.active ? 'Se desactivarán sus permisos laborales y se bloquearán nuevos inicios de sesión. Su código, perfil e historial se conservarán.' : 'Se restablecerá su acceso laboral. Los bloqueos independientes de esta sección se conservarán.'}</p>
    {!ready && <p className="employee-dialog-error" role="status">El servicio conectado no confirma el bloqueo de acceso o las asignaciones. Esta acción requiere actualizar el backend; no se realizará ningún cambio.</p>}
    {employee.active && impact && <section className="employee-impact" aria-label="Consecuencias de la desactivación"><h3>{affected ? 'Atención pendiente de organizar' : 'Revisión de asignaciones'}</h3><dl><div><dt>Citas pendientes o en atención</dt><dd>{impact.pendingAppointments}</dd></div><div><dt>Pacientes con asignación vigente</dt><dd>{impact.assignedPatients}</dd></div><div><dt>Consultas abiertas</dt><dd>{impact.openEncounters}</dd></div></dl><p>La desactivación no cancela citas, no reasigna pacientes ni cierra consultas. Coordina la cobertura con otro profesional antes de continuar.</p>{affected && <label><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />Entiendo las consecuencias y he revisado la cobertura de estas asignaciones.</label>}<button type="button" disabled={busy} onClick={onRefresh}>Actualizar asignaciones</button></section>}
    {error && <p className="employee-dialog-error" role="alert">{error}</p>}
    <div className="employee-state-actions"><button autoFocus type="button" disabled={busy} onClick={onCancel}>Cancelar</button><button type="button" disabled={busy || !ready || (employee.active && affected && !acknowledged)} onClick={onConfirm}>{busy ? 'Guardando…' : `${action} empleado`}</button></div>
  </dialog>
}
