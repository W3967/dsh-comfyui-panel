/**
 * Workflow presets and the parameter discovery that turns any ComfyUI graph
 * into a form.
 *
 * The panel no longer knows what Krea 2 is. It knows two things:
 *
 *   1. a workflow is ComfyUI's API-format JSON (`{ nodeId: { class_type, inputs } }`)
 *   2. ComfyUI's `/object_info` describes every node's inputs, so the form can
 *      be generated instead of hand-written
 *
 * Krea 2 ships as two built-in presets; everything else is user-supplied.
 *
 * @module dsh-krea2-panel/workflows
 */

import fs from 'node:fs'
import path from 'node:path'

/** Display order of the generated groups. */
const GROUP_ORDER = ['prompt', 'size', 'sampling', 'models', 'other']

/**
 * Two Krea 2 graphs, expressed as plain API-format JSON. These are the only
 * graph-shaped things left in the plugin.
 */
export const BUILTIN_PRESETS = Object.freeze([
  {
    id: 'krea2-txt2img',
    name: 'Krea 2 · 文生图',
    nameEn: 'Krea 2 · Text to image',
    description: 'Krea 2 Turbo，8 步。只需画面描述。',
    descriptionEn: 'Krea 2 Turbo at 8 steps. Prompt only.',
    template: {
      1: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'krea2_turbo-Q2_K.gguf' } },
      2: {
        class_type: 'CLIPLoader',
        inputs: { clip_name: 'qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2' },
      },
      3: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
      4: {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: 'a red fox sitting in a snowy forest at dusk, cinematic lighting, highly detailed',
          clip: ['2', 0],
        },
      },
      5: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
      6: { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
      7: {
        class_type: 'ModelSamplingFlux',
        inputs: { model: ['1', 0], max_shift: 1.15, base_shift: 0.5, width: 1024, height: 1024 },
      },
      8: {
        class_type: 'KSampler',
        inputs: {
          model: ['7', 0],
          positive: ['4', 0],
          negative: ['5', 0],
          latent_image: ['6', 0],
          seed: 42,
          steps: 8,
          cfg: 1,
          sampler_name: 'euler',
          scheduler: 'simple',
          denoise: 1,
        },
      },
      9: { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
      10: { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'krea2_t2i' } },
    },
  },
  {
    id: 'krea2-style',
    name: 'Krea 2 · 风格参考',
    nameEn: 'Krea 2 · Style reference',
    description: '给一张参考图，沿用它的风格与氛围重新绘制。',
    descriptionEn: 'Carry the style and mood of a reference image.',
    template: {
      1: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'krea2_turbo-Q2_K.gguf' } },
      2: {
        class_type: 'CLIPLoader',
        inputs: { clip_name: 'qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2' },
      },
      3: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
      4: {
        class_type: 'LoraLoaderModelOnly',
        inputs: {
          model: ['1', 0],
          lora_name: 'krea2_style_reference.safetensors',
          strength_model: 1,
        },
      },
      5: {
        class_type: 'ModelSamplingFlux',
        inputs: { model: ['4', 0], max_shift: 1.15, base_shift: 0.5, width: 1024, height: 1024 },
      },
      6: { class_type: 'LoadImage', inputs: { image: 'reference.png' } },
      7: {
        class_type: 'TextEncodeQwenImageEditPlus',
        inputs: {
          clip: ['2', 0],
          vae: ['3', 0],
          image1: ['6', 0],
          prompt: 'the same style and atmosphere as the reference image',
        },
      },
      8: {
        class_type: 'FluxKontextMultiReferenceLatentMethod',
        inputs: { conditioning: ['7', 0], reference_latents_method: 'index_timestep_zero' },
      },
      9: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['7', 0] } },
      10: {
        class_type: 'CFGGuider',
        inputs: { model: ['5', 0], positive: ['8', 0], negative: ['9', 0], cfg: 1 },
      },
      11: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
      12: {
        class_type: 'BasicScheduler',
        inputs: { model: ['5', 0], scheduler: 'simple', steps: 8, denoise: 1 },
      },
      13: { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
      14: { class_type: 'RandomNoise', inputs: { noise_seed: 12345 } },
      15: {
        class_type: 'SamplerCustomAdvanced',
        inputs: {
          noise: ['14', 0],
          guider: ['10', 0],
          sampler: ['11', 0],
          sigmas: ['12', 0],
          latent_image: ['13', 0],
        },
      },
      16: { class_type: 'VAEDecode', inputs: { samples: ['15', 0], vae: ['3', 0] } },
      17: { class_type: 'SaveImage', inputs: { images: ['16', 0], filename_prefix: 'krea2_style' } },
    },
  },
])

