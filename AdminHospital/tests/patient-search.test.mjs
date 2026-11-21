import test from 'node:test'
import assert from 'node:assert/strict'
import { maskPatientDui, patientExactFilter, patientMatch, patientPrimaryFilter, patientSearchFilter, patientSearchIntent, patientTextPattern, possiblePatientDuplicates, rankPatientMatches, searchText } from '../src/lib/patientSearch.ts'

const patient = (id, first, last, values = {}) => ({ id, first_name: first, last_name: last, dui: null, phone: null, email: null, patient_code: `PAC-${id}`, record_code: null, ...values })

test('fati prioriza Fátima por nombre y excluye la coincidencia accidental del correo de Daniela', () => {
  const rows = [patient('daniela', 'Daniela Abigail', 'Rivera', { email: 'fatima@example.test' }), patient('fatima', 'Fátima Daniela', 'Rivera Díaz', { email: 'daniela@example.test' })]
  const original = structuredClone(rows)
  assert.deepEqual(rankPatientMatches(rows, 'fati').map(row => row.id), ['fatima'])
  assert.equal(patientMatch(rows[1], 'fati').label, 'Nombre')
  assert.deepEqual(rankPatientMatches(rows, 'fatima@').map(row => row.id), ['daniela'])
  assert.equal(patientMatch(rows[0], 'fatima@example.test').label, 'Correo')
  assert.deepEqual(rows, original, 'Searching never swaps or modifies personal data')
})

test('clasifica la intención y consulta el campo prioritario sin mezclarlo con secundarios', () => {
  for (const [query, intent] of [['fati', 'name'], ['FÁTIMA DANIELA', 'name'], ['fatima@', 'email'], ['7777-1234', 'phone'], ['+503 77771234', 'phone'], ['123456789', 'dui'], ['12345678-9', 'dui'], ['EXP-123', 'record']]) assert.equal(patientSearchIntent(query), intent)
  assert.ok(!patientPrimaryFilter('fati').includes('email.'))
  assert.ok(patientPrimaryFilter('fatima@').startsWith('email.imatch.'))
})

test('búsqueda sin tildes funciona también en el patrón enviado al servidor', () => {
  const regex = new RegExp(patientTextPattern('fati'), 'i')
  assert.ok(regex.test('Fátima'))
  assert.ok(regex.test('Fatima'))
  assert.ok(new RegExp(patientTextPattern('lopez'), 'i').test('LÓPEZ'))
  assert.ok(!regex.test('Daniela'))
  for (const term of ['a.*', 'a(b)', 'a|b', 'a[0-9]', '^a$', 'a+b?']) {
    const literal = new RegExp(`^${patientTextPattern(term)}$`, 'i')
    assert.ok(literal.test(term))
    assert.ok(!literal.test('unrelated'))
  }
})

test('ordena exacta, inicio y parcial dentro del campo buscado', () => {
  const rows = [patient('partial', 'Alfati', 'Local'), patient('prefix', 'Fátima', 'Local'), patient('exact', 'Fati', 'Local'), patient('mail', 'Otra', 'Persona', { email: 'fati' })]
  assert.deepEqual(rankPatientMatches(rows, 'fati').map(row => row.id), ['exact', 'prefix', 'partial'])
  assert.deepEqual(rows.map(row => row.id), ['partial', 'prefix', 'exact', 'mail'])
})

test('teléfono y DUI tienen prioridad sobre números accidentales en correo', () => {
  const rows = [patient('mail', 'Otro', 'Registro', { email: '77771234@example.test' }), patient('phone', 'Paciente', 'Teléfono', { phone: '7777-1234' }), patient('dui', 'Paciente', 'Documento', { dui: '12345678-9', phone: '123456789' })]
  assert.deepEqual(rankPatientMatches(rows, '77771234').map(row => row.id), ['phone'])
  assert.equal(patientMatch(rows[1], '+503 7777-1234').label, 'Teléfono')
  assert.deepEqual(rankPatientMatches(rows, '12345678-9').map(row => row.id), ['dui'])
  assert.equal(patientMatch(rows[2], '12345678-9').label, 'DUI')
  assert.equal(rankPatientMatches(rows, '77')[0].id, 'phone')
})

