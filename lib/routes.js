/**
 * The `/krea2/*` HTTP surface the browser half calls.
 *
 *   GET  /krea2/status     ComfyUI reachability, loader inventories, settings
 *   GET  /krea2/settings   effective settings
 *   POST /krea2/settings   validate and persist a partial settings update
 *   POST /krea2/generate   queue one generation, returns the job
 *   GET  /krea2/job?id=    one job's current state
 *   GET  /krea2/jobs       recent jobs, newest first
 *   POST /krea2/cancel     stop a job
 *   GET  /krea2/image?path=  one generated PNG/JPEG/WebP
 *
 * `?path=` is re-resolved against the ComfyUI `output` and `temp` folders, so a
 * crafted path can never read a file the user did not generate.
 *
 * @module dsh-krea2-panel/routes
 */

import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { ComfyError, listModels, systemStats } from './comfy.js'
import { SAMPLERS } from './settings.js'

/** Route prefix owned by this plugin. */
export const PREFIX = '/krea2'

const MAX_BODY_BYTES = 64 * 1024

/** Extensions the image endpoint serves. */
const IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
])

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
 * @param {{
 *   settings: ReturnType<import('./settings.js').createSettings>,
 *   jobs: ReturnType<import('./jobs.js').createJobs>,
 * }} deps
 */
export function createRoutes({ settings, jobs }) {
  let modelCache = { root: '', at: 0, value: { unet: [], clip: [], vae: [], lora: [] } }

  async function modelsOf(comfyRoot) {
    const now = Date.now()
    if (modelCache.root === comfyRoot && now - modelCache.at < 5000) return modelCache.value
    const value = await listModels(comfyRoot)
    modelCache = { root: comfyRoot, at: now, value }
    return value
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
        const [models, comfy] = await Promise.all([
          modelsOf(current.comfyRoot),
          systemStats(current.comfyUrl, { timeoutMs: 4000 }).catch((error) => ({
            online: false,
            error: error instanceof Error ? error.message : String(error),
          })),
        ])
        return sendJson(res, 200, { ok: true, settings: current, models, comfy, samplers: SAMPLERS })
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
