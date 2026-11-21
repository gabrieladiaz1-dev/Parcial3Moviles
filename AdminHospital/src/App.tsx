import { userMessage } from './lib/userError'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthGate } from './components/AuthGate'
import { AdminGate } from './components/AdminGate'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { PageHeading } from './components/PageHeading'
import type { PanelNotification } from './lib/panel'
import { panelNoticeTarget } from './lib/panelNavigation'
import { readMyAccess, type UserAccess } from './lib/api'
import type { Page } from './types'
import type { ReceptionTab } from './pages/ReceptionPage'

const ReceptionPage = lazy(() => import('./pages/ReceptionPage').then(({ ReceptionPage }) => ({ default: ReceptionPage })))

const GeneralDashboard = lazy(() => import('./pages/GeneralDashboard').then(({ GeneralDashboard }) => ({ default: GeneralDashboard })))
const EmployeesPage = lazy(() => import('./pages/EmployeesPage').then(({ EmployeesPage }) => ({ default: EmployeesPage })))
const RoomsPage = lazy(() => import('./pages/RoomsPage').then(({ RoomsPage }) => ({ default: RoomsPage })))
const StaffShiftsPage = lazy(() => import('./pages/StaffShiftsPage').then(({ StaffShiftsPage }) => ({ default: StaffShiftsPage })))
const PharmacyPage = lazy(() => import('./pages/PharmacyPage').then(({ PharmacyPage }) => ({ default: PharmacyPage })))
const InventoryPage = lazy(() => import('./pages/InventoryPage').then(({ InventoryPage }) => ({ default: InventoryPage })))
const AmbulancePage = lazy(() => import('./pages/AmbulancePage').then(({ AmbulancePage }) => ({ default: AmbulancePage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(({ ReportsPage }) => ({ default: ReportsPage })))
const ConfigurationPage = lazy(() => import('./pages/ConfigurationPage').then(({ ConfigurationPage }) => ({ default: ConfigurationPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(({ ProfilePage }) => ({ default: ProfilePage })))
const InstitutionPage = lazy(() => import('./pages/InstitutionPage').then(({ InstitutionPage }) => ({ default: InstitutionPage })))
const LaboratoryPage = lazy(() => import('./pages/LaboratoryPage').then(({ LaboratoryPage }) => ({ default: LaboratoryPage })))

function HospitalApp({ session, onSignOut }: { session: Session; onSignOut: () => Promise<void> }) {
  const [page, setPage] = useState<Page>('Resumen general')
  const [receptionTab, setReceptionTab] = useState<ReceptionTab>('Solicitudes de atención')
  const [planningStaffId, setPlanningStaffId] = useState('')
  const showUnconnectedModules = false
  const [receptionRequestId, setReceptionRequestId] = useState<string | null>(null)
  const [hospitalAdmissionId, setHospitalAdmissionId] = useState<string | null>(null)
  const [transportRequestId, setTransportRequestId] = useState<string | null>(null)
  const [transportUnitId, setTransportUnitId] = useState<number | null>(null)
  const [laboratoryOrderId, setLaboratoryOrderId] = useState<string | null>(null)
  const [accessState, setAccessState] = useState<{ access: UserAccess | null; loading: boolean; error: string }>({
    access: null,
    loading: true,
    error: '',
  })
  const isAdministrator = accessState.access?.isAdministrator === true
  const isReceptionist = accessState.access?.roles.some(role => role.code === 'recepcionista') === true
  const canLaboratory = isAdministrator || accessState.access?.laboratory?.can_view === true

  useEffect(() => {
    let active = true
    readMyAccess().then((access) => {
      if (active) {
        setAccessState({ access, loading: false, error: '' })
        setPage(access.isAdministrator ? 'Resumen general' : access.roles.some(r => r.code === 'recepcionista') ? 'Recepción' : 'Laboratorios')
      }
    }).catch((loadError: unknown) => {
      if (active) setAccessState({
        access: null,
        loading: false,
        error: userMessage(loadError, 'No se pudieron comprobar los permisos.'),
      })
    })
    return () => {
      active = false
    }
  }, [])

  function navigate(nextPage: Page) {
    if (['Citas y Turnos', 'Pacientes e ingresos', 'Expediente Clínico'].includes(nextPage)) return
    if (!isAdministrator && !['Mi perfil', 'Acerca del hospital', 'Cómo llegar'].includes(nextPage) && !(isReceptionist && ['Recepción', 'Ambulancia'].includes(nextPage)) && !(canLaboratory && nextPage === 'Laboratorios')) return
    if (nextPage === 'Recepción' && !isAdministrator && !isReceptionist) return
    if ((nextPage === 'Personal hospitalario' || nextPage === 'Horarios y turnos') && !isAdministrator) return
    setPage(nextPage)
    setReceptionRequestId(null); setHospitalAdmissionId(null); setTransportRequestId(null); setTransportUnitId(null)
    setLaboratoryOrderId(null)
    if (nextPage === 'Recepción') setReceptionTab('Solicitudes de atención')
  }

  function openNotification(notice: PanelNotification) {
    const target = panelNoticeTarget(notice)
    if (!target) return
    if (target.page === 'Laboratorios' && !canLaboratory) return
    setReceptionRequestId(null); setHospitalAdmissionId(null); setTransportRequestId(null); setTransportUnitId(null)
    setPage(target.page)
    if (target.page === 'Laboratorios') setLaboratoryOrderId(target.id)
    else if (target.page === 'Recepción') { setReceptionTab(target.tab); if (target.tab === 'Solicitudes de atención') setReceptionRequestId(target.id); else setHospitalAdmissionId(target.id) }
    else if (target.requestId) setTransportRequestId(target.requestId)
    else if (target.unitId) setTransportUnitId(target.unitId)
  }

  if (accessState.loading) return <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] text-sm text-slate-500" role="status">Preparando tu panel…</main>
  if (accessState.error) return <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] p-5"><div className="rounded-xl bg-white p-6"><p role="alert">{accessState.error}</p><button className="mt-4 text-sm text-[#800b2c]" onClick={() => void onSignOut()}>Cerrar sesión</button></div></main>

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-slate-800 md:flex">
      <Sidebar isAdministrator={isAdministrator} isReceptionist={isReceptionist} canLaboratory={canLaboratory} onNavigate={navigate} page={page} showUnconnectedModules={showUnconnectedModules} />
      <div className="min-w-0 flex-1">
        <Topbar onSignOut={onSignOut} onNavigate={navigate} isAdministrator={isAdministrator} onOpenNotification={openNotification} session={session} />
        <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-7 sm:py-7">
          <PageHeading page={page} />
          <Suspense fallback={<p className="rounded-lg bg-white p-5 text-xs text-slate-500">Cargando pantalla...</p>}>
            {page === 'Recepción' && (isAdministrator || isReceptionist) && <ReceptionPage key={`${receptionTab}-${receptionRequestId}-${hospitalAdmissionId}`} initialTab={receptionTab} initialRequestId={receptionRequestId} initialHospitalAdmissionId={hospitalAdmissionId} />}
            {page === 'Laboratorios' && canLaboratory && <LaboratoryPage key={laboratoryOrderId ?? 'orders'} initialOrderId={laboratoryOrderId} />}
            {page === 'Resumen general' && isAdministrator && <GeneralDashboard onNavigate={navigate} onOpenReception={tab => { setReceptionTab(tab); setPage('Recepción') }} />}
            {page === 'Personal hospitalario' && (accessState.loading
              ? <p className="rounded-lg bg-white p-5 text-xs text-slate-500" role="status">Verificando permisos administrativos...</p>
              : accessState.error
                ? <p className="rounded-lg bg-rose-50 p-4 text-xs text-rose-800" role="alert">{accessState.error}</p>
                : isAdministrator && <EmployeesPage onSchedule={staffId => { setPlanningStaffId(staffId ?? ''); setPage('Horarios y turnos') }} />)}
            {page === 'Habitaciones y Camas' && <RoomsPage />}
            {page === 'Horarios y turnos' && isAdministrator && <StaffShiftsPage initialStaffId={planningStaffId} />}
            {page === 'Farmacia' && isAdministrator && <PharmacyPage />}
            {page === 'Inventario y Recursos' && isAdministrator && <InventoryPage />}
            {page === 'Ambulancia' && (isAdministrator || isReceptionist) && <AmbulancePage key={transportRequestId ?? `fleet-${transportUnitId}`} initialRequestId={transportRequestId} initialUnitId={transportUnitId} />}
            {page === 'Reportes y Analítica' && <ReportsPage />}
            {page === 'Configuración' && isAdministrator && <ConfigurationPage />}
            {page === 'Mi perfil' && <ProfilePage />}
            {(page === 'Acerca del hospital' || page === 'Cómo llegar') && <InstitutionPage key={page} directions={page === 'Cómo llegar'} isAdmin={isAdministrator} onConfiguration={() => navigate('Configuración')} />}
          </Suspense>
          <footer className="mt-5 flex items-center justify-between border-t border-slate-200 py-3 text-[9px] text-slate-400">
            <span>Hospital Moviles · Hospital Moviles</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Acceso según los permisos de tu cuenta</span>
          </footer>
        </main>
      </div>
    </div>
  )
}

function App() {
  return <AuthGate>{(session, signOut) => <AdminGate key={session.user.id} onSignOut={signOut}><HospitalApp onSignOut={signOut} session={session} /></AdminGate>}</AuthGate>
}

export default App
