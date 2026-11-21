/**
 * Panel settings: defaults, a JSON file under DSH home, and validation.
 *
 * Priority is saved file > bundle `config` seed > built-in defaults, so a user
 * who edits `cordis.patch.yml` gets those values until the panel saves its own.
 *
 * @module dsh-krea2-panel/settings
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { DEFAULT_COMFY_URL, clampInt } from './comfy.js'

/** Stable settings shape; every key the panel can read or write. */
export const DEFAULT_SETTINGS = Object.freeze({
  comfyUrl: DEFAULT_COMFY_URL,
  comfyRoot: '',
  mode: 'txt2img',
  unet: '',
  clip: '',
  vae: '',
  lora: '',
  loraStrength: 1,
  negative: '',
  width: 1024,
  height: 1024,
  steps: 8,
  cfg: 1,
  sampler: 'euler',
  maxShift: 1.15,
  baseShift: 0.5,
  showAdvanced: false,
})

const MODES = new Set(['txt2img', 'style_ref'])

/** Every sampler this panel offers; the graph passes the name through. */
export const SAMPLERS = Object.freeze([
  'euler',
  'euler_ancestral',
  'dpmpp_2m',
  'dpmpp_2m_sde',
  'dpmpp_sde',
  'heun',
  'lcm',
])

function text(value, fallback) {
  return typeof value === 'string' ? value.trim() : fallback
}

function number(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function boolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
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
    if (!Object.hasOwn(raw, key)) continue
    merged[key] = raw[key]
  }

  const mode = text(merged.mode, DEFAULT_SETTINGS.mode)
  return {
    comfyUrl: text(merged.comfyUrl, DEFAULT_SETTINGS.comfyUrl) || DEFAULT_SETTINGS.comfyUrl,
    comfyRoot: text(merged.comfyRoot, DEFAULT_SETTINGS.comfyRoot),
    mode: MODES.has(mode) ? mode : DEFAULT_SETTINGS.mode,
    unet: text(merged.unet, DEFAULT_SETTINGS.unet),
    clip: text(merged.clip, DEFAULT_SETTINGS.clip),
    vae: text(merged.vae, DEFAULT_SETTINGS.vae),
    lora: text(merged.lora, DEFAULT_SETTINGS.lora),
    loraStrength: clampInt(number(merged.loraStrength, 1) * 100, 0, 200, 100) / 100,
    negative: typeof merged.negative === 'string' ? merged.negative : DEFAULT_SETTINGS.negative,
    width: clampInt(merged.width, 256, 1280, DEFAULT_SETTINGS.width),
    height: clampInt(merged.height, 256, 1280, DEFAULT_SETTINGS.height),
    steps: clampInt(merged.steps, 1, 60, DEFAULT_SETTINGS.steps),
    cfg: Math.min(10, Math.max(0, number(merged.cfg, DEFAULT_SETTINGS.cfg))),
    sampler: SAMPLERS.includes(text(merged.sampler, '')) ? text(merged.sampler, '') : DEFAULT_SETTINGS.sampler,
    maxShift: Math.min(4, Math.max(0, number(merged.maxShift, DEFAULT_SETTINGS.maxShift))),
    baseShift: Math.min(4, Math.max(0, number(merged.baseShift, DEFAULT_SETTINGS.baseShift))),
    showAdvanced: boolean(merged.showAdvanced, DEFAULT_SETTINGS.showAdvanced),
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
    /** Directory holding the settings file (also used for nothing else). */
    dir,
    file,
    /** Current effective settings. */
    read() {
      return { ...current }
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
      return { ...current }
    },
  }
}
