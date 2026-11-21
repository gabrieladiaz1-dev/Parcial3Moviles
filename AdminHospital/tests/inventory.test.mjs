import test from 'node:test'
import assert from 'node:assert/strict'
import { medicationLabel, medicationProblem, stockState } from '../src/lib/inventoryRules.ts'

const med = (stock, minimum, active = true) => ({ id: 'm', name: 'Paracetamol', strength: '500 mg', presentation: 'Tabletas', stock, minimum_stock: minimum, active })

test('estado del stock según existencia y mínimo', () => {
  assert.equal(stockState(med(50, 10)), 'Disponible')
  assert.equal(stockState(med(10, 10)), 'Stock bajo', 'En el mínimo ya es stock bajo')
  assert.equal(stockState(med(3, 10)), 'Stock bajo')
  assert.equal(stockState(med(0, 10)), 'Agotado')
  assert.equal(stockState(med(0, 0)), 'Agotado', 'Sin existencias siempre es agotado')
  assert.equal(stockState(med(50, 10, false)), 'Inactivo')
})

test('etiqueta del medicamento sin campos vacíos', () => {
  assert.equal(medicationLabel(med(1, 1)), 'Paracetamol · 500 mg · Tabletas')
  assert.equal(medicationLabel({ name: 'Suero', strength: null, presentation: '' }), 'Suero')
})

test('validación igual que save_medication', () => {
  const ok = { name: 'Paracetamol', presentation: 'Tabletas', strength: '500 mg', minimum: 10, active: true, initial: 0 }
  assert.equal(medicationProblem(ok), null)
  assert.match(medicationProblem({ ...ok, name: '  ' }), /nombre/)
  assert.match(medicationProblem({ ...ok, minimum: -1 }), /mínimo/)
  assert.match(medicationProblem({ ...ok, minimum: 2.5 }), /mínimo/)
  assert.match(medicationProblem({ ...ok, initial: -5 }), /inicial/)
  assert.match(medicationProblem({ ...ok, strength: 'x'.repeat(101) }), /concentración/)
})
