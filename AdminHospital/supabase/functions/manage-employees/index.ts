import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import postgres from 'npm:postgres@3.4.7'
import { employeeContract } from './contract.ts'
import { validEmployeeBirthDate, validEmployeePhone, formatEmployeePhone, nextEmployeeCode, temporaryEmployeePassword } from './validation.ts'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Employee-Contract': employeeContract.version, 'Access-Control-Expose-Headers': 'X-Employee-Contract' }
class Failure extends Error { constructor(message: string, public status = 400, public code?: string) { super(message) } }
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10 })
function check(result: { error: unknown }) { if (result.error) throw new Failure('Supabase rechazó la operación. Revisa los datos o reanuda el alta.', 409) }
function text(value: unknown, max: number, required = true, field = 'valor solicitado'): string {
  if (typeof value !== 'string' || (required && !value.trim())) throw new Failure(`Completa el campo ${field} con un valor válido.`,400,'INVALID_FIELD')
  if (value.trim().length > max) throw new Failure(`El campo ${field} admite como máximo ${max} caracteres.`,400,'INVALID_FIELD')
  return value.trim()
}
function validate(b: Record<string, unknown>) {
  const role = b.role
  if (role !== 'doctor' && role !== 'receptionist') throw new Failure('Rol no permitido.')
  const email = text(b.email, 254, true, 'correo electrónico').toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Failure('Correo inválido.')
  const birthDate = text(b.birthDate ?? '', 10, false, 'fecha de nacimiento')
  if (!validEmployeeBirthDate(birthDate, new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))) throw new Failure('Fecha de nacimiento inválida. Usa una fecha real entre 1900 y hoy.')
  if (typeof b.active !== 'boolean') throw new Failure('Estado inválido.')
  if (!Array.isArray(b.specialties) || b.specialties.length > 50 || b.specialties.some(x => typeof x !== 'string' || !/^[1-9]\d*$/.test(x))) throw new Failure('Especialidades inválidas.')
  const specialties = [...new Set(b.specialties as string[])]
  if (role === 'doctor' ? !specialties.length : specialties.length) throw new Failure('Selecciona especialidades solamente para doctores.')
  const rawPhone = text(b.phone, 30, true, 'teléfono')
  if (!validEmployeePhone(rawPhone)) throw new Failure('El teléfono debe tener 8 dígitos e iniciar con 2, 5, 6 o 7.')
  const phone = formatEmployeePhone(rawPhone)
  return { givenNames: text(b.givenNames,100,true,'nombres'), familyNames: text(b.familyNames,100,true,'apellidos'), email, phone, birthDate, city: text(b.city ?? '',120,false,'ciudad'), employeeCode: text(b.employeeCode ?? '',80,false,'código de empleado'), role, specialties, active: b.active }
}
type EmployeeQuery = (parts: TemplateStringsArray, ...values: any[]) => Promise<any[]>
async function directory(id?: string, execute: EmployeeQuery = sql) {
  return await execute`select s.id, s.profile_id as "profileId", s.employee_code as "employeeCode", s.active and coalesce(r.active,false) as active,
    p.first_name as "givenNames", p.last_name as "familyNames", p.phone, p.birth_date::text as "birthDate", p.city, u.email,
    case when s.category='doctor' then 'doctor' else 'receptionist' end as role,
    coalesce((select json_agg(d.specialty_id::text) from public.doctor_specialties d where d.doctor_id=s.id),'[]') as specialties,
    p.updated_at::text as "personVersion", s.xmin::text as "staffVersion"
    from public.staff s join public.profiles p on p.id=s.profile_id join auth.users u on u.id=p.id
    left join public.user_roles r on r.user_id=p.id and r.role::text=s.category
    where (${id ?? null}::uuid is null or s.id=${id ?? null}::uuid) and s.category in ('doctor','recepcionista') and coalesce(u.raw_app_meta_data->>'employee_pending','false') <> 'true' and coalesce(u.raw_app_meta_data->>'employee_deleted','false') <> 'true' order by s.employee_code`
}

