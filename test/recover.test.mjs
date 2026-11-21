import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { extractValues, readGraph, readPngText } from '../lib/recover.js'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Build a chunk. The reader does not verify CRCs, so a zero CRC is fine. */
function chunk(type, data) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length, 0)
  header.write(type, 4, 'ascii')
  return Buffer.concat([header, data, Buffer.alloc(4)])
}

/** Minimal 1×1 RGB PNG carrying the given tEXt chunks. */
function makePng(textChunks) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr)]
  for (const [key, value] of Object.entries(textChunks)) {
    parts.push(
      chunk('tEXt', Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')])),
    )
  }
  parts.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

async function writeTemp(t, name, bytes) {
  const dir = await mkdtemp(path.join(tmpdir(), 'krea2-recover-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, name)
  await writeFile(file, bytes)
  return file
}

const GRAPH = {
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'a red fox', clip: ['2', 0] } },
  5: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
  6: { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 512, batch_size: 1 } },
  8: { class_type: 'KSampler', inputs: { seed: 2024, steps: 12, model: ['7', 0] } },
}

const PARAMS = [
  { id: '4.text', keys: ['4.text'] },
  { id: '5.text', keys: ['5.text'] },
  { id: '6.width', keys: ['6.width'] },
  { id: '6.height', keys: ['6.height'] },
  { id: '8.seed', keys: ['8.seed'] },
  { id: '8.steps', keys: ['8.steps'] },
]

test('reads tEXt chunks out of a PNG', async (t) => {
  const file = await writeTemp(t, 'a.png', makePng({ prompt: '{"x":1}', workflow: '{"nodes":[]}' }))
  const chunks = await readPngText(file)
  assert.equal(chunks.prompt, '{"x":1}')
  assert.equal(chunks.workflow, '{"nodes":[]}')
})

test('returns null for a non-PNG file', async (t) => {
  const file = await writeTemp(t, 'a.png', Buffer.from('definitely not a png'))
  assert.equal(await readPngText(file), null)
  assert.equal(await readGraph(file), null)
})

test('returns null for a PNG without a prompt chunk', async (t) => {
  const file = await writeTemp(t, 'a.png', makePng({ workflow: '{}' }))
  assert.equal(await readGraph(file), null)
})

test('returns null when the prompt chunk is not valid JSON', async (t) => {
  const file = await writeTemp(t, 'a.png', makePng({ prompt: 'not json' }))
  assert.equal(await readGraph(file), null)
})

test('recovers every declared parameter from the graph', async (t) => {
  const file = await writeTemp(t, 'a.png', makePng({ prompt: JSON.stringify(GRAPH) }))
  const graph = await readGraph(file)
  const values = extractValues(graph, PARAMS)

  assert.equal(values['4.text'], 'a red fox')
  assert.equal(values['5.text'], '')
  assert.equal(values['6.width'], 768)
  assert.equal(values['6.height'], 512)
  assert.equal(values['8.seed'], 2024)
  assert.equal(values['8.steps'], 12)
})

test('a folded parameter reads from the first key that exists', () => {
  const folded = [{ id: 'width', keys: ['6.width', '7.width'] }]
  const graph = { 6: { inputs: { width: 640 } } }
  assert.deepEqual(extractValues(graph, folded), { width: 640 })
})

test('a graph of another shape yields null instead of partial values', () => {
  const wrong = { 4: { inputs: { text: 'x' } } } // no 5/6/8 nodes
  assert.equal(extractValues(wrong, PARAMS), null)
})

test('a link is never mistaken for a literal value', () => {
  const linked = { 4: { inputs: { text: ['9', 0] } } }
  const one = [{ id: '4.text', keys: ['4.text'] }]
  assert.equal(extractValues(linked, one), null)
})
