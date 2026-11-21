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
        workflowId: 'krea2-txt2img',
        workflowName: 'Krea 2 · 文生图',
        seed: 42,
        images: [{ filename: 'a.png', type: 'output', path: 'D:\\out\\a.png' }],
        elapsedMs: 39_000,
        error: null,
        ...overrides,
      }
    },
  }
}

const exec = { signal: new AbortController().signal }

test('submits the workflow id and values, then returns the image path', async () => {
  const jobs = fakeJobs()
  const tool = defineGenerateTool({ jobs })

  const value = await tool.execute({ workflow: 'krea2-txt2img', values: { '4.text': 'a fox' } }, exec)

  assert.equal(jobs.calls[0].kind, 'start')
  assert.equal(jobs.calls[0].input.workflowId, 'krea2-txt2img')
  assert.deepEqual(jobs.calls[0].input.values, { '4.text': 'a fox' })
  assert.equal(value.path, 'D:\\out\\a.png')
  assert.equal(value.workflow, 'krea2-txt2img')
  assert.equal(value.elapsed_ms, 39_000)
})

test('omitted workflow falls back to the panel selection', async () => {
  const jobs = fakeJobs()
  const tool = defineGenerateTool({ jobs })

  await tool.execute({ values: { '8.seed': 7 } }, exec)
  assert.equal(jobs.calls[0].input.workflowId, undefined)
})

test('drops non-scalar values instead of forwarding objects', async () => {
  const jobs = fakeJobs()
  const tool = defineGenerateTool({ jobs })

  await tool.execute(
    {
      workflow: 'w',
      values: { a: 1, b: 'x', c: true, d: null, e: undefined, f: { nested: 1 }, g: [1, 2] },
    },
    exec,
  )

  assert.deepEqual(jobs.calls[0].input.values, { a: 1, b: 'x', c: true })
})

test('tolerates a missing values object', async () => {
  const jobs = fakeJobs()
  const tool = defineGenerateTool({ jobs })

  await tool.execute({ workflow: 'w' }, exec)
  assert.deepEqual(jobs.calls[0].input.values, {})

  const jobs2 = fakeJobs()
  const tool2 = defineGenerateTool({ jobs: jobs2 })
  await tool2.execute({ workflow: 'w', values: 'not-an-object' }, exec)
  assert.deepEqual(jobs2.calls[0].input.values, {})
})

test('surfaces a failed job as a tool error', async () => {
  const jobs = fakeJobs({ state: 'error', images: [], error: 'ComfyUI 执行失败' })
  const tool = defineGenerateTool({ jobs })

  await assert.rejects(() => tool.execute({ workflow: 'w' }, exec), /ComfyUI 执行失败/)
})

test('surfaces a canceled job as a tool error', async () => {
  const jobs = fakeJobs({ state: 'canceled', images: [], error: null })
  const tool = defineGenerateTool({ jobs })

  await assert.rejects(() => tool.execute({ workflow: 'w' }, exec), /取消/)
})

test('reports an empty image list instead of a bogus path', async () => {
  const jobs = fakeJobs({ state: 'done', images: [] })
  const tool = defineGenerateTool({ jobs })

  await assert.rejects(() => tool.execute({ workflow: 'w' }, exec), /没有返回图片/)
})

test('renders a short, path-bearing result card', async () => {
  const jobs = fakeJobs()
  const tool = defineGenerateTool({ jobs })
  const value = await tool.execute({ workflow: 'krea2-txt2img' }, exec)

  const blocks = tool.output.render({}, value)
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /D:\\out\\a\.png/)
  assert.match(blocks[0].text, /39\.0s/)
})

test('declares the schema the host projects to the model', () => {
  const tool = defineGenerateTool({ jobs: fakeJobs() })
  assert.equal(tool.name, 'krea2_generate')
  assert.deepEqual(Object.keys(tool.parameters.properties).sort(), ['values', 'workflow'])
  assert.equal(tool.isConcurrencySafe(), false)
  assert.ok(tool.timeoutMs > 10 * 60 * 1000)
})
