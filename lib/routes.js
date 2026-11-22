/**
 * The `/krea2/*` HTTP surface the browser half calls.
 *
 *   GET    /krea2/status      ComfyUI reachability, presets, settings
 *   POST   /krea2/start       launch a local ComfyUI process
 *   GET    /krea2/workflow    one preset's discovered parameters + saved values
 *   POST   /krea2/workflow    create or replace a user preset
 *   DELETE /krea2/workflow    delete a user preset
 *   GET    /krea2/settings    effective settings
 *   POST   /krea2/settings    validate and persist a partial settings update
 *   POST   /krea2/generate    queue one generation, returns the job
 *   GET    /krea2/job?id=     one job's current state
 *   GET    /krea2/jobs        recent jobs
 *   POST   /krea2/cancel      stop a job
 *   GET    /krea2/image?path= one generated image
 *
 * `?path=` is re-resolved against ComfyUI's `output` and `temp` folders, so a
 * crafted path can never read a file the user did not generate.
 *
 * @module dsh-comfyui-panel/routes
 */

import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  ComfyError,
  editQueue,
  fetchObjectInfo,
  getQueue,
  listModels,
  systemStats,
} from './comfy.js'
import { extractValues, readGraph } from './recover.js'
import { launchComfyUI } from './launch.js'
import { defaultValues, discoverParams, imageInputs } from './workflows.js'

/** Route prefix owned by this plugin. */
export const PREFIX = '/krea2'

const MAX_BODY_BYTES = 2 * 1024 * 1024

/** `/object_info` is stable until custom nodes change; a minute is plenty. */
const OBJECT_INFO_TTL_MS = 60_000

/** Extensions the image endpoint serves. */
const IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
])

/** How many files a history scan will look at before giving up. */
const HISTORY_SCAN_MAX = 3000

/** How many entries the history endpoint returns by default. */
const HISTORY_LIMIT_DEFAULT = 60

/**
 * Walk a directory tree collecting images. Recursive because ComfyUI writes
 * into dated subfolders when the user configures it to.
 *
 * @param {string} root
 * @param {string} dir
 * @param {Array<{ path: string, name: string, size: number, mtime: number, subfolder: string }>} out
 * @param {number} [budget]
 */
async function scanImages(root, dir, out, budget = HISTORY_SCAN_MAX) {
  if (out.length >= budget) return
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= budget) return
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await scanImages(root, full, out, budget)
      continue
    }
    if (!entry.isFile()) continue
    if (!IMAGE_TYPES.has(path.extname(entry.name).toLowerCase())) continue
    let stat
    try {
      stat = await fs.stat(full)
    } catch {
      continue
    }
    const relative = path.relative(root, dir)
    out.push({
      path: full,
      name: entry.name,
      size: stat.size,
      mtime: stat.mtimeMs,
      subfolder: relative === '' ? '' : relative.split(path.sep).join('/'),
    })
  }
}

function sendJson(res, status, payload) {
  if (res.writableEnded || res.destroyed) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function fail(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, ...(message === undefined ? {} : { message }) } })
}

function readJson(req, cap = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > cap) {
        reject(new ComfyError('请求体过大', 'BODY_TOO_LARGE', 413))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new ComfyError('请求体不是合法 JSON', 'BAD_JSON', 400))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Same-origin guard for mutations. A missing Origin is allowed (the Desktop
 * shell strips it); a present Origin must match the Host header.
 */
