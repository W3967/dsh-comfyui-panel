import assert from 'node:assert/strict'
import test from 'node:test'

import { defineGenerateTool } from '../lib/tool.js'

/** A job queue stub that records what the tool submitted and returns one image. */
function fakeJobs(overrides = {}) {
  const calls = []
  return {
    calls,
    async start(input) {
      calls.push({ kind: 'start', input })
      return { id: 'job-1', state: 'running' }
    },
    async wait(id, options) {
      calls.push({ kind: 'wait', id, options })
      return {
        id,
        state: 'done',
        mode: 'txt2img',
        seed: 42,
        width: 1024,
        height: 1024,
        steps: 8,
        images: [{ filename: 'a.png', type: 'output', path: 'D:\\out\\a.png' }],
        elapsedMs: 39_000,
        error: null,
        ...overrides,
      }
    },
  }
}

const exec = { signal: new AbortController().signal }

test('submits a text-to-image job and returns the image path', async () => {
  const jobs = fakeJobs()
  const tool = defineGenerateTool({ jobs })

  const value = await tool.execute({ prompt: 'a red fox' }, exec)

  assert.equal(jobs.calls[0].kind, 'start')
  assert.equal(jobs.calls[0].input.mode, 'txt2img')
  assert.equal(jobs.calls[0].input.prompt, 'a red fox')
  assert.equal(jobs.calls[0].input.referenceImage, undefined)
  assert.equal(value.path, 'D:\\out\\a.png')
  assert.deepEqual(value.paths, ['D:\\out\\a.png'])
  assert.equal(value.seed, 42)
})

test('maps snake_case arguments onto the job request', async () => {
  const jobs = fakeJobs()
  const tool = defineGenerateTool({ jobs })

  await tool.execute(
    {
      prompt: 'keep the mood',
      mode: 'style_ref',
      reference_image: '  D:\\refs\\cat.png  ',
      model: 'other.gguf',
      lora: 'style.safetensors',
      lora_strength: 0.6,
      width: 768,
      height: 512,
      steps: 12,
      seed: 7,
    },
    exec,
  )

  const input = jobs.calls[0].input
  assert.equal(input.mode, 'style_ref')
  assert.equal(input.referenceImage, 'D:\\refs\\cat.png')
  assert.equal(input.unet, 'other.gguf')
  assert.equal(input.lora, 'style.safetensors')
  assert.equal(input.loraStrength, 0.6)
  assert.equal(input.width, 768)
  assert.equal(input.height, 512)
  assert.equal(input.steps, 12)
  assert.equal(input.seed, 7)
})

test('keeps an explicit empty LoRA as "no LoRA"', async () => {
  const jobs = fakeJobs()
  const tool = defineGenerateTool({ jobs })

  await tool.execute({ prompt: 'x', lora: '' }, exec)
  assert.equal(jobs.calls[0].input.lora, '')
})

test('rejects an empty prompt for text-to-image', async () => {
  const jobs = fakeJobs()
  const tool = defineGenerateTool({ jobs })

  await assert.rejects(() => tool.execute({ prompt: '   ' }, exec), /prompt/)
  assert.equal(jobs.calls.length, 0)
})

test('rejects style_ref without a reference image', async () => {
  const jobs = fakeJobs()
  const tool = defineGenerateTool({ jobs })

  await assert.rejects(
    () => tool.execute({ prompt: 'x', mode: 'style_ref' }, exec),
    /reference_image/,
  )
  assert.equal(jobs.calls.length, 0)
})

test('rejects an unknown mode by falling back to text-to-image rules', async () => {
  const jobs = fakeJobs()
  const tool = defineGenerateTool({ jobs })

  await assert.rejects(() => tool.execute({ prompt: '', mode: 'upscale' }, exec), /prompt/)
})

test('surfaces a failed job as a tool error', async () => {
  const jobs = fakeJobs({ state: 'error', images: [], error: 'ComfyUI 执行失败' })
  const tool = defineGenerateTool({ jobs })

  await assert.rejects(() => tool.execute({ prompt: 'x' }, exec), /ComfyUI 执行失败/)
})

test('surfaces a canceled job as a tool error', async () => {
  const jobs = fakeJobs({ state: 'canceled', images: [], error: null })
  const tool = defineGenerateTool({ jobs })

  await assert.rejects(() => tool.execute({ prompt: 'x' }, exec), /取消/)
})

test('reports an empty image list instead of a bogus path', async () => {
  const jobs = fakeJobs({ state: 'done', images: [] })
  const tool = defineGenerateTool({ jobs })

  await assert.rejects(() => tool.execute({ prompt: 'x' }, exec), /没有返回图片/)
})

test('renders a short, path-bearing result card', async () => {
  const jobs = fakeJobs()
  const tool = defineGenerateTool({ jobs })
  const value = await tool.execute({ prompt: 'x' }, exec)

  const blocks = tool.output.render({ prompt: 'x' }, value)
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /D:\\out\\a\.png/)
  assert.match(blocks[0].text, /39\.0s/)
})

test('declares the schema the host projects to the model', () => {
  const tool = defineGenerateTool({ jobs: fakeJobs() })
  assert.equal(tool.name, 'krea2_generate')
  assert.equal(tool.parameters.required[0], 'prompt')
  assert.deepEqual(tool.parameters.properties.mode.enum, ['txt2img', 'style_ref'])
  assert.equal(tool.isConcurrencySafe(), false)
  assert.ok(tool.timeoutMs > 10 * 60 * 1000)
})