async function employeeImpact(id: string, execute: EmployeeQuery = sql) {
  const [impact] = await execute`select
    (select count(*)::int from public.appointments where doctor_id=${id} and status in ('programada','confirmada','en_atencion')) as "pendingAppointments",
    (select count(distinct patient_id)::int from public.care_team_assignments where staff_id=${id} and starts_at<=now() and (ends_at is null or ends_at>now())) as "assignedPatients",
    (select count(*)::int from public.clinical_encounters where doctor_id=${id} and ended_at is null) as "openEncounters"`
  return impact
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers })
  try {
    if (req.method !== 'POST') throw new Failure('Método no permitido.',405)
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'')
    if (!token) throw new Failure('Inicia sesión.',401)
    const identity = await admin.auth.getUser(token)
    if (identity.error || !identity.data.user) throw new Failure('Sesión inválida.',401)
    const caller = identity.data.user.id
    const permission = await admin.from('user_roles').select('user_id').eq('user_id',caller).eq('role','admin').eq('active',true).maybeSingle()
    if (permission.error || !permission.data) throw new Failure('Se requiere administrador activo.',403)
    if (Number(req.headers.get('content-length') ?? 0) > 24000) throw new Failure('Solicitud demasiado grande.',413)
    const raw = await req.text()
    if (raw.length > 24000) throw new Failure('Solicitud demasiado grande.',413)
    let b: Record<string, any>
    try { b = JSON.parse(raw) } catch { throw new Failure('JSON inválido.') }
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Failure('Solicitud inválida.')
    const reply = (data: unknown) => new Response(JSON.stringify(data), { headers })
    if (b.action === 'contract') return reply(employeeContract)
    if (b.action === 'catalogs') {
      const result = await admin.from('specialties').select('id,name').eq('active',true).order('name'); check(result)
      return reply({ contract: employeeContract, specialties: result.data!.map(s => ({ ...s,id:String(s.id) })) })
    }
    if (b.action === 'pending') {
      const rows = await sql`select id, email, created_at as "createdAt", raw_app_meta_data->'employee_payload' as payload from auth.users where raw_app_meta_data->>'employee_pending'='true' order by created_at desc limit 100`
      return reply(rows)
    }
    if (b.action === 'list' || b.action === 'detail') {
      const rows = await directory(b.action === 'detail' ? text(b.id,36) : undefined)
      if (b.action === 'detail') { const row = rows.find(r => r.id === b.id); if (!row) throw new Failure('Empleado no encontrado.',404); return reply({ ...row, impact: await employeeImpact(row.id) }) }
      const query = String(b.query ?? '').toLowerCase().slice(0,200)
      const filtered = rows.filter(r => (!b.role || r.role === b.role) && (!b.status || r.active === (b.status === 'active')) && `${r.givenNames} ${r.familyNames} ${r.email} ${r.employeeCode}`.toLowerCase().includes(query))
      const offset = Math.max(0,Math.floor(Number(b.offset)||0))
      return reply({ employees: filtered.slice(offset,offset+50), total: filtered.length })
    }
    if (b.action === 'delete') throw new Failure('La eliminación de empleados fue retirada. Utiliza Desactivar empleado para conservar su historial.',410,'EMPLOYEE_DELETE_REMOVED')
    if (!['create','recover','update','state'].includes(b.action)) throw new Failure('Operación inválida.',400,'OPERATION_NOT_SUPPORTED')
    let savedEmployee: any
    let completedEmployeeCode: string | undefined
    let completedStaffId: string | undefined
    let deliverCredentials = false
    let initialPassword: string | undefined
    let target: string | undefined
    let payload: ReturnType<typeof validate> | undefined
    if (b.action === 'create') {
      payload = validate({ ...b, employeeCode: '' })
      // Fast capacity check before creating Auth. The definitive allocation is locked below.
      const [capacity] = await sql`select coalesce(max(case when employee_code ~ '^[0-9]+$' then employee_code::numeric end),0)::text as last from public.staff`
      try { nextEmployeeCode(capacity.last) } catch { throw new Failure('Se agotaron los códigos de empleado de tres dígitos (001–999).',409) }
      for (const sp of payload.specialties) {
        const found = await sql`select id from public.specialties where id=${sp}::bigint and active`
        if (!found.length) throw new Failure('Selecciona especialidades activas.')
      }
      initialPassword = temporaryEmployeePassword()
      const created = await admin.auth.admin.createUser({ email: payload.email, password: initialPassword, email_confirm: true, ban_duration: '876000h', app_metadata: { employee_pending: true, employee_payload: payload, employee_initial_credentials: 'initial-v1' }, user_metadata: { first_name: payload.givenNames, last_name: payload.familyNames } })
      if (created.error) throw new Failure('No se pudo crear la cuenta. El correo puede estar registrado o la contraseña fue rechazada.',409)
      target = created.data.user.id
      deliverCredentials = true
    } else if (b.action === 'recover') {
      const user = await admin.auth.admin.getUserById(text(b.requestId,36)); check(user)
      if (user.data.user?.app_metadata.employee_pending !== true) throw new Failure('Esta cuenta no tiene un alta pendiente.')
      target = user.data.user.id
      initialPassword = temporaryEmployeePassword()
      deliverCredentials = true
      payload = validate({ ...(b.values ?? user.data.user.app_metadata.employee_payload), email:user.data.user.email, employeeCode: '' })
      // Recovery only targets a still-blocked pending account. Rotate its initial secret;
      // completed accounts never enter this path and retain their existing passwords.
      check(await admin.auth.admin.updateUserById(target,{ password:initialPassword, app_metadata:{employee_payload:payload,employee_initial_credentials:'initial-v1'} }))
    }
    try {
      await sql.begin(async tx => {
        await tx`select set_config('request.jwt.claim.sub',${caller},true)`
        // Same order as planning and appointments: global lock before row locks.
        // Built-in PostgreSQL function; compatible before/after the planning SQL.
        await tx`select pg_catalog.pg_advisory_xact_lock(726391054201::bigint)`
        const allowed = await tx`select user_id from public.user_roles where user_id=${caller} and role='admin' and active for share`
        if (!allowed.length) throw new Failure('Permiso administrativo revocado.',403)
        if (target && payload) {
          // Also serialize inserts from other staff writers, not just this Edge Function.
          // The existing UNIQUE constraint remains the final collision guard.
          await tx`lock table public.staff in share row exclusive mode`
          await tx`select id from auth.users where id=${target} for update`
          const pending = await tx`select id from auth.users where id=${target} and raw_app_meta_data->>'employee_pending'='true'`
          if (!pending.length) throw new Failure('El alta ya fue completada. Actualiza el directorio.',409)
          const [existingStaff] = await tx`select employee_code from public.staff where profile_id=${target}`
          if (existingStaff) {
            // Recovery after a committed SQL transaction must keep the already assigned code.
            payload.employeeCode = existingStaff.employee_code
          } else {
            const [sequence] = await tx`select coalesce(max(case when employee_code ~ '^[0-9]+$' then employee_code::numeric end),0)::text as last from public.staff`
            try { payload.employeeCode = nextEmployeeCode(sequence.last) } catch { throw new Failure('Se agotaron los códigos de empleado de tres dígitos (001–999).',409) }
          }
          completedEmployeeCode = payload.employeeCode
          const profiles = await tx`update public.profiles set first_name=${payload.givenNames},last_name=${payload.familyNames},phone=${payload.phone},birth_date=${payload.birthDate||null}::date,city=${payload.city||null} where id=${target} returning id`
          if (profiles.length !== 1) throw new Failure('No se encontró el perfil de la cuenta. El alta no fue confirmada.',409)
          const role = payload.role === 'doctor' ? 'doctor' : 'recepcionista'
          await tx`select public.set_employee_role(${target}::uuid,${role}::public.hospital_role,${payload.active})`
          const [staff] = await tx`select public.upsert_staff(${target}::uuid,${payload.employeeCode},${role}) as id`
          completedStaffId = staff.id
          await tx`update public.staff set active=${payload.active} where id=${staff.id}`
          await tx`delete from public.doctor_specialties where doctor_id=${staff.id}`
          for (const sp of payload.specialties) {
            const valid = await tx`select id from public.specialties where id=${sp}::bigint and active for share`
            if (!valid.length) throw new Failure('Una especialidad ya no está activa.')
            await tx`insert into public.doctor_specialties(doctor_id,specialty_id) values(${staff.id},${sp}::bigint)`
          }
          // Read back the persisted relations before commit and before allowing Auth login.
          const [verified] = await tx`select exists(
            select 1 from public.staff s join public.profiles p on p.id=s.profile_id
            join auth.users u on u.id=p.id
            where s.id=${staff.id} and s.profile_id=${target} and s.employee_code=${payload.employeeCode}
              and s.category=${role} and s.active=${payload.active}
              and p.first_name=${payload.givenNames} and p.last_name=${payload.familyNames}
              and p.phone=${payload.phone} and p.birth_date is not distinct from ${payload.birthDate||null}::date
              and p.city is not distinct from ${payload.city||null} and lower(u.email)=${payload.email}
              and exists(select 1 from public.user_roles r where r.user_id=p.id and r.role::text=${role} and r.active=${payload.active})
              and not exists(select 1 from public.user_roles r where r.user_id=p.id and r.role='paciente' and r.active)
              and (select count(*) from public.doctor_specialties d where d.doctor_id=s.id)=${payload.specialties.length}
              and not exists(select 1 from public.doctor_specialties d where d.doctor_id=s.id and not(d.specialty_id::text=any(${payload.specialties}::text[])))
          ) as valid`
          if (!verified?.valid) throw new Failure('No se pudo verificar el perfil, cargo o especialidades guardados. El alta no fue confirmada.',409)
        } else {
          const [staff] = await tx`select s.*,p.updated_at::text as version,s.xmin::text as staff_version from public.staff s join public.profiles p on p.id=s.profile_id where s.id=${text(b.id,36)}::uuid for update of s,p`
          if (!staff || !['doctor','recepcionista'].includes(staff.category) || staff.profile_id === caller) throw new Failure('Empleado no autorizado.',403)
          if (String(b.staffVersion) !== staff.staff_version) throw new Failure('El empleado cambió. Actualiza el directorio.',409)
          const admins = await tx`select user_id from public.user_roles where user_id=${staff.profile_id} and role='admin'`
          if (admins.length) throw new Failure('No se permite modificar o desactivar cuentas administradoras desde este módulo.',403)
          const [account] = await tx`select raw_app_meta_data,banned_until::text as banned_until from auth.users where id=${staff.profile_id} for update`
          if (!account || account.raw_app_meta_data?.employee_deleted === true) throw new Failure('El empleado ya fue eliminado del directorio. Actualiza la lista.',409)
          let expectedUpdate: ReturnType<typeof validate> | undefined
          if (b.action === 'state') {
            if (typeof b.active !== 'boolean') throw new Failure('Estado inválido.')
            if (!b.active) {
              const impact = await employeeImpact(staff.id, tx)
              const affected = impact.pendingAppointments + impact.assignedPatients + impact.openEncounters > 0
              if (affected && (b.impactAcknowledged !== true || !b.impact || ['pendingAppointments','assignedPatients','openEncounters'].some(key => b.impact[key] !== impact[key]))) throw new Failure('El empleado tiene citas o pacientes asignados. Revisa las asignaciones actuales y confirma las consecuencias antes de desactivarlo.',409,'IMPACT_CONFIRMATION_REQUIRED')
            }
            const roles = await tx`select role::text as role,active from public.user_roles where user_id=${staff.profile_id} for update`
            if (roles.some(row => row.role === 'admin')) throw new Failure('No se permite desactivar ni reactivar administradores desde empleados.',403)
            if (!roles.some(row => row.role === staff.category)) throw new Failure('Falta el rol laboral del empleado. No se puede restaurar un permiso inexistente.',409)
            const metadata = account.raw_app_meta_data ?? {}
            const banned = account.banned_until && Date.parse(account.banned_until) > Date.now()
            if (b.active) {
              if (metadata.employee_access_disabled === true) {
                if (Date.parse(account.banned_until) !== Date.parse(metadata.employee_access_ban_until)) throw new Failure('La cuenta tiene otra restricción de acceso. No se puede reactivar desde este módulo.',409)
                if (metadata.employee_access_previous_ban && Date.parse(metadata.employee_access_previous_ban) > Date.now()) throw new Failure('La cuenta ya tenía un bloqueo de acceso independiente. No se puede retirar desde este módulo.',409)
                await tx`update auth.users set banned_until=(raw_app_meta_data->>'employee_access_previous_ban')::timestamptz,
                  raw_app_meta_data=raw_app_meta_data-'employee_access_disabled'-'employee_access_previous_ban'-'employee_access_ban_until'-'employee_access_roles',updated_at=now() where id=${staff.profile_id}`
              } else if (banned) throw new Failure('La cuenta tiene un bloqueo de acceso independiente. No se puede retirar desde este módulo.',409)
            } else {
              await tx`update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)||jsonb_build_object(
                'employee_access_disabled',true,
                'employee_access_roles',${tx.json(metadata.employee_access_disabled === true ? (Array.isArray(metadata.employee_access_roles) ? metadata.employee_access_roles : [...new Set([staff.category, ...roles.filter(row => row.active && row.role !== 'paciente').map(row => row.role)])]) : roles.filter(row => row.active && row.role !== 'paciente').map(row => row.role))}::jsonb,
                'employee_access_previous_ban',case when raw_app_meta_data->>'employee_access_disabled'='true' then raw_app_meta_data->'employee_access_previous_ban' else to_jsonb(banned_until) end,
                'employee_access_ban_until',greatest(coalesce(banned_until,now()),now()+interval '100 years')),
                banned_until=greatest(coalesce(banned_until,now()),now()+interval '100 years'),updated_at=now() where id=${staff.profile_id}`
            }
            await tx`update public.staff set active=${b.active} where id=${staff.id}`
            if (b.active) {
              // Restore only existing, server-recorded labor grants; never insert duplicate roles.
              const restore = Array.isArray(metadata.employee_access_roles) && metadata.employee_access_roles.length
                ? [...new Set(metadata.employee_access_roles)].filter(role => typeof role === 'string' && role !== 'admin' && role !== 'paciente')
                : [staff.category]
              if (!restore.includes(staff.category)) throw new Failure('La autorización guardada no incluye el cargo del empleado. Revisa sus permisos.',409)
              await tx`update public.user_roles set active=true where user_id=${staff.profile_id} and role::text in (select jsonb_array_elements_text(${tx.json(restore)}::jsonb))`
            } else {
              // RLS checks the current database role and staff flag, not the old JWT claims.
              // Revoking all labor roles therefore covers previously issued sessions too.
              await tx`update public.user_roles set active=false where user_id=${staff.profile_id} and role<>'paciente' and active`
              const [revoked] = await tx`select not exists(select 1 from public.user_roles where user_id=${staff.profile_id} and role<>'paciente' and active) as valid`
              if (!revoked?.valid) throw new Failure('No se pudieron revocar todos los permisos laborales. Los cambios se revirtieron.',409)
            }
          } else {
            if (String(b.personVersion) !== staff.version) throw new Failure('Los datos cambiaron. Actualiza el directorio.',409)
            const v=b.values ?? {}
            const [user] = await tx`select email from auth.users where id=${staff.profile_id}`
            const data=validate({ givenNames:v.given_names,familyNames:v.family_names,phone:v.phone,birthDate:v.birth_date??'',city:v.city??'',employeeCode:staff.employee_code,email:user.email,role:staff.category==='doctor'?'doctor':'receptionist',specialties:v.specialties,active:staff.active })
            expectedUpdate = data
            await tx`update public.profiles set first_name=${data.givenNames},last_name=${data.familyNames},phone=${data.phone},birth_date=${data.birthDate||null}::date,city=${data.city||null} where id=${staff.profile_id}`
            await tx`delete from public.doctor_specialties where doctor_id=${staff.id}`
            for (const sp of data.specialties) {
              const valid=await tx`select id from public.specialties where id=${sp}::bigint and active for share`
              if (!valid.length) throw new Failure('Especialidad inactiva.',409)
              await tx`insert into public.doctor_specialties values(${staff.id},${sp}::bigint)`
            }
          }
          await tx`insert into public.audit_logs(actor_id,action,entity_type,entity_id) values(${caller},${b.action},'staff',${staff.id})`
          {
            const [confirmed] = await directory(staff.id, tx)
            if (!confirmed || (b.action === 'state' && confirmed.active !== b.active)) throw new Failure('No se pudieron confirmar los datos guardados. Los cambios se revirtieron.',409)
            if (expectedUpdate && (confirmed.givenNames !== expectedUpdate.givenNames || confirmed.familyNames !== expectedUpdate.familyNames || confirmed.phone !== expectedUpdate.phone || confirmed.city !== (expectedUpdate.city || null) || confirmed.birthDate !== (expectedUpdate.birthDate || null) || confirmed.employeeCode !== expectedUpdate.employeeCode || JSON.stringify([...confirmed.specialties].sort()) !== JSON.stringify([...expectedUpdate.specialties].sort()))) throw new Failure('Los datos guardados no coinciden con los solicitados. Los cambios se revirtieron.',409)
            if (b.action === 'state') {
              const [access] = await tx`select case when ${b.active} then banned_until is null or banned_until<=now() else banned_until>now() end as valid from auth.users where id=${staff.profile_id}`
              if (!access?.valid) throw new Failure('No se pudo confirmar el acceso de la cuenta. Los cambios se revirtieron.',409)
            }
            savedEmployee = confirmed
          }
        }
      })
      if (target) {
        // Auth is outside the SQL transaction. Keep durable recovery data until unban succeeds.
        const finished = await admin.auth.admin.updateUserById(target,{ ban_duration:'none', app_metadata:{ employee_pending:false,employee_payload:null,employee_initial_credentials:null } }); check(finished)
      }
    } catch (error) {
      if (target) throw new Failure(`Alta pendiente de recuperación. La cuenta sigue bloqueada. Reanuda desde el panel. Referencia: ${target}`,409)
      if (error instanceof Failure) throw error
      throw new Failure('No se pudo completar la operación. Actualiza el directorio y vuelve a intentarlo.',409)
    }
    return reply({ success:true, ...(savedEmployee ? { employee: savedEmployee } : {}), ...(completedStaffId ? { staffId: completedStaffId, employeeCode: completedEmployeeCode } : {}), ...(deliverCredentials && payload && initialPassword ? { credentials: { email: payload.email, password: initialPassword }, employee: { givenNames: payload.givenNames, familyNames: payload.familyNames, role: payload.role, active: payload.active } } : {}) })
  } catch (error) {
    return new Response(JSON.stringify({ error:error instanceof Failure ? error.message : 'No se pudo procesar la solicitud.', ...(error instanceof Failure && error.code ? { code: error.code } : {}) }),{ status:error instanceof Failure ? error.status : 500,headers })
  }
})
