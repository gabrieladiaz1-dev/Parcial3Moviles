export interface PatientSearchItem {
  id: string; first_name: string; last_name: string; dui: string | null; phone: string | null
  email?: string | null; patient_code: string; record_code?: string | null
}
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim()
const digits = (value: string) => value.replace(/\D/g, '')
const phoneDigits = (value: string) => { const number = digits(value); return number.length === 11 && number.startsWith('503') ? number.slice(3) : number }
export const searchText = (value: string) => value.trim().replace(/\s+/g, ' ').slice(0, 120)

export type PatientSearchIntent = 'name' | 'email' | 'phone' | 'dui' | 'record'
export interface PatientMatch { field: PatientSearchIntent; grade: number; label: string }

export function patientSearchIntent(value: string): PatientSearchIntent {
  const term = searchText(value)
  if (term.includes('@')) return 'email'
  if (/^(exp|pac)(?:[-\s]|$)/i.test(term)) return 'record'
  if (/^[+\d\s()-]+$/.test(term) && digits(term).length >= 2) return digits(term).length === 9 || /^\d{8}-\d?$/.test(term) ? 'dui' : 'phone'
  return 'name'
}

// PostgreSQL/PostgREST imatch (~*) supports literal, accent-expanded patterns.
// Escape every regex metacharacter; user input never becomes a regex program.
export function patientTextPattern(value: string) {
  const accents: Record<string, string> = { a: '[aáàâäãå]', e: '[eéèêë]', i: '[iíìîï]', o: '[oóòôöõ]', u: '[uúùûü]', n: '[nñ]', c: '[cç]', y: '[yýÿ]' }
  return Array.from(normalized(value)).map(character => accents[character] ?? character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')
}

function nameFilter(value: string, exact = false) {
  const term = searchText(value)
  const pattern = (text: string) => JSON.stringify(`${exact ? '^' : ''}${patientTextPattern(text)}${exact ? '$' : ''}`)
  const tokens = term.split(' ').slice(0, 8)
  if (!exact && tokens.length > 1) return `and(${tokens.map(token => `or(first_name.imatch.${pattern(token)},last_name.imatch.${pattern(token)})`).join(',')})`
  const filters = [`first_name.imatch.${pattern(term)}`, `last_name.imatch.${pattern(term)}`]
  if (exact) for (let split = 1; split < tokens.length; split++) filters.push(`and(first_name.imatch.${pattern(tokens.slice(0, split).join(' '))},last_name.imatch.${pattern(tokens.slice(split).join(' '))})`)
  return filters.join(',')
}

export function patientExactFilter(value: string) {
  const term = searchText(value)
  const pattern = JSON.stringify(`^${patientTextPattern(term)}$`)
  return `${nameFilter(term, true)},email.imatch.${pattern},patient_code.imatch.${pattern}`
}

export function patientPrimaryFilter(value: string) {
  const term = searchText(value)
  const intent = patientSearchIntent(term)
  if (intent === 'name') return nameFilter(term)
  if (intent === 'email') return `email.imatch.${JSON.stringify(patientTextPattern(term))}`
  if (intent === 'record') return `patient_code.imatch.${JSON.stringify(patientTextPattern(term))}`
  const number = intent === 'dui' ? digits(term) : phoneDigits(term)
  return `${intent === 'dui' ? 'dui' : 'phone'}.ilike.${JSON.stringify(`%${number.split('').join('%')}%`)}`
}

export function patientSearchFilter(value: string) {
  const term = searchText(value)
  const pattern = JSON.stringify(patientTextPattern(term))
  const parts = [nameFilter(term), `email.imatch.${pattern}`, `patient_code.imatch.${pattern}`]
  if (/^[+\d\s()-]+$/.test(term) && digits(term).length >= 2) {
    const numericPattern = (number: string) => JSON.stringify(`%${number.split('').join('%')}%`)
    parts.push(`dui.ilike.${numericPattern(digits(term))}`, `phone.ilike.${numericPattern(phoneDigits(term))}`)
  }
  return parts.join(',')
}

function matchGrade(field: string, term: string) {
  if (!field || !term) return 3
  return field === term ? 0 : field.startsWith(term) ? 1 : field.includes(term) ? 2 : 3
}

export function patientMatch(patient: PatientSearchItem, value: string): PatientMatch | null {
  const term = normalized(searchText(value))
  const intent = patientSearchIntent(value)
  const name = normalized(`${patient.first_name} ${patient.last_name}`)
  const names = [name, normalized(patient.first_name), normalized(patient.last_name), normalized(`${patient.last_name} ${patient.first_name}`)]
  const nameGrade = Math.min(...names.map(field => matchGrade(field, term)), term.split(' ').every(token => name.includes(token)) ? 2 : 3)
  const isNumber = /^[+\d\s()-]+$/.test(term) && digits(term).length >= 2
  const recordGrade = matchGrade(normalized(patient.record_code ?? ''), term)
  const patientCodeGrade = matchGrade(normalized(patient.patient_code), term)
  const candidates: PatientMatch[] = [
    { field: 'name', grade: nameGrade, label: 'Nombre' },
    { field: 'email', grade: matchGrade(normalized(patient.email ?? ''), term), label: 'Correo' },
    { field: 'phone', grade: isNumber ? matchGrade(phoneDigits(patient.phone ?? ''), phoneDigits(term)) : 3, label: 'Teléfono' },
    { field: 'dui', grade: isNumber ? matchGrade(digits(patient.dui ?? ''), digits(term)) : 3, label: 'DUI' },
    { field: 'record', grade: Math.min(recordGrade, patientCodeGrade), label: recordGrade <= patientCodeGrade ? 'Expediente' : 'Código de paciente' },
  ].filter(match => match.grade < 3) as PatientMatch[]
  return candidates.sort((a, b) => Number(b.field === intent) - Number(a.field === intent) || a.grade - b.grade)[0] ?? null
}

export function rankPatientMatches<T extends PatientSearchItem>(rows: T[], value: string): T[] {
  const intent = patientSearchIntent(value)
  const matches = [...new Map(rows.map(row => [row.id, row])).values()].map(patient => ({ patient, match: patientMatch(patient, value) })).filter((entry): entry is { patient: T; match: PatientMatch } => entry.match !== null)
  // Keep other fields searchable as a fallback, without mixing accidental secondary
  // matches into a clear search in the intended field.
  const primary = matches.filter(entry => entry.match.field === intent)
  return (primary.length ? primary : matches).sort((a, b) => a.match.grade - b.match.grade || `${a.patient.first_name} ${a.patient.last_name}`.localeCompare(`${b.patient.first_name} ${b.patient.last_name}`, 'es') || a.patient.id.localeCompare(b.patient.id)).map(entry => entry.patient)
}

export function maskPatientDui(value: string | null) {
  const document = digits(value ?? '')
  return document.length === 9 ? `•••••${document.slice(5, 8)}-${document.slice(8)}` : 'No registrado'
}

export function possiblePatientDuplicates<T extends PatientSearchItem>(rows: T[]) {
  const result = new Set<string>()
  rows.forEach((patient, index) => rows.slice(index + 1).forEach(other => {
    const name = normalized(`${patient.first_name} ${patient.last_name}`)
    const sameName = Boolean(name && name === normalized(`${other.first_name} ${other.last_name}`))
    const phone = phoneDigits(patient.phone ?? '')
    const samePhone = phone.length >= 8 && phone === phoneDigits(other.phone ?? '')
    if (sameName || samePhone) { result.add(patient.id); result.add(other.id) }
  }))
  return result
}
