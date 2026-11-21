import assert from 'node:assert/strict'
import test from 'node:test'

import { buildStyleRef, buildTxt2Img, buildWorkflow, clampInt, randomSeed, unetLoaderNode } from '../lib/comfy.js'

const BASE = {
  prompt: 'a red fox',
  negative: '',
  unet: 'model-Q2_K.gguf',
  clip: 'clip.safetensors',
  vae: 'vae.safetensors',
  lora: '',
  loraStrength: 1,
  width: 1024,
  height: 1024,
  steps: 8,
  cfg: 1,
  sampler: 'euler',
  seed: 42,
  referenceImage: 'krea2_ref_abcd1234.png',
}

test('txt2img wires the prompt, size, seed and sampler into the graph', () => {
  const graph = buildTxt2Img({ ...BASE, width: 1152, height: 896, steps: 12, cfg: 1.5, seed: 777 })

  assert.equal(graph[1].class_type, 'UnetLoaderGGUF')
  assert.equal(graph[1].inputs.unet_name, 'model-Q2_K.gguf')
  assert.equal(graph[2].inputs.clip_name, 'clip.safetensors')
  assert.equal(graph[3].inputs.vae_name, 'vae.safetensors')
  assert.equal(graph[4].inputs.text, 'a red fox')
  assert.equal(graph[6].inputs.width, 1152)
  assert.equal(graph[6].inputs.height, 896)
  assert.equal(graph[7].inputs.width, 1152)
  assert.equal(graph[8].inputs.seed, 777)
  assert.equal(graph[8].inputs.steps, 12)
  assert.equal(graph[8].inputs.cfg, 1.5)
  assert.equal(graph[8].inputs.sampler_name, 'euler')
  assert.deepEqual(graph[8].inputs.model, ['7', 0])
})

test('unetLoaderNode switches loader on the file extension', () => {
  const gguf = unetLoaderNode('krea2_turbo-Q2_K.gguf')
  assert.equal(gguf.class_type, 'UnetLoaderGGUF')
  assert.deepEqual(gguf.inputs, { unet_name: 'krea2_turbo-Q2_K.gguf' })

  const upper = unetLoaderNode('MODEL.Q8_0.GGUF')
  assert.equal(upper.class_type, 'UnetLoaderGGUF')

  const safetensors = unetLoaderNode('krea2_turbo.safetensors')
  assert.equal(safetensors.class_type, 'UNETLoader')
  assert.deepEqual(safetensors.inputs, { unet_name: 'krea2_turbo.safetensors', weight_dtype: 'default' })

  // An empty name must still produce a well-formed node, not a crash.
  assert.equal(unetLoaderNode('').class_type, 'UNETLoader')
  assert.equal(unetLoaderNode(undefined).class_type, 'UNETLoader')
})

test('a safetensors model goes through the native loader in both modes', () => {
  const t2i = buildTxt2Img({ ...BASE, unet: 'krea2_turbo.safetensors' })
  assert.equal(t2i[1].class_type, 'UNETLoader')
  assert.equal(t2i[1].inputs.weight_dtype, 'default')

  const style = buildStyleRef({ ...BASE, unet: 'krea2_turbo.safetensors' })
  assert.equal(style[1].class_type, 'UNETLoader')
  assert.equal(style[1].inputs.unet_name, 'krea2_turbo.safetensors')
  // The rest of the style graph still hangs off the same node id.
  assert.equal(style[4].class_type, 'LoraLoaderModelOnly')
  assert.deepEqual(style[4].inputs.model, ['1', 0])
})

test('txt2img inserts a LoRA node between the UNet and the sampler', () => {
  const graph = buildTxt2Img({ ...BASE, lora: 'style.safetensors', loraStrength: 0.65 })

  assert.equal(graph[11].class_type, 'LoraLoaderModelOnly')
  assert.equal(graph[11].inputs.lora_name, 'style.safetensors')
  assert.equal(graph[11].inputs.strength_model, 0.65)
  assert.deepEqual(graph[11].inputs.model, ['1', 0])
  assert.deepEqual(graph[7].inputs.model, ['11', 0])
})

test('txt2img omits the LoRA node when no LoRA is selected', () => {
  const graph = buildTxt2Img(BASE)
  assert.equal(graph[11], undefined)
  assert.deepEqual(graph[7].inputs.model, ['1', 0])
})

test('style_ref uses the reference image and the custom sampler graph', () => {
  const graph = buildStyleRef({ ...BASE, referenceImage: 'krea2_ref_abcd1234.png', seed: 99 })

  assert.equal(graph[6].class_type, 'LoadImage')
  assert.equal(graph[6].inputs.image, 'krea2_ref_abcd1234.png')
  assert.equal(graph[4].inputs.lora_name, '')
  assert.equal(graph[14].inputs.noise_seed, 99)
  assert.equal(graph[12].inputs.steps, 8)
  assert.equal(graph[15].class_type, 'SamplerCustomAdvanced')
  assert.equal(graph[17].inputs.filename_prefix, 'krea2_style')
})

test('style_ref falls back to a neutral prompt for an empty string', () => {
  const graph = buildStyleRef({ ...BASE, prompt: '' })
  assert.equal(graph[7].inputs.prompt, 'the same style and atmosphere as the reference image')
})

test('buildWorkflow dispatches on the mode name', () => {
  assert.equal(buildWorkflow('txt2img', BASE)[10].inputs.filename_prefix, 'krea2_t2i')
  assert.equal(buildWorkflow('style_ref', BASE)[17].inputs.filename_prefix, 'krea2_style')
  // An unknown mode must not crash; it degrades to text-to-image.
  assert.equal(buildWorkflow('nope', BASE)[10].inputs.filename_prefix, 'krea2_t2i')
})

test('clampInt keeps values in range and rounds', () => {
  assert.equal(clampInt(1024, 256, 1280, 512), 1024)
  assert.equal(clampInt(100, 256, 1280, 512), 256)
  assert.equal(clampInt(9999, 256, 1280, 512), 1280)
  assert.equal(clampInt('abc', 256, 1280, 512), 512)
  assert.equal(clampInt(8.6, 1, 60, 8), 9)
})

test('randomSeed stays a positive integer', () => {
  for (let i = 0; i < 20; i += 1) {
    const seed = randomSeed()
    assert.ok(Number.isInteger(seed))
    assert.ok(seed >= 0)
  }
})
