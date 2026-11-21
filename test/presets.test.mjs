import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createValuePresets } from '../lib/presets.js'

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'krea2-presets-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return createValuePresets({ dir })
}

test('saves and lists a preset', async (t) => {
  const presets = await fixture(t)
  const saved = presets.save({ workflowId: 'w1', name: 'Wide', values: { '6.width': 1280, '6.height': 720 } })

  assert.equal(saved.name, 'Wide')
  assert.equal(saved.workflowId, 'w1')
  assert.equal(presets.list('w1').length, 1)
  assert.deepEqual(presets.list('w1')[0].values, { '6.width': 1280, '6.height': 720 })
})

test('the same name on the same workflow overwrites instead of duplicating', async (t) => {
  const presets = await fixture(t)
  const first = presets.save({ workflowId: 'w1', name: 'Wide', values: { a: 1 } })
  const second = presets.save({ workflowId: 'w1', name: 'Wide', values: { a: 2 } })

  assert.equal(first.id, second.id)
  const list = presets.list('w1')
  assert.equal(list.length, 1)
  assert.deepEqual(list[0].values, { a: 2 })
})

test('different workflows are isolated', async (t) => {
  const presets = await fixture(t)
  presets.save({ workflowId: 'w1', name: 'P', values: { a: 1 } })
  presets.save({ workflowId: 'w2', name: 'P', values: { a: 2 } })

  assert.equal(presets.list('w1').length, 1)
  assert.equal(presets.list('w2').length, 1)
  assert.equal(presets.list().length, 2)
})

test('removes by id and reports a miss', async (t) => {
  const presets = await fixture(t)
  const saved = presets.save({ workflowId: 'w1', name: 'P', values: { a: 1 } })

  assert.equal(presets.remove(saved.id), true)
  assert.equal(presets.list('w1').length, 0)
  assert.equal(presets.remove('does-not-exist'), false)
})

test('keeps only scalar values', async (t) => {
  const presets = await fixture(t)
  const saved = presets.save({
    workflowId: 'w1',
    name: 'P',
    values: { a: 1, b: null, c: { nested: 1 }, d: 'ok', e: true },
  })

  assert.deepEqual(saved.values, { a: 1, d: 'ok', e: true })
})

test('rejects a missing workflow and a non-object values bag', async (t) => {
  const presets = await fixture(t)
  assert.throws(() => presets.save({ name: 'x', values: {} }), /workflowId/)
  assert.throws(() => presets.save({ workflowId: 'w1', name: 'x', values: [1, 2] }), /values/)
})

test('an empty name falls back to a placeholder', async (t) => {
  const presets = await fixture(t)
  const saved = presets.save({ workflowId: 'w1', name: '   ', values: { a: 1 } })
  assert.equal(saved.name, '未命名')
})

test('survives a corrupt store file', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krea2-presets-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const { writeFile } = await import('node:fs/promises')
  await writeFile(path.join(dir, 'value-presets.json'), 'not json at all', 'utf8')

  const presets = createValuePresets({ dir })
  assert.deepEqual(presets.list(), [])
  // Writing after a corrupt read still works.
  const saved = presets.save({ workflowId: 'w1', name: 'P', values: { a: 1 } })
  assert.equal(saved.name, 'P')
})
