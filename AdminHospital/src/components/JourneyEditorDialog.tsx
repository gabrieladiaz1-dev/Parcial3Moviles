import { useEffect, useRef, type ReactNode } from 'react'
export function JourneyEditorDialog({ children, busy, onClose, title = 'Editar horario recurrente' }: { children: ReactNode; busy: boolean; onClose: () => void; title?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="staff-day-dialog" style={{ width: 'min(1000px, 96vw)', maxHeight: '92vh', overflow: 'auto' }} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px' }}><button type="button" disabled={busy} onClick={onClose} aria-label="Cerrar edición de jornada">Cerrar ×</button></div>
    {children}
  </dialog>
}
