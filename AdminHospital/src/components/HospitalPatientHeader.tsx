import { Icon } from './Icon'
import { HospitalDate } from './HospitalPresentation'
import { admissionStates,hospitalKinds,type AdmissionDetail } from '../lib/hospitalization'

export function HospitalPatientHeader({detail:d}:{detail:AdmissionDetail}){
  const assignment=d.assignments.find(a=>!a.released_at)
  return <header className="hospital-patient-header">
    <div className="hospital-patient-banner"><span className="hospital-patient-emblem"><Icon name="patient" size={34}/></span><div className="hospital-patient-identity"><span>FICHA DE HOSPITALIZACIÓN</span><h3>{d.patient_name}</h3><p><Icon name="users" size={18}/><span>Médico responsable · <strong>{d.doctor_name}</strong></span></p></div><span className={`hospital-badge hospital-status status-${d.status}`}>{d.status==='solicitado'&&d.reviewed_at?'En revisión':admissionStates[d.status]}</span></div>
    <dl className="hospital-patient-overview">
      <div><span className="hospital-overview-icon"><Icon name="bed" size={23}/></span><div><dt>Habitación y cama</dt><dd>{assignment?`${assignment.room} · ${assignment.bed}`:'Pendiente de asignación'}</dd></div></div>
      <div><span className="hospital-overview-icon"><Icon name="file" size={23}/></span><div><dt>Categoría indicada</dt><dd>{hospitalKinds[d.requested_kind]??d.requested_kind}</dd></div></div>
      <div className={d.priority==='urgente'?'is-urgent':''}><span className="hospital-overview-icon"><Icon name="activity" size={23}/></span><div><dt>Prioridad</dt><dd>{d.priority==='urgente'?'Urgente':'Normal'}</dd></div></div>
      <div><span className="hospital-overview-icon"><Icon name="calendar" size={23}/></span><div><dt>Solicitud médica</dt><dd><HospitalDate value={d.ordered_at}/></dd></div></div>
    </dl>
  </header>
}
