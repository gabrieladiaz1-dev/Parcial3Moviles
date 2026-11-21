import { useId, useRef, useState, type InputHTMLAttributes } from 'react'
import { Icon } from './Icon'
import { localities, searchLocalities } from '../lib/elSalvadorLocalities'

function SpecialtyIcon({ name = '' }: { name?: string }) {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  let path = 'M6 3v1M14 3v1M4 4v5a6 6 0 0 0 12 0V4M10 15v2a5 5 0 0 0 10 0v-3M20 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4'
  if (normalized.includes('cardio')) path = 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z'
  else if (normalized.includes('oftalm')) path = 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'
  else if (normalized.includes('neuro') || normalized.includes('psiqu')) path = 'M12 4a3 3 0 0 0-5-1 4 4 0 0 0-3 6 4 4 0 0 0-1 7 4 4 0 0 0 5 5 3 3 0 0 0 4-2V4Zm0 0a3 3 0 0 1 5-1 4 4 0 0 1 3 6 4 4 0 0 1 1 7 4 4 0 0 1-5 5 3 3 0 0 1-4-2M7 8l2 2m-3 5 3-1m8-6-2 2m3 5-3-1'
  else if (normalized.includes('neumo')) path = 'M12 3v8m0-3L8 5C5 5 2 12 2 17c0 3 2 4 5 3l3-1V9m2-1 4-3c3 0 6 7 6 12 0 3-2 4-5 3l-3-1V9'
  else if (normalized.includes('pediatr')) path = 'M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM5 22v-2a7 7 0 0 1 14 0v2M9 18h6m-3-3v6'
  return <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>
}

export function EmployeeSpecialties({ options, selected, onChange }: { options: { id: string; name: string }[]; selected: string[]; onChange: (value: string[]) => void }) {
  const [query, setQuery] = useState('')
  const id = useId()
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
  const matches = options.filter(option => normalize(option.name).includes(normalize(query)))
  const chosen = options.filter(option => selected.includes(option.id))
  function toggle(specialtyId: string) { onChange(selected.includes(specialtyId) ? selected.filter(value => value !== specialtyId) : [...selected, specialtyId]) }
  return <section className="employee-specialties" aria-labelledby={`${id}-title`}>
    <header className="employee-specialties-heading"><span className="employee-specialties-emblem"><SpecialtyIcon /></span><div><h3 id={`${id}-title`}>Especialidades médicas <span>*</span></h3><p>Selecciona una o varias áreas de atención.</p></div><span className="employee-specialties-count" role="status">{selected.length} {selected.length === 1 ? 'elegida' : 'elegidas'}</span></header>
    {options.length > 0 ? <>
      <div className="employee-field-control employee-specialties-search"><span className="employee-field-symbol" aria-hidden="true"><Icon name="search" size={18} /></span><input aria-label="Buscar especialidades" aria-controls={`${id}-options`} type="search" autoComplete="off" placeholder="Buscar una especialidad…" value={query} onChange={event => setQuery(event.target.value)} /></div>
      {chosen.length > 0 && <div className="employee-specialties-selected" aria-label="Especialidades seleccionadas">{chosen.map(option => <button key={option.id} type="button" aria-label={`Quitar ${option.name}`} onClick={() => toggle(option.id)}><Icon name="check" size={13} /><span>{option.name}</span><span className="employee-specialty-remove" aria-hidden="true">×</span></button>)}</div>}
      <div id={`${id}-options`} className="employee-specialties-options">{matches.map(option => <label key={option.id} className={`employee-specialty-option ${selected.includes(option.id) ? 'is-selected' : ''}`}><span className="employee-specialty-option-icon" aria-hidden="true"><SpecialtyIcon name={option.name} /></span><span className="employee-specialty-option-name">{option.name}<small>{selected.includes(option.id) ? 'Seleccionada' : 'Añadir al perfil'}</small></span><input type="checkbox" checked={selected.includes(option.id)} onChange={() => toggle(option.id)} /></label>)}</div>
      {!matches.length && <div className="employee-specialties-empty"><Icon name="search" size={24} /><p>No encontramos esa especialidad.</p><button type="button" onClick={() => setQuery('')}>Ver todas las especialidades</button></div>}
    </> : <p className="employee-specialties-empty">No hay especialidades disponibles. Actualiza el directorio antes de registrar al doctor.</p>}
  </section>
}

export function EmployeeTextField({ label, symbol, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; symbol: 'person' | 'code' | 'email' | 'phone'; hint?: string }) {
  const paths = {
    person: 'M20 21v-2a7 7 0 0 0-14 0v2M13 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    code: 'M9 3 7 21M17 3l-2 18M4 9h16M3 15h16',
    email: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm18 2-10 7L2 7',
    phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z',
  }
  return <label className="employee-field"><span className="employee-field-label">{label}{props.required && <span aria-hidden="true"> *</span>}</span><span className="employee-field-control"><span className="employee-field-symbol" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[symbol]} /></svg></span><input {...props} /></span>{hint && <small className="employee-hint">{hint}</small>}</label>
}

