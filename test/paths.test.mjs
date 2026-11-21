import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveOutputFile } from '../lib/routes.js'

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'krea2-paths-'))
  const comfyRoot = path.join(root, 'ComfyUI')
  await mkdir(path.join(comfyRoot, 'output'), { recursive: true })
  await mkdir(path.join(comfyRoot, 'temp'), { recursive: true })
  await mkdir(path.join(comfyRoot, 'input'), { recursive: true })
  await writeFile(path.join(comfyRoot, 'output', 'krea2_t2i_00001_.png'), PNG)
  await writeFile(path.join(comfyRoot, 'output', 'notes.txt'), 'hello')
  await writeFile(path.join(comfyRoot, 'input', 'reference.png'), PNG)
  await writeFile(path.join(root, 'outside.png'), PNG)
  return { root, comfyRoot }
}

test('accepts a generated image inside output', async (t) => {
  const { root, comfyRoot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const resolved = await resolveOutputFile(path.join(comfyRoot, 'output', 'krea2_t2i_00001_.png'), comfyRoot)
  assert.ok(resolved !== null)
  assert.ok(resolved.endsWith('krea2_t2i_00001_.png'))
})

test('rejects a readable image outside output and temp', async (t) => {
  const { root, comfyRoot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  assert.equal(await resolveOutputFile(path.join(root, 'outside.png'), comfyRoot), null)
  assert.equal(await resolveOutputFile(path.join(comfyRoot, 'input', 'reference.png'), comfyRoot), null)
})

test('rejects traversal and non-image extensions', async (t) => {
  const { root, comfyRoot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const traversal = path.join(comfyRoot, 'output', '..', 'input', 'reference.png')
  assert.equal(await resolveOutputFile(traversal, comfyRoot), null)
  assert.equal(await resolveOutputFile(path.join(comfyRoot, 'output', 'notes.txt'), comfyRoot), null)
})

test('rejects an empty path, a missing file, and an unset root', async (t) => {
  const { root, comfyRoot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  assert.equal(await resolveOutputFile('', comfyRoot), null)
  assert.equal(await resolveOutputFile(null, comfyRoot), null)
  assert.equal(await resolveOutputFile(path.join(comfyRoot, 'output', 'gone.png'), comfyRoot), null)
  assert.equal(await resolveOutputFile(path.join(comfyRoot, 'output', 'krea2_t2i_00001_.png'), ''), null)
})
