/**
 * Host half of dsh-workflow-form.
 *
 * Owns the `/krea2/*` HTTP surface the browser panel calls: ComfyUI status, the
 * workflow presets and their discovered parameters, generation jobs, and image
 * bytes. Also registers the agent tools, which drive the same job queue.
 *
 * Note: the `/krea2` route prefix, `krea2` plugin id, agent tool names and the
 * local `krea2-panel` data directory are retained for backward compatibility.
 * They are historical identifiers; the plugin itself is generic and not
 * restricted to Krea 2 workflows.
 *
 * @module dsh-workflow-form
 */

import { createJobs } from './lib/jobs.js'
import { PREFIX, createObjectInfoCache, createRoutes } from './lib/routes.js'
import { createSettings } from './lib/settings.js'
import { createValuePresets } from './lib/presets.js'
import { registerGenerateTool } from './lib/tool.js'
import { createWorkflowStore } from './lib/workflows.js'

/** Cordis plugin name. */
export const name = 'krea2'

/** The browser carrier is the only hard dependency. */
export const inject = ['webServer']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ comfyUrl?: string, comfyRoot?: string, dshHome?: string }} [rawConfig]
 */
export function apply(ctx, rawConfig) {
  const config = rawConfig !== null && typeof rawConfig === 'object' ? rawConfig : {}
  const settings = createSettings({ dshHome: config.dshHome, seed: config })
  const workflows = createWorkflowStore({ dir: settings.dir })
  const presets = createValuePresets({ dir: settings.dir })
  const objectInfo = createObjectInfoCache()

  const jobs = createJobs({
    settings,
    workflows,
    getObjectInfo: () => objectInfo.get(settings.read().comfyUrl),
  })
  const handle = createRoutes({
    settings,
    jobs,
    workflows,
    objectInfo,
    presets,
    // Late-bound on purpose: the connection service may arrive after this
    // plugin loads, and a profile without it must keep working (the routes
    // then fall back to the loopback + same-origin fence).
    getConnection: () => {
      try {
        return ctx.get('connection')
      } catch {
        return undefined
      }
    },
  })

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: handle,
    })
    return () => {
      jobs.dispose()
      if (typeof dispose === 'function') dispose()
    }
  }, 'krea2-routes')

  // Optional: profiles without a tool registry keep the panel.
  registerGenerateTool(ctx, { settings, workflows, objectInfo, jobs })
}
