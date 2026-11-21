import { useId, useState } from 'react'
import { Icon } from './Icon'
import type { PlanningStaff } from '../lib/planning'
import { staffName } from '../lib/planning'

export function StaffScheduleSearch({ matches, query, onQuery, onSelect, selectedId, disabled, loading, error = '', collapseWhenSelected = false, searchRequired = false, placeholder = 'Nombre, especialidad o cargo…', helpText = 'Busca coincidencias parciales por nombre, especialidad o cargo. Selecciona una persona para cargar solo su horario.' }: { matches: PlanningStaff[]; query: string; onQuery: (query: string) => void; onSelect: (id: string) => void; selectedId: string; disabled: boolean; loading: boolean; error?: string; collapseWhenSelected?: boolean; searchRequired?: boolean; placeholder?: string; helpText?: string }) {
  const id = useId()
  const [active, setActive] = useState(0)
  const [limit, setLimit] = useState(8)
  const results = matches.slice(0, limit)
  const selected = Math.max(0, Math.min(active, Math.max(0, results.length - 1)))
  return <div className="staff-direct-search"><label htmlFor={id}>Buscar y seleccionar empleado</label><div className="staff-search-input"><Icon name="search" size={19} /><input id={id} value={query} disabled={disabled} placeholder={placeholder} autoComplete="off" aria-controls={`${id}-results`} aria-describedby={`${id}-help`} onChange={e => { setActive(0); setLimit(8); onQuery(e.target.value) }} onKeyDown={e => {
    if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && results[selected] && !loading) { e.preventDefault(); onSelect(results[selected].id) }
  }} />{query && <button type="button" aria-label="Limpiar búsqueda" disabled={disabled} onClick={() => { onQuery(''); setActive(0); setLimit(8) }}>×</button>}</div><p id={`${id}-help`} className="staff-search-help">{helpText}</p>
    <div id={`${id}-results`} className="staff-search-results" aria-label="Resultados de empleados" aria-busy={loading}>
      {collapseWhenSelected && selectedId ? <p role="status">Empleado seleccionado. Cambia la búsqueda para elegir a otra persona.</p> : error ? <p role="alert">{error}</p> : loading ? <p role="status">Buscando empleados…</p> : searchRequired && !query.trim() ? <p role="status">Escribe un nombre, especialidad o cargo para comenzar.</p> : !results.length ? <p role="status">No encontramos empleados con esos datos y ese cargo.</p> : results.map((person, i) => <button type="button" key={person.id} disabled={disabled} className={`${person.id === selectedId ? 'is-selected' : ''} ${i === selected ? 'is-keyboard-active' : ''}`} aria-pressed={person.id === selectedId} onClick={() => onSelect(person.id)} onMouseEnter={() => setActive(i)}><span className="staff-search-avatar"><Icon name="patient" size={20} /></span><span><strong>{staffName(person)}</strong><small>{person.employee_code} · {person.category === 'doctor' ? 'Doctor' : 'Recepcionista'}{person.specialties?.length ? ` · ${person.specialties.join(', ')}` : ''}{!person.active ? ' · Inactivo' : ''}</small></span><Icon name={person.id === selectedId ? 'check' : 'arrowRight'} size={17} /></button>)}
    </div>{!(collapseWhenSelected && selectedId) && matches.length > results.length && !loading && <button type="button" className="staff-search-more" disabled={disabled} onClick={() => setLimit(i => i + 8)}>Mostrar más resultados ({matches.length - results.length})</button>}
  </div>
}
