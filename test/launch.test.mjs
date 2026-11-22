import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { findPython, isLocalAddress, launchComfyUI, stopComfyUI } from '../lib/launch.js'

/** A port nothing listens on, so the pre-flight probe fails instantly. */
const DEAD_URL = 'http://127.0.0.1:1'

test('isLocalAddress accepts the loopback aliases', () => {
  assert.equal(isLocalAddress('http://127.0.0.1:8188'), true)
  assert.equal(isLocalAddress('http://localhost:8188'), true)
  assert.equal(isLocalAddress('http://[::1]:8188'), true)
  assert.equal(isLocalAddress('http://0.0.0.0:8188'), true)
})

test('isLocalAddress rejects anything off this machine', () => {
  assert.equal(isLocalAddress('http://192.168.1.5:8188'), false)
  assert.equal(isLocalAddress('https://comfy.example.com'), false)
  assert.equal(isLocalAddress('http://comfy.internal/comfy'), false)
  assert.equal(isLocalAddress('not a url'), false)
  assert.equal(isLocalAddress(''), false)
})

test('findPython prefers the portable embedded interpreter', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'krea2-launch-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const comfyRoot = path.join(root, 'ComfyUI')
  await mkdir(comfyRoot, { recursive: true })
  await mkdir(path.join(root, 'python_embeded'), { recursive: true })
  await writeFile(path.join(root, 'python_embeded', process.platform === 'win32' ? 'python.exe' : 'python'), '')

  const found = findPython(comfyRoot)
  assert.equal(found.portable, true)
  assert.equal(found.portableRoot, root)
  assert.ok(found.command.includes('python_embeded'))
})

test('findPython falls back to PATH when there is no embedded build', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'krea2-launch-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const comfyRoot = path.join(root, 'ComfyUI')
  await mkdir(comfyRoot, { recursive: true })

  const found = findPython(comfyRoot)
  assert.equal(found.portable, false)
  assert.equal(found.command, process.platform === 'win32' ? 'python' : 'python3')
})

test('refuses an address that is not on this machine', async () => {
  await assert.rejects(
    () => launchComfyUI({ comfyRoot: 'C:\\nowhere', comfyUrl: 'http://192.168.1.5:8188', waitMs: 1000 }),
    /不在本机/,
  )
})

test('refuses an empty ComfyUI directory', async () => {
  await assert.rejects(() => launchComfyUI({ comfyRoot: '', comfyUrl: DEAD_URL, waitMs: 1000 }), /ComfyUI 目录/)
})

test('refuses a directory without main.py', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'krea2-launch-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  await assert.rejects(
    () => launchComfyUI({ comfyRoot: root, comfyUrl: DEAD_URL, waitMs: 1000 }),
    /main\.py/,
  )
})

test('refuses a source install with no embedded python', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'krea2-launch-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const comfyRoot = path.join(root, 'ComfyUI')
  await mkdir(comfyRoot, { recursive: true })
  await writeFile(path.join(comfyRoot, 'main.py'), '# stand-in\n')

  await assert.rejects(
    () => launchComfyUI({ comfyRoot, comfyUrl: DEAD_URL, waitMs: 1000 }),
    /python_embeded/,
  )
})

test('stopping an offline ComfyUI still sweeps for a stale process', async () => {
  let killerCalls = 0
  const result = await stopComfyUI({
    comfyUrl: DEAD_URL,
    killer: async () => {
      killerCalls += 1
      return 2
    },
  })

  assert.equal(result.wasOnline, false)
  assert.equal(result.unloaded, false)
  assert.equal(result.killed, 2)
  assert.equal(killerCalls, 1, 'the killer runs even when nothing was listening')
})

test('the killer result is passed through', async () => {
  const none = await stopComfyUI({ comfyUrl: DEAD_URL, killer: async () => 0 })
  assert.equal(none.killed, 0)
})
