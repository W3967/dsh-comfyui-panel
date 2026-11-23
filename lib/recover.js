/**
 * Recover a generation's parameters from the PNG ComfyUI wrote.
 *
 * ComfyUI embeds the submitted graph as a `prompt` tEXt chunk, so any history
 * image already carries everything needed to reproduce it — no side database
 * required.
 *
 * @module dsh-workflow-form/recover
 */

import fs from 'node:fs/promises'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Read a PNG's tEXt chunks.
 *
 * Only `tEXt` is handled: that is what ComfyUI writes. `zTXt` / `iTXt` would
 * need a decompressor for no practical gain here.
 *
 * @param {string} filePath
 * @returns {Promise<Record<string, string> | null>} null when this is not a PNG
 */
export async function readPngText(filePath) {
  let buffer
  try {
    buffer = await fs.readFile(filePath)
  } catch {
    return null
  }
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null

  const chunks = {}
  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (type === 'IEND') break
    if (offset + 12 + length > buffer.length) break

    if (type === 'tEXt') {
      const data = buffer.subarray(offset + 8, offset + 8 + length)
      const zero = data.indexOf(0)
      if (zero > 0) {
        chunks[data.toString('latin1', 0, zero)] = data.toString('latin1', zero + 1)
      }
    }
    offset += 12 + length
  }
  return chunks
}

/**
 * Parse the embedded API-format graph.
 *
 * @param {string} filePath
 * @returns {Promise<Record<string, any> | null>}
 */
export async function readGraph(filePath) {
  const chunks = await readPngText(filePath)
  if (chunks === null || typeof chunks.prompt !== 'string') return null
  try {
    const graph = JSON.parse(chunks.prompt)
    if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) return null
    return graph
  } catch {
    return null
  }
}

/**
 * Pull one preset's parameter values out of a recovered graph.
 *
 * Returns null when the graph does not have the same shape — a different
 * workflow, or a node the preset expects is absent. That is the signal to try
 * the next preset rather than a failure.
 *
 * @param {Record<string, any>} graph
 * @param {Array<{ id: string, keys: string[] }>} params
 * @returns {Record<string, unknown> | null}
 */
export function extractValues(graph, params) {
  const values = {}
  for (const param of params) {
    let found = false
    for (const key of param.keys) {
      const dot = key.indexOf('.')
      if (dot <= 0) continue
      const nodeId = key.slice(0, dot)
      const field = key.slice(dot + 1)
      const node = graph[nodeId]
      if (node === null || node === undefined || node.inputs === null || node.inputs === undefined) continue
      if (!Object.hasOwn(node.inputs, field)) continue
      const value = node.inputs[field]
      if (Array.isArray(value)) continue // a link, not a literal
      values[param.id] = value
      found = true
      break
    }
    // One missing field means this graph is not the preset's graph.
    if (!found) return null
  }
  return values
}
