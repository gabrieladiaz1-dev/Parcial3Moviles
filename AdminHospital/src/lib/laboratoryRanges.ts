export function laboratoryRangeFlag(parameter: { type: string; range_scope?: string; low?: number | string | null; high?: number | string | null }, value: string): 'low' | 'high' | 'within' | null {
  if (parameter.type !== 'number' || parameter.range_scope !== 'all_patients' || !/^-?[0-9]+(\.[0-9]+)?$/.test(value.trim())) return null
  const parsed = Number(value); const low = parameter.low === null || parameter.low === undefined || parameter.low === '' ? null : Number(parameter.low)
  const high = parameter.high === null || parameter.high === undefined || parameter.high === '' ? null : Number(parameter.high)
  if (!Number.isFinite(parsed) || low !== null && !Number.isFinite(low) || high !== null && !Number.isFinite(high) || low === null && high === null || low !== null && high !== null && low > high) return null
  if (low !== null && parsed < low) return 'low'
  if (high !== null && parsed > high) return 'high'
  return 'within'
}
