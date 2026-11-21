/**
 * The agent-facing side: two tools over the same job queue the UI uses.
 *
 *   krea2_workflows  list presets and the parameters each one exposes
 *   krea2_generate   submit one generation and wait for the image
 *
 * The split exists because the parameter set is not fixed any more: a model has
 * to look at a workflow before it can name its parameters.
 *
 * @module dsh-krea2-panel/tool
 */

import { discoverParams } from './workflows.js'

/** A generation plus the wait; job timeouts inside `jobs` fire well before this. */
const TOOL_TIMEOUT_MS = 11 * 60 * 1000

function readValues(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'object') continue
    out[key] = value
  }
  return out
}

/**
 * @param {{
 *   settings: ReturnType<import('./settings.js').createSettings>,
 *   workflows: ReturnType<import('./workflows.js').createWorkflowStore>,
 *   objectInfo: ReturnType<import('./routes.js').createObjectInfoCache>,
 * }} deps
 */
export function defineWorkflowsTool({ settings, workflows, objectInfo }) {
  return {
    name: 'krea2_workflows',
    description:
      '列出可用的 ComfyUI 工作流（预设），以及每个工作流可调的参数：参数 id、名称、控件类型、当前值和可选项。调用 krea2_generate 之前先用它确认参数名——参数 id 由工作流图的节点 id 加字段名组成（如 "4.text"），不同工作流不一样。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '只看某一个工作流 id；不填则列出全部。' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          workflows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                builtin: { type: 'boolean' },
                params: { type: 'array', items: { type: 'object' } },
              },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: true,
      },
      render(args, value) {
        const list = Array.isArray(value?.workflows) ? value.workflows : []
        const lines = list.map((workflow) => {
          const names = (workflow.params ?? []).map((param) => `${param.label}(${param.id})`).join(', ')
          return `- ${workflow.name} [${workflow.id}]${workflow.builtin ? ' 内置' : ''}: ${names}`
        })
        return [{ type: 'text', text: lines.length === 0 ? '没有可用工作流。' : lines.join('\n') }]
      },
    },
    timeoutMs: 60_000,
    isConcurrencySafe: () => true,
    async execute(rawArgs) {
      const args = rawArgs !== null && typeof rawArgs === 'object' ? rawArgs : {}
      const current = settings.read()
      const info = await objectInfo.get(current.comfyUrl)
      const wanted = typeof args.id === 'string' && args.id !== '' ? args.id : null

      const presets = workflows.list().filter((preset) => wanted === null || preset.id === wanted)
      if (presets.length === 0) {
        throw new Error(wanted === null ? '没有可用工作流。' : `工作流不存在：${wanted}`)
      }

      return {
        workflows: presets.map((preset) => ({
          id: preset.id,
          name: preset.name,
          builtin: preset.createdAt === undefined,
          description: preset.description ?? '',
          params: discoverParams(preset.template, info).map((param) => ({
            id: param.id,
            label: param.label,
            control: param.control,
            value: param.value,
            ...(param.choices === undefined ? {} : { choices: param.choices }),
            ...(param.min === undefined ? {} : { min: param.min }),
            ...(param.max === undefined ? {} : { max: param.max }),
          })),
        })),
      }
    },
  }
}

/**
 * @param {{ jobs: ReturnType<import('./jobs.js').createJobs> }} deps
 */
export function defineGenerateTool({ jobs }) {
  return {
    name: 'krea2_generate',
    description:
      '用本机 ComfyUI 生成图片，阻塞到图片真正产出后返回绝对路径。参数按工作流而定——先用 krea2_workflows 查目标工作流的参数 id，再把它们放进 values。省略的参数沿用用户在面板里的设置。1024² 通常约 1 分钟，风格参考会更久。',
    parameters: {
      type: 'object',
      properties: {
        workflow: {
          type: 'string',
          description: '工作流 id（来自 krea2_workflows）。不填则用面板当前选中的那个。',
        },
        values: {
          type: 'object',
          description:
            '参数键值对，key 是 krea2_workflows 返回的 params[].id（如 "4.text"、"8.seed"），value 按该参数的控件类型给。',
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          job_id: { type: 'string' },
          path: { type: 'string', description: '第一张生成图的绝对路径。' },
          paths: { type: 'array', items: { type: 'string' } },
          workflow: { type: 'string' },
          workflow_name: { type: 'string' },
          elapsed_ms: { type: 'number' },
        },
        additionalProperties: true,
      },
      render(args, value) {
        const seconds = Number.isFinite(value?.elapsed_ms) ? (value.elapsed_ms / 1000).toFixed(1) : '?'
        const head = `生成完成：${value?.workflow_name ?? value?.workflow ?? ''}，${seconds}s`
        const paths = Array.isArray(value?.paths) ? value.paths : []
        return [{ type: 'text', text: [head, ...paths.map((item) => `图片：${item}`)].join('\n') }]
      },
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    // One generation at a time: two concurrent prompts fight over VRAM and
    // ComfyUI's /interrupt is global, so serial execution is the safe default.
    isConcurrencySafe() {
      return false
    },
    async execute(rawArgs, exec) {
      const args = rawArgs !== null && typeof rawArgs === 'object' ? rawArgs : {}
      const workflowId = typeof args.workflow === 'string' && args.workflow !== '' ? args.workflow : undefined
      const values = readValues(args.values)

      const submitted = await jobs.start({ workflowId, values })

      const finished = await jobs.wait(submitted.id, {
        signal: exec?.signal,
        timeoutMs: TOOL_TIMEOUT_MS,
      })

      if (finished.state === 'canceled') throw new Error('生成已取消。')
      if (finished.state !== 'done') throw new Error(finished.error || '生成失败。')
      if (!Array.isArray(finished.images) || finished.images.length === 0) {
        throw new Error('ComfyUI 执行完成但没有返回图片。')
      }

      return {
        job_id: finished.id,
        path: finished.images[0].path,
        paths: finished.images.map((image) => image.path),
        workflow: finished.workflowId,
        workflow_name: finished.workflowName,
        elapsed_ms: finished.elapsedMs,
      }
    },
  }
}

/**
 * Register both tools when the profile has a tool registry. `tools` is
 * optional: a profile without it still gets the panel.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerGenerateTool(ctx, deps) {
  const tools = typeof ctx.get === 'function' ? ctx.get('tools') : undefined
  if (tools === undefined || tools === null || typeof tools.register !== 'function') return false

  ctx.effect(() => {
    const disposers = [
      tools.register(defineWorkflowsTool(deps)),
      tools.register(defineGenerateTool(deps)),
    ]
    return () => {
      for (const dispose of disposers) {
        if (typeof dispose === 'function') dispose()
      }
    }
  }, 'krea2-tools')

  return true
}
