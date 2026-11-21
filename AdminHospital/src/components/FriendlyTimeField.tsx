import { clockParts, clockValue } from '../lib/recurringJourney'

export function FriendlyTimeField({ label, value, onChange, error }: { label: string; value: string; onChange: (value: string) => void; error?: string }) {
  const parts = clockParts(value)
  const errorId = error ? `${label.replace(/\W/g, '-')}-error` : undefined
  return <fieldset className="friendly-time" aria-invalid={Boolean(error)} aria-describedby={errorId}><legend>{label}</legend><div><select aria-label={`${label}: hora`} aria-invalid={Boolean(error)} value={parts.hour} onChange={e => onChange(clockValue(Number(e.target.value), parts.minute, parts.period))}>{Array.from({ length: 12 }, (_, i) => i + 1).map(h => <option key={h} value={h}>{h}</option>)}</select><span>:</span><select aria-label={`${label}: minutos`} aria-invalid={Boolean(error)} value={parts.minute} onChange={e => onChange(clockValue(parts.hour, Number(e.target.value), parts.period))}>{Array.from({ length: 60 }, (_, i) => i).map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}</select><select aria-label={`${label}: AM o PM`} aria-invalid={Boolean(error)} value={parts.period} onChange={e => onChange(clockValue(parts.hour, parts.minute, e.target.value))}><option value="AM">AM</option><option value="PM">PM</option></select></div>{error && <small id={errorId} className="recurring-field-error">{error}</small>}</fieldset>
}