test('mantiene campos secundarios disponibles cuando no hay coincidencia principal y explica el motivo', () => {
  const mail = patient('mail', 'Persona', 'Local', { email: 'fatima@example.test' })
  assert.deepEqual(rankPatientMatches([mail], 'fati'), [mail])
  assert.equal(patientMatch(mail, 'fati').label, 'Correo')
  const record = patient('record', 'Persona', 'Archivo', { record_code: 'EXP-123' })
  assert.equal(patientMatch(record, 'EXP-123').label, 'Expediente')
  assert.equal(patientMatch(mail, 'PAC-mail').label, 'Código de paciente')
  assert.deepEqual(rankPatientMatches([mail], 'sin coincidencias'), [])
})

test('nombre completo usa todos los términos en nombres o apellidos sin depender del orden', () => {
  const filter = patientSearchFilter('Ana María López')
  assert.ok(filter.includes('and(or(first_name.imatch.'))
  for (const term of ['Ana', 'María', 'López']) assert.ok(filter.includes(JSON.stringify(patientTextPattern(term))))
  assert.equal(searchText('  Ana   López  '), 'Ana López')
  assert.equal(searchText('a'.repeat(150)).length, 120)
  assert.ok(patientExactFilter('Ana María López').includes(`and(first_name.imatch.${JSON.stringify(`^${patientTextPattern('Ana María')}$`)},last_name.imatch.${JSON.stringify(`^${patientTextPattern('López')}$`)})`))
})

test('búsqueda de documentos y teléfonos tolera separadores sin ampliar filtros con texto arbitrario', () => {
  assert.ok(patientSearchFilter('12345678-9').includes('dui.ilike."%1%2%3%4%5%6%7%8%9%"'))
  assert.ok(patientSearchFilter('7777-1234').includes('phone.ilike.'))
  assert.ok(patientSearchFilter('+503 7777-1234').includes('phone.ilike."%7%7%7%7%1%2%3%4%"'))
  const input = 'Ana",id.not.is.null,(x'
  assert.ok(patientSearchFilter(input).includes(JSON.stringify(patientTextPattern(input))))
  assert.ok(new RegExp(`^${patientTextPattern('50%_\\')}$`, 'i').test('50%_\\'))
})

test('coincidencias exactas primero, luego prefijos, orden alfabético estable y sin repetir pacientes', () => {
  const exact = patient('1', 'Ana', 'López')
  const prefix = patient('2', 'Ana', 'López Martínez')
  const middle = patient('3', 'María Ana', 'López')
  assert.deepEqual(rankPatientMatches([middle, prefix, exact, exact], 'ANA LÓPEZ').map(row => row.id), ['1', '2', '3'])
  const email = patient('4', 'Otro', 'Nombre', { email: 'Persona@correo.test' })
  assert.equal(rankPatientMatches([middle, email], 'persona@correo.test')[0].id, '4')
  const record = patient('5', 'Otro', 'Registro', { record_code: 'EXP-001' })
  assert.equal(rankPatientMatches([middle, record], 'exp-001')[0].id, '5')
})

test('documento completo nunca se muestra en la máscara de resultados', () => {
  assert.equal(maskPatientDui('12345678-9'), '•••••678-9')
  assert.equal(maskPatientDui(null), 'No registrado')
  assert.equal(maskPatientDui('123'), 'No registrado')
})

test('nombre o teléfono compartido solo genera advertencias de posibles duplicados', () => {
  const rows = [patient('1', 'Ana', 'López', { dui: '11111111-1', phone: '7777-1234' }), patient('2', 'ANA', 'LOPEZ', { dui: '22222222-2' }), patient('3', 'Nombre', 'Distinto', { phone: '77771234' }), patient('4', 'Otra', 'Persona')]
  assert.deepEqual([...possiblePatientDuplicates(rows)].sort(), ['1', '2', '3'])
  assert.equal(rows[0].dui, '11111111-1')
  assert.equal(possiblePatientDuplicates([patient('1', 'A', 'B'), patient('2', 'C', 'D')]).size, 0)
})
