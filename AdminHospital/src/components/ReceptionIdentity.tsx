import { Icon } from './Icon'
import type { ReceptionPatient } from '../lib/reception'

export function IdentityCheck({ checked, onChange, disabled, description = 'El nombre, DUI y fecha de nacimiento corresponden al solicitante.' }: { checked: boolean; onChange: (value: boolean) => void; disabled: boolean; description?: string }) {
  return <label className={`reception-identity-check ${checked ? 'is-checked' : ''}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /><span><strong>Verifiqué la identidad con su documento</strong><small>{description}</small></span></label>
}


export function PatientCard({ patient, code }: { patient: ReceptionPatient; code?: string }) {
  return <div className="reception-patient-card"><div className="reception-patient-heading"><span className="reception-avatar"><Icon name="patient" size={24} /></span><div><span className="reception-eyebrow">DATOS DEL PACIENTE</span><h4>{patient.first_name} {patient.last_name}</h4></div>{code && <span className="reception-record-code"><Icon name="file" size={16} />{code}</span>}</div><dl className="reception-patient-data">{[['DUI', patient.dui], ['Fecha de nacimiento', patient.birth_date], ['Teléfono', patient.phone], ['Número de paciente', patient.patient_code]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'No registrado'}</dd></div>)}</dl></div>
}
