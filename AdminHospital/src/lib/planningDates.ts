export const hospitalTimezone = 'America/Guatemala'
export function hospitalDate(value: Date | string = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: hospitalTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-')
}
export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}
export function weekday(day: string): number { return new Date(`${day}T12:00:00Z`).getUTCDay() }
export function monday(day: string): string { return addDays(day, -((weekday(day) + 6) % 7)) }
export function atMidnight(day: string): string { return `${day}T00:00:00-06:00` }
export function clock(timestamp: string): string {
  return new Intl.DateTimeFormat('es-GT', { timeZone: hospitalTimezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp))
}
export function selectedDates(from: string, until: string, days: number[]): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(until) || until < from || addDays(from, 366) < until) throw new Error('Selecciona un rango válido de hasta un año.')
  const dates: string[] = []
  for (let day = from; day <= until; day = addDays(day, 1)) if (days.includes(weekday(day))) dates.push(day)
  if (!dates.length || dates.length > 84) throw new Error('Selecciona entre 1 y 84 días de trabajo.')
  return dates
}
export function overlapsDay(start: string, end: string, day: string): boolean {
  return new Date(start).getTime() < new Date(atMidnight(addDays(day, 1))).getTime()
    && new Date(end).getTime() > new Date(atMidnight(day)).getTime()
}
