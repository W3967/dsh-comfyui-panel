import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUILTIN_PRESETS,
  controlFor,
  defaultValues,
  discoverParams,
  isLink,
  mergeWorkflow,
  readInputSpec,
} from '../lib/workflows.js'

/** A trimmed `/object_info` covering the node classes the built-ins use. */
const OBJECT_INFO = {
  UnetLoaderGGUF: {
    input: { required: { unet_name: [['krea2_turbo-Q2_K.gguf'], {}] } },
  },
  UNETLoader: {
    input: {
      required: {
        unet_name: [['krea2_turbo.safetensors'], {}],
        weight_dtype: [['default', 'fp8_e4m3fn'], {}],
      },
    },
  },
  CLIPLoader: {
    input: {
      required: {
        clip_name: [['qwen3vl_4b_fp8_scaled.safetensors'], {}],
        type: [['krea2', 'stable_diffusion'], {}],
      },
    },
  },
  VAELoader: {
    input: { required: { vae_name: [['qwen_image_vae.safetensors'], {}] } },
  },
  CLIPTextEncode: {
    input: { required: { text: ['STRING', { multiline: true }], clip: ['CLIP', {}] } },
  },
  EmptyLatentImage: {
    input: {
      required: {
        width: ['INT', { default: 512, min: 16, max: 16384, step: 8 }],
        height: ['INT', { default: 512, min: 16, max: 16384, step: 8 }],
        batch_size: ['INT', { default: 1, min: 1, max: 4096 }],
      },
    },
  },
  ModelSamplingFlux: {
    input: {
      required: {
        model: ['MODEL', {}],
        max_shift: ['FLOAT', { default: 1.15, min: 0, max: 100, step: 0.01 }],
        base_shift: ['FLOAT', { default: 0.5, min: 0, max: 100, step: 0.01 }],
        width: ['INT', { default: 512, min: 16, max: 16384, step: 8 }],
        height: ['INT', { default: 512, min: 16, max: 16384, step: 8 }],
      },
    },
  },
  KSampler: {
    input: {
      required: {
        model: ['MODEL', {}],
        positive: ['CONDITIONING', {}],
        negative: ['CONDITIONING', {}],
        latent_image: ['LATENT', {}],
        seed: ['INT', { default: 0, min: 0, max: 18446744073709551615 }],
        steps: ['INT', { default: 20, min: 1, max: 10000 }],
        cfg: ['FLOAT', { default: 8, min: 0, max: 100, step: 0.1 }],
        sampler_name: [['euler', 'euler_ancestral', 'dpmpp_2m'], {}],
        scheduler: [['simple', 'normal'], {}],
        denoise: ['FLOAT', { default: 1, min: 0, max: 1, step: 0.01 }],
      },
    },
  },
  LoraLoaderModelOnly: {
    input: {
      required: {
        model: ['MODEL', {}],
        lora_name: [['krea2_style_reference.safetensors'], {}],
        strength_model: ['FLOAT', { default: 1, min: -100, max: 100, step: 0.01 }],
      },
    },
  },
  LoadImage: {
    input: { required: { image: ['STRING', { image_upload: true }] } },
  },
  TextEncodeQwenImageEditPlus: {
    input: {
      required: {
        clip: ['CLIP', {}],
        vae: ['VAE', {}],
        image1: ['IMAGE', {}],
        prompt: ['STRING', { multiline: true }],
      },
    },
  },
  VAEDecode: { input: { required: { samples: ['LATENT', {}], vae: ['VAE', {}] } } },
  SaveImage: { input: { required: { images: ['IMAGE', {}], filename_prefix: ['STRING', {}] } } },
  FluxKontextMultiReferenceLatentMethod: {
    input: { required: { conditioning: ['CONDITIONING', {}], reference_latents_method: [['a', 'b'], {}] } },
  },
  ConditioningZeroOut: { input: { required: { conditioning: ['CONDITIONING', {}] } } },
  CFGGuider: {
    input: {
      required: {
        model: ['MODEL', {}],
        positive: ['CONDITIONING', {}],
        negative: ['CONDITIONING', {}],
        cfg: ['FLOAT', { default: 8, min: 0, max: 100, step: 0.1 }],
      },
    },
  },
  KSamplerSelect: { input: { required: { sampler_name: [['euler'], {}] } } },
  BasicScheduler: {
    input: {
      required: {
        model: ['MODEL', {}],
        scheduler: [['simple'], {}],
        steps: ['INT', { default: 20, min: 1, max: 10000 }],
        denoise: ['FLOAT', { default: 1, min: 0, max: 1, step: 0.01 }],
      },
    },
  },
  RandomNoise: {
    input: { required: { noise_seed: ['INT', { default: 0, min: 0, max: 18446744073709551615 }] } },
  },
  SamplerCustomAdvanced: {
    input: {
      required: {
        noise: ['NOISE', {}],
        guider: ['GUIDER', {}],
        sampler: ['SAMPLER', {}],
        sigmas: ['SIGMAS', {}],
        latent_image: ['LATENT', {}],
      },
    },
  },
}

const TXT2IMG = BUILTIN_PRESETS.find((preset) => preset.id === 'krea2-txt2img')
const STYLE = BUILTIN_PRESETS.find((preset) => preset.id === 'krea2-style')

test('isLink only treats [nodeId, index] pairs as links', () => {
  assert.equal(isLink(['4', 0]), true)
  assert.equal(isLink('euler'), false)
  assert.equal(isLink(42), false)
  assert.equal(isLink(['a', 'b']), false)
  assert.equal(isLink(['4']), false)
})

