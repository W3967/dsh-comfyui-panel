/**
 * Generation jobs: resolve a workflow preset, fold submitted values into its
 * graph, submit to ComfyUI, and poll until images exist.
 *
 * ComfyUI has no server-side job object, so this module owns the small state
 * machine the panel renders: queued → running → done | error | canceled.
 *
 * The job layer knows nothing about Krea 2, sampling, or models. It knows
 * workflows and values.
 *
 * @module dsh-comfyui-panel/jobs
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  ComfyError,
  cancelPrompt,
  getHistory,
  getQueue,
  randomSeed,
  readHistoryEntry,
  submitPrompt,
} from './comfy.js'
import { defaultValues, discoverParams, mergeWorkflow } from './workflows.js'

/** How often a live job asks ComfyUI for progress. */
const POLL_MS = 1500

/** A stuck prompt must not hold the queue forever. */
const JOB_TIMEOUT_MS = 10 * 60 * 1000

/** Old finished jobs are dropped so the map cannot grow without bound. */
const MAX_KEPT = 50

const ACTIVE = new Set(['queued', 'running'])

/** ComfyUI's LoadImage reads only its own `input/` folder. */
function isBareFilename(value) {
  return !value.includes('/') && !value.includes('\\') && !path.isAbsolute(value)
}

function referenceExtension(file) {
  const ext = path.extname(file).toLowerCase()
  return ext === '' ? '.png' : ext
}

/**
 * @param {{
 *   settings: ReturnType<import('./settings.js').createSettings>,
 *   workflows: ReturnType<import('./workflows.js').createWorkflowStore>,
 *   getObjectInfo: () => Promise<Record<string, unknown>>,
 * }} options
 */
export function createJobs({ settings, workflows, getObjectInfo }) {
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
      workflowId: job.workflowId,
      workflowName: job.workflowName,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
      values: job.values,
      seed: job.seed,
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
        // A transient blip must not fail a running generation.
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
   * Resolve a preset and fold the submitted values over its saved defaults.
   *
   * @param {Record<string, unknown>} raw
   */
  async function resolve(raw) {
    const current = settings.read()
    const input = raw !== null && typeof raw === 'object' ? raw : {}
    const workflowId =
      typeof input.workflowId === 'string' && input.workflowId !== '' ? input.workflowId : current.activeWorkflow

    const preset = workflows.get(workflowId)
    if (preset === undefined) {
      throw new ComfyError(`工作流不存在：${workflowId}`, 'NO_WORKFLOW', 404)
    }

    const objectInfo = await getObjectInfo()
    const params = discoverParams(preset.template, objectInfo)
    if (params.length === 0) {
      throw new ComfyError(
        '这个工作流没有可调参数。确认它是 ComfyUI「Save (API Format)」导出的 JSON，且对应节点已安装。',
        'NO_PARAMS',
        400,
      )
    }

    const submitted = input.values !== null && typeof input.values === 'object' && !Array.isArray(input.values)
      ? input.values
      : {}
    const values = {
      ...defaultValues(params),
      ...(current.values[preset.id] ?? {}),
      ...submitted,
    }
    return { preset, params, values, current }
  }

  /**
   * Validate and submit one generation.
   *
   * @param {Record<string, unknown>} raw
   */
  async function start(raw) {
    const { preset, params, values, current } = await resolve(raw)

    if (current.comfyRoot === '') {
      throw new ComfyError('还没有设置 ComfyUI 目录，请在面板「设置」里填写', 'NO_COMFY_ROOT', 400)
    }

    const id = randomUUID()
    const merged = { ...values }

    // Seeds left at zero or empty roll fresh, matching what people expect from
    // an "empty means random" box.
    for (const param of params) {
      if (param.control !== 'seed') continue
      const number = Number(merged[param.id])
      if (!Number.isFinite(number) || number <= 0) merged[param.id] = randomSeed()
    }

    // Image inputs point at local paths; ComfyUI can only read its own input
    // folder, so copy each one in under a per-job name.
    for (const param of params) {
      if (param.resource !== 'image') continue
      const value = merged[param.id]
      if (typeof value !== 'string' || value.trim() === '') continue
      const source = value.trim()
      if (isBareFilename(source)) continue
      const target = `krea2_in_${id.slice(0, 8)}${referenceExtension(source)}`
      try {
        await fs.mkdir(path.join(current.comfyRoot, 'input'), { recursive: true })
        await fs.copyFile(source, path.join(current.comfyRoot, 'input', target))
      } catch (error) {
        throw new ComfyError(
          `输入图片读取失败：${error.code === 'ENOENT' ? '文件不存在' : error.message}`,
          'INPUT_UNREADABLE',
          400,
        )
      }
      merged[param.id] = target
    }

    const seedParam = params.find((param) => param.control === 'seed')
    const workflow = mergeWorkflow(preset.template, merged, params)

    const job = {
      id,
      state: 'queued',
      phase: 'queued',
      workflowId: preset.id,
      workflowName: preset.name,
      createdAt: Date.now(),
      startedAt: Date.now(),
      finishedAt: null,
      promptId: '',
      values: merged,
      seed: seedParam === undefined ? undefined : merged[seedParam.id],
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

    // Remember what this workflow ran with so the next open is consistent.
    try {
      settings.write({ activeWorkflow: preset.id, values: { ...current.values, [preset.id]: merged } })
    } catch {
      // Persisting is a convenience, never a reason to fail a generation.
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
