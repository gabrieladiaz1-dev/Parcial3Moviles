import type { KeyboardEvent } from 'react'
export function advanceFormOnEnter(event: KeyboardEvent<HTMLFormElement>) {
  if(event.key!=='Enter'||event.defaultPrevented||event.nativeEvent.isComposing)return
  const target=event.target as HTMLElement
  if(target.closest('.employee-calendar')||target instanceof HTMLSelectElement||target instanceof HTMLTextAreaElement)return
  if(!(target instanceof HTMLInputElement))return
  event.preventDefault()
  if(target.type==='date')return
  const fields=Array.from(event.currentTarget.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input,select')).filter(field=>!field.matches(':disabled')&&field.type!=='hidden'&&field.getClientRects().length>0)
  fields[fields.indexOf(target)+1]?.focus()
}
