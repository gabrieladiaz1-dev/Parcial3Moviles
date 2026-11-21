import { useEffect, useRef } from 'react'
import { Icon } from './Icon'
import type { CatalogItem, Employee } from '../lib/employees'

export function EmployeeDetailDialog({ employee, specialties, busy, error, onEdit, onClose }: { employee: Employee; specialties: CatalogItem[]; busy: boolean; error: string; onEdit: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  const name = `${employee.givenNames} ${employee.familyNames}`
  const birthday = employee.birthDate ? employee.birthDate.split('-').reverse().join('/') : 'No registrada'
  return <dialog ref={dialog} className="employee-detail-dialog" aria-labelledby="employee-detail-name" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <header className="employee-detail-cover"><span>FICHA DEL EMPLEADO</span><button type="button" aria-label="Cerrar ficha" title="Cerrar ficha" disabled={busy} onClick={onClose}>×</button></header>
    <div className="employee-detail-identity"><span className="employee-detail-avatar" aria-hidden="true">{`${employee.givenNames.charAt(0)}${employee.familyNames.charAt(0)}`.toLocaleUpperCase()}</span><h2 id="employee-detail-name">{name}</h2><p>Código {employee.employeeCode} · {employee.role === 'doctor' ? 'Doctor' : 'Recepcionista'}</p><span className={`employee-directory-status ${employee.active ? 'is-active' : ''}`}><i />{employee.active ? 'Activo' : 'Inactivo'}</span></div>
    <div className="employee-detail-content">
      <section><h3><Icon name="file" size={18} />Perfil profesional</h3><dl><div><dt>Código de empleado</dt><dd>{employee.employeeCode}</dd></div><div><dt>Cargo</dt><dd>{employee.role === 'doctor' ? 'Doctor' : 'Recepcionista'}</dd></div></dl>{employee.role === 'doctor' && <div className="employee-detail-specialties"><h4>Especialidades</h4><div>{employee.specialties.map(id => <span key={id}>{specialties.find(item => item.id === id)?.name || 'Especialidad no disponible'}</span>)}{!employee.specialties.length && <p>Sin especialidades asignadas.</p>}</div></div>}</section>
      <section><h3><Icon name="mail" size={18} />Datos de contacto</h3><dl><div><dt>Correo electrónico</dt><dd>{employee.email}</dd></div><div><dt>Teléfono</dt><dd>{employee.phone || 'No registrado'}</dd></div></dl></section>
      <section><h3><Icon name="users" size={18} />Datos personales</h3><dl><div><dt>Ciudad o distrito</dt><dd>{employee.city || 'No registrada'}</dd></div><div><dt>Fecha de nacimiento</dt><dd>{birthday}</dd></div></dl></section>
      {error && <p className="employee-dialog-error" role="alert">{error}</p>}
    </div>
    <footer><button type="button" disabled={busy} onClick={onClose}>Cerrar ficha</button><button type="button" disabled={busy} onClick={onEdit}><Icon name="file" size={16} />{busy ? 'Cargando…' : 'Editar datos'}</button></footer>
  </dialog>
}
