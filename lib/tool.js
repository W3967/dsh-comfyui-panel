/**
 * The agent-facing side of the panel: one `krea2_generate` tool that runs
 * through the exact same job queue the UI uses.
 *
 * The tool differs from the panel in one way only: it waits. A model cannot
 * poll `/krea2/job`, so the tool holds the call open until ComfyUI produced the
 * image and returns the path. Cancellation and the plugin's own timeout still
 * apply through `exec.signal` and `timeoutMs`.
 *
 * @module dsh-krea2-panel/tool
 */

/** A generation plus the wait; job timeouts inside `jobs` fire well before this. */
const TOOL_TIMEOUT_MS = 11 * 60 * 1000

const MODES = ['txt2img', 'style_ref']

function readArgs(raw) {
  const args = raw !== null && typeof raw === 'object' ? raw : {}
  const mode = typeof args.mode === 'string' && MODES.includes(args.mode) ? args.mode : 'txt2img'
  return {
    prompt: typeof args.prompt === 'string' ? args.prompt : '',
    mode,
    referenceImage: typeof args.reference_image === 'string' ? args.reference_image.trim() : '',
    unet: typeof args.model === 'string' && args.model.trim() !== '' ? args.model.trim() : undefined,
    lora: typeof args.lora === 'string' ? args.lora.trim() : undefined,
    loraStrength: typeof args.lora_strength === 'number' ? args.lora_strength : undefined,
    width: args.width,
    height: args.height,
    steps: args.steps,
    seed: args.seed,
  }
}

/**
 * @param {{ jobs: ReturnType<import('./jobs.js').createJobs> }} deps
 */
export function defineGenerateTool({ jobs }) {
  return {
    name: 'krea2_generate',
    description:
      '用本机 Krea 2（ComfyUI）生成图片，阻塞到图片真正产出后返回绝对路径。mode=txt2img 文生图（给 prompt）；mode=style_ref 风格参考（给 reference_image 绝对路径，沿用它的风格与氛围，prompt 可留空）。1024² 约 1 分钟，风格参考约 1.5~3 分钟。模型与参数默认沿用用户面板里已选的设置。',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '画面描述。建议英文，中文也可识别。style_ref 模式可传空字符串，表示只沿用参考图的风格与氛围。',
        },
        mode: {
          type: 'string',
          enum: MODES,
          description: '生成模式：txt2img 文生图（默认）或 style_ref 风格参考。',
        },
        reference_image: {
          type: 'string',
          description: 'style_ref 模式必填：参考图的绝对路径。ComfyUI 会读取它并复制到自己的 input 目录。',
        },
        model: {
          type: 'string',
          description: '可选，覆盖主模型（ComfyUI models 目录下的 UNet 文件名，如 krea2_turbo-Q2_K.gguf）。默认用面板里选的那个。',
        },
        lora: {
          type: 'string',
          description: '可选，覆盖 LoRA 文件名。传空字符串表示这一次不用 LoRA；不传则沿用设置。',
        },
        lora_strength: {
          type: 'number',
          description: 'LoRA 强度，0~2，默认沿用设置（通常 1）。',
        },
        width: {
          type: 'number',
          description: '宽，256~1280，默认沿用设置（通常 1024）。',
        },
        height: {
          type: 'number',
          description: '高，256~1280，默认沿用设置（通常 1024）。',
        },
        steps: {
          type: 'number',
          description: '采样步数，1~60。Krea 2 Turbo 建议 8。',
        },
        seed: {
          type: 'number',
          description: '随机种子。不填或传 0 表示每次随机。',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          job_id: { type: 'string' },
          path: { type: 'string', description: '第一张生成图的绝对路径。' },
          paths: { type: 'array', items: { type: 'string' } },
          mode: { type: 'string' },
          seed: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          steps: { type: 'number' },
          elapsed_ms: { type: 'number' },
        },
        additionalProperties: true,
      },
      render(args, value) {
        const seconds = Number.isFinite(value?.elapsed_ms) ? (value.elapsed_ms / 1000).toFixed(1) : '?'
        const head = `生成完成：${value?.mode ?? ''} ${value?.width ?? '?'}×${value?.height ?? '?'}，${value?.steps ?? '?'} 步，seed=${value?.seed ?? '?'}，${seconds}s`
        const paths = Array.isArray(value?.paths) ? value.paths : []
        return [{ type: 'text', text: [head, ...paths.map((p) => `图片：${p}`)].join('\n') }]
      },
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    // One generation at a time: two concurrent prompts fight over 8 GB of VRAM
    // and ComfyUI's /interrupt is global, so serial execution is the safe default.
    isConcurrencySafe() {
      return false
    },
    async execute(rawArgs, exec) {
      const args = readArgs(rawArgs)

      if (args.mode === 'txt2img' && args.prompt.trim() === '') {
        throw new Error('文生图需要 prompt。')
      }
      if (args.mode === 'style_ref' && args.referenceImage === '') {
        throw new Error('style_ref 模式需要 reference_image（参考图绝对路径）。')
      }

      const submitted = await jobs.start({
        mode: args.mode,
        prompt: args.prompt,
        unet: args.unet,
        lora: args.lora,
        loraStrength: args.loraStrength,
        width: args.width,
        height: args.height,
        steps: args.steps,
        seed: args.seed,
        referenceImage: args.mode === 'style_ref' ? args.referenceImage : undefined,
      })

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
        mode: finished.mode,
        seed: finished.seed,
        width: finished.width,
        height: finished.height,
        steps: finished.steps,
        elapsed_ms: finished.elapsedMs,
      }
    },
  }
}

/**
 * Register the tool when the profile has a tool registry. `tools` is optional:
 * a profile without it still gets the panel, it just has no agent tool.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ jobs: ReturnType<import('./jobs.js').createJobs> }} deps
 */
export function registerGenerateTool(ctx, deps) {
  const tools = typeof ctx.get === 'function' ? ctx.get('tools') : undefined
  if (tools === undefined || tools === null || typeof tools.register !== 'function') return false

  ctx.effect(() => {
    const dispose = tools.register(defineGenerateTool(deps))
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'krea2-generate-tool')

  return true
}