/**
 * Semantic labels. A rule matches on the node class and input name; the first
 * hit wins. Anything unmatched still gets a control, just a plainer label.
 *
 * `group` decides where the control lands; `control` overrides the type-derived
 * widget when the type alone would pick something unhelpful (a seed must not be
 * a slider across 2^64).
 */
const RULES = [
  {
    match: (ctx) => ctx.field === 'text' || ctx.field === 'prompt' || ctx.field === 'string',
    group: 'prompt',
    label: '提示词',
    labelEn: 'Prompt',
    control: 'textarea',
  },
  {
    match: (ctx) => /seed/i.test(ctx.field),
    group: 'sampling',
    label: '种子',
    labelEn: 'Seed',
    control: 'seed',
  },
  { match: (ctx) => ctx.field === 'steps', group: 'sampling', label: '步数', labelEn: 'Steps' },
  {
    match: (ctx) => ctx.field === 'cfg' || ctx.field === 'guidance',
    group: 'sampling',
    label: 'CFG',
    labelEn: 'CFG',
  },
  {
    match: (ctx) => ctx.field === 'sampler_name',
    group: 'sampling',
    label: '采样器',
    labelEn: 'Sampler',
    control: 'select',
  },
  {
    match: (ctx) => ctx.field === 'scheduler',
    group: 'sampling',
    label: '调度器',
    labelEn: 'Scheduler',
    control: 'select',
  },
  {
    match: (ctx) => ctx.field === 'denoise',
    group: 'sampling',
    label: '降噪强度',
    labelEn: 'Denoise',
    control: 'slider',
  },
  { match: (ctx) => ctx.field === 'width', group: 'size', label: '宽', labelEn: 'Width', control: 'number' },
  { match: (ctx) => ctx.field === 'height', group: 'size', label: '高', labelEn: 'Height', control: 'number' },
  {
    match: (ctx) => ctx.field === 'batch_size',
    group: 'size',
    label: '张数',
    labelEn: 'Batch size',
    control: 'number',
  },
  {
    match: (ctx) => /^(ckpt_name|unet_name)$/.test(ctx.field),
    group: 'models',
    label: '主模型',
    labelEn: 'UNet',
    control: 'select',
  },
  {
    match: (ctx) => /^clip_name$/.test(ctx.field),
    group: 'models',
    label: '文本编码器',
    labelEn: 'Text encoder',
    control: 'select',
  },
  {
    match: (ctx) => /^vae_name$/.test(ctx.field),
    group: 'models',
    label: 'VAE',
    labelEn: 'VAE',
    control: 'select',
  },
  {
    match: (ctx) => /^lora_name$/.test(ctx.field),
    group: 'models',
    label: 'LoRA',
    labelEn: 'LoRA',
    control: 'select',
  },
  {
    match: (ctx) => /^strength_model$/.test(ctx.field),
    group: 'models',
    label: 'LoRA 强度',
    labelEn: 'LoRA strength',
    control: 'slider',
  },
  {
    match: (ctx) => ctx.field === 'type' && ctx.classType === 'CLIPLoader',
    group: 'models',
    label: 'CLIP 类型',
    labelEn: 'CLIP type',
    control: 'select',
  },
  {
    match: (ctx) => /^weight_dtype$/.test(ctx.field),
    group: 'models',
    label: '权重精度',
    labelEn: 'Weight dtype',
    control: 'select',
  },
  {
    match: (ctx) => ctx.field === 'max_shift',
    group: 'sampling',
    label: '位移上限',
    labelEn: 'Shift max',
    control: 'slider',
  },
  {
    match: (ctx) => ctx.field === 'base_shift',
    group: 'sampling',
    label: '位移基准',
    labelEn: 'Shift base',
    control: 'slider',
  },
  {
    match: (ctx) => /_shift$/.test(ctx.field),
    group: 'sampling',
    label: '采样位移',
    labelEn: 'Sampling shift',
    control: 'slider',
  },
  {
    match: (ctx) => ctx.field === 'filename_prefix',
    group: 'other',
    label: '文件名前缀',
    labelEn: 'Filename prefix',
  },
  {
    match: (ctx) => ctx.resource === 'image',
    group: 'other',
    label: '输入图片',
    labelEn: 'Input image',
    control: 'image',
  },
]

