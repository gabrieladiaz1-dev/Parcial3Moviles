import type { Employee, EmployeeInput } from './employees.ts'

export function employeeUpdatePayload(employee: Employee, form: EmployeeInput) {
  return {
    id: employee.id,
    staffVersion: employee.staffVersion,
    personVersion: employee.personVersion,
    values: {
      given_names: form.givenNames.trim(), family_names: form.familyNames.trim(),
      birth_date: form.birthDate || null, phone: form.phone.trim(), city: form.city.trim(),
      // Older deployed handlers require this field. Preserve it; never accept a new code from the form.
      employee_code: employee.employeeCode, specialties: [...form.specialties],
    },
  }
}

export function employeeUpdateMatches(employee: Employee, original: Employee, form: EmployeeInput) {
  return employee.id === original.id && employee.profileId === original.profileId &&
    employee.employeeCode === original.employeeCode && employee.email === original.email && employee.role === original.role &&
    employee.givenNames === form.givenNames.trim() && employee.familyNames === form.familyNames.trim() &&
    (employee.phone ?? '') === form.phone.trim() && (employee.city ?? '') === form.city.trim() &&
    (employee.birthDate ?? '') === form.birthDate &&
    JSON.stringify([...employee.specialties].sort()) === JSON.stringify([...form.specialties].sort())
}
