/**
 * Generation jobs: validate one request, submit it to ComfyUI, and poll until
 * the graph produces images.
 *
 * ComfyUI has no server-side job object of its own, so this module owns the
 * small state machine the panel renders: queued → running → done | error |
 * canceled. Polling is a single timer shared by every live job.
 *
 * @module dsh-krea2-panel/jobs
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  ComfyError,
  buildWorkflow,
  cancelPrompt,
  clampInt,
  getHistory,
  getQueue,
  randomSeed,
  readHistoryEntry,
  submitPrompt,
} from './comfy.js'

/** How often a live job asks ComfyUI for progress. */
const POLL_MS = 1500

/** A 8 GB card needs minutes, not hours; a stuck prompt must not hold a slot. */
const JOB_TIMEOUT_MS = 10 * 60 * 1000

/** Old finished jobs are dropped so the map cannot grow without bound. */
const MAX_KEPT = 50

const ACTIVE = new Set(['queued', 'running'])

function referenceExtension(file) {
  const ext = path.extname(file).toLowerCase()
  return ext === '' ? '.png' : ext
}

/**
 * @param {{
 *   settings: ReturnType<import('./settings.js').createSettings>,
 * }} options
 */
export function createJobs({ settings }) {
  /** @type {Map<string, any>} */
  const jobs = new Map()
  /** Waiting callers, so dispose() can release them instead of hanging tools. */
  const waiters = new Set()
  let timer = null
  let disposed = false

  function viewOf(job) {
    return {
      id: job.id,
      state: job.state,
      phase: job.phase,
      mode: job.mode,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
      prompt: job.prompt,
      negative: job.negative,
      seed: job.seed,
      width: job.width,
      height: job.height,
      steps: job.steps,
      cfg: job.cfg,
      sampler: job.sampler,
      images: job.images,
      error: job.error,
    }
  }

  function prune() {
    if (jobs.size <= MAX_KEPT) return
    const finished = [...jobs.values()]
      .filter((job) => !ACTIVE.has(job.state))
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
    while (jobs.size > MAX_KEPT && finished.length > 0) {
      const oldest = finished.shift()
      jobs.delete(oldest.id)
    }
  }

  function schedule() {
    if (disposed || timer !== null) return
    timer = setTimeout(() => {
      timer = null
      void tick()
    }, POLL_MS)
    if (typeof timer.unref === 'function') timer.unref()
  }

  function hasActive() {
    for (const job of jobs.values()) if (ACTIVE.has(job.state)) return true
    return false
  }

  async function tick() {
    if (disposed) return
    const current = settings.read()
    for (const job of [...jobs.values()]) {
      if (!ACTIVE.has(job.state)) continue
      try {
        await advance(job, current)
      } catch (error) {
        // A transient network blip must not fail a running generation; only a
        // real error (offline ComfyUI) does, and the timeout covers the rest.
        if (error instanceof ComfyError && error.code === 'COMFY_OFFLINE') {
          job.state = 'error'
          job.error = error.message
          job.finishedAt = Date.now()
        }
      }
    }
    if (hasActive()) schedule()
  }

  async function advance(job, current) {
    if (Date.now() - job.startedAt > JOB_TIMEOUT_MS) {
      job.state = 'error'
      job.error = `生成超时（超过 ${Math.round(JOB_TIMEOUT_MS / 60000)} 分钟）`
      job.finishedAt = Date.now()
      return
    }

    const entry = await getHistory(current.comfyUrl, job.promptId, { timeoutMs: 15_000 })
    if (entry !== undefined) {
      const history = readHistoryEntry(entry)
      if (history.status === 'error' || (history.completed && history.images.length === 0 && history.status !== 'success')) {
        job.state = 'error'
        job.error = 'ComfyUI 执行失败，请查看 ComfyUI 控制台日志'
        job.finishedAt = Date.now()
        return
      }
      if (history.images.length === 0) return // still decoding
      job.images = history.images.map((image) => ({
        filename: image.filename,
        type: image.type,
        path: path.join(
          current.comfyRoot,
          image.type === 'temp' ? 'temp' : 'output',
          image.subfolder === '' ? '' : image.subfolder,
          image.filename,
        ),
      }))
      job.state = 'done'
      job.phase = 'done'
      job.finishedAt = Date.now()
      return
    }

    const queue = await getQueue(current.comfyUrl, { timeoutMs: 10_000 })
    job.phase = queue.running.includes(job.promptId) ? 'running' : 'queued'
    job.state = 'running'
  }

  /**
   * Validate and submit one generation.
   *
   * @param {Record<string, unknown>} raw
   */
  async function start(raw) {
    const current = settings.read()
    const input = raw !== null && typeof raw === 'object' ? raw : {}
    const mode = input.mode === 'style_ref' ? 'style_ref' : 'txt2img'
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
    const negative = typeof input.negative === 'string' ? input.negative : current.negative

    if (prompt === '' && mode === 'txt2img') {
      throw new ComfyError('请先写画面描述', 'EMPTY_PROMPT', 400)
    }
    if (current.comfyRoot === '') {
      throw new ComfyError('还没有设置 ComfyUI 目录，请在面板「设置」里填写', 'NO_COMFY_ROOT', 400)
    }
    for (const [key, label] of [
      ['unet', '主模型'],
      ['clip', '文本编码器'],
      ['vae', 'VAE'],
    ]) {
      if (typeof input[key] === 'string' ? input[key].trim() === '' : current[key] === '') {
        throw new ComfyError(`请选择${label}`, 'NO_MODEL', 400)
      }
    }

    const unet = typeof input.unet === 'string' && input.unet.trim() !== '' ? input.unet.trim() : current.unet
    const clip = typeof input.clip === 'string' && input.clip.trim() !== '' ? input.clip.trim() : current.clip
    const vae = typeof input.vae === 'string' && input.vae.trim() !== '' ? input.vae.trim() : current.vae
    const lora = typeof input.lora === 'string' ? input.lora.trim() : current.lora
    const loraStrength =
      typeof input.loraStrength === 'number' && Number.isFinite(input.loraStrength)
        ? Math.min(2, Math.max(0, input.loraStrength))
        : current.loraStrength
    const width = clampInt(input.width, 256, 1280, current.width)
    const height = clampInt(input.height, 256, 1280, current.height)
    const steps = clampInt(input.steps, 1, 60, current.steps)
    const cfgInput = Number(input.cfg)
    const cfg = Number.isFinite(cfgInput) ? Math.min(10, Math.max(0, cfgInput)) : current.cfg
    const sampler = typeof input.sampler === 'string' && input.sampler !== '' ? input.sampler : current.sampler
    const seedInput = Number(input.seed)
    const seed = Number.isFinite(seedInput) && seedInput > 0 ? Math.floor(seedInput) : randomSeed()

    const id = randomUUID()
    let referenceImage = ''
    if (mode === 'style_ref') {
      const source = typeof input.referenceImage === 'string' ? input.referenceImage.trim() : ''
      if (source === '') {
        throw new ComfyError('风格参考模式需要一张参考图', 'NO_REFERENCE', 400)
      }
      // ComfyUI's LoadImage only reads from its own input directory, so copy
      // the user's file in under a per-job name and reference that.
      const inputDir = path.join(current.comfyRoot, 'input')
      const target = `krea2_ref_${id.slice(0, 8)}${referenceExtension(source)}`
      try {
        await fs.mkdir(inputDir, { recursive: true })
        await fs.copyFile(source, path.join(inputDir, target))
      } catch (error) {
        throw new ComfyError(`参考图读取失败：${error.code === 'ENOENT' ? '文件不存在' : error.message}`, 'REFERENCE_UNREADABLE', 400)
      }
      referenceImage = target
    }

    const workflow = buildWorkflow(mode, {
      prompt,
      negative,
      unet,
      clip,
      vae,
      lora: mode === 'style_ref' ? lora || current.lora : lora,
      loraStrength,
      width,
      height,
      steps,
      cfg,
      sampler,
      seed,
      maxShift: current.maxShift,
      baseShift: current.baseShift,
      referenceImage,
    })

    const job = {
      id,
      state: 'queued',
      phase: 'queued',
      mode,
      prompt,
      negative,
      seed,
      width,
      height,
      steps,
      cfg,
      sampler,
      createdAt: Date.now(),
      startedAt: Date.now(),
      finishedAt: null,
      promptId: '',
      images: [],
      error: null,
    }
    jobs.set(id, job)
    prune()

    try {
      const submitted = await submitPrompt(current.comfyUrl, workflow, { clientId: id, timeoutMs: 60_000 })
      job.promptId = submitted.promptId
      job.state = 'running'
      job.phase = 'queued'
      schedule()
    } catch (error) {
      job.state = 'error'
      job.error = error instanceof Error ? error.message : String(error)
      job.finishedAt = Date.now()
      throw new ComfyError(job.error, 'SUBMIT_FAILED', 502)
    }

    return viewOf(job)
  }

  /** Best-effort cancellation: drop it from the queue and interrupt when it runs. */
  async function cancel(id) {
    const job = jobs.get(id)
    if (job === undefined) return false
    if (!ACTIVE.has(job.state)) return false
    const current = settings.read()
    if (job.promptId !== '') {
      try {
        await cancelPrompt(current.comfyUrl, job.promptId, { timeoutMs: 8000 })
      } catch {
        // Offline ComfyUI: the local state is still what the user sees.
      }
    }
    job.state = 'canceled'
    job.phase = 'canceled'
    job.finishedAt = Date.now()
    return true
  }

  function get(id) {
    const job = jobs.get(id)
    return job === undefined ? null : viewOf(job)
  }

  /**
   * Resolve once the job leaves the active states, with the same view the HTTP
   * layer serves. Used by the agent tool, which must return a finished image
   * rather than a job id the model cannot poll.
   *
   * @param {string} id
   * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
   */
  function wait(id, options = {}) {
    const existing = jobs.get(id)
    if (existing === undefined) {
      return Promise.reject(new ComfyError('任务不存在或已过期', 'NO_JOB', 404))
    }
    if (!ACTIVE.has(existing.state)) return Promise.resolve(viewOf(existing))

    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : JOB_TIMEOUT_MS + 30_000
    const signal = options.signal
    const started = Date.now()

    return new Promise((resolve, reject) => {
      let timer = null
      const done = (error, value) => {
        if (timer !== null) {
          clearInterval(timer)
          timer = null
        }
        waiters.delete(entry)
        if (signal !== undefined && signal !== null && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', onAbort)
        }
        if (error !== null) reject(error)
        else resolve(value)
      }
      const check = () => {
        const job = jobs.get(id)
        if (job === undefined) {
          done(new ComfyError('任务已过期', 'NO_JOB', 404))
          return
        }
        if (!ACTIVE.has(job.state)) {
          done(null, viewOf(job))
          return
        }
        if (Date.now() - started > timeoutMs) {
          done(new ComfyError(`等待生成超时（${Math.round(timeoutMs / 1000)}s）`, 'WAIT_TIMEOUT', 504))
        }
      }
      const onAbort = () => done(new ComfyError('等待已取消', 'ABORTED', 499))
      const entry = { abort: onAbort }
      waiters.add(entry)

      timer = setInterval(check, 400)
      if (typeof timer.unref === 'function') timer.unref()

      if (signal !== undefined && signal !== null && typeof signal.addEventListener === 'function') {
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      check()
    })
  }

  function list() {
    return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(viewOf)
  }

  function dispose() {
    disposed = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    for (const waiter of [...waiters]) waiter.abort()
    waiters.clear()
  }

  return { start, cancel, get, wait, list, dispose }
}
