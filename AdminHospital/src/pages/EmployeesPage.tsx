import { userMessage } from '../lib/userError'
import { advanceFormOnEnter } from '../lib/formKeyboard'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Panel } from '../components/ui'
import { EmployeeActionButton } from '../components/EmployeeActionButton'
import { EmployeeDetailDialog } from '../components/EmployeeDetailDialog'
import { EmployeeStateDialog } from '../components/EmployeeStateDialog'
import { Icon } from '../components/Icon'
import { employeeUpdatePayload, employeeUpdateMatches } from '../lib/employeeEditing'
import { confirmEmployeeRegistration } from '../lib/employeeRegistration'
import { hospitalDate } from '../lib/planningDates'
import './AdminExperience.css'
import './EmployeesPage.css'
import { EmployeeCity, EmployeeBirthDate, EmployeeTextField, EmployeeSpecialties } from '../components/EmployeeFields'
import { EmployeeCredentials, type InitialCredentials } from '../components/EmployeeCredentials'
import { formatEmployeePhone, validEmployeePhone, validEmployeeBirthDate } from '../../supabase/functions/manage-employees/validation'
import { employeeRequest, type EmployeeMutationResult, type Employee, type EmployeeInput, type EmployeeCatalogs, type PendingEmployee } from '../lib/employees'
import { usePlanningRealtime } from '../lib/usePlanningRealtime'

const inputClass = 'mt-1.5 w-full rounded-md border border-slate-200 bg-[#f8f6f7] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#870b30]/25'
const buttonClass = 'rounded-md bg-[#870b30] px-3 py-2 text-xs font-medium text-white hover:bg-[#6f0827] disabled:cursor-not-allowed disabled:opacity-50'
const secondaryClass = 'rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50'
const emptyForm = (): EmployeeInput => ({ requestId: crypto.randomUUID(), givenNames: '', familyNames: '', email: '', phone: '', birthDate: '', city: '', employeeCode: '', role: 'doctor', specialties: [], active: true })
const roleName = (role: string) => role === 'doctor' ? 'Doctor' : 'Recepcionista'

