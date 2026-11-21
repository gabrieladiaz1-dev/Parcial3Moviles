// Reglas puras del inventario (sin red): estado del stock, etiqueta y validación igual que save_medication.
export interface Medication {
  id: string
  name: string
  presentation: string | null
  strength: string | null
  stock: number
  minimum_stock: number
  active: boolean
}
export interface InventoryMovement { id: number; created_at: string; quantity: number; reason: string | null; medication: string; actor: string }
export interface InventoryOverview { medications: Medication[]; movements: InventoryMovement[] }
export interface MedicationInput { name: string; presentation: string; strength: string; minimum: number; active: boolean; initial: number }

export type StockState = 'Disponible' | 'Stock bajo' | 'Agotado' | 'Inactivo'

/** Agotado: sin existencias. Stock bajo: en o por debajo del mínimo configurado. */
export function stockState(item: Medication): StockState {
  if (!item.active) return 'Inactivo'
  if (item.stock <= 0) return 'Agotado'
  if (item.stock <= item.minimum_stock) return 'Stock bajo'
  return 'Disponible'
}

export function medicationLabel(item: Pick<Medication, 'name' | 'strength' | 'presentation'>): string {
  return [item.name, item.strength, item.presentation].filter(Boolean).join(' · ')
}

/** Valida en el cliente lo mismo que save_medication en el servidor; devuelve el mensaje o null. */
export function medicationProblem(input: MedicationInput): string | null {
  if (!input.name.trim() || input.name.length > 200) return 'Escribe el nombre del medicamento.'
  if (input.presentation.length > 200 || input.strength.length > 100) return 'Revisa la presentación y la concentración.'
  if (!Number.isInteger(input.minimum) || input.minimum < 0) return 'El stock mínimo debe ser un número entero igual o mayor que cero.'
  if (!Number.isInteger(input.initial) || input.initial < 0) return 'El stock inicial debe ser un número entero igual o mayor que cero.'
  return null
}
