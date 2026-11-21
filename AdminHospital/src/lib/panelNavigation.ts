export type PanelNoticeTarget =
  | { page: 'Laboratorios'; id: string }
  | { page: 'Recepción'; tab: 'Solicitudes de atención' | 'Hospitalización'; id: string }
  | { page: 'Ambulancia'; requestId: string; unitId?: never }
  | { page: 'Ambulancia'; unitId: number; requestId?: never }

export function panelNoticeTarget(notice: { entity_type: string | null; entity_id: string | null }): PanelNoticeTarget | null {
  const id = notice.entity_id
  if (!id) return null
  if (notice.entity_type === 'ambulances') {
    const unitId = Number(id)
    return Number.isInteger(unitId) && unitId > 0 && unitId <= 32767 ? { page: 'Ambulancia', unitId } : null
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null
  if (notice.entity_type === 'lab_orders') return { page: 'Laboratorios', id }
  if (notice.entity_type === 'appointment_requests') return { page: 'Recepción', tab: 'Solicitudes de atención', id }
  if (notice.entity_type === 'hospital_admissions') return { page: 'Recepción', tab: 'Hospitalización', id }
  if (notice.entity_type === 'ambulance_requests') return { page: 'Ambulancia', requestId: id }
  return null
}