function isSameOrigin(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** `relative()` handles case-insensitive drives poorly on Windows; normalize. */
function isInside(root, target) {
  const rel = path.relative(root.toLowerCase(), target.toLowerCase())
  if (rel === '') return true
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Turn an untrusted `?path=` into a real image file inside ComfyUI's own
 * output folders.
 *
 * @param {string | null} raw
 * @param {string} comfyRoot
 */
export async function resolveOutputFile(raw, comfyRoot) {
  if (typeof raw !== 'string' || raw === '' || comfyRoot === '') return null
  let real
  try {
    real = await fs.realpath(path.resolve(raw))
  } catch {
    return null
  }
  if (!IMAGE_TYPES.has(path.extname(real).toLowerCase())) return null
  for (const folder of ['output', 'temp']) {
    let realRoot
    try {
      realRoot = await fs.realpath(path.join(comfyRoot, folder))
    } catch {
      continue
    }
    if (isInside(realRoot, real)) return real
  }
  return null
}

/**
 * One cached `/object_info` per ComfyUI URL. The response is large and only
 * changes when custom nodes are installed, so re-fetching per request would be
 * wasteful.
 */
export function createObjectInfoCache() {
  let cache = { url: '', at: 0, value: null }

  return {
    async get(comfyUrl) {
      const now = Date.now()
      if (cache.url === comfyUrl && cache.value !== null && now - cache.at < OBJECT_INFO_TTL_MS) {
        return cache.value
      }
      const value = await fetchObjectInfo(comfyUrl)
      cache = { url: comfyUrl, at: now, value }
      return value
    },
    invalidate() {
      cache = { url: '', at: 0, value: null }
    },
  }
}

/**
 * @param {{
 *   settings: ReturnType<import('./settings.js').createSettings>,
 *   jobs: ReturnType<import('./jobs.js').createJobs>,
 *   workflows: ReturnType<import('./workflows.js').createWorkflowStore>,
 *   objectInfo: ReturnType<typeof createObjectInfoCache>,
 * }} deps
 */
export function createRoutes({ settings, jobs, workflows, objectInfo, presets }) {
  let modelCache = { root: '', at: 0, value: { unet: [], clip: [], vae: [], lora: [] } }

  async function modelsOf(comfyRoot) {
    const now = Date.now()
    if (modelCache.root === comfyRoot && now - modelCache.at < 5000) return modelCache.value
    const value = await listModels(comfyRoot)
    modelCache = { root: comfyRoot, at: now, value }
    return value
  }

  /** Presets with their parameter count when `objectInfo` is reachable. */
  async function listPresets() {
    const current = settings.read()
    let info = null
    try {
      info = await objectInfo.get(current.comfyUrl)
    } catch {
      info = null
    }
    return workflows.list().map((preset) => ({
      id: preset.id,
      name: preset.name,
      nameEn: preset.nameEn,
      description: preset.description,
      descriptionEn: preset.descriptionEn,
      builtin: preset.createdAt === undefined,
      paramCount: info === null ? null : discoverParams(preset.template, info).length,
    }))
  }

  /** One preset's form description plus the values last used with it. */
  async function describePreset(id) {
    const current = settings.read()
    const preset = workflows.get(id)
    if (preset === undefined) throw new ComfyError(`工作流不存在：${id}`, 'NO_WORKFLOW', 404)

    const base = {
      id: preset.id,
      name: preset.name,
      nameEn: preset.nameEn,
      description: preset.description,
      descriptionEn: preset.descriptionEn,
      builtin: preset.createdAt === undefined,
    }

    let info
    try {
      info = await objectInfo.get(current.comfyUrl)
    } catch (error) {
      return {
        ...base,
        params: [],
        values: {},
        imageInputs: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }

    const params = discoverParams(preset.template, info)
    const values = { ...defaultValues(params), ...(current.values[preset.id] ?? {}) }
    return { ...base, params, values, imageInputs: imageInputs(params), error: null }
  }

  return async function handle(req, res) {
    const method = req.method ?? 'GET'
    let url
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      return fail(res, 400, 'BAD_URL', '无法解析请求地址')
    }
    const pathname = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) || '/' : url.pathname
    const query = url.searchParams

    try {
      if (method === 'GET' && pathname === '/status') {
        const current = settings.read()
        const [models, comfy, presets] = await Promise.all([
          modelsOf(current.comfyRoot),
          systemStats(current.comfyUrl, { timeoutMs: 4000 }).catch((error) => ({
            online: false,
            error: error instanceof Error ? error.message : String(error),
          })),
          listPresets(),
        ])
        return sendJson(res, 200, {
          ok: true,
          settings: current,
          models,
          comfy,
          workflows: presets,
        })
      }

      if (method === 'POST' && pathname === '/start') {
        if (!isSameOrigin(req)) return fail(res, 403, 'CROSS_ORIGIN', '跨站请求已拒绝')
        const current = settings.read()
        const result = await launchComfyUI({ comfyRoot: current.comfyRoot, comfyUrl: current.comfyUrl })
        // A fresh process may expose a different model inventory.
        objectInfo.invalidate()
        return sendJson(res, 200, {
          ok: true,
          started: result.started,
          already: result.already,
          online: result.online,
          logFile: result.logFile,
        })
      }

      if (method === 'GET' && pathname === '/workflow') {
        const id = query.get('id')
        if (typeof id !== 'string' || id === '') return fail(res, 400, 'NO_ID', '缺少 id')
        const described = await describePreset(id)
        return sendJson(res, 200, { ok: true, workflow: described })
      }

      if (method === 'POST' && pathname === '/workflow') {
        if (!isSameOrigin(req)) return fail(res, 403, 'CROSS_ORIGIN', '跨站请求已拒绝')
        const body = await readJson(req)
        let saved
        try {
          saved = workflows.save(body)
        } catch (error) {
          return fail(res, 400, 'WORKFLOW_SAVE_FAILED', error instanceof Error ? error.message : String(error))
        }
        // The new preset must be describable right away; a bad graph fails here
        // rather than at generation time.
        const described = await describePreset(saved.id).catch(() => null)
        return sendJson(res, 200, { ok: true, workflow: described ?? { id: saved.id, name: saved.name, params: [] } })
      }

      if (method === 'DELETE' && pathname === '/workflow') {
        if (!isSameOrigin(req)) return fail(res, 403, 'CROSS_ORIGIN', '跨站请求已拒绝')
        const id = query.get('id')
        if (typeof id !== 'string' || id === '') return fail(res, 400, 'NO_ID', '缺少 id')
        let removed
        try {
          removed = workflows.remove(id)
        } catch (error) {
          return fail(res, 400, 'WORKFLOW_DELETE_FAILED', error instanceof Error ? error.message : String(error))
        }
        return sendJson(res, 200, { ok: true, removed })
      }

      if (method === 'GET' && pathname === '/settings') {
        return sendJson(res, 200, { ok: true, settings: settings.read() })
      }

      if (method === 'POST' && pathname === '/settings') {
        if (!isSameOrigin(req)) return fail(res, 403, 'CROSS_ORIGIN', '跨站请求已拒绝')
        const patch = await readJson(req)
        return sendJson(res, 200, { ok: true, settings: settings.write(patch) })
      }

      if (method === 'POST' && pathname === '/generate') {
        if (!isSameOrigin(req)) return fail(res, 403, 'CROSS_ORIGIN', '跨站请求已拒绝')
        const body = await readJson(req)
        const job = await jobs.start(body)
        return sendJson(res, 200, { ok: true, job })
      }

      if (method === 'GET' && pathname === '/job') {
        const id = query.get('id')
        if (typeof id !== 'string' || id === '') return fail(res, 400, 'NO_ID', '缺少 id')
        const job = jobs.get(id)
        if (job === null) return fail(res, 404, 'NO_JOB', '任务不存在或已过期')
        return sendJson(res, 200, { ok: true, job })
      }

      if (method === 'GET' && pathname === '/jobs') {
        return sendJson(res, 200, { ok: true, jobs: jobs.list() })
      }

      if (method === 'POST' && pathname === '/cancel') {
        if (!isSameOrigin(req)) return fail(res, 403, 'CROSS_ORIGIN', '跨站请求已拒绝')
        const body = await readJson(req)
        const id = typeof body?.id === 'string' ? body.id : ''
        const canceled = await jobs.cancel(id)
        return sendJson(res, 200, { ok: true, canceled })
      }

      if (method === 'GET' && pathname === '/queue') {
        const current = settings.read()
        let queue
        try {
          queue = await getQueue(current.comfyUrl, { timeoutMs: 6000 })
        } catch (error) {
          return fail(res, 503, 'QUEUE_UNAVAILABLE', error instanceof Error ? error.message : String(error))
        }
        const tracked = jobs.list()
        const describe = (promptId) => {
          const job = tracked.find((item) => item.promptId === promptId)
          if (job === undefined) return { promptId }
          return {
            promptId,
            jobId: job.id,
            workflowId: job.workflowId,
            workflowName: job.workflowName,
            state: job.state,
            elapsedMs: job.elapsedMs,
          }
        }
        return sendJson(res, 200, {
          ok: true,
          running: queue.running.map(describe),
          pending: queue.pending.map(describe),
        })
      }

      if (method === 'POST' && pathname === '/queue') {
        if (!isSameOrigin(req)) return fail(res, 403, 'CROSS_ORIGIN', '跨站请求已拒绝')
        const body = await readJson(req)
        const current = settings.read()
        const action = typeof body?.action === 'string' ? body.action : ''
        if (action === 'clear') {
          await editQueue(current.comfyUrl, { clear: true }, { timeoutMs: 8000 })
          return sendJson(res, 200, { ok: true, cleared: true })
        }
        if (action === 'delete') {
          const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === 'string') : []
          if (ids.length === 0) return fail(res, 400, 'NO_IDS', '缺少要删除的 prompt id')
          await editQueue(current.comfyUrl, { delete: ids }, { timeoutMs: 8000 })
          return sendJson(res, 200, { ok: true, deleted: ids })
        }
        return fail(res, 400, 'BAD_ACTION', 'action 必须是 clear 或 delete')
      }

      if (method === 'GET' && pathname === '/history') {
        const current = settings.read()
        if (current.comfyRoot === '') {
          return fail(res, 400, 'NO_COMFY_ROOT', '还没有设置 ComfyUI 目录')
        }
        const limitRaw = Number(query.get('limit'))
        const limit = Math.min(
          200,
          Math.max(1, Number.isFinite(limitRaw) && limitRaw > 0 ? Math.round(limitRaw) : HISTORY_LIMIT_DEFAULT),
        )
        const outputRoot = path.join(current.comfyRoot, 'output')
        const items = []
        await scanImages(outputRoot, outputRoot, items)
        items.sort((a, b) => b.mtime - a.mtime)
        return sendJson(res, 200, { ok: true, items: items.slice(0, limit), total: items.length })
      }

      if (method === 'GET' && pathname === '/presets') {
        const workflowId = query.get('workflow')
        return sendJson(res, 200, {
          ok: true,
          presets: presets.list(typeof workflowId === 'string' && workflowId !== '' ? workflowId : undefined),
        })
      }

      if (method === 'POST' && pathname === '/presets') {
        if (!isSameOrigin(req)) return fail(res, 403, 'CROSS_ORIGIN', '跨站请求已拒绝')
        const body = await readJson(req)
        let saved
        try {
          saved = presets.save(body)
        } catch (error) {
          return fail(res, 400, 'PRESET_SAVE_FAILED', error instanceof Error ? error.message : String(error))
        }
        return sendJson(res, 200, { ok: true, preset: saved })
      }

      if (method === 'DELETE' && pathname === '/presets') {
        if (!isSameOrigin(req)) return fail(res, 403, 'CROSS_ORIGIN', '跨站请求已拒绝')
        const id = query.get('id')
        if (typeof id !== 'string' || id === '') return fail(res, 400, 'NO_ID', '缺少 id')
        return sendJson(res, 200, { ok: true, removed: presets.remove(id) })
      }

      if (method === 'GET' && pathname === '/recover') {
        const current = settings.read()
        const file = await resolveOutputFile(query.get('path'), current.comfyRoot)
        if (file === null) return fail(res, 404, 'NO_IMAGE', '图片不存在或不在 ComfyUI 输出目录内')

        const graph = await readGraph(file)
        if (graph === null) {
          return fail(res, 422, 'NO_GRAPH', '这张图里没有工作流元数据，可能不是 ComfyUI 生成的')
        }

        let info
        try {
          info = await objectInfo.get(current.comfyUrl)
        } catch (error) {
          return fail(res, 503, 'COMFY_OFFLINE', error instanceof Error ? error.message : String(error))
        }

        for (const preset of workflows.list()) {
          const params = discoverParams(preset.template, info)
          const values = extractValues(graph, params)
          if (values !== null) {
            return sendJson(res, 200, {
              ok: true,
              workflowId: preset.id,
              workflowName: preset.name,
              values,
            })
          }
        }
        return fail(res, 422, 'NO_MATCH', '这张图的节点结构和现有工作流都对不上')
      }

      if (method === 'POST' && pathname === '/reveal') {
        if (!isSameOrigin(req)) return fail(res, 403, 'CROSS_ORIGIN', '跨站请求已拒绝')
        const current = settings.read()
        const body = await readJson(req)
        const file = await resolveOutputFile(body?.path, current.comfyRoot)
        if (file === null) return fail(res, 404, 'NO_IMAGE', '图片不存在或不在 ComfyUI 输出目录内')
        if (process.platform !== 'win32') {
          return fail(res, 501, 'UNSUPPORTED', '当前系统不支持在文件管理器中定位')
        }
        spawn('explorer.exe', ['/select,', file], { detached: true, stdio: 'ignore' }).unref()
        return sendJson(res, 200, { ok: true, revealed: true })
      }

      if (method === 'DELETE' && pathname === '/image') {
        if (!isSameOrigin(req)) return fail(res, 403, 'CROSS_ORIGIN', '跨站请求已拒绝')
        const current = settings.read()
        const file = await resolveOutputFile(query.get('path'), current.comfyRoot)
        if (file === null) return fail(res, 404, 'NO_IMAGE', '图片不存在或不在 ComfyUI 输出目录内')
        try {
          await fs.unlink(file)
        } catch (error) {
          return fail(res, 500, 'DELETE_FAILED', error instanceof Error ? error.message : String(error))
        }
        return sendJson(res, 200, { ok: true, deleted: true })
      }

      if ((method === 'GET' || method === 'HEAD') && pathname === '/image') {
        const current = settings.read()
        const file = await resolveOutputFile(query.get('path'), current.comfyRoot)
        if (file === null) return fail(res, 404, 'NO_IMAGE', '图片不存在或不在 ComfyUI 输出目录内')
        const type = IMAGE_TYPES.get(path.extname(file).toLowerCase())
        const stat = await fs.stat(file)
        res.writeHead(200, {
          'content-type': type,
          'content-length': stat.size,
          'cache-control': 'private, max-age=3600',
        })
        if (method === 'HEAD') {
          res.end()
          return
        }
        createReadStream(file).pipe(res)
        return
      }

      return fail(res, 404, 'NO_ROUTE', `未知接口：${method} ${pathname}`)
    } catch (error) {
      if (res.writableEnded || res.destroyed) return
      const status = error instanceof ComfyError ? error.status : 500
      const code = error instanceof ComfyError ? error.code : 'INTERNAL'
      return fail(res, status, code, error instanceof Error ? error.message : String(error))
    }
  }
}
