import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { jsonSchemaToZod } from './schema'

for (const { type, values, invalid } of [
  { type: 'string', values: ['alpha', 'beta'], invalid: [1] },
  { type: 'number', values: [10, 20], invalid: ['10'] },
  { type: 'boolean', values: [true, false], invalid: ['true'] },
]) {
  test(`converts ${type} arrays without coercing scalars or array elements`, () => {
    const shape = jsonSchemaToZod({ values: { type: 'array', items: { type }, description: 'Array values' } }, [
      'values',
    ])
    const schema = z.object(shape)

    assert.deepEqual(schema.parse({ values }), { values })
    assert.deepEqual(schema.parse({ values: [] }), { values: [] })
    for (const value of [undefined, null, values[0], invalid, [...values, ...invalid]]) {
      assert.equal(schema.safeParse({ values: value }).success, false)
    }
    assert.equal(shape.values.description, 'Array values')
  })
}

test('keeps optional arrays optional and does not apply JSON Schema defaults', () => {
  const schema = z.object(jsonSchemaToZod({ values: { type: 'array', items: { type: 'string' }, default: ['alpha'] } }))

  assert.deepEqual(schema.parse({}), {})
  assert.deepEqual(schema.parse({ values: ['beta'] }), { values: ['beta'] })
})

for (const items of [{ type: 'object' }, { type: 'array' }, { type: 'integer' }, undefined]) {
  test(`preserves the string/enum fallback for arrays with ${items?.type ?? 'missing'} items`, () => {
    const shape = jsonSchemaToZod(
      {
        required: { type: 'array', items, description: 'Unsupported array' },
        optional: { type: 'array', items, default: ['alpha'] },
        choice: { type: 'array', items, enum: ['alpha', 'beta'] },
      },
      ['required']
    )
    const schema = z.object(shape)

    assert.deepEqual(schema.parse({ required: 'alpha' }), { required: 'alpha' })
    const values = { required: 'alpha', optional: 'beta', choice: 'alpha' }
    assert.deepEqual(schema.parse(values), values)
    assert.equal(schema.safeParse({}).success, false)
    assert.equal(schema.safeParse({ ...values, choice: 'gamma' }).success, false)
    for (const value of [[], ['alpha'], [{ name: 'Alice', count: 4 }]]) {
      assert.equal(schema.safeParse({ ...values, required: value }).success, false)
      assert.equal(schema.safeParse({ ...values, optional: value }).success, false)
    }
    assert.equal(shape.required.description, 'Unsupported array')
  })
}

test('preserves scalar, enum, fallback, required and default conversion behavior', () => {
  const shape = jsonSchemaToZod(
    {
      text: { type: 'string', description: 'Text value' },
      count: { type: 'number', default: 5 },
      enabled: { type: 'boolean' },
      mode: { type: 'string', enum: ['text', 'json'] },
      fallback: { type: 'object' },
    },
    ['text', 'mode']
  )
  const schema = z.object(shape)
  const required = { text: 'hello', mode: 'json' }
  const all = { ...required, count: 2, enabled: false, fallback: 'value' }

  assert.deepEqual(schema.parse(required), required)
  assert.deepEqual(schema.parse(all), all)
  for (const value of [
    {},
    { ...all, text: 1 },
    { ...all, count: '2' },
    { ...all, enabled: 'false' },
    { ...all, mode: 'xml' },
    { ...all, fallback: {} },
  ]) {
    assert.equal(schema.safeParse(value).success, false)
  }
  assert.equal(shape.text.description, 'Text value')
})
