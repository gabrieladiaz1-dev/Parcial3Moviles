interface MedicalRecordSummary {
  id: string
  record_code: string | null
}

interface PatientWithRecords {
  id: string
  medical_records?: MedicalRecordSummary | MedicalRecordSummary[] | null
}

export function mapPatientRecord<T extends PatientWithRecords>(row: T): Omit<T, 'medical_records'> & { record_id: string | null; record_code: string | null } {
  const { medical_records: embedded, ...patient } = row
  const records = Array.isArray(embedded) ? embedded : embedded ? [embedded] : []
  if (records.length > 1) throw new Error('No se pudo confirmar un expediente único para este paciente. Solicita revisión; no crees otra persona.')
  return { ...patient, record_id: records[0]?.id ?? null, record_code: records[0]?.record_code ?? null }
}
