/**
 * ComfyUI transport and the two Krea 2 workflow graphs.
 *
 * The graphs mirror what ComfyUI's "Save (API Format)" exports from the
 * reference workflows; keeping them in code makes the bundle self-contained
 * instead of reading files out of the user's ComfyUI install.
 *
 * @module dsh-comfyui-panel/comfy
 */

import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Where ComfyUI usually listens. */
export const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188'

/** Model extensions ComfyUI loaders accept. */
const MODEL_EXTENSIONS = new Set(['.safetensors', '.gguf', '.ckpt', '.pt', '.pth', '.bin'])

const REQUEST_TIMEOUT_MS = 30_000

/** A failure the HTTP layer can surface verbatim. */
export class ComfyError extends Error {
  constructor(message, code = 'COMFY_ERROR', status = 500) {
    super(message)
    this.name = 'ComfyError'
    this.code = code
    this.status = status
  }
}

function trimBase(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return (text === '' ? DEFAULT_COMFY_URL : text).replace(/\/+$/, '')
}

/**
 * Resolve a route against a user-supplied base URL. A reverse-proxied base
 * such as `http://host/comfy` keeps its prefix because we concatenate rather
 * than resolving against the origin.
 *
 * @param {string} baseUrl
 * @param {string} route starts with `/`
 */
export function resolveUrl(baseUrl, route) {
  const url = new URL(trimBase(baseUrl) + route)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ComfyError(`不支持的协议：${url.protocol}`, 'BAD_URL', 400)
  }
  return url
}

/**
 * One JSON request/response against ComfyUI.
 *
 * @param {string} baseUrl
 * @param {string} method
 * @param {string} route
 * @param {unknown} [body]
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
 */
export function requestJson(baseUrl, method, route, body, options = {}) {
  const url = resolveUrl(baseUrl, route)
  const transport = url.protocol === 'https:' ? https : http
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8')
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method,
        headers:
          payload === null
            ? { accept: 'application/json' }
            : {
                accept: 'application/json',
                'content-type': 'application/json',
                'content-length': payload.length,
              },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const status = res.statusCode ?? 0
          if (status >= 400) {
            reject(new ComfyError(`ComfyUI 返回 HTTP ${status}：${text.slice(0, 500)}`, 'COMFY_HTTP', status))
            return
          }
          if (text === '') {
            resolve({})
            return
          }
          try {
            resolve(JSON.parse(text))
          } catch {
            resolve(text)
          }
        })
      },
    )

    const abort = () => req.destroy(new ComfyError('请求已取消', 'ABORTED', 499))
    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        abort()
        return
      }
      options.signal.addEventListener('abort', abort, { once: true })
      req.on('close', () => options.signal?.removeEventListener('abort', abort))
    }

    req.on('error', (error) => {
      if (error instanceof ComfyError) {
        reject(error)
        return
      }
      if (error.code === 'ECONNREFUSED') {
        reject(
          new ComfyError(
            `ComfyUI 未运行（${trimBase(baseUrl)}）。请先启动 ComfyUI，再在面板里刷新状态。`,
            'COMFY_OFFLINE',
            503,
          ),
        )
        return
      }
      reject(new ComfyError(`连接 ComfyUI 失败：${error.message}`, 'COMFY_UNREACHABLE', 503))
    })
    req.on('timeout', () => req.destroy(new ComfyError('ComfyUI 请求超时', 'COMFY_TIMEOUT', 504)))

    if (payload !== null) req.write(payload)
    req.end()
  })
}

/** Clamp an integer option into a range, falling back to the default. */
export function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/** Pick a random seed at the same scale ComfyUI uses. */
export function randomSeed() {
  return Math.floor(Math.random() * 1e12)
}

/**
 * `GET /object_info` — the metadata the form generator needs.
 *
 * Large (hundreds of kilobytes), so callers cache it; it only changes when the
 * user installs or removes custom nodes.
 *
 * @param {string} baseUrl
 * @param {{ timeoutMs?: number }} [options]
 */
export async function fetchObjectInfo(baseUrl, options = {}) {
  const info = await requestJson(baseUrl, 'GET', '/object_info', undefined, {
    timeoutMs: options.timeoutMs ?? 45_000,
  })
  if (info === null || typeof info !== 'object' || Array.isArray(info)) {
    throw new ComfyError('ComfyUI 返回的 /object_info 格式不正确', 'BAD_OBJECT_INFO', 502)
  }
  return info
}

/* ----------------------------- discovery ----------------------------- */

async function readModelDir(root, dirs) {
  const found = []
  for (const dir of dirs) {
    const full = path.join(root, dir)
    let entries
    try {
      entries = await fs.readdir(full, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isFile()) {
        if (MODEL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) found.push(entry.name)
        continue
      }
      if (!entry.isDirectory()) continue
      // ComfyUI names subfolders with `/` in loader dropdowns.
      let inner
      try {
        inner = await fs.readdir(path.join(full, entry.name), { withFileTypes: true })
      } catch {
        continue
      }
      for (const file of inner) {
        if (file.isFile() && MODEL_EXTENSIONS.has(path.extname(file.name).toLowerCase())) {
          found.push(`${entry.name}/${file.name}`)
        }
      }
    }
  }
  return [...new Set(found)].sort((a, b) => a.localeCompare(b))
}

/**
 * Scan `<comfyRoot>/models` for the four loader slots this panel offers.
 * Missing directories yield empty lists rather than an error: a fresh install
 * still opens, it just has nothing to pick from.
 *
 * @param {string} comfyRoot
 */
