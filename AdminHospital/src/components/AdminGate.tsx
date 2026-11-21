import { userMessage } from '../lib/userError'
import { useEffect, useState, type ReactNode } from 'react'
import { readMyAccess } from '../lib/api'

export function AdminGate({ children, onSignOut }: { children: ReactNode; onSignOut: () => Promise<void> }) {
  const [state, setState] = useState({ loading: true, allowed: false, error: '' })
  useEffect(() => {
    let active = true
    async function verify() {
      try {
        const data = await readMyAccess()
        // Active roles are read from public.user_roles, never user metadata.
        const allowed = data.isAdministrator === true || data.roles.some(role => role.code === 'recepcionista') || data.laboratory?.can_view === true
        if (active) setState({ loading: false, allowed, error: '' })
      } catch (error) {
        if (active) setState({ loading: false, allowed: false, error: userMessage(error, 'No se pudieron verificar los permisos en Hospital Moviles.') })
      }
    }
    void verify()
    const timer = window.setInterval(() => { void verify() }, 30000)
    window.addEventListener('focus', verify)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', verify) }
  }, [])
  if (state.loading) return <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] text-sm text-slate-500" role="status">Verificando acceso del personal...</main>
  if (!state.allowed) return <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] p-5"><section className="max-w-md rounded-xl border border-slate-100 bg-white p-6"><h1 className="font-semibold text-[#870b30]">Acceso de personal requerido</h1><p className="mt-3 text-sm text-slate-600" role="alert">{state.error || 'Este panel requiere un rol administrativo, de recepción o una autorización activa de laboratorio.'}</p><button className="mt-5 rounded-md bg-[#800b2c] px-4 py-2 text-sm text-white" onClick={() => void onSignOut()} type="button">Cerrar sesión</button></section></main>
  return children
}
