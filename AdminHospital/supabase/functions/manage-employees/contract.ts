// Additive contract: legacy request/response fields remain supported.
export const employeeContract = {
  version: 'employees-2026-11-registration-v4',
  actions: ['contract', 'catalogs', 'pending', 'list', 'detail', 'create', 'recover', 'update', 'state'],
  features: ['mutation-readback', 'auth-state-control', 'deactivation-impact', 'live-role-revocation', 'restore-authorized-roles', 'server-employee-code', 'server-initial-password', 'unique-temporary-password', 'field-validation-errors'],
} as const