/** A two-element array of `[nodeId, outputIndex]` is a link, not a literal. */
export function isLink(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'number'
  )
}

/**
 * Read one node input's declaration out of `/object_info`.
 *
 * ComfyUI encodes it as `[type, options]`, where `type` is a string for scalars
 * and an array of choices for combo boxes.
 */
export function readInputSpec(objectInfo, classType, field) {
  const spec = objectInfo?.[classType]
  if (spec === undefined || spec === null) return null
  const raw = spec.input?.required?.[field] ?? spec.input?.optional?.[field]
  if (!Array.isArray(raw) || raw.length === 0) return null

  const typeCell = raw[0]
  const options = raw[1] !== null && typeof raw[1] === 'object' ? raw[1] : {}
  if (Array.isArray(typeCell)) {
    return { type: 'COMBO', choices: typeCell, ...options }
  }
  return { type: typeof typeCell === 'string' ? typeCell : 'STRING', ...options }
}

/** Pick the widget for a declared input. */
export function controlFor(input) {
  if (input.type === 'COMBO') return 'select'
  // LoadImage declares `["STRING", { image_upload: true }]`; it is a file
  // picker, not a text box.
  if (input.image_upload === true) return 'image'
  if (input.type === 'INT') {
    const min = Number.isFinite(input.min) ? input.min : 0
    const max = Number.isFinite(input.max) ? input.max : 0
    const span = max - min
    return span > 0 && span <= 200 ? 'slider' : 'number'
  }
  if (input.type === 'FLOAT') return 'slider'
  if (input.type === 'BOOLEAN') return 'toggle'
  if (input.type === 'STRING') return input.multiline === true ? 'textarea' : 'text'
  if (input.type === 'IMAGE' || input.type === 'MASK') return 'image'
  return 'text'
}

/** Nodes that feed a sampler's `positive` / `negative` input, for prompt labelling. */
function hintNodes(template) {
  const positive = new Set()
  const negative = new Set()
  for (const node of Object.values(template)) {
    for (const [field, value] of Object.entries(node?.inputs ?? {})) {
      if (!isLink(value)) continue
      if (field === 'positive') positive.add(value[0])
      if (field === 'negative') negative.add(value[0])
    }
  }
  return { positive, negative }
}

function normalizeKeyValue(value) {
  // Merge candidates must compare by value, not identity.
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Turn a workflow graph into a form description.
 *
 * @param {Record<string, { class_type: string, inputs: Record<string, unknown> }>} template
 * @param {Record<string, unknown>} objectInfo
 * @returns {Array<object>} one descriptor per logical parameter
 */
export function discoverParams(template, objectInfo) {
  const { positive, negative } = hintNodes(template)
  const raw = []

  for (const [nodeId, node] of Object.entries(template)) {
    const classType = node?.class_type
    if (typeof classType !== 'string') continue
    // A class missing from /object_info is not installed, so ComfyUI would
    // reject the whole graph. Skipping the node beats inventing controls for it.
    if (objectInfo?.[classType] === undefined || objectInfo[classType] === null) continue
    const inputs = node.inputs ?? {}

    for (const [field, value] of Object.entries(inputs)) {
      if (isLink(value)) continue
      const declared = readInputSpec(objectInfo, classType, field)
      const control = declared === null ? 'text' : controlFor(declared)

      const resource = control === 'image' ? 'image' : undefined
      const ctx = { classType, field, nodeId, resource, declared }
      const rule = RULES.find((candidate) => candidate.match(ctx))

      let label = rule?.label ?? `${classType} · ${field}`
      let labelEn = rule?.labelEn ?? `${classType} · ${field}`

      // The graph knows which encoder feeds the negative input, so the label
      // can say so even when both nodes use the same class and field name.
      if ((field === 'text' || field === 'prompt') && negative.has(nodeId)) {
        label = '负面提示词'
        labelEn = 'Negative prompt'
      } else if ((field === 'text' || field === 'prompt') && positive.has(nodeId)) {
        label = '画面描述'
        labelEn = 'Prompt'
      }

      raw.push({
        key: `${nodeId}.${field}`,
        nodeId,
        field,
        classType,
        label,
        labelEn,
        group: rule?.group ?? 'other',
        control: rule?.control ?? control,
        value,
        choices: Array.isArray(declared?.choices) ? declared.choices : undefined,
        min: Number.isFinite(declared?.min) ? declared.min : undefined,
        max: Number.isFinite(declared?.max) ? declared.max : undefined,
        step: Number.isFinite(declared?.step) ? declared.step : undefined,
        multiline: declared?.multiline === true,
        resource,
      })
    }
  }

  // Graphs repeat the same value in several nodes (EmptyLatentImage and
  // ModelSamplingFlux both carry width/height). Fold identical semantics into
  // one control that writes everywhere.
  const merged = []
  const index = new Map()
  for (const param of raw) {
    const signature = [param.group, param.label, param.control, normalizeKeyValue(param.value)].join('|')
    const seen = index.get(signature)
    if (seen === undefined) {
      const entry = { ...param, id: param.key, keys: [param.key] }
      index.set(signature, entry)
      merged.push(entry)
    } else {
      seen.keys.push(param.key)
    }
  }

  merged.sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.group)
    const gb = GROUP_ORDER.indexOf(b.group)
    if (ga !== gb) return ga - gb
    return Number(a.nodeId) - Number(b.nodeId)
  })

  return merged
}

