import { useEffect, useRef, useState } from 'react'

export interface InitialCredentials { employeeCode?: string; name: string; email: string; password: string; role: string; active: boolean }

export function EmployeeCredentials({ credentials, onClose }: { credentials: InitialCredentials; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  async function copy() {
    try {
      await navigator.clipboard.writeText(`Empleado: ${credentials.name}${credentials.employeeCode ? `\nCódigo: ${credentials.employeeCode}` : ''}\nCorreo: ${credentials.email}\nContraseña inicial: ${credentials.password}`)
      setMessage('Datos copiados. Compártelos únicamente con el empleado y borra el portapapeles después.')
    } catch { setMessage('No se pudo copiar. Puedes entregar los datos personalmente.') }
  }
  return <dialog ref={dialog} className="employee-credentials" aria-labelledby="employee-created-title" onCancel={onClose} onClose={onClose}>
    <div className="employee-credentials-header"><span aria-hidden="true">✓</span><p>REGISTRO COMPLETADO</p><h2 id="employee-created-title">¡Todo listo para {credentials.name}!</h2><p>Entrega estos datos personalmente al nuevo empleado.</p></div>
    <div className="employee-credentials-body"><p className="employee-credentials-role">{credentials.role} · {credentials.active ? 'Cuenta activa' : 'Cuenta inactiva'}</p>
      {credentials.employeeCode && <p className="employee-credentials-code">Código de empleado <strong>{credentials.employeeCode}</strong></p>}
      <label>Correo para iniciar sesión<input readOnly value={credentials.email} autoComplete="off" /></label>
      <label>Contraseña inicial<div className="employee-credentials-password"><input readOnly type={visible ? 'text' : 'password'} value={credentials.password} autoComplete="off" /><button type="button" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? 'Ocultar' : 'Mostrar'}</button></div></label>
      {!credentials.active && <p className="employee-credentials-note">Activa al empleado desde el directorio para que pueda utilizar su cuenta.</p>}
      <p className="employee-credentials-note">Estos datos se retiran de esta pantalla al cerrar o después de 5 minutos. Recomienda cambiar la contraseña antes de utilizar la cuenta.</p>
      <div className="employee-credentials-actions"><button type="button" onClick={() => void copy()}>Copiar datos de acceso</button><button type="button" onClick={onClose}>Entendido, cerrar</button></div>
      <p role="status">{message}</p>
    </div>
  </dialog>
}
