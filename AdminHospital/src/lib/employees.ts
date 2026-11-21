import { isUserFacing } from './userError'
import { supabase } from './supabase'

export interface Employee {
  impact?: { pendingAppointments: number; assignedPatients: number; openEncounters: number }
  id: string
  profileId: string
  employeeCode: string
  active: boolean
  staffVersion: string
  personVersion: string
  givenNames: string
  familyNames: string
  birthDate: string | null
  city: string | null
  phone: string | null
  email: string
  role: 'doctor' | 'receptionist'
  specialties: string[]
}
export interface EmployeeInput {
  requestId: string
  givenNames: string
  familyNames: string
  email: string
  phone: string
  birthDate: string
  city: string
  employeeCode: string
  role: 'doctor' | 'receptionist'
  specialties: string[]
  active: boolean
}
export interface CatalogItem { id: string; name: string }
export interface EmployeeContract { version: string; actions: readonly string[]; features: readonly string[] }
export interface EmployeeCatalogs { specialties: CatalogItem[]; contract?: EmployeeContract }
export interface EmployeeMutationResult { success: boolean; employee?: Employee; staffId?: string; employeeCode?: string; credentials?: { email: string; password: string } }
export interface PendingEmployee { id: string; email: string; createdAt: string; payload: Omit<EmployeeInput, 'requestId'> }

export async function employeeRequest<T>(action: string, data: object = {}): Promise<T> {
  if (!supabase) throw new Error('El sistema no está configurado correctamente. Contacta al administrador.')
  const session = await supabase.auth.getSession()
  if (session.error) throw Object.assign(new Error("Tu sesión venció. Inicia sesión nuevamente."), { code: "AUTH_SESSION_MISSING" })
  if (!session.data.session) throw Object.assign(new Error('Tu sesión venció. Inicia sesión nuevamente para gestionar personal.'), { code: 'AUTH_SESSION_MISSING' })
  const result = await supabase.functions.invoke('manage-employees', { body: { action, ...data }, timeout: 45000 })
  if (result.error) {
    const status = result.error.context?.status
    let code = status ? `HTTP_${status}` : 'NETWORK_ERROR'
    let message = status ? "El servicio de personal no pudo completar la operación. Intenta nuevamente." : 'No hay conexión con el servidor. Comprueba tu conexión; no se confirmó ningún resultado.'
    try {
      const body = await result.error.context.json()
      { const text = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : ""; if (text && isUserFacing(text)) message = text }
      code = body.code || code
      if (body.code === 'OPERATION_NOT_SUPPORTED' || message === 'Operación inválida.') message = 'Esta acción no está disponible en este momento. Contacta al administrador del sistema.'
      if (action === 'create' && message === 'Completa los campos requeridos con valores válidos.') message = 'Algún campo obligatorio no es válido. Revisa el formulario e intenta nuevamente.'
    } catch { /* Network or gateway failure. */ }
    if (status === 401) message = "Tu sesión venció. Inicia sesión nuevamente."
    if (status === 403) message = "Tu cuenta no tiene autorización para esta operación."
    throw Object.assign(new Error(message), { code, status })
  }
  if (result.data?.error) throw new Error(typeof result.data.error === "string" && isUserFacing(result.data.error) ? result.data.error : "El servicio de personal no pudo completar la operación. Intenta nuevamente.")
  return result.data as T
}
