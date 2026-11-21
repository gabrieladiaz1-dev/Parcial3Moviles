import { localities } from './elSalvadorLocalities.ts'

export function normalizeDui(value: string): string {
  const input = value.trim()
  if (!/^\d{8}-?\d$/.test(input)) throw new Error('Escribe los 9 números del DUI: 00000000-0.')
  const digits = input.replace('-', '')
  return `${digits.slice(0, 8)}-${digits.slice(8)}`
}

export interface WalkinFields { first: string; last: string; dui: string; birth: string; phone: string; email: string; city: string }
export function walkinAge(birth: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null
  const date=new Date(`${birth}T12:00:00Z`)
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==birth||birth>today)return null
  return Number(today.slice(0,4))-Number(birth.slice(0,4))-(today.slice(5)<birth.slice(5)?1:0)
}
export function formatWalkinDui(value: string) { const digits=value.replace(/\D/g,'').slice(0,9); return digits.length>8?`${digits.slice(0,8)}-${digits.slice(8)}`:digits }
export function validateWalkinFields(form: WalkinFields, today: string): Partial<Record<keyof WalkinFields, string>> {
  const errors: Partial<Record<keyof WalkinFields, string>> = {}
  if (!form.first.trim() || form.first.trim().length>100) errors.first='Escribe los nombres (máximo 100 caracteres).'
  if (!form.last.trim() || form.last.trim().length>100) errors.last='Escribe los apellidos (máximo 100 caracteres).'
  try { normalizeDui(form.dui) } catch { errors.dui='Escribe el DUI completo: 00000000-0.' }
  const date=new Date(`${form.birth}T12:00:00Z`)
  const earliest=`${Number(today.slice(0,4))-120}${today.slice(4)}`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.birth) || Number.isNaN(date.getTime()) || date.toISOString().slice(0,10)!==form.birth || form.birth>today || form.birth<earliest) errors.birth='Indica una fecha real, no futura.'
  else if((walkinAge(form.birth,today)??0)<18) errors.birth='El paciente debe tener al menos 18 años para este registro.'
  if (!/^[2567]\d{3}-\d{4}$/.test(form.phone)) errors.phone='Usa 8 dígitos e inicia con 2, 5, 6 o 7.'
  if (form.email && (form.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))) errors.email='Escribe un correo válido, como nombre@dominio.com.'
  if (!localities.some(item=>item.name===form.city)) errors.city='Selecciona una localidad válida de El Salvador en la lista.'
  return errors
}
export function formatWalkinPhone(value: string) {
  let digits=value.replace(/\D/g,'')
  if(digits.length===11&&digits.startsWith('503'))digits=digits.slice(3)
  digits=digits.slice(0,8)
  return digits.length>4?`${digits.slice(0,4)}-${digits.slice(4)}`:digits
}
