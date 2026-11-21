import { supabase } from './supabase'
import type { LaboratoryAccess } from './laboratory'


export interface Facility {
  id: string
  name: string
  active: boolean
}

export interface PatientRecord {
  id: string
  medicalRecordNumber: string
  givenNames: string
  familyNames: string
  birthDate: string | null
  administrativeSex: string | null
  archivedAt: string | null
}

export interface AdmissionDepartment {
  id: string
  name: string
}

export interface TriageLevel {
  id: string
  code: string
  name: string
  priority: number
}

export interface AdmissionPhysician {
  id: string
  name: string
}

export interface HospitalInformation {
  id: string
  category: string
  title: string
  body: string
  publishedAt: string
  expiresAt: string | null
}

export interface OnDutyStaff {
  name: string
  specialty: string
  department: string
  startsAt: string
  endsAt: string
}

export interface HospitalOverview {
  asOf: string
  capacity: number
  occupied: number
  information: HospitalInformation[]
  onDuty: OnDutyStaff[]
}

export interface UserAccess {
  isAdministrator: boolean
  laboratory?: LaboratoryAccess
  profileId: string | null
  roles: Array<{ facilityId: string; code: string }>
  permissions: Array<{ facilityId: string; code: string }>
}

export type PatientChart = Record<string, unknown>

export interface AppointmentRequest {
  id: string
  patientId: string
  patientName: string
  recordNumber: string | null
  facilityId: string
  specialtyId: string
  specialtyName: string
  reason: string
  preferredDate: string
  preferredStart: string | null
  preferredEnd: string | null
  rowVersion: number
}

export interface DoctorAppointment {
  id: string
  patientId: string
  patientName: string
  recordNumber: string
  phone: string | null
  period: string
  status: string
  encounterId: string | null
}

export interface AppointmentTimeBlock {
  period: string
  status: string
}

export interface ManagedUser {
  id: string
  email: string
  givenNames: string
  familyNames: string
  status: string
  roles: Array<{ id: string; code: string; name: string }>
}

export interface SystemRole {
  id: string
  code: string
  name: string
}

export interface PrescriptionCatalogs {
  medications: Array<{ id: string; name: string; strength: string | null }>
  units: Array<{ id: string; name: string }>
  routes: Array<{ id: string; name: string }>
}

export interface LaboratoryTest {
  id: string
  name: string
}

export function getAuthorizationErrorMessage(error: unknown, permission: string): string | null {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== '42501') return null
  return (void permission, 'Tu cuenta no tiene autorización para esta operación. Contacta al administrador.')
}

export async function readFacilities(): Promise<Facility[]> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function readMyAccess(): Promise<UserAccess> {
  if (!supabase) throw new Error('El sistema no está configurado correctamente. Contacta al administrador.')
  const { data: identity, error: identityError } = await supabase.auth.getUser()
  if (identityError || !identity.user) throw new Error('Inicia sesión nuevamente.')
  const [{ data, error }, laboratory] = await Promise.all([supabase.from('user_roles').select('role').eq('user_id', identity.user.id).eq('active', true), supabase.rpc('my_laboratory_access')])
  if (error) throw error
  return { isAdministrator: data.some(r => r.role === 'admin'), profileId: identity.user.id,
    roles: data.map(r => ({ facilityId: '', code: r.role })), permissions: [], laboratory: laboratory.error ? undefined : laboratory.data as LaboratoryAccess }
}

export async function readPendingAppointmentRequests(_facilityId: string): Promise<AppointmentRequest[]> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function readDoctorAppointments(_facilityId: string, _from: string, _to: string): Promise<DoctorAppointment[]> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function readDoctorAvailability(_facilityId: string, _physicianId: string, _date: string): Promise<AppointmentTimeBlock[]> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function scheduleAppointmentRequest(_input: {
  requestId: string
  departmentId: string
  physicianId: string
  startsAt: string
  endsAt: string
  expectedVersion: number
  requestKey: string
}): Promise<void> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function searchManagedUsers(
  _facilityId: string,
  _query: string,
  _after: string | null = null,
): Promise<{ users: ManagedUser[]; after: string | null }> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function readSystemRoles(_facilityId: string): Promise<SystemRole[]> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function setUserRoles(_profileId: string, _facilityId: string, _roleIds: string[]): Promise<void> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function readPatientChart(_patientId: string, _isDoctor: boolean): Promise<PatientChart> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function readPrescriptionCatalogs(): Promise<PrescriptionCatalogs> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function issuePrescription(_input: {
  encounterId: string
  medicationId: string
  dose: number
  doseUnitId: string
  routeId: string
  intervalHours: number | null
  instructions: string
  startsOn: string
  endsOn: string | null
  quantity: number | null
  requestKey: string
}): Promise<void> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function readLaboratoryTests(): Promise<LaboratoryTest[]> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function requestLaboratoryStudy(_input: {
  encounterId: string
  testId: string
  instructions: string
  requestKey: string
}): Promise<void> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function createClinicalNote(_input: {
  encounterId: string
  subjective: string
  objective: string
  assessment: string
  plan: string
  requestKey: string
}): Promise<void> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function rejectAppointmentRequest(_requestId: string, _expectedVersion: number, _reason: string): Promise<void> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function readPatients(_facilityId: string, _query: string, _after: string | null): Promise<PatientRecord[]> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function readAdmissionCatalogs(_facilityId: string): Promise<{ departments: AdmissionDepartment[]; triageLevels: TriageLevel[] }> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function readAdmissionPhysicians(_facilityId: string, _departmentId: string): Promise<AdmissionPhysician[]> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function registerPatient(_input: {
  facilityId: string
  givenNames: string
  familyNames: string
  birthDate: string | null
  sex: 'female' | 'male' | 'intersex' | 'unknown'
  requestKey: string
}): Promise<void> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function registerPatientWithAppointmentRequest(_input: {
  facilityId: string
  givenNames: string
  familyNames: string
  birthDate: string | null
  sex: 'female' | 'male' | 'intersex' | 'unknown'
  specialtyId: string
  reason: string
  preferredDate: string
  preferredStart: string
  preferredEnd: string
  requestKey: string
}): Promise<void> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function registerAdmission(_input: {
  patientId: string
  departmentId: string
  physicianId: string
  admissionType: 'emergency' | 'scheduled' | 'observation'
  triageLevelId: string
  requestKey: string
}): Promise<void> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function readHospitalOverview(_facilityId: string): Promise<HospitalOverview> {
  throw new Error('Este módulo no está disponible en este momento.')
}

export async function readPublicView(_viewName: string): Promise<Record<string, unknown>[]> {
  throw new Error('Este módulo no está disponible en este momento.')
}
