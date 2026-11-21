/**
 * Named parameter sets: the numbers you typed into one workflow's form, saved
 * for reuse.
 *
 * Distinct from the workflow presets in `workflows.js` — those are graphs,
 * these are the values you fill into a graph. One graph can have many.
 *
 * @module dsh-comfyui-panel/presets
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Keep the store small and the values JSON-safe. */
function cleanValues(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const out = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'object') continue
    out[key] = value
  }
  return out
}

/**
 * @param {{ dir: string }} options
 */
export function createValuePresets({ dir }) {
  const file = path.join(dir, 'value-presets.json')

  function read() {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (Array.isArray(parsed?.presets)) return parsed.presets
    } catch {
      // Missing or corrupt: start empty rather than refusing to open.
    }
    return []
  }

  function write(presets) {
    mkdirSync(dir, { recursive: true })
    const temp = `${file}.tmp`
    writeFileSync(temp, JSON.stringify({ version: 1, presets }, null, 2), 'utf8')
    renameSync(temp, file)
  }

  return {
    /** All presets, or just one workflow's. */
    list(workflowId) {
      const all = read()
      const filtered = typeof workflowId === 'string' && workflowId !== ''
        ? all.filter((preset) => preset.workflowId === workflowId)
        : all
      return filtered.slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    },

    /**
     * Save under a name; the same name on the same workflow overwrites, so the
     * list cannot fill with duplicates.
     */
    save(input) {
      const workflowId = typeof input?.workflowId === 'string' ? input.workflowId.trim() : ''
      if (workflowId === '') throw new Error('缺少 workflowId。')

      const rawName = typeof input?.name === 'string' ? input.name.trim() : ''
      const name = rawName === '' ? '未命名' : rawName

      const values = cleanValues(input?.values)
      if (values === null) throw new Error('values 必须是一个对象。')

      const presets = read()
      const existing = presets.find((preset) => preset.workflowId === workflowId && preset.name === name)
      const record = {
        id: existing?.id ?? `vp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        workflowId,
        name,
        values,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      }

      write([...presets.filter((preset) => preset.id !== record.id), record])
      return record
    },

    remove(id) {
      const presets = read()
      const next = presets.filter((preset) => preset.id !== id)
      if (next.length === presets.length) return false
      write(next)
      return true
    },
  }
}
