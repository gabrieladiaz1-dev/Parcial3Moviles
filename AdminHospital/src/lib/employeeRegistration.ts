import type { Employee, EmployeeInput, EmployeeMutationResult } from './employees'

type Request = <T>(action: string, data?: object) => Promise<T>
export async function confirmEmployeeRegistration(result: EmployeeMutationResult, input: EmployeeInput, request: Request): Promise<Employee> {
  if (result?.success !== true) throw new Error('El servicio no confirmó el registro. Los datos del formulario se conservaron.')
  let id = result.staffId || result.employee?.id
  if (!id) {
    const directory = await request<{ employees: Employee[] }>('list', { query: input.email.trim(), role: '', status: '', offset: 0 })
    const matches = directory.employees.filter(employee => employee.email.toLowerCase() === input.email.trim().toLowerCase())
    if (matches.length !== 1) throw new Error('El servicio aceptó el alta, pero el directorio no confirma un único empleado con este correo.')
    id = matches[0].id
  }
  const saved = await request<Employee>('detail', { id })
  if (!saved || typeof saved.email !== 'string' || !Array.isArray(saved.specialties)) throw new Error('No se pudo verificar la ficha del nuevo empleado. Conservamos el registro recibido para volver a consultarlo.')
  const sorted = (value: string[]) => [...value].map(String).sort().join(',')
  if (saved.id !== id || !saved.profileId || !saved.employeeCode || saved.email.toLowerCase() !== input.email.trim().toLowerCase() || saved.givenNames !== input.givenNames.trim() || saved.familyNames !== input.familyNames.trim() || saved.role !== input.role || saved.active !== input.active || (saved.phone ?? '').replace(/\D/g, '') !== input.phone.replace(/\D/g, '') || (saved.birthDate ?? '') !== input.birthDate || (saved.city ?? '') !== input.city.trim() || sorted(saved.specialties) !== sorted(input.specialties)) throw new Error('El alta fue recibida, pero la ficha no confirma todos los datos guardados. Se conservará esta operación para volver a verificarla sin crear otra cuenta.')
  return saved
}
