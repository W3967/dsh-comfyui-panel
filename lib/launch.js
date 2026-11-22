/**
 * Start a local ComfyUI when it is not running.
 *
 * Only ever acts on this machine: a remote ComfyUI URL is rejected, because
 * spawning a process there is not something this plugin can do.
 *
 * @module dsh-comfyui-panel/launch
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { ComfyError, systemStats } from './comfy.js'

/** Hosts that mean "this machine". */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '[::1]'])

/** How long to wait for the port to answer after spawning. */
const READY_TIMEOUT_MS = 90_000

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