/**
 * Write parameter values back into a copy of the graph.
 *
 * @param {Record<string, any>} template
 * @param {Record<string, unknown>} values keyed by parameter id
 * @param {Array<object>} params the descriptors the values refer to
 */
export function mergeWorkflow(template, values, params) {
  const graph = JSON.parse(JSON.stringify(template))
  const byId = new Map(params.map((param) => [param.id, param]))

  for (const [id, value] of Object.entries(values ?? {})) {
    const param = byId.get(id)
    if (param === undefined) continue
    for (const key of param.keys) {
      const dot = key.indexOf('.')
      const nodeId = key.slice(0, dot)
      const field = key.slice(dot + 1)
      const node = graph[nodeId]
      if (node === undefined || node.inputs === undefined) continue
      node.inputs[field] = value
    }
  }

  return graph
}

/** Default values for a template: what the graph already contains. */
export function defaultValues(params) {
  const values = {}
  for (const param of params) values[param.id] = param.value
  return values
}

/** Image inputs on this graph, in node order. */
export function imageInputs(params) {
  return params.filter((param) => param.resource === 'image')
}

/**
 * Preset storage: built-ins are read-only, user presets live in one JSON file
 * next to the settings.
 *
 * @param {{ dir: string }} options
 */
export function createWorkflowStore({ dir }) {
  const file = path.join(dir, 'workflows.json')

  function readUser() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (Array.isArray(parsed?.presets)) return parsed.presets
    } catch {
      // Missing or corrupt: start from no user presets.
    }
    return []
  }

  function writeUser(presets) {
    fs.mkdirSync(dir, { recursive: true })
    const temp = `${file}.tmp`
    fs.writeFileSync(temp, JSON.stringify({ version: 1, presets }, null, 2), 'utf8')
    fs.renameSync(temp, file)
  }

  return {
    /** Built-ins first, then user presets, newest last. */
    list() {
      return [...BUILTIN_PRESETS, ...readUser()]
    },

    get(id) {
      return this.list().find((preset) => preset.id === id)
    },

    /**
     * Create or replace a user preset. Built-in ids are rejected so an upgrade
     * cannot be shadowed by stale saved data.
     */
    save(input) {
      const id = typeof input?.id === 'string' && input.id !== '' ? input.id : `wf-${Date.now()}`
      if (BUILTIN_PRESETS.some((preset) => preset.id === id)) {
        throw new Error('内置工作流不可修改，请另存为新名称。')
      }
      const template = input?.template
      if (template === null || typeof template !== 'object' || Array.isArray(template)) {
        throw new Error('工作流必须是一个 JSON 对象。')
      }

      const record = {
        id,
        name: typeof input.name === 'string' && input.name !== '' ? input.name : id,
        description: typeof input.description === 'string' ? input.description : '',
        template,
        bindings: Array.isArray(input.bindings) ? input.bindings : undefined,
        createdAt: input.createdAt ?? Date.now(),
      }
      const presets = readUser().filter((preset) => preset.id !== id)
      presets.push(record)
      writeUser(presets)
      return record
    },

    remove(id) {
      if (BUILTIN_PRESETS.some((preset) => preset.id === id)) {
        throw new Error('内置工作流不可删除。')
      }
      const presets = readUser()
      const next = presets.filter((preset) => preset.id !== id)
      if (next.length === presets.length) return false
      writeUser(next)
      return true
    },
  }
}
