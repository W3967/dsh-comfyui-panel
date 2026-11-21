# Krea 2 Studio · DeepSeek Harness plugin

[![test](https://github.com/W3967/dsh-krea2-panel/actions/workflows/test.yml/badge.svg)](https://github.com/W3967/dsh-krea2-panel/actions/workflows/test.yml)

Plug a local **Krea 2** ComfyUI into DeepSeek Harness: one click in the sidebar, pick the model, write a prompt, tune a few knobs, get an image.

Generating with a local ComfyUI usually means switching to a browser, editing parameters in a node graph, then switching back. This plugin folds all of that into the DSH sidebar: the parameter panel stays put and the images land next to your conversation.

[中文](README.md) | English

![Krea 2 panel](docs/panel.png)

---

## Features

- **Sidebar entry + standalone panel** — runs beside the chat instead of inside it.
- **Model pickers** — scans `<ComfyUI>/models` and lets you switch the quantized UNet (including GGUF), text encoder, VAE and LoRA from dropdowns.
- **Two modes**
  - Text to image (`txt2img`): generate from the prompt alone.
  - Style reference (`style_ref`): hand it one image and carry over its style and mood; the last result can be reused as the reference in one click.
- **Tunable** — size presets or custom width/height, steps, CFG, seed (empty means random), sampler, LoRA strength, and the `ModelSamplingFlux` max/base shift.
- **Settings persist** — ComfyUI URL and root directory live in `$DSH_HOME/krea2-panel/settings.json` and survive a restart.
- **Job-based generation** — submit returns immediately, the panel polls progress, cancellation works, and finished images can be opened full size or copied as a path.
- **Follows the host theme** — only `--dsw-alias-*` design tokens are used, so light and dark themes both look native.
- **Agent tool** — `krea2_generate` lets the model generate an image and get the resulting path, sharing the exact same job queue as the panel.

## Requirements

1. **ComfyUI** running (default `http://127.0.0.1:8188`).
2. **GPU**: 8 GB of VRAM runs the Q2_K quant (1024² at 8 steps takes about 70 s on an RTX 5060 Laptop); 16 GB and up can take a larger quant.
3. **The nodes and models Krea 2 needs** already installed. The panel drives this graph:
   - `UnetLoaderGGUF` (quantized GGUF UNet)
   - `CLIPLoader` (`type: krea2`)
   - `VAELoader`
   - `LoraLoaderModelOnly` (style-reference LoRA)
   - `ModelSamplingFlux` / `KSampler` (text to image)
   - `TextEncodeQwenImageEditPlus` / `SamplerCustomAdvanced` (style reference)

   The graph lives in `lib/comfy.js` as plain readable objects. If your node names or wiring differ, edit `buildTxt2Img` / `buildStyleRef` and nothing else.

## Which one: this plugin vs the MCP server

The same ComfyUI graph has two front ends. **Install one, not both:**

- **This plugin (`dsh-krea2-panel`)** — DeepSeek Harness only, ships a sidebar panel *and* an agent tool.
- **`krea2-mcp`** — a plain MCP server: tools only, no UI.

Both drive the same Krea 2 weights (same UNet / text encoder / VAE / LoRA). What differs is how you reach them:

| | This plugin | krea2-mcp |
|---|---|---|
| Shape | Cordis bundle: panel + tool | MCP server: tool only |
| Available to | DeepSeek Harness only | Any MCP client (Claude Desktop, Cursor, DSH, …) |
| For humans | ✅ tweak and preview in a panel, browse this session's results | ❌ only by asking the model |
| For models | `krea2_generate` | `generate_image` (shown as `mcp__krea2__generate_image` in DSH; other clients prefix differently) |
| Choosing a model | dropdown over `models/` | one filename via env var |
| Tunable | steps, CFG, LoRA strength, sampler, ModelSamplingFlux shifts, size presets | prompt, mode, width, height, seed |
| Progress and cancel | ✅ job queue, polling, cancellable | ❌ one call blocks until done |
| Configuration | panel settings → `$DSH_HOME/krea2-panel/settings.json` | env vars / CLI flags (`env` in the DSH patch) |
| Extra dependencies | none (graph is embedded) | no npm dependencies, Node ≥ 18 |

**Inside DeepSeek Harness, the plugin is enough — don't install both.** It is essentially a superset: anything the tool can do the panel can do, and the reverse. The MCP server's only extra is a `comfyui_status` tool, which the plugin covers with the status badge in the panel header and `GET /krea2/status` (VRAM, version, model inventory).

### When the MCP server is still the right pick

- You want **one config shared across several MCP clients** (Cursor, Claude Desktop, DSH): one JSON block does it.
- You **don't want a UI**, or you run headless / remotely with no browser.
- Your DSH version cannot install Cordis bundles.

### What happens if you install both

They don't technically conflict (different tool names, separate processes), but in practice both you and the model get confused:

- two near-identical tools appear in the list and the model picks either one at random;
- each path submits its own jobs to ComfyUI, so running both at once fights over 8 GB of VRAM;
- the model filename and URL are configured in two places, so changing one and forgetting the other shows up as "the panel works but the model can't generate" — miserable to diagnose.

If you already had the MCP version installed, delete or comment out this block in `cordis.patch.yml`:

```yaml
# Disable the MCP version; `krea2_generate` from the plugin covers it.
# - insert:
#     - id: mcp-krea2
#       name: '@deepseek-ai/dsh-mcp-client'
#       config:
#         serverName: krea2
#         transport: stdio
#         command: 'node'
#         args: ['D:/path/to/krea2-mcp/src/index.js']
```

## Install

### Option 1: local directory (development)

```bash
git clone https://github.com/W3967/dsh-krea2-panel.git
```

In Harness, run `plugin_manager` with `install_bundle` and pass the absolute path of that directory. A local directory install links the checkout, so code changes take effect after a restart of the session.

### Option 2: mount it into the profile

Put the package in the profile's `node_modules` and add one row to `cordis.patch.yml`:

```yaml
- insert:
    - id: krea2
      name: dsh-krea2-panel
      config:
        comfyUrl: 'http://127.0.0.1:8188'
        comfyRoot: 'D:\AI\ComfyUI\ComfyUI_windows_portable\ComfyUI'
```

`config` is only a **seed**: values saved from the panel take precedence.

## Configure

After installing, a ✦ icon appears in the sidebar. Open it and expand «Settings» at the bottom:

| Field | Meaning |
|---|---|
| ComfyUI URL | Default `http://127.0.0.1:8188`; reverse-proxied paths such as `http://host/comfy` also work. |
| ComfyUI directory | The folder containing `models/`, `input/` and `output/`. **Required**, otherwise the model dropdowns stay empty and generated images cannot be read back. |
| Sampler | `euler` / `euler_ancestral` / `dpmpp_2m` / `dpmpp_2m_sde` / `dpmpp_sde` / `heun` / `lcm`. |

Everything else (models, size, steps, CFG, LoRA strength) saves automatically, with a brief «saved» note in the footer.

## Usage

1. Pick a mode: text to image or style reference.
2. Write the prompt (English works best; Chinese is recognized too).
3. Choose the UNet — the other dropdowns follow whatever files are available.
4. Tune size and steps. On an RTX 5060 8 GB, 1024² at 8 steps takes about 70 seconds; style reference takes longer because the reference image has to be encoded.
5. Press Generate (or `Ctrl/Cmd + Enter`).
6. The result appears on the right. Click it for full size; the thumbnail strip walks back through this session's results.

## Changing models

All four dropdowns come from a **live scan** of ComfyUI's `models/` folder — no code change, no reinstall:

1. drop the file into the right directory;
2. press ↻ at the top right of the panel;
3. pick it from the dropdown (it saves automatically).

| Kind | Location |
|---|---|
| UNet / main model | `models/diffusion_models/` (or `unet/`) |
| Text encoder | `models/text_encoders/` |
| VAE | `models/vae/` |
| LoRA | `models/loras/` |

### Both UNet formats are picked up automatically

| File | Loader node |
|---|---|
| `*.gguf` (community quant) | `UnetLoaderGGUF` |
| `*.safetensors` (official full precision) | `UNETLoader` |

The extension decides the loader, so moving from Q2_K to Q4_K, or switching to the official fp16 file, is just a dropdown change.

### What you can and cannot swap

| Change | OK | Note |
|---|---|---|
| Different quant of the same architecture (Q2_K → Q4_K → Q8_0) | ✅ | pick it |
| Official `.safetensors` full-precision UNet | ✅ | switches to `UNETLoader` automatically |
| Different VAE | ✅ | must match the architecture (Krea 2 uses `qwen_image_vae`) |
| Add or change a style LoRA | ✅ | **single slot**, no stacking multiple LoRAs |
| Different text encoder | ⚠️ | must be the **official FP8 Qwen3VL**; the GGUF variant fails with a `12x2560` feature-dimension error |
| A different architecture (Flux, SDXL, …) | ❌ | the node graph differs — see below |

**Why the last row fails:** the graph is fixed — `ModelSamplingFlux` + `KSampler`, `CLIPLoader` with `type: krea2`, and `TextEncodeQwenImageEditPlus` in style-reference mode. Those are Krea 2 / Qwen-Image specific nodes, so a different architecture means a different graph.

To support another architecture, rewrite `buildTxt2Img` / `buildStyleRef` in [lib/comfy.js](lib/comfy.js). Queueing, validation, UI and the tool all stay untouched.

## For the agent: `krea2_generate`

> If you also installed `krea2-mcp`, read the «Which one» section first — the two tools will compete.

Besides the panel, the plugin registers one agent tool. It goes through the **same job queue** (`jobs.start`) and only differs by waiting: a model cannot poll a job id, so the tool holds the call open until the image exists.

| Parameter | Meaning |
|---|---|
| `prompt` | What to draw. May be an empty string in `style_ref` mode. |
| `mode` | `txt2img` (default) / `style_ref` |
| `reference_image` | Required for `style_ref`; absolute path to the reference |
| `model` | Optional temporary UNet filename override |
| `lora` / `lora_strength` | Optional LoRA override; `lora: ""` means none for this call |
| `width` / `height` / `steps` / `seed` | Optional; omitted values use the panel settings |

Returns `{ path, paths, seed, width, height, steps, elapsed_ms, job_id }`, and the result card shows the image path.

How it relates to the panel:

- **Same validation and clamping** — `width: 100` from the tool is clamped to 256 exactly like the UI.
- **Serial execution** (`isConcurrencySafe: false`): two prompts at once fight over 8 GB of VRAM, and ComfyUI's `/interrupt` is global.
- **Cancellable** — an interrupted model call releases the wait through `exec.signal`.
- **11-minute tool timeout**, a little longer than the 10-minute job cap, so you get "job failed" rather than "tool timed out".

## Architecture

```
krea2-panel/
├── index.js              Host half: registers the /krea2 routes
├── lib/
│   ├── comfy.js          ComfyUI HTTP client + both workflow graphs
│   ├── settings.js       defaults, validation, persistence
│   ├── jobs.js           job state machine (queued→running→done/error/canceled)
│   ├── routes.js         the /krea2/* HTTP surface and image path checks
│   └── tool.js           the krea2_generate agent tool
├── client.js             Client half: sidebar entry + main panel
├── cordis.patch.yml      bundle patch
├── locale/{en,zh}.json   title and description shown in Plugin Manager
└── icon.svg
```

**Transport**: the client calls the Host's HTTP routes with relative paths — `fetch('krea2/...', { credentials: 'same-origin' })`. No session involvement, no event-log writes. Images are proxied by the Host too, so the browser never talks to ComfyUI directly (no cross-origin problems).

**Endpoints**:

| Method | Path | Purpose |
|---|---|---|
| GET | `/krea2/status` | ComfyUI state, model inventory, current settings |
| GET/POST | `/krea2/settings` | read / partially update settings |
| POST | `/krea2/generate` | submit one generation, returns a job immediately |
| GET | `/krea2/job?id=` | one job's state |
| GET | `/krea2/jobs` | recent jobs |
| POST | `/krea2/cancel` | stop a job |
| GET | `/krea2/image?path=` | image bytes |

`?path=` is re-resolved and must land inside ComfyUI's `output` or `temp`; `..` traversal and outside paths are a flat 404.

## Development

```bash
npm run check   # node --check on all 7 entry files
npm test        # 25 tests: workflow construction, path safety, tool argument mapping
```

There is no build step: `client.js` is plain JavaScript loaded by the browser directly (`window.__ModuleLoader__` format), so a page refresh picks up changes.

After editing `index.js` or anything under `lib/`, disable and re-enable the plugin from `plugin_manager` so a fresh module generation is loaded.

### CI

GitHub Actions runs `npm run check` and `npm test` on every push and pull request (Node 22, about 15 seconds). The badge is at the top of this page.

### Publishing

```bash
git init
git add -A
git commit -m "feat: Krea 2 studio panel"

git remote add origin https://github.com/W3967/dsh-krea2-panel.git
git branch -M main
git push -u origin main
```

To publish on npm, remove `"private": true` from `package.json` if present, check `npm pack --dry-run`, then `npm publish --access public`.

## Known limitations

- Cancellation is best effort: ComfyUI's `/interrupt` is global, so a prompt already sampling may still finish while the panel marks it canceled.
- One generation is capped at 10 minutes; exceeding it is reported as a failure.
- The reference image must be an absolute local path (the panel copies it into ComfyUI's `input`); drag-and-drop upload is not supported yet.
- The panel does not manage images; results stay in ComfyUI's `output` folder.

## Notes

- **The Krea 2 weights themselves** are covered by the Krea 2 Community License (conditional commercial use, mandatory content-filtering obligations). This plugin only calls your local ComfyUI and ships no model weights.

## License

MIT for the plugin code. See [LICENSE](./LICENSE).
