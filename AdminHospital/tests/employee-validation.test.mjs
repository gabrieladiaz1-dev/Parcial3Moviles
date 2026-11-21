import test from 'node:test'
import assert from 'node:assert/strict'
import { formatEmployeePhone, validEmployeePhone, validEmployeeBirthDate, nextEmployeeCode } from '../supabase/functions/manage-employees/validation.ts'
import { localityGroups, localities, searchLocalities } from '../src/lib/elSalvadorLocalities.ts'

test('códigos consecutivos de tres dígitos, sin desbordamiento ni vuelta a 001', () => {
  for (const [last, expected] of [[0, '001'], ['004', '005'], [9, '010'], [99, '100'], [998, '999']]) assert.equal(nextEmployeeCode(last), expected)
  for (const last of [999, 1000, -1, 1.5, 'inválido']) assert.throws(() => nextEmployeeCode(last), RangeError)
})

test('normaliza números pegados, prefijo internacional y límite de ocho dígitos', () => {
  assert.equal(formatEmployeePhone('+503 7777-1234'), '7777-1234')
  assert.equal(formatEmployeePhone('abc7777 . 1234XYZ9'), '7777-1234')
  assert.equal(formatEmployeePhone('77771'), '7777-1')
  assert.equal(formatEmployeePhone(''), '')
})

test('acepta prefijos vigentes y rechaza teléfonos incompletos o inválidos', () => {
  for (const prefix of ['2', '5', '6', '7']) assert.ok(validEmployeePhone(`${prefix}123-4567`))
  for (const value of ['8123-4567', '777-1234', '7777-12345', 'abcd-efgh', '+50377771234']) assert.equal(validEmployeePhone(value), false)
})

test('valida fechas reales, años bisiestos, límites y fecha opcional', () => {
  const today = '2026-11-18'
  for (const value of ['', '1900-01-01', '2000-02-29', today]) assert.ok(validEmployeeBirthDate(value, today))
  for (const value of ['1900-02-29', '2025-02-29', '2020-04-31', '2020-13-01', '2026-11-19', '1899-12-31', '18/11/1990', '1990-1-1']) assert.equal(validEmployeeBirthDate(value, today), false)
})

test('catálogo completo, sin distritos duplicados dentro de un municipio', () => {
  assert.equal(localityGroups.length, 44)
  assert.equal(localities.length, 262)
  assert.equal(new Set(localities.map(item => item.department)).size, 14)
  assert.equal(new Set(localities.map(item => `${item.municipality}/${item.name}`)).size, 262)
})

test('búsqueda sin acentos, coincidencia exacta primero y contexto municipal', () => {
  assert.equal(searchLocalities('san salvador')[0].name, 'San Salvador')
  assert.equal(searchLocalities('ataco')[0].name, 'Concepción de Ataco')
  assert.equal(searchLocalities('San Salvador Centro').length, 5)
  assert.equal(searchLocalities('zzzz').length, 0)
  assert.equal(searchLocalities('El Rosario').filter(item => item.name === 'El Rosario').length, 3)
  for (const name of ['Ilopango', 'Ilobasco', 'Izalco', 'Intipucá', 'Mercedes Umaña']) assert.ok(localities.some(item => item.name === name))
})
