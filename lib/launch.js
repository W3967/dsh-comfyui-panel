/**
 * Start and stop a local ComfyUI.
 *
 * Only ever acts on this machine: a remote ComfyUI URL is rejected, because
 * spawning or killing a process there is not something this plugin can do.
 *
 * @module dsh-workflow-form/launch
 */

import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { ComfyError, requestJson, systemStats } from './comfy.js'

/** Hosts that mean "this machine". */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '[::1]'])

/**
 * How long to wait for the port to answer after spawning. A portable install
 * with many custom nodes has been seen taking 88 s on a cold start, so the cap
 * leaves real headroom.
 */
const READY_TIMEOUT_MS = 150_000

const POLL_MS = 1000

/** True when the configured ComfyUI address points at this machine. */
export function isLocalAddress(comfyUrl) {
  try {
    const host = new URL(comfyUrl).hostname.toLowerCase()
    return LOCAL_HOSTS.has(host)
  } catch {
    return false
  }
}

/**
 * Locate a Python interpreter able to run this ComfyUI.
 *
 * The portable build ships its own under `python_embeded/`; a source install
 * relies on whatever `python` is on PATH.
 *
 * @param {string} comfyRoot directory containing `main.py`
 */
export function findPython(comfyRoot) {
  const portableRoot = path.dirname(comfyRoot)
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const embedded = path.join(portableRoot, 'python_embeded', `python${suffix}`)
  if (fs.existsSync(embedded)) {
    return { command: embedded, portable: true, portableRoot }
  }
  return {
    command: process.platform === 'win32' ? 'python' : 'python3',
    portable: false,
    portableRoot,
  }
}

/** Poll `/system_stats` until it answers or the deadline passes. */
async function waitUntilReady(comfyUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const stats = await systemStats(comfyUrl, { timeoutMs: 3000 })
      return stats
    } catch {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
  }
  return null
}

/**
 * Launch ComfyUI and wait for it to answer.
 *
 * @param {{ comfyRoot: string, comfyUrl: string, waitMs?: number }} options
 * @returns {Promise<{ started: boolean, already: boolean, online: boolean, stats: object | null, logFile: string | null }>}
 */
export async function launchComfyUI({ comfyRoot, comfyUrl, waitMs = READY_TIMEOUT_MS }) {
  // Already answering? Nothing to do.
  try {
    const stats = await systemStats(comfyUrl, { timeoutMs: 2500 })
    return { started: false, already: true, online: true, stats, logFile: null }
  } catch {
    // Not running, keep going.
  }

  if (!isLocalAddress(comfyUrl)) {
    throw new ComfyError('ComfyUI 不在本机，无法从这里启动它。', 'NOT_LOCAL', 400)
  }

  const root = typeof comfyRoot === 'string' ? comfyRoot.trim() : ''
  if (root === '') {
    throw new ComfyError('还没有设置 ComfyUI 目录，无法启动。', 'NO_COMFY_ROOT', 400)
  }
  if (!fs.existsSync(path.join(root, 'main.py'))) {
    throw new ComfyError(`目录里找不到 main.py：${root}`, 'NO_MAIN_PY', 400)
  }

  const python = findPython(root)
  if (python.portable === false) {
    throw new ComfyError(
      '没有找到便携版自带的 python（python_embeded）。这台机器上的 ComfyUI 不是便携版，请手动启动它。',
      'NO_EMBEDDED_PYTHON',
      400,
    )
  }

  // The portable launcher passes -s; keep the same flags and log next to the
  // portable root so a failure is still diagnosable.
  const logFile = path.join(python.portableRoot, 'comfyui.log')
  let logHandle
  try {
    logHandle = fs.openSync(logFile, 'a')
  } catch {
    logHandle = undefined
  }

  const args = ['-s', path.join('ComfyUI', 'main.py'), '--windows-standalone-build']
  const child = spawn(python.command, args, {
    cwd: python.portableRoot,
    detached: true,
    stdio: logHandle === undefined ? 'ignore' : ['ignore', logHandle, logHandle],
    windowsHide: true,
  })
  child.unref()
  if (logHandle !== undefined) {
    // The child owns the handle now; closing ours is safe.
    try {
      fs.closeSync(logHandle)
    } catch {
      // Nothing to do.
    }
  }

  const stats = await waitUntilReady(comfyUrl, waitMs)
  return {
    started: true,
    already: false,
    online: stats !== null,
    stats,
    logFile,
  }
}

/**
 * Kill every process whose command line runs ComfyUI's `main.py`.
 *
 * Matching on the command line rather than a remembered PID means it also
 * stops a ComfyUI the user launched themselves.
 *
 * @returns {Promise<number>} how many processes were signalled
 */
function killComfyProcesses() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const script =
        `$p = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue | ` +
        `Where-Object { $_.CommandLine -like '*ComfyUI*main.py*' }; ` +
        `foreach ($x in $p) { try { Stop-Process -Id $x.ProcessId -Force } catch {} }; ` +
        `Write-Output ($p | Measure-Object).Count`
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeout: 20_000, windowsHide: true },
        (_error, stdout) => {
          const count = Number(String(stdout === undefined || stdout === null ? '' : stdout).trim())
          resolve(Number.isFinite(count) ? count : 0)
        },
      )
      return
    }
    execFile('pkill', ['-f', 'ComfyUI/main.py'], { timeout: 10_000 }, (error) => {
      resolve(error === null ? 1 : 0)
    })
  })
}

/**
 * Unload the models (which frees VRAM) and stop the process.
 *
 * `killer` is injectable so a test never has to signal a real process.
 *
 * @param {{ comfyUrl: string, killer?: () => Promise<number> }} options
 * @returns {Promise<{ wasOnline: boolean, unloaded: boolean, killed: number }>}
 */
export async function stopComfyUI({ comfyUrl, killer = killComfyProcesses }) {
  let wasOnline = false
  try {
    await systemStats(comfyUrl, { timeoutMs: 2500 })
    wasOnline = true
  } catch {
    wasOnline = false
  }

  if (wasOnline && !isLocalAddress(comfyUrl)) {
    throw new ComfyError('ComfyUI 不在本机，无法从这里关闭它。', 'NOT_LOCAL', 400)
  }

  // Unload first: it releases VRAM cleanly and lets the process settle before
  // the kill. A failure here must not block the kill.
  let unloaded = false
  if (wasOnline) {
    try {
      await requestJson(
        comfyUrl,
        'POST',
        '/free',
        { unload_models: true, free_memory: true },
        { timeoutMs: 15_000 },
      )
      unloaded = true
    } catch {
      unloaded = false
    }
  }

  const killed = await killer()
  return { wasOnline, unloaded, killed }
}
