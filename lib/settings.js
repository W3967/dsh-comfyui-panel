/**
 * Panel settings: connection info, the active workflow, and that workflow's
 * remembered parameter values.
 *
 * Priority is saved file > bundle `config` seed > built-in defaults, so a user
 * who edits `cordis.patch.yml` gets those values until the panel saves its own.
 *
 * @module dsh-workflow-form/settings
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { DEFAULT_COMFY_URL } from './comfy.js'

/** The built-in preset the panel opens with. */
export const DEFAULT_WORKFLOW_ID = 'krea2-txt2img'

/** Stable settings shape; every key the panel can read or write. */
export const DEFAULT_SETTINGS = Object.freeze({
  comfyUrl: DEFAULT_COMFY_URL,
  comfyRoot: '',
  activeWorkflow: DEFAULT_WORKFLOW_ID,
  values: {},
  showAdvanced: false,
})

function text(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

/**
 * Keep only plain objects, so a hand-edited settings file cannot inject arrays
 * or class instances into the parameter store.
 */
function cleanValues(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return {}
  const out = {}
  for (const [workflowId, bag] of Object.entries(input)) {
    if (bag === null || typeof bag !== 'object' || Array.isArray(bag)) continue
    const kept = {}
    for (const [key, value] of Object.entries(bag)) {
      if (value === undefined) continue
      if (typeof value === 'object' && value !== null) continue
      kept[key] = value
    }
    out[workflowId] = kept
  }
  return out
}

/**
 * Coerce one raw object into a complete settings record.
 *
 * @param {unknown} input
 * @param {Readonly<typeof DEFAULT_SETTINGS>} [base]
 */
export function normalizeSettings(input, base = DEFAULT_SETTINGS) {
  const raw = input !== null && typeof input === 'object' ? input : {}
  const merged = { ...base }
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (Object.hasOwn(raw, key)) merged[key] = raw[key]
  }

  return {
    comfyUrl: text(merged.comfyUrl, DEFAULT_SETTINGS.comfyUrl),
    comfyRoot: typeof merged.comfyRoot === 'string' ? merged.comfyRoot.trim() : '',
    activeWorkflow: text(merged.activeWorkflow, DEFAULT_WORKFLOW_ID),
    values: cleanValues(merged.values),
    showAdvanced: merged.showAdvanced === true,
  }
}

/** DSH home: explicit config first, then the environment, then `~/.dsh`. */
export function resolveDshHome(explicit) {
  const fromConfig = typeof explicit === 'string' ? explicit.trim() : ''
  if (fromConfig !== '') return fromConfig
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  if (fromEnv !== '') return fromEnv
  return path.join(homedir(), '.dsh')
}

/**
 * @param {{ dshHome?: string, seed?: Record<string, unknown> }} options
 */
export function createSettings(options = {}) {
  const home = resolveDshHome(options.dshHome)
  // Historical directory name, kept so existing installs keep their settings
  // and presets. See the "Naming and compatibility" section in the README.
  const dir = path.join(home, 'krea2-panel')
  const file = path.join(dir, 'settings.json')

  let saved = {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed !== null && typeof parsed === 'object') saved = parsed
  } catch {
    // Missing or unreadable: fall back to the seed and defaults.
  }

  const seeded = normalizeSettings(options.seed ?? {})
  let current = normalizeSettings(saved, seeded)

  return {
    dir,
    file,
    read() {
      return { ...current, values: cleanValues(current.values) }
    },
    /**
     * Merge a partial update, persist it, and return the new record.
     *
     * @param {unknown} patch
     */
    write(patch) {
      const next = normalizeSettings(patch, current)
      try {
        mkdirSync(dir, { recursive: true })
        const temp = `${file}.tmp`
        writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8')
        renameSync(temp, file)
      } catch {
        // A read-only home keeps settings in memory for this process.
      }
      current = next
      return { ...current, values: cleanValues(current.values) }
    },
    /** Remember one workflow's parameter values without touching the rest. */
    rememberValues(workflowId, values) {
      if (typeof workflowId !== 'string' || workflowId === '') return
      return this.write({
        values: { ...current.values, [workflowId]: { ...(values ?? {}) } },
      })
    },
  }
}
