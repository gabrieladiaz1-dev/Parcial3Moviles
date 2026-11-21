export type RequestOrder = 'oldest' | 'newest'
export function orderAttentionRequests<T extends { id: string; status: string; created_at: string }>(rows: T[], order: RequestOrder = 'oldest'): T[] {
  const priority: Record<string, number> = { pendiente: 0, en_revision: 1, agendada: 2, rechazada: 3, cancelada: 4 }
  return [...rows].sort((a, b) => (priority[a.status] ?? 5) - (priority[b.status] ?? 5) || (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * (order === 'oldest' ? 1 : -1) || a.id.localeCompare(b.id))
}
