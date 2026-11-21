import { supabase } from './supabase'

export interface DashboardCounts {
  pending: number | null; reviewing: number | null; admissions: number | null
  discharges: number | null; staff: number | null; errors: string[]
}
export async function readDashboardCounts(): Promise<DashboardCounts> {
  if (!supabase) throw new Error('El sistema no está configurado correctamente. Contacta al administrador.')
  const results = await Promise.allSettled([
    supabase.from('appointment_requests').select('id', { count: 'exact', head: true }).eq('status', 'pendiente'),
    supabase.from('appointment_requests').select('id', { count: 'exact', head: true }).eq('status', 'en_revision'),
    supabase.from('hospital_admissions').select('id', { count: 'exact', head: true }).eq('status', 'solicitado'),
    supabase.from('hospital_admissions').select('id', { count: 'exact', head: true }).eq('status', 'alta_medica'),
    supabase.from('staff').select('id', { count: 'exact', head: true }).eq('active', true),
  ])
  const keys = ['pending', 'reviewing', 'admissions', 'discharges', 'staff'] as const
  const labels = ['solicitudes pendientes', 'solicitudes en revisión', 'ingresos pendientes', 'altas pendientes', 'personal activo']
  const data: DashboardCounts = { pending: null, reviewing: null, admissions: null, discharges: null, staff: null, errors: [] }
  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && !result.value.error && result.value.count !== null) data[keys[i]!] = result.value.count
    else data.errors.push(labels[i]!)
  })
  return data
}