test('readInputSpec understands combo, int and string declarations', () => {
  const combo = readInputSpec(OBJECT_INFO, 'KSampler', 'sampler_name')
  assert.equal(combo.type, 'COMBO')
  assert.deepEqual(combo.choices, ['euler', 'euler_ancestral', 'dpmpp_2m'])

  const int = readInputSpec(OBJECT_INFO, 'KSampler', 'steps')
  assert.equal(int.type, 'INT')
  assert.equal(int.max, 10000)

  const text = readInputSpec(OBJECT_INFO, 'CLIPTextEncode', 'text')
  assert.equal(text.type, 'STRING')
  assert.equal(text.multiline, true)

  assert.equal(readInputSpec(OBJECT_INFO, 'Nope', 'x'), null)
  assert.equal(readInputSpec(OBJECT_INFO, 'KSampler', 'nope'), null)
})

test('controlFor maps declared types to widgets', () => {
  assert.equal(controlFor({ type: 'COMBO' }), 'select')
  assert.equal(controlFor({ type: 'INT', min: 0, max: 100 }), 'slider')
  assert.equal(controlFor({ type: 'INT', min: 0, max: 10000 }), 'number')
  assert.equal(controlFor({ type: 'FLOAT', min: 0, max: 1 }), 'slider')
  assert.equal(controlFor({ type: 'STRING', multiline: true }), 'textarea')
  assert.equal(controlFor({ type: 'STRING' }), 'text')
  assert.equal(controlFor({ type: 'BOOLEAN' }), 'toggle')
})

test('discovery finds the prompt and negative prompt from the graph wiring', () => {
  const params = discoverParams(TXT2IMG.template, OBJECT_INFO)
  const positive = params.find((param) => param.key === '4.text')
  const negative = params.find((param) => param.key === '5.text')

  assert.equal(positive.label, '画面描述')
  assert.equal(positive.group, 'prompt')
  assert.equal(positive.control, 'textarea')
  assert.equal(negative.label, '负面提示词')
})

test('discovery folds the repeated width/height into one control', () => {
  const params = discoverParams(TXT2IMG.template, OBJECT_INFO)
  const width = params.find((param) => param.label === '宽')
  const height = params.find((param) => param.label === '高')

  assert.deepEqual(width.keys.sort(), ['6.width', '7.width'])
  assert.deepEqual(height.keys.sort(), ['6.height', '7.height'])
  assert.equal(width.group, 'size')
})

test('discovery labels seeds, steps, cfg and sampler sensibly', () => {
  const params = discoverParams(TXT2IMG.template, OBJECT_INFO)
  const byKey = new Map(params.map((param) => [param.key, param]))

  assert.equal(byKey.get('8.seed').control, 'seed')
  assert.equal(byKey.get('8.seed').group, 'sampling')
  assert.equal(byKey.get('8.steps').label, '步数')
  assert.equal(byKey.get('8.steps').control, 'number')
  assert.equal(byKey.get('8.cfg').label, 'CFG')
  assert.equal(byKey.get('8.sampler_name').control, 'select')
  assert.deepEqual(byKey.get('8.sampler_name').choices, ['euler', 'euler_ancestral', 'dpmpp_2m'])
  assert.equal(byKey.get('2.clip_name').label, '文本编码器')
})

test('discovery never emits a control for a link', () => {
  const params = discoverParams(TXT2IMG.template, OBJECT_INFO)
  const keys = new Set(params.flatMap((param) => param.keys))
  assert.equal(keys.has('8.model'), false)
  assert.equal(keys.has('8.positive'), false)
  assert.equal(keys.has('9.samples'), false)
})

test('the style preset exposes its reference image as an image control', () => {
  const params = discoverParams(STYLE.template, OBJECT_INFO)
  const image = params.find((param) => param.resource === 'image')
  assert.equal(image.key, '6.image')
  assert.equal(image.control, 'image')
})

test('unknown node classes are skipped instead of crashing', () => {
  const params = discoverParams({ 1: { class_type: 'NotInstalled', inputs: { x: 1 } } }, OBJECT_INFO)
  assert.deepEqual(params, [])
})

test('defaults come from the graph, and merge writes them back', () => {
  const params = discoverParams(TXT2IMG.template, OBJECT_INFO)
  const values = defaultValues(params)
  assert.equal(values['8.steps'], 8)
  assert.equal(values['4.text'], TXT2IMG.template[4].inputs.text)

  const merged = mergeWorkflow(TXT2IMG.template, { ...values, '8.steps': 20 }, params)
  assert.equal(merged[8].inputs.steps, 20)
  // The source template must not be mutated.
  assert.equal(TXT2IMG.template[8].inputs.steps, 8)
})

test('merging a folded parameter updates every owning node', () => {
  const params = discoverParams(TXT2IMG.template, OBJECT_INFO)
  const width = params.find((param) => param.label === '宽')
  const merged = mergeWorkflow(TXT2IMG.template, { [width.id]: 768 }, params)

  assert.equal(merged[6].inputs.width, 768)
  assert.equal(merged[7].inputs.width, 768)
})

test('unknown parameter ids are ignored by merge', () => {
  const params = discoverParams(TXT2IMG.template, OBJECT_INFO)
  const merged = mergeWorkflow(TXT2IMG.template, { 'nope.nope': 1 }, params)
  assert.deepEqual(merged, TXT2IMG.template)
})
