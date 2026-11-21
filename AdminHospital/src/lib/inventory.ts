import { receptionRpc } from './reception'

export * from './inventoryRules'
import type { MedicationInput, InventoryOverview } from './inventoryRules'

export const readInventory = () => receptionRpc<InventoryOverview>('inventory_overview', {})
export const saveMedication = (input: MedicationInput, id?: string) => receptionRpc<string>('save_medication', {
  p_name: input.name.trim(), p_presentation: input.presentation.trim(), p_strength: input.strength.trim(),
  p_minimum: input.minimum, p_active: input.active, p_initial: id ? 0 : input.initial, p_id: id ?? null,
})
export const addStock = (medication: string, quantity: number, reason: string) =>
  receptionRpc<null>('add_inventory', { p_medication: medication, p_quantity: quantity, p_reason: reason.trim() || 'Entrada de inventario' })
