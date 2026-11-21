// SIGET, Plan de Numeración 2025: fijo 2; móvil 5, 6 y 7.
export function nextEmployeeCode(previous: string | number) {
  const last = Number(previous)
  if (!Number.isInteger(last) || last < 0 || last >= 999) throw new RangeError('Se agotaron los códigos de empleado de tres dígitos (001–999).')
  return String(last + 1).padStart(3, '0')
}

export function formatEmployeePhone(value: string) {
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('503') && digits.length === 11) digits = digits.slice(3)
  digits = digits.slice(0, 8)
  return digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits
}

export function validEmployeePhone(value: string) {
  return /^[2567]\d{3}-?\d{4}$/.test(value)
}

export function validEmployeeBirthDate(value: string, today: string) {
  if (!value) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > today) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function temporaryEmployeePassword() {
  return 'Gaby.0522123'
}
