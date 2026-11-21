import { useId, type ButtonHTMLAttributes } from 'react'

export type EmployeeAction = 'view' | 'edit' | 'disable' | 'enable'
export function EmployeeActionButton({ action, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { action: EmployeeAction; label: string }) {
  const id = useId()
  const paths: Record<EmployeeAction, string> = {
    view: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    edit: 'm16 3 5 5M4 16 16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
    disable: 'M12 2v10M6 5a9 9 0 1 0 12 0',
    enable: 'M12 2v10M6 5a9 9 0 1 0 12 0',
  }
  return <span className={`employee-action employee-action-${action}`}><button {...props} type="button" aria-label={label} aria-describedby={id}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[action]} /></svg></button><span id={id} role="tooltip">{label}</span></span>
}