export function EmployeesPage({ onSchedule }: { onSchedule?: (staffId?: string) => void }) {
  const realtime = usePlanningRealtime()
  const [view, setView] = useState<'register' | 'directory'>('register')
  const [stateEmployee, setStateEmployee] = useState<Employee | null>(null)
  const [stateError, setStateError] = useState('')
  const [editingFromDetail, setEditingFromDetail] = useState(false)
  const [savedStaffId, setSavedStaffId] = useState<string | undefined>()
  const [catalogs, setCatalogs] = useState<EmployeeCatalogs>({ specialties: [] })
  const [employees, setEmployees] = useState<Employee[]>([])
  const [pending, setPending] = useState<PendingEmployee[]>([])
  const [pendingError, setPendingError] = useState('')
  const [confirmingCreation, setConfirmingCreation] = useState(false)
  const creation = useRef<{ requestId: string; result: EmployeeMutationResult } | null>(null)
  const saveLock = useRef(false)
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [offset, setOffset] = useState(0)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [today] = useState(() => hospitalDate())
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<EmployeeInput | null>(emptyForm)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [credentials, setCredentials] = useState<InitialCredentials | null>(null)
  useEffect(() => {
    if (!credentials) return
    const timer = window.setTimeout(() => setCredentials(null), 300000)
    return () => window.clearTimeout(timer)
  }, [credentials])
  const [detail, setDetail] = useState<Employee | null>(null)
  const detailId = detail?.id

  useEffect(() => {
    if (view !== 'directory') return
    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      employeeRequest<{ employees: Employee[]; total: number }>('list', { query: query.trim(), role, status, offset }).then(directory => {
        if (!active) return
        setEmployees(directory.employees); setTotal(directory.total); setLoadError('')
      }).catch((err: unknown) => {
        if (active) { setEmployees([]); setLoadError(userMessage(err, 'No se pudo cargar el personal.')) }
      }).finally(() => { if (active) setLoading(false) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query, role, status, offset, revision, realtime.revision, view])

  useEffect(() => {
    if (view !== 'directory' || !detailId) return
    let active = true
    employeeRequest<Employee>('detail', { id: detailId }).then(employee => {
      if (active) setDetail(current => current?.id === detailId ? employee : current)
    }).catch((err: unknown) => {
      if (active) setError(userMessage(err, 'No se pudo actualizar la ficha del empleado.'))
    })
    return () => { active = false }
  }, [detailId, realtime.revision, view])

  useEffect(() => {
    let active = true
    setCatalogLoading(true)
    employeeRequest<EmployeeCatalogs>('catalogs')
      .then(options => { if (!Array.isArray(options?.specialties)) throw new Error('No se pudieron cargar los datos de registro.'); if (active) { setCatalogs({ ...options, specialties: options.specialties.map(item => ({ ...item, id: String(item.id) })) }); setCatalogError('') } })
      .catch((err: unknown) => { if (active) setCatalogError(userMessage(err, 'No se pudieron cargar los datos de registro.')) })
      .finally(() => { if (active) setCatalogLoading(false) })
    employeeRequest<PendingEmployee[]>('pending').then(unfinished => { if (!Array.isArray(unfinished)) throw new Error('No se pudieron consultar las altas pendientes.'); if (active) { setPending(unfinished); setPendingError('') } }).catch((err: unknown) => { if (active) setPendingError(userMessage(err, 'No se pudieron consultar las altas pendientes.')) })
    return () => { active = false }
  }, [revision])

  useEffect(() => {
    if (!confirmingCreation) return
    const timer = window.setTimeout(() => { if (creation.current) delete creation.current.result.credentials }, 300000)
    return () => window.clearTimeout(timer)
  }, [confirmingCreation])

  function change<K extends keyof EmployeeInput>(key: K, value: EmployeeInput[K]) {
    setForm(current => current ? { ...current, [key]: value } : current)
  }
  function openRegistration() { if (!form || editing) setForm(emptyForm()); setEditing(null); setDetail(null); setNotice(''); setError(''); setView('register') }
  function openDirectory() { setView('directory'); setDetail(null); setError('') }
  function applyEmployee(employee: Employee) {
    setEmployees(current => current.map(item => item.id === employee.id ? employee : item))
    setDetail(current => current?.id === employee.id ? employee : current)
  }
  async function openEdit(employee: Employee, fromDetail = false) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const current = await employeeRequest<Employee>('detail', { id: employee.id })
      setView('register'); setEditing(current); setEditingFromDetail(fromDetail); setDetail(null)
      setForm({ ...emptyForm(), ...current, city: current.city ?? '', phone: formatEmployeePhone(current.phone ?? ''), birthDate: current.birthDate ?? '' })
    } catch (err) { setError(userMessage(err, 'No se pudo cargar el perfil para editar.')) }
    finally { setBusy(false) }
  }
  function nextField(event: KeyboardEvent<HTMLFormElement>) { advanceFormOnEnter(event) }
  async function save() {
    if (!form || busy || saveLock.current) return
    if (!form.givenNames.trim() || !form.familyNames.trim() || (form.role === 'doctor' && !form.specialties.length)) { setError('Completa los nombres, apellidos y, para doctores, al menos una especialidad.'); return }
    if (!validEmployeePhone(form.phone)) { setError('El teléfono debe tener 8 dígitos y comenzar con 2, 5, 6 o 7.'); return }
    if (!validEmployeeBirthDate(form.birthDate, today)) { setError('Escribe una fecha de nacimiento real entre 01/01/1900 y hoy, con formato DD/MM/AAAA.'); return }
    saveLock.current = true; setBusy(true); setError(''); setNotice('')
    let updateReadbackFailed = false
    try {
      let result: EmployeeMutationResult | undefined
      if (editing) {
        result = await employeeRequest<EmployeeMutationResult>('update', employeeUpdatePayload(editing, form))
      } else if (creation.current?.requestId === form.requestId) {
        result = creation.current.result
      } else if (pending.some(p => p.id === form.requestId)) {
        result = await employeeRequest('recover', { requestId: form.requestId, values: form })
      } else {
        result = await employeeRequest('create', { ...form, employeeCode: undefined })
      }
      if (!editing) {
        if (result?.success !== true) throw new Error('El servicio no confirmó el alta. Conservamos el formulario para revisar el resultado.')
        creation.current = { requestId: form.requestId, result }
        setConfirmingCreation(true)
        const registered = await confirmEmployeeRegistration(result, form, employeeRequest)
        result = { ...result, staffId: registered.id, employeeCode: registered.employeeCode }
        creation.current = null; setConfirmingCreation(false)
      }
      if (editing) {
        // Old deployed versions return success only; preserve compatibility with a read-back.
        updateReadbackFailed = !result?.employee
        const confirmed = result?.employee ?? await employeeRequest<Employee>('detail', { id: editing.id })
        updateReadbackFailed = false
        if (!employeeUpdateMatches(confirmed, editing, form)) throw new Error('El servicio no confirmó todos los cambios solicitados. Los datos del formulario se conservaron; actualiza la ficha antes de volver a guardar.')
        applyEmployee(confirmed)
        if (editingFromDetail) setDetail(confirmed)
      }
      setNotice(editing ? 'Datos del empleado actualizados.' : `Empleado registrado correctamente${result?.employeeCode ? ` con código ${result.employeeCode}` : ''}.`)
      setSavedStaffId(editing?.id ?? result?.staffId)
      if (result?.credentials) setCredentials({ ...result.credentials, employeeCode: result.employeeCode, name: `${form.givenNames.trim()} ${form.familyNames.trim()}`, role: roleName(form.role), active: form.active })
      setForm(emptyForm()); setEditing(null); setView(editing ? 'directory' : 'register')
    } catch (err) {
      setError(updateReadbackFailed ? 'El servicio recibió la edición, pero no se pudo verificar el resultado. Abre el directorio y pulsa Actualizar antes de editar nuevamente.' : userMessage(err, 'No se pudo guardar el empleado.'))
    } finally { saveLock.current = false; setBusy(false); setRevision(r => r + 1) }
  }
  async function run(action: 'recover' | 'detail', data: object) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await employeeRequest<Employee & { credentials?: { email: string; password: string }; employeeCode?: string; employee?: { givenNames: string; familyNames: string; role: string; active: boolean } }>(action, data)
      if (result.credentials && result.employee) setCredentials({ ...result.credentials, employeeCode: result.employeeCode, name: `${result.employee.givenNames} ${result.employee.familyNames}`, role: roleName(result.employee.role), active: result.employee.active })
      if (action === 'detail') { setDetail(result) }
      else { setNotice('Alta completada correctamente.'); setRevision(r => r + 1) }
    } catch (err) { setError(userMessage(err, 'No se pudo completar la operación.')) }
    finally { setBusy(false) }
  }

  async function openEmployeeState(employee: Employee) {
    if (busy) return
    setBusy(true); setError(''); setStateError('')
    try { setStateEmployee(await employeeRequest<Employee>('detail', { id: employee.id })) }
    catch (err) { setError(userMessage(err, 'No se pudieron consultar las asignaciones del empleado.')) }
    finally { setBusy(false) }
  }

  async function changeEmployeeState() {
    if (!stateEmployee || busy) return
    if (!canChangeState || (stateEmployee.active && !stateEmployee.impact)) { setStateError('Es necesario actualizar el servicio para confirmar el bloqueo de acceso y revisar las asignaciones. No se realizó ningún cambio.'); return }
    setBusy(true); setStateError('')
    try {
      const result = await employeeRequest<EmployeeMutationResult>('state', { id: stateEmployee.id, active: !stateEmployee.active, staffVersion: stateEmployee.staffVersion, impactAcknowledged: true, impact: stateEmployee.impact })
      const confirmed = result.employee ?? await employeeRequest<Employee>('detail', { id: stateEmployee.id })
      if (confirmed.id !== stateEmployee.id || confirmed.active !== !stateEmployee.active) throw new Error('El servidor no confirmó el cambio de estado. Actualiza la ficha antes de volver a intentarlo.')
      applyEmployee(confirmed)
      setNotice(`${confirmed.givenNames} ${confirmed.familyNames}: cuenta ${confirmed.active ? 'reactivada' : 'desactivada'}.`)
      setSavedStaffId(undefined); setStateEmployee(null); setRevision(current => current + 1)
    } catch (err) { setStateError(userMessage(err, 'No se pudo actualizar el acceso del empleado.')) }
    finally { setBusy(false) }
  }

  const canChangeState = Boolean(catalogs.contract?.actions?.includes('state') && catalogs.contract?.features?.includes('auth-state-control'))

  const registrationSections = form ? [
    { id: 'employee-personal', title: 'Datos personales', detail: 'Conoce a tu nuevo integrante', complete: Boolean(form.givenNames.trim() && form.familyNames.trim()) },
    { id: 'employee-work', title: 'Perfil profesional', detail: 'Su lugar dentro del hospital', complete: Boolean(form.role !== 'doctor' || form.specialties.length) },
    { id: 'employee-access', title: 'Contacto y acceso', detail: 'Todo listo para conectar', complete: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) && validEmployeePhone(form.phone) },
  ] : []

  return <div className="employees-page space-y-4">
    {detail && view === 'directory' && <EmployeeDetailDialog employee={detail} specialties={catalogs.specialties} busy={busy} error={error} onClose={() => { setDetail(null); setError('') }} onEdit={() => void openEdit(detail, true)} />}
    {stateEmployee && <EmployeeStateDialog key={`${stateEmployee.id}:${JSON.stringify(stateEmployee.impact)}`} employee={stateEmployee} busy={busy} error={stateError} authControl={canChangeState} onRefresh={() => void openEmployeeState(stateEmployee)} onCancel={() => setStateEmployee(null)} onConfirm={() => void changeEmployeeState()} />}
    {credentials && <EmployeeCredentials credentials={credentials} onClose={() => setCredentials(null)} />}
    <div className="experience-heading rounded-xl border border-slate-200 bg-white p-5">
      <div><span className="experience-eyebrow">EQUIPO DEL HOSPITAL</span><h2>{view === 'register' ? 'Registrar empleado' : 'Personal hospitalario'}</h2><p>{view === 'register' ? 'Completa el perfil de quien se une al equipo del hospital.' : 'Consulta, organiza y gestiona a los integrantes de tu equipo.'}</p></div>
      <button className={`${buttonClass} employee-view-toggle`} disabled={busy} onClick={view === 'register' ? openDirectory : openRegistration} type="button"><Icon name={view === 'register' ? 'users' : 'plus'} size={18} />{view === 'register' ? 'Visualizar empleados' : 'Registrar empleado'}</button>
    </div>
    {error && view === 'directory' && <p className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800" role="alert">{error}</p>}
    {catalogError && <p className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800" role="alert">{catalogError} <button type="button" className="underline" onClick={() => setRevision(current => current + 1)}>Actualizar opciones</button></p>}
    {view === 'directory' && loadError && <p className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800" role="alert">{loadError}</p>}
    {view === 'directory' && pendingError && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900" role="alert">No se pudo consultar la lista de altas pendientes: {pendingError} <button type="button" disabled={busy} className="underline" onClick={() => setRevision(r => r + 1)}>Reintentar consulta</button></p>}
    {notice && <p className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800" role="status">{notice}{onSchedule && savedStaffId && <button type="button" className={`${secondaryClass} ml-3`} onClick={() => onSchedule(savedStaffId)}>Asignar horario laboral</button>}</p>}
    {view === 'register' && form && <section className="employee-registration" aria-labelledby="employee-registration-title">
      <header className="employee-registration-hero">
        <div className="employee-registration-emblem" aria-hidden="true"><Icon name="users" size={31} /><span><Icon name="plus" size={12} /></span></div>
        <div className="employee-registration-intro"><span className="employee-registration-eyebrow">PERSONAS QUE HACEN LA DIFERENCIA</span><h2 id="employee-registration-title">{editing ? 'Actualiza su perfil' : 'Un nuevo talento para tu equipo'}</h2><p>{editing ? 'Mantén su información al día y su perfil bien organizado.' : 'Dale la bienvenida. Nosotros te ayudamos a preparar su perfil y acceso.'}</p></div>
        <span className="employee-registration-label"><Icon name="patient" size={16} /> Hospital Móviles</span>
      </header>
      <nav className="employee-registration-steps" aria-label="Secciones del formulario">{registrationSections.map((section, index) => <a href={`#${section.id}`} key={section.id} className={section.complete ? 'is-complete' : ''}><span className="employee-step-number">{section.complete ? <Icon name="check" size={17} /> : `0${index + 1}`}</span><span><strong>{section.title}</strong><small>{section.detail}</small></span><Icon name="chevron" size={15} /></a>)}</nav>
      <form key={form.requestId} onSubmit={event => event.preventDefault()} onKeyDown={nextField} className="employee-registration-form">
        <div className="employee-registration-body">
        <div className="employee-registration-fields">
        <fieldset id="employee-personal" disabled={busy || catalogLoading || confirmingCreation} className="employee-form-section"><legend><span className="employee-section-icon"><Icon name="users" size={20} /></span><span><small>ACERCA DEL EMPLEADO</small>Datos personales</span><span className="employee-section-number">01</span></legend><p>Escribe los datos del empleado como aparecen en su documento.</p><div className="employee-form-grid">
          <EmployeeTextField label="Nombres" symbol="person" placeholder="Escribe sus nombres" autoComplete="given-name" maxLength={100} required value={form.givenNames} onChange={e => change('givenNames', e.target.value)} />
          <EmployeeTextField label="Apellidos" symbol="person" placeholder="Escribe sus apellidos" autoComplete="family-name" maxLength={100} required value={form.familyNames} onChange={e => change('familyNames', e.target.value)} />
          <div className="employee-field"><span className="employee-field-label">Fecha de nacimiento<small>Opcional</small></span><EmployeeBirthDate className={inputClass} today={today} value={form.birthDate} onChange={value => change('birthDate', value)} /></div>
          <div className="employee-field"><span className="employee-field-label">Ciudad o distrito<small>Opcional</small></span><EmployeeCity className={inputClass} value={form.city} onChange={value => change('city', value)} /></div>
        </div></fieldset>
        <fieldset id="employee-work" disabled={busy || catalogLoading || confirmingCreation} className="employee-form-section"><legend><span className="employee-section-icon"><Icon name="file" size={20} /></span><span><small>SU PERFIL EN EL HOSPITAL</small>Datos laborales</span><span className="employee-section-number">02</span></legend><p>Selecciona el tipo de empleado. Los campos profesionales se adaptan al cargo.</p><div className="employee-role-options" role="group" aria-label="Cargo del empleado">{([{ value: 'doctor', title: 'Doctor', description: 'Atención médica y especialidades', icon: 'activity' }, { value: 'receptionist', title: 'Recepcionista', description: 'Recepción y atención al paciente', icon: 'users' }] as const).map(option => <label key={option.value} className={`employee-role-option ${form.role === option.value ? 'is-selected' : ''}`}><input type="radio" name="employee-role" value={option.value} checked={form.role === option.value} disabled={Boolean(editing)} onChange={() => { change('role', option.value); change('specialties', []) }} /><span className="employee-role-icon"><Icon name={option.icon} size={23} /></span><span><strong>{option.title}</strong><small>{option.description}</small></span><span className="employee-role-check" aria-hidden="true">{form.role === option.value && <Icon name="check" size={13} />}</span></label>)}</div>
          {editing && <p className="employee-hint">El cargo se conserva al editar los datos.</p>}
          <div className="employee-form-grid employee-work-details">
            <div className="employee-code-assignment"><span className="employee-field-label">Código de empleado</span><div><span className="employee-code-icon"><Icon name="file" size={20} /></span><strong>{editing ? form.employeeCode : 'Asignación automática'}</strong><span className="employee-code-badge">{editing ? 'Asignado' : '001 → 999'}</span></div><small>{editing ? 'Este código identifica al empleado y se conserva.' : 'Se asignará el siguiente número disponible al guardar.'}</small></div>
            {!editing && <label className="employee-activation"><input type="checkbox" className="accent-[#870b30]" checked={form.active} onChange={e => change('active', e.target.checked)} /><span><strong>Activar al registrar</strong><small>Permitir el acceso a su cuenta.</small></span><span className="employee-activation-indicator" aria-hidden="true" /></label>}
          </div>
          {form.role === 'doctor' && <EmployeeSpecialties options={catalogs.specialties} selected={form.specialties} onChange={value => change('specialties', value)} />}
        </fieldset>
        <fieldset id="employee-access" disabled={busy || catalogLoading || confirmingCreation} className="employee-form-section"><legend><span className="employee-section-icon"><Icon name="lock" size={20} /></span><span><small>SIEMPRE EN CONTACTO</small>Contacto y acceso</span><span className="employee-section-number">03</span></legend><p>El correo se utiliza para iniciar sesión en la aplicación autorizada del empleado.</p><div className="employee-form-grid">
          <EmployeeTextField label="Correo electrónico" symbol="email" hint="Será su usuario para iniciar sesión." type="email" placeholder="nombre@correo.com" autoComplete="off" maxLength={254} required disabled={Boolean(editing) || pending.some(p => p.id === form.requestId)} value={form.email} onChange={e => change('email', e.target.value)} />
          <EmployeeTextField label="Teléfono" symbol="phone" hint="8 dígitos. El guion se agrega automáticamente." type="tel" autoComplete="tel" inputMode="numeric" pattern="[2567][0-9]{3}-[0-9]{4}" title="8 dígitos; inicia con 2, 5, 6 o 7. Ejemplo: 7777-7777" placeholder="7777-7777" required value={form.phone} onChange={e => change('phone', formatEmployeePhone(e.target.value))} />
          {!editing && <div className="employee-access-note"><span className="employee-access-icon"><Icon name="lock" size={19} /></span><div><strong>Sus datos de acceso, listos al finalizar</strong><p>Al registrar verás el correo y la contraseña inicial para entregárselos.</p></div></div>}
        </div></fieldset>
        </div>
        <aside className="employee-registration-sidebar" aria-label="Vista previa y ayuda de registro">
        <section className="employee-review"><span className="employee-preview-eyebrow">VISTA PREVIA DEL PERFIL</span><div className="employee-profile-preview"><div className="employee-profile-cover"><Icon name="patient" size={23} /><span>HOSPITAL MÓVILES</span></div><div className="employee-profile-avatar" aria-hidden="true">{form.givenNames.trim() || form.familyNames.trim() ? `${form.givenNames.trim().charAt(0)}${form.familyNames.trim().charAt(0)}`.toLocaleUpperCase() : <Icon name="users" size={30} />}</div><h3>{`${form.givenNames} ${form.familyNames}`.trim() || 'Nombre del empleado'}</h3><p>{roleName(form.role)}</p><span className={`employee-profile-status ${form.active ? 'is-active' : ''}`}><i />{form.active ? 'Activo al registrar' : 'Cuenta inactiva'}</span></div><h3 className="employee-summary-heading"><Icon name="file" size={17} />Resumen del registro</h3><dl>{[['Código', editing ? form.employeeCode : 'Automático al registrar'], ['Correo', form.email], ['Teléfono', form.phone], ...(form.role === 'doctor' ? [['Especialidades', catalogs.specialties.filter(s => form.specialties.includes(s.id)).map(s => s.name).join(', ')]] : [])].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Pendiente de completar'}</dd></div>)}</dl><p>Comprueba que los datos sean correctos. {editing ? 'Al guardar se te pedirá confirmar los cambios.' : 'Pulsa Registrar empleado cuando todo esté listo.'}</p></section>
        </aside>
        </div>
        <div className="employee-registration-footer">{catalogLoading && <p className="employee-save-status" role="status">Cargando opciones de registro. Espera un momento.</p>}{catalogError && <p className="employee-save-error" role="alert">{catalogError} <button type="button" disabled={busy} onClick={() => setRevision(r => r + 1)}>Volver a cargar opciones</button></p>}{confirmingCreation && <p className="employee-save-status" role="status">El servicio recibió el alta. Pulsa verificar para confirmar su ficha sin registrar otra cuenta.</p>}{error && <p className="employee-save-error" role="alert">{error}</p>}<div className="employee-footer-message"><span><Icon name="file" size={20} /></span><div><strong>{editing ? 'Guardar los cambios del perfil' : 'Crear perfil de empleado'}</strong><p>Los campos con <b>*</b> son obligatorios.</p></div></div><div className="employee-footer-actions"><button className={`${secondaryClass} px-5 py-3`} disabled={busy} type="button" onClick={() => { creation.current = null; setConfirmingCreation(false); setForm(emptyForm()); setEditing(null); openDirectory() }}>Cancelar</button><button className={`${buttonClass} px-5 py-3`} disabled={busy || catalogLoading} type="button" onClick={event => { if (event.currentTarget.form?.reportValidity()) void save(); else setError('Revisa los campos obligatorios y el formato de los datos marcados antes de guardar.') }}>{busy ? 'Guardando, espera un momento…' : catalogLoading ? 'Cargando opciones…' : confirmingCreation ? 'Verificar registro guardado' : editing ? 'Confirmar y guardar cambios' : 'Registrar empleado'}</button></div></div>
      </form>
    </section>}
    {view === 'directory' && <section className="employee-directory-panel" aria-labelledby="employee-directory-title">
      <header className="employee-directory-heading"><span className="employee-directory-emblem"><Icon name="users" size={25} /></span><div><small>DIRECTORIO DEL HOSPITAL</small><h2 id="employee-directory-title">Empleados registrados</h2><p>Todos los perfiles de tu equipo, en un solo lugar.</p></div><span className="employee-directory-total"><strong>{total}</strong>{query || role || status ? 'coincidencias' : 'empleados'}</span></header>
      <p className="employee-contract-notice" role="status"><Icon name="activity" size={17} />{realtime.connected ? 'Directorio sincronizado en tiempo real.' : 'Reconectando; se actualizará automáticamente al recuperar la conexión.'}</p>
      {!catalogLoading && !canChangeState && <p className="employee-contract-notice" role="status"><Icon name="help" size={17} />La conexión aún no confirma el bloqueo de acceso al desactivar. Ver ficha y Editar están disponibles; actualizar el servicio habilitará la gestión completa de acceso.</p>}
      <div className="employee-directory-filters"><label className="employee-directory-search"><span>Buscar empleado</span><div><Icon name="search" size={19} /><input placeholder="Nombre, correo o código…" value={query} onChange={e => { setQuery(e.target.value); setOffset(0) }} /></div></label>
        <label>Cargo<select value={role} onChange={e => { setRole(e.target.value); setOffset(0) }}><option value="">Todos los cargos</option><option value="doctor">Doctores</option><option value="receptionist">Recepcionistas</option></select></label>
        <label>Estado<select value={status} onChange={e => { setStatus(e.target.value); setOffset(0) }}><option value="">Todos los estados</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></label>
        {(query || role || status) && <button type="button" className="employee-clear-filters" onClick={() => { setQuery(''); setRole(''); setStatus(''); setOffset(0) }}>Limpiar filtros</button>}
      </div>
      {loading ? <div className="employee-directory-empty" role="status"><Icon name="users" size={30} /><p>Cargando el equipo del hospital…</p></div> : <div className="employee-directory-table-wrap"><table className="employee-directory"><caption className="sr-only">Directorio de empleados, cargos, contacto y acciones</caption><thead><tr>{['Empleado', 'Perfil profesional', 'Contacto', 'Estado', 'Gestionar'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{employees.map(employee => <tr key={employee.id}>
          <td data-label="Empleado"><div className="employee-directory-person"><span className="employee-directory-avatar" aria-hidden="true">{`${employee.givenNames.charAt(0)}${employee.familyNames.charAt(0)}`.toLocaleUpperCase()}</span><div><strong>{employee.givenNames} {employee.familyNames}</strong><span className="employee-directory-code">Código {employee.employeeCode}</span></div></div></td>
          <td data-label="Perfil profesional"><span className={`employee-directory-role ${employee.role}`}><Icon name={employee.role === 'doctor' ? 'patient' : 'users'} size={14} />{roleName(employee.role)}</span>{employee.role === 'doctor' && <div className="employee-directory-specialties">{catalogs.specialties.filter(specialty => employee.specialties.includes(specialty.id)).map(specialty => <span key={specialty.id}>{specialty.name}</span>)}{!employee.specialties.length && <small>Sin especialidades asignadas</small>}</div>}</td>
          <td data-label="Contacto"><div className="employee-directory-contact"><span><Icon name="mail" size={14} />{employee.email}</span><small>{employee.phone || 'Sin teléfono registrado'}</small></div></td>
          <td data-label="Estado"><span className={`employee-directory-status ${employee.active ? 'is-active' : ''}`}><i />{employee.active ? 'Activo' : 'Inactivo'}</span></td>
          <td data-label="Gestionar"><div className="employee-directory-actions" role="group" aria-label={`Acciones de ${employee.givenNames} ${employee.familyNames}`}><EmployeeActionButton action="view" label="Ver ficha" disabled={busy} onClick={() => void run('detail', { id: employee.id })} /><EmployeeActionButton action="edit" label="Editar empleado" disabled={busy} onClick={() => void openEdit(employee)} /><EmployeeActionButton action={employee.active ? 'disable' : 'enable'} label={employee.active ? 'Desactivar empleado' : 'Reactivar empleado'} disabled={busy} onClick={() => void openEmployeeState(employee)} /></div></td>
        </tr>)}</tbody></table>{!employees.length && <div className="employee-directory-empty"><Icon name="search" size={30} /><h3>{query || role || status ? 'No hay coincidencias' : 'Tu equipo empieza aquí'}</h3><p>{query || role || status ? 'Prueba con otro nombre o ajusta los filtros.' : 'Los empleados que registres aparecerán en este directorio.'}</p></div>}</div>}
      <footer className="employee-directory-pagination"><span>{total ? `${Math.min(offset + 1, total)}–${Math.min(offset + employees.length, total)} de ${total} empleados` : '0 empleados'} · 50 por página</span><div><button className={secondaryClass} disabled={loading || busy || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))} type="button">Anterior</button><button className={secondaryClass} disabled={loading || busy} onClick={() => setRevision(value => value + 1)} type="button">Actualizar</button><button className={secondaryClass} disabled={loading || busy || offset + 50 >= total} onClick={() => setOffset(value => value + 50)} type="button">Siguiente</button></div></footer>
    </section>}
    {view === 'directory' && pending.length > 0 && <Panel title="Altas pendientes de completar" subtitle="Estas solicitudes todavía no se confirmaron. Las cuentas pendientes no tienen permisos hospitalarios."><ul className="space-y-3">{pending.map(p => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-50 pb-2 text-xs"><span className="text-slate-600">{p.email}</span><div className="flex gap-2"><button className={secondaryClass} disabled={busy} onClick={() => { setView('register'); setDetail(null); setEditing(null); setForm({ ...p.payload, phone: formatEmployeePhone(p.payload.phone), requestId: p.id }); setNotice('Corrige los datos y guarda para reanudar el alta sin crear otra cuenta.'); setError('') }} type="button">Revisar solicitud</button><button className={buttonClass} disabled={busy} onClick={() => void run('recover',{ requestId:p.id })} type="button">Reanudar alta</button></div></li>)}</ul></Panel>}
  </div>
}
