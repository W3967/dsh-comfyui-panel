/**
 * Host half of dsh-krea2-panel.
 *
 * Owns the `/krea2/*` HTTP surface the browser panel calls: ComfyUI status,
 * the model inventory, persisted settings, generation jobs, and image bytes.
 * Also registers the `krea2_generate` agent tool, which drives the same job
 * queue. The Client half renders everything; this module never touches the UI.
 *
 * @module dsh-krea2-panel
 */

import { createJobs } from './lib/jobs.js'
import { PREFIX, createRoutes } from './lib/routes.js'
import { createSettings } from './lib/settings.js'
import { registerGenerateTool } from './lib/tool.js'

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
  const jobs = createJobs({ settings })
  const handle = createRoutes({ settings, jobs })

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
  registerGenerateTool(ctx, { jobs })
}