export function EmployeeCity({ value, onChange, className, inputId, invalid = false, strict = false }: { value: string; onChange: (value: string) => void; className: string; inputId?: string; invalid?: boolean; strict?: boolean }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(-1)
  const matches = searchLocalities(value)
  function choose(item: typeof localities[number]) { onChange(item.name); setOpen(false); setIndex(-1) }
  return <div className="employee-combobox" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <div className="employee-field-control"><span className="employee-field-symbol" aria-hidden="true"><Icon name="search" size={19} /></span><input id={inputId} aria-invalid={invalid} aria-label="Ciudad o distrito" placeholder="Busca tu ciudad o distrito" className={className} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open && index >= 0 ? `${id}-${index}` : undefined} autoComplete="off" maxLength={120} value={value}
      onFocus={() => setOpen(true)} onChange={event => { onChange(event.target.value); setOpen(true); setIndex(-1) }} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation(); setOpen(true)
          const next = event.key === 'ArrowDown' ? Math.min(index + 1, matches.length - 1) : Math.max(index - 1, 0)
          setIndex(next); document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: 'nearest' })
        } else if (event.key === 'Enter' && open && matches.length && (value.trim() || index >= 0)) {
          event.preventDefault(); event.stopPropagation(); choose(matches[Math.max(index, 0)])
        } else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
      }} /></div>
    {open && <ul id={`${id}-options`} role="listbox" aria-label="Distritos de El Salvador" className="employee-city-options">
      {matches.map((item, i) => <li key={`${item.municipality}/${item.name}`} id={`${id}-${i}`} role="option" aria-selected={i === index} className={i === index ? 'selected' : ''} onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}><strong>{item.name}</strong><small>Distrito · {item.municipality} · {item.department}</small></li>)}
      {!matches.length && <li role="presentation">{strict ? 'Sin coincidencias. Prueba otra localidad y selecciona una opción.' : 'Sin coincidencias. Puedes conservar la ciudad escrita.'}</li>}
    </ul>}
    <small className="employee-hint">Selecciona una localidad de El Salvador.</small>
  </div>
}

const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export function EmployeeBirthDate({ value, onChange, today, className, inputId, invalid = false }: { value: string; onChange: (value: string) => void; today: string; className: string; inputId?: string; invalid?: boolean }) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(Number(value.slice(0, 4)) || Number(today.slice(0, 4)) - 30)
  const [month, setMonth] = useState(value ? Math.max(0, Number(value.slice(5, 7)) - 1) : Number(today.slice(5, 7)) - 1)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const display = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : value
  const days = new Date(year, month + 1, 0).getDate()
  return <div className="employee-date" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); input.current?.focus() } }}>
    <div className="employee-date-entry employee-field-control"><span className="employee-field-symbol" aria-hidden="true"><Icon name="calendar" size={19} /></span><input ref={input} id={inputId} aria-invalid={invalid} aria-label="Fecha de nacimiento" aria-describedby={`${id}-hint`} className={className} placeholder="DD / MM / AAAA" inputMode="numeric" maxLength={10} value={display} onChange={event => {
      const raw = event.target.value
      onChange(/^\d{2}\/\d{2}\/\d{4}$/.test(raw) ? raw.split('/').reverse().join('-') : raw)
    }} /><button type="button" aria-label="Abrir calendario de nacimiento" aria-expanded={open} aria-controls={`${id}-calendar`} onClick={() => { if (!open && /^\d{4}-\d{2}-\d{2}$/.test(value)) { setYear(Number(value.slice(0,4))); setMonth(Number(value.slice(5,7))-1) }; setOpen(!open) }}><Icon name="chevron" size={16} /></button></div>
    <small id={`${id}-hint`} className="employee-hint">Escribe la fecha o abre el calendario.</small>
    {open && <div id={`${id}-calendar`} className="employee-calendar" role="group" aria-label="Calendario de nacimiento">
      <div className="employee-calendar-selects"><select aria-label="Mes de nacimiento" value={month} onChange={event => setMonth(Number(event.target.value))}>{months.map((name, i) => <option key={name} value={i}>{name}</option>)}</select>
        <select aria-label="Año de nacimiento" value={year} onChange={event => setYear(Number(event.target.value))}>{Array.from({ length: Number(today.slice(0, 4)) - 1899 }, (_, i) => Number(today.slice(0, 4)) - i).map(y => <option key={y}>{y}</option>)}</select></div>
      <div className="employee-calendar-days" onKeyDown={event => {
        const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
        if (!(event.key in steps) || !(event.target instanceof HTMLButtonElement)) return
        event.preventDefault()
        const buttons = Array.from(event.currentTarget.querySelectorAll('button'))
        const next = buttons[buttons.indexOf(event.target) + steps[event.key]]
        if (next && !next.disabled) next.focus()
      }}>{['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((day, i) => <span key={i} aria-hidden="true">{day}</span>)}
        {Array.from({ length: new Date(year, month, 1).getDay() }, (_, i) => <span key={`blank-${i}`} />)}
        {Array.from({ length: days }, (_, i) => { const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`; return <button type="button" key={date} aria-label={`${i + 1} de ${months[month]} de ${year}`} aria-pressed={date === value} disabled={date > today} onClick={() => { onChange(date); setOpen(false); input.current?.focus() }}>{i + 1}</button> })}
      </div><button type="button" className="employee-calendar-clear" onClick={() => { onChange(''); setOpen(false); input.current?.focus() }}>Borrar fecha</button>
    </div>}
  </div>
}