export async function listModels(comfyRoot) {
  const root = typeof comfyRoot === 'string' ? comfyRoot.trim() : ''
  if (root === '') return { unet: [], clip: [], vae: [], lora: [] }
  // `comfyRoot` is the ComfyUI directory itself; loaders read from its `models`.
  const modelsDir = path.join(root, 'models')
  const [unet, clip, vae, lora] = await Promise.all([
    readModelDir(modelsDir, ['diffusion_models', 'unet']),
    readModelDir(modelsDir, ['text_encoders', 'clip']),
    readModelDir(modelsDir, ['vae']),
    readModelDir(modelsDir, ['loras']),
  ])
  return { unet, clip, vae, lora }
}

/** `GET /system_stats`, reduced to what the panel shows. */
export async function systemStats(baseUrl, options = {}) {
  const stats = await requestJson(baseUrl, 'GET', '/system_stats', undefined, options)
  const system = stats?.system ?? {}
  const devices = Array.isArray(stats?.devices) ? stats.devices : []
  const device = devices[0] ?? {}
  return {
    online: true,
    comfyVersion: typeof system.comfyui_version === 'string' ? system.comfyui_version : undefined,
    pythonVersion: typeof system.python_version === 'string' ? system.python_version : undefined,
    deviceName: typeof device.name === 'string' ? device.name : undefined,
    vramTotal: typeof device.vram_total === 'number' ? device.vram_total : undefined,
    vramFree: typeof device.vram_free === 'number' ? device.vram_free : undefined,
  }
}

/** `POST /prompt`; rejects when ComfyUI reports node-level validation errors. */
export async function submitPrompt(baseUrl, workflow, options = {}) {
  const body = { prompt: workflow }
  if (typeof options.clientId === 'string' && options.clientId !== '') body.client_id = options.clientId
  const result = await requestJson(baseUrl, 'POST', '/prompt', body, options)
  const nodeErrors = result?.node_errors
  if (nodeErrors !== undefined && nodeErrors !== null) {
    const names = Object.keys(nodeErrors)
    if (names.length > 0) {
      const first = nodeErrors[names[0]]
      const detail = first?.errors?.[0]?.message ?? first?.class_type ?? '节点校验失败'
      throw new ComfyError(`工作流校验失败：${detail}`, 'WORKFLOW_INVALID', 400)
    }
  }
  const promptId = result?.prompt_id
  if (typeof promptId !== 'string' || promptId === '') {
    throw new ComfyError('ComfyUI 没有返回 prompt_id', 'NO_PROMPT_ID', 502)
  }
  return { promptId, number: result?.number }
}

/**
 * Fold a `/history/<id>` entry into the panel's shape.
 *
 * @param {unknown} entry
 * @returns {{ images: Array<{ filename: string, subfolder: string, type: string }>, completed: boolean, status: string }}
 */
export function readHistoryEntry(entry) {
  const outputs = entry?.outputs ?? {}
  const images = []
  for (const key of Object.keys(outputs)) {
    const list = outputs[key]?.images
    if (!Array.isArray(list)) continue
    for (const image of list) {
      if (typeof image?.filename !== 'string') continue
      images.push({
        filename: image.filename,
        subfolder: typeof image.subfolder === 'string' ? image.subfolder : '',
        type: typeof image.type === 'string' ? image.type : 'output',
      })
    }
  }
  const status = entry?.status ?? {}
  return {
    images,
    completed: status.completed === true || status.status_str === 'success',
    status: typeof status.status_str === 'string' ? status.status_str : status.completed === true ? 'success' : 'running',
  }
}

/** `GET /history/<id>`; `undefined` while the prompt is still running. */
export async function getHistory(baseUrl, promptId, options = {}) {
  const history = await requestJson(
    baseUrl,
    'GET',
    `/history/${encodeURIComponent(promptId)}`,
    undefined,
    options,
  )
  const entry = history?.[promptId]
  if (entry === undefined || entry === null) return undefined
  return entry
}

/** `GET /queue`, split into running and pending prompt ids. */
export async function getQueue(baseUrl, options = {}) {
  const queue = await requestJson(baseUrl, 'GET', '/queue', undefined, options)
  const running = Array.isArray(queue?.queue_running) ? queue.queue_running : []
  const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending : []
  const idOf = (item) => (Array.isArray(item) && typeof item[1] === 'string' ? item[1] : undefined)
  return {
    running: running.map(idOf).filter((id) => typeof id === 'string'),
    pending: pending.map(idOf).filter((id) => typeof id === 'string'),
  }
}

/** Drop one prompt from the queue, or interrupt it when it already runs. */
export async function cancelPrompt(baseUrl, promptId, options = {}) {  try {
    await requestJson(baseUrl, 'POST', '/queue', { delete: [promptId] }, options)
  } catch {
    // A prompt that already started is not in the queue; fall through.
  }
  try {
    await requestJson(baseUrl, 'POST', '/interrupt', undefined, options)
  } catch {
    // Interrupting is best effort: the job is marked canceled either way.
  }
}

/**
 * `POST /queue` with a delete list or a clear flag.
 *
 * @param {string} baseUrl
 * @param {{ delete?: string[], clear?: boolean }} payload
 * @param {{ timeoutMs?: number }} [options]
 */
export async function editQueue(baseUrl, payload, options = {}) {
  return requestJson(baseUrl, 'POST', '/queue', payload, options)
}

/** `POST /interrupt` — stop whatever is currently sampling. */
export async function interruptCurrent(baseUrl, options = {}) {
  return requestJson(baseUrl, 'POST', '/interrupt', undefined, options)
}
