/**
 * dsh-krea2-panel — Web Client half.
 *
 * Registers a sidebar entry and the main panel behind it: model pickers, the
 * prompt box, generation parameters, and a preview of finished images. All
 * data comes from the Host's `/krea2/*` routes.
 */

window.__ModuleLoader__.load({
  id: 'dsh-krea2-panel',
  factory: function (require) {
    'use strict'

    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef
    var useCallback = React.useCallback

    /** Sidebar entry id, which is also the `main` slot key. */
    var PANEL_ID = 'krea2'

    /** Relative to the page origin; the Host serves the `/krea2` prefix. */
    var API = 'krea2/'

    var EMPTY_MODELS = { unet: [], clip: [], vae: [], lora: [] }

    var SIZE_PRESETS = [
      { label: '1:1 · 1024', width: 1024, height: 1024 },
      { label: '4:3 · 1152×896', width: 1152, height: 896 },
      { label: '3:4 · 896×1152', width: 896, height: 1152 },
      { label: '16:9 · 1280×720', width: 1280, height: 720 },
      { label: '9:16 · 720×1280', width: 720, height: 1280 },
    ]

    /* ------------------------------- i18n ------------------------------- */

    var DICTS = {
      zh: {
        'nav.label': 'Krea 2',
        'app.title': 'Krea 2 工作台',
        'app.tagline': '本地 ComfyUI · 文生图与风格参考',

        'comfy.online': '已连接',
        'comfy.offline': '未连接',
        'comfy.checking': '检测中',
        'comfy.unknown': '状态未知',
        'comfy.refresh': '刷新状态',
        'comfy.vram': '显存',

        'mode.txt2img': '文生图',
        'mode.style_ref': '风格参考',
        'mode.txt2img.hint': '只凭画面描述生成。',
        'mode.style_ref.hint': '参考一张图，沿用它的风格与氛围。',

        'field.prompt': '画面描述',
        'field.prompt.ph': '例如：a red fox sitting in a snowy forest at dusk, cinematic lighting, highly detailed',
        'field.negative': '负面提示词',
        'field.negative.ph': '可选，不想出现的内容',
        'field.unet': '主模型',
        'field.clip': '文本编码器',
        'field.vae': 'VAE',
        'field.lora': 'LoRA',
        'field.lora.none': '不使用',
        'field.loraStrength': 'LoRA 强度',
        'field.size': '尺寸',
        'field.width': '宽',
        'field.height': '高',
        'field.steps': '步数',
        'field.cfg': 'CFG',
        'field.seed': '种子',
        'field.seed.ph': '留空 = 随机',
        'field.sampler': '采样器',
        'field.reference': '参考图',
        'field.reference.ph': '参考图的绝对路径',
        'field.reference.hint': 'ComfyUI 会读取这张图，生成时复制到它的 input 目录。',

        'action.generate': '生成',
        'action.generating': '生成中',
        'action.cancel': '取消',
        'action.random': '随机',
        'action.useLatest': '用最近结果',
        'action.copyPath': '复制路径',
        'action.copyPrompt': '复制描述',
        'action.zoom': '查看大图',
        'action.close': '关闭',
        'action.save': '保存设置',
        'action.saved': '已保存',
        'action.saving': '保存中',

        'state.queued': '排队中',
        'state.running': '生成中',
        'state.done': '已完成',
        'state.error': '失败',
        'state.canceled': '已取消',

        'empty.title': '还没有图',
        'empty.body': '写好画面描述，点「生成」。1024² 大约一分钟，风格参考会更久一些。',
        'empty.offline': 'ComfyUI 没连上，先启动它，再点右上角刷新。',
        'empty.noModels': '没找到模型文件。请在下方「设置」里填写 ComfyUI 目录（包含 models 文件夹的那一层）。',

        'settings.title': '设置',
        'settings.expand': '展开设置',
        'settings.collapse': '收起设置',
        'settings.comfyUrl': 'ComfyUI 地址',
        'settings.comfyRoot': 'ComfyUI 目录',
        'settings.comfyRoot.hint': '指向含 models / input / output 的目录，用于查找模型和读取生成的图。',
        'settings.advanced': '高级',
        'settings.maxShift': 'max shift',
        'settings.baseShift': 'base shift',

        'result.title': '结果',
        'result.count': '本次会话 {n} 张',
        'result.seed': '种子 {seed}',
        'result.size': '{w}×{h}',
        'result.time': '{s}s',
        'result.mode': '{mode}',

        'error.title': '出错了',
        'error.closed': '连接中断，稍后会自动重试。',
        'error.noUnet': '请选择主模型。',
        'error.noPrompt': '先写画面描述。',
        'error.noReference': '风格参考模式需要一张参考图。',
        'hint.enter': '⌘/Ctrl + Enter 生成',
      },
      en: {
        'nav.label': 'Krea 2',
        'app.title': 'Krea 2 Studio',
        'app.tagline': 'Local ComfyUI · text-to-image and style reference',

        'comfy.online': 'Connected',
        'comfy.offline': 'Offline',
        'comfy.checking': 'Checking',
        'comfy.unknown': 'Unknown',
        'comfy.refresh': 'Refresh status',
        'comfy.vram': 'VRAM',

        'mode.txt2img': 'Text to image',
        'mode.style_ref': 'Style reference',
        'mode.txt2img.hint': 'Generate from the prompt alone.',
        'mode.style_ref.hint': 'Carry over the style and mood of a reference image.',

        'field.prompt': 'Prompt',
        'field.prompt.ph': 'e.g. a red fox sitting in a snowy forest at dusk, cinematic lighting, highly detailed',
        'field.negative': 'Negative prompt',
        'field.negative.ph': 'Optional, what to avoid',
        'field.unet': 'UNet',
        'field.clip': 'Text encoder',
        'field.vae': 'VAE',
        'field.lora': 'LoRA',
        'field.lora.none': 'None',
        'field.loraStrength': 'LoRA strength',
        'field.size': 'Size',
        'field.width': 'W',
        'field.height': 'H',
        'field.steps': 'Steps',
        'field.cfg': 'CFG',
        'field.seed': 'Seed',
        'field.seed.ph': 'Empty = random',
        'field.sampler': 'Sampler',
        'field.reference': 'Reference image',
        'field.reference.ph': 'Absolute path to an image',
        'field.reference.hint': 'ComfyUI reads this file; it is copied into its input folder per run.',

        'action.generate': 'Generate',
        'action.generating': 'Generating',
        'action.cancel': 'Cancel',
        'action.random': 'Random',
        'action.useLatest': 'Use latest',
        'action.copyPath': 'Copy path',
        'action.copyPrompt': 'Copy prompt',
        'action.zoom': 'Open full size',
        'action.close': 'Close',
        'action.save': 'Save settings',
        'action.saved': 'Saved',
        'action.saving': 'Saving',

        'state.queued': 'Queued',
        'state.running': 'Generating',
        'state.done': 'Done',
        'state.error': 'Failed',
        'state.canceled': 'Canceled',

        'empty.title': 'No images yet',
        'empty.body': 'Write a prompt and press Generate. 1024² takes about a minute; style reference takes longer.',
        'empty.offline': 'ComfyUI is not reachable. Start it, then refresh.',
        'empty.noModels': 'No model files found. Set the ComfyUI directory below (the folder containing models/).',

        'settings.title': 'Settings',
        'settings.expand': 'Show settings',
        'settings.collapse': 'Hide settings',
        'settings.comfyUrl': 'ComfyUI URL',
        'settings.comfyRoot': 'ComfyUI directory',
        'settings.comfyRoot.hint': 'Points at the folder holding models / input / output.',
        'settings.advanced': 'Advanced',
        'settings.maxShift': 'max shift',
        'settings.baseShift': 'base shift',

        'result.title': 'Result',
        'result.count': '{n} this session',
        'result.seed': 'seed {seed}',
        'result.size': '{w}×{h}',
        'result.time': '{s}s',
        'result.mode': '{mode}',

        'error.title': 'Something went wrong',
        'error.closed': 'Connection lost; retrying shortly.',
        'error.noUnet': 'Pick a UNet first.',
        'error.noPrompt': 'Write a prompt first.',
        'error.noReference': 'Style reference needs a reference image.',
        'hint.enter': '⌘/Ctrl + Enter to generate',
      },
    }

    var LANG = (function () {
      var lang = ''
      try {
        lang = document.documentElement.getAttribute('lang') || (navigator && navigator.language) || ''
      } catch (error) {
        lang = ''
      }
      return String(lang).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
    })()

    /** Bound to the host locale service when the plugin applies. */
    var localeTranslate = null

    function t(key, vars) {
      var text = null
      if (localeTranslate !== null) {
        try {
          text = localeTranslate(key, vars)
        } catch (error) {
          text = null
        }
      }
      if (typeof text !== 'string' || text === '' || text === key) {
        var dict = DICTS[LANG] || DICTS.zh
        text = dict[key] !== undefined ? dict[key] : DICTS.zh[key] !== undefined ? DICTS.zh[key] : key
      }
      if (vars !== undefined && vars !== null) {
        Object.keys(vars).forEach(function (name) {
          text = text.split('{' + name + '}').join(String(vars[name]))
        })
      }
      return text
    }

    /* ------------------------------- HTTP ------------------------------- */

    async function getJson(url) {
      var response = await fetch(url, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      return readEnvelope(response)
    }

    async function postJson(url, payload) {
      var response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload === undefined ? {} : payload),
      })
      return readEnvelope(response)
    }

    async function readEnvelope(response) {
      var body = null
      try {
        body = await response.json()
      } catch (error) {
        body = null
      }
      if (!response.ok || body === null || body.ok !== true) {
        var message =
          body !== null && body.error && body.error.message ? body.error.message : 'HTTP ' + response.status
        throw new Error(message)
      }
      return body
    }

    function imageUrl(path) {
      return API + 'image?path=' + encodeURIComponent(path)
    }

    /* ------------------------------ styling ----------------------------- */

    var STYLE = `
.k2-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,#141417);color:var(--dsw-alias-label-primary,#f4f4f5);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);font-size:13px;line-height:20px}
.k2-root *,.k2-root *::before,.k2-root *::after{box-sizing:border-box}
.k2-root :focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4176E6);outline-offset:1px}
.k2-root input,.k2-root textarea{user-select:text}
.k2-topbar{display:flex;align-items:center;gap:10px;flex:none;height:48px;padding:0 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));background:var(--dsw-alias-bg-layer-1,#15151a)}
.k2-brand{display:flex;align-items:center;gap:9px;min-width:0}
.k2-brand-mark{width:28px;height:28px;flex:none;border-radius:9px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#7c8cff,#3f5fd6);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}
.k2-brand-text{display:flex;flex-direction:column;min-width:0;line-height:1.2}
.k2-brand-title{font-size:13.5px;font-weight:650;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k2-brand-sub{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a93);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k2-head-right{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}
.k2-pill{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.04));color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:12px;white-space:nowrap}
.k2-pill.is-on{color:var(--dsw-alias-state-success-primary,#3fb950);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fb950) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fb950) 12%,transparent)}
.k2-pill.is-off{color:var(--dsw-alias-state-error-primary,#e5484d);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 12%,transparent)}
.k2-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.k2-iconbtn{width:30px;height:30px;display:inline-grid;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa);cursor:pointer;flex:none}
.k2-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07));color:var(--dsw-alias-label-primary,#f4f4f5)}
.k2-iconbtn:disabled{opacity:.45;cursor:default}
.k2-iconbtn.is-spinning svg{animation:k2-spin .9s linear infinite}

.k2-body{display:flex;flex:1 1 auto;min-height:0}
.k2-side{width:348px;flex:0 0 348px;min-height:0;overflow-y:auto;padding:16px 18px 32px;border-right:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));background:var(--dsw-alias-bg-base,#141417)}
.k2-stage{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;padding:16px 20px 20px;gap:12px;overflow:hidden}

.k2-sec{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}
.k2-sec:last-child{margin-bottom:0}
.k2-sec-head{display:flex;align-items:center;gap:6px}
.k2-sec-title{font-size:11px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.k2-sec-note{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.k2-row{display:flex;align-items:center;gap:8px}
.k2-row.is-wrap{flex-wrap:wrap}
.k2-grow{flex:1 1 auto;min-width:0}

.k2-seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:3px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.04));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07))}
.k2-seg-btn{height:26px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.k2-seg-btn:hover{color:var(--dsw-alias-label-primary,#f4f4f5)}
.k2-seg-btn.is-on{background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.1));color:var(--dsw-alias-label-primary,#f4f4f5);font-weight:600}
.k2-hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8a93);line-height:1.5}

.k2-label{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#a1a1aa);min-height:18px}
.k2-label .k2-grow{flex:1 1 auto}
.k2-input,.k2-select,.k2-textarea{width:100%;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.035));color:var(--dsw-alias-label-primary,#f4f4f5);font:inherit;font-size:13px;padding:0 10px;height:32px;outline:none;min-width:0}
.k2-input::placeholder,.k2-textarea::placeholder{color:var(--dsw-alias-label-tertiary,#8a8a93)}
.k2-input:focus,.k2-select:focus,.k2-textarea:focus{border-color:var(--dsw-alias-state-business-primary,#4176E6);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176E6) 16%,transparent)}
.k2-select{appearance:none;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 15px) 14px,calc(100% - 10px) 14px;background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:28px;cursor:pointer}
.k2-select option{background:var(--dsw-alias-bg-layer-1,#1a1a1e);color:var(--dsw-alias-label-primary,#f4f4f5)}
.k2-textarea{height:auto;min-height:96px;padding:9px 10px;line-height:1.55;resize:vertical;font-size:13px}
.k2-textarea.is-tall{min-height:120px}
.k2-num{text-align:center;font-variant-numeric:tabular-nums}
.k2-input:disabled,.k2-select:disabled,.k2-textarea:disabled{opacity:.55;cursor:not-allowed}

.k2-chips{display:flex;flex-wrap:wrap;gap:6px}
.k2-chip{height:24px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa);font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}
.k2-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07));color:var(--dsw-alias-label-primary,#f4f4f5)}
.k2-chip.is-on{background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.1));color:var(--dsw-alias-label-primary,#f4f4f5);border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.16))}

.k2-slider{display:flex;align-items:center;gap:8px}
.k2-slider input[type=range]{flex:1 1 auto;height:16px;appearance:none;background:transparent;cursor:pointer;min-width:0}
.k2-slider input[type=range]::-webkit-slider-runnable-track{height:3px;border-radius:2px;background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.12))}
.k2-slider input[type=range]::-moz-range-track{height:3px;border-radius:2px;background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.12))}
.k2-slider input[type=range]::-webkit-slider-thumb{appearance:none;width:11px;height:11px;margin-top:-4px;border-radius:50%;background:var(--dsw-alias-label-primary,#f4f4f5);box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1,#15151a)}
.k2-slider input[type=range]::-moz-range-thumb{width:11px;height:11px;border:0;border-radius:50%;background:var(--dsw-alias-label-primary,#f4f4f5)}
.k2-slider-val{width:38px;flex:none;text-align:right;font-size:12px;color:var(--dsw-alias-label-secondary,#a1a1aa);font-variant-numeric:tabular-nums}

.k2-btn{height:32px;padding:0 14px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.05));color:var(--dsw-alias-label-primary,#f4f4f5);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.k2-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.k2-btn:disabled{opacity:.5;cursor:not-allowed}
.k2-btn.is-primary{width:100%;height:38px;font-size:13.5px;font-weight:600;border-color:transparent;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,#4176E6));color:var(--dsw-alias-label-primary-foreground,#fff)}
.k2-btn.is-primary:hover{background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-state-business-primary,#4176E6));filter:brightness(1.05)}
.k2-btn.is-danger{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 40%,transparent);color:var(--dsw-alias-state-error-primary,#e5484d);background:transparent}
.k2-btn.is-small{height:26px;padding:0 9px;font-size:12px}
.k2-btn.is-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa)}
.k2-btn.is-ghost:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07));color:var(--dsw-alias-label-primary,#f4f4f5)}

.k2-disclose{display:flex;align-items:center;gap:6px;width:100%;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.k2-disclose:hover{color:var(--dsw-alias-label-primary,#f4f4f5)}
.k2-disclose svg{transition:transform .16s;flex:none}
.k2-disclose.is-open svg{transform:rotate(90deg)}

.k2-alert{display:flex;gap:8px;padding:9px 11px;border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 10%,transparent);color:var(--dsw-alias-state-error-primary,#e5484d);font-size:12px;line-height:1.5}
.k2-alert.is-info{border-color:var(--dsw-alias-border-l1,rgba(255,255,255,.08));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.04));color:var(--dsw-alias-label-secondary,#a1a1aa)}

.k2-stage-head{display:flex;align-items:center;gap:10px;flex:none;min-height:24px}
.k2-stage-title{font-size:13px;font-weight:620;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.k2-stage-meta{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.k2-stage-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:10px}
.k2-canvas{position:relative;flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));background:var(--dsw-alias-bg-layer-1,#15151a);overflow:hidden}
.k2-canvas img{max-width:100%;max-height:100%;display:block;object-fit:contain}
.k2-canvas.is-empty{background:repeating-linear-gradient(45deg,var(--dsw-alias-bg-layer-1,#15151a) 0 12px,var(--dsw-alias-bg-layer-2,#18181d) 12px 24px)}
.k2-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:32px 28px;text-align:center;color:var(--dsw-alias-label-tertiary,#8a8a93);max-width:46ch}
.k2-empty strong{color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:13.5px;font-weight:620}
.k2-empty span{font-size:12px;line-height:1.6}
.k2-empty svg{opacity:.5}

.k2-busy{display:flex;flex-direction:column;align-items:center;gap:14px;padding:24px;text-align:center}
.k2-spinner{width:30px;height:30px;border-radius:50%;border:2.5px solid var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.12));border-top-color:var(--dsw-alias-state-business-primary,#4176E6);animation:k2-spin .85s linear infinite}
.k2-busy-title{font-size:13px;font-weight:600}
.k2-busy-sub{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8a93);font-variant-numeric:tabular-nums}
.k2-busy-bar{width:min(240px,70%);height:3px;border-radius:2px;background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.12));overflow:hidden}
.k2-busy-bar i{display:block;height:100%;width:38%;border-radius:2px;background:var(--dsw-alias-state-business-primary,#4176E6);animation:k2-indet 1.6s ease-in-out infinite}

.k2-strip{display:flex;align-items:center;gap:8px;flex:none;overflow-x:auto;padding:2px 0 4px;scrollbar-width:thin}
.k2-thumb{position:relative;width:56px;height:56px;flex:none;padding:0;border-radius:9px;overflow:hidden;border:2px solid transparent;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.05));cursor:pointer}
.k2-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.k2-thumb.is-on{border-color:var(--dsw-alias-state-business-primary,#4176E6)}
.k2-thumb-count{margin-left:auto;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8a93);white-space:nowrap;flex:none}

.k2-zoom{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:32px;background:rgba(8,8,10,.82);backdrop-filter:blur(6px)}
.k2-zoom img{max-width:100%;max-height:100%;display:block;border-radius:10px;box-shadow:0 24px 80px rgba(0,0,0,.6)}
.k2-zoom-close{position:absolute;top:18px;right:18px;width:34px;height:34px;display:grid;place-items:center;border:0;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;cursor:pointer}
.k2-zoom-close:hover{background:rgba(255,255,255,.22)}

.k2-foot{display:flex;align-items:center;gap:8px;flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a93);min-height:16px}
.k2-saved{color:var(--dsw-alias-state-success-primary,#3fb950)}

@keyframes k2-spin{to{transform:rotate(360deg)}}
@keyframes k2-indet{0%{margin-left:-40%}50%{margin-left:60%}100%{margin-left:100%}}

@media (max-width:920px){
  .k2-body{flex-direction:column}
  .k2-side{width:auto;flex:0 0 auto;max-height:46vh;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07))}
  .k2-stage{padding:12px 14px 14px}
  .k2-brand-sub{display:none}
}
@media (prefers-reduced-motion:reduce){
  .k2-spinner{animation:none}
  .k2-busy-bar i{animation:none;margin-left:0;width:60%}
}
`

    /* ------------------------------- icons ------------------------------ */

    var ICONS = {
      spark: 'M12 2.6c.55 3.9 1.9 6.3 3.9 7.5-2 .9-3.4 3.3-3.9 7.3-.55-4-1.9-6.4-3.9-7.3 2-1.2 3.35-3.6 3.9-7.5Z',
      refresh: 'M20.5 12a8.5 8.5 0 1 1-2.5-6M20.5 4v5.5H15',
      gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
      stop: 'M7.5 7.5h9v9h-9z',
      copy: 'M9 9h9.5v9.5H9z M6.5 15H5V5h10v1.5',
      image: 'M3.5 5h17v14h-17z M3.5 15.5l4.6-4.4 3.1 3 3.4-3.3 5.4 5.2 M8.6 9.2a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2Z',
      chevron: 'M9 6l6 6-6 6',
      close: 'M6.5 6.5l11 11 M17.5 6.5l-11 11',
      bolt: 'M13.5 2.5 5.5 13.5h5l-1 8 8-11h-5l1-8Z',
    }

    function Icon(props) {
      var size = props.size || 16
      var name = props.name
      var path = ICONS[name] || ICONS.spark
      var filled = name === 'spark' || name === 'bolt'
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          'aria-hidden': true,
          fill: filled ? 'currentColor' : 'none',
          stroke: filled ? 'none' : 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { d: path }),
      )
    }

    /** Sidebar entry glyph; `active` marks the selected panel. */
    function KreaIcon(props) {
      var size = props && props.size ? props.size : 20
      var active = props && props.active === true
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          'aria-hidden': true,
          style: { display: 'block', color: active ? 'inherit' : 'currentColor', opacity: active ? 1 : 0.82 },
        },
        h('path', {
          d: ICONS.spark,
          fill: active ? 'currentColor' : 'none',
          stroke: 'currentColor',
          strokeWidth: active ? 0 : 1.7,
          strokeLinejoin: 'round',
        }),
      )
    }

    /* ---------------------------- primitives ---------------------------- */

    function Section(props) {
      return h(
        'div',
        { className: 'k2-sec' },
        props.title !== undefined
          ? h(
              'div',
              { className: 'k2-sec-head' },
              h('span', { className: 'k2-sec-title' }, props.title),
              props.note !== undefined ? h('span', { className: 'k2-sec-note' }, props.note) : null,
            )
          : null,
        props.children,
      )
    }

    function Label(props) {
      return h('div', { className: 'k2-label' }, h('span', null, props.text), props.children)
    }

    var SAMPLER_FALLBACKS = ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_sde', 'heun', 'lcm']

    function Select(props) {
      var options = Array.isArray(props.options) ? props.options : []
      var values = options.length > 0 ? options : props.emptyHint !== undefined ? [] : ['']
      var known = values.indexOf(props.value) >= 0
      return h(
        'select',
        {
          className: 'k2-select',
          value: known ? props.value : values.length > 0 ? values[0] : '',
          disabled: props.disabled === true || values.length === 0,
          title: props.title,
          onChange: function (event) {
            if (props.onChange) props.onChange(event.target.value)
          },
        },
        values.length === 0
          ? h('option', { value: '' }, props.emptyHint !== undefined ? props.emptyHint : '—')
          : values.map(function (value) {
              return h('option', { key: value, value: value }, props.render ? props.render(value) : value)
            }),
      )
    }

    /**
     * Number input that keeps the raw text while focused, so clearing the field
     * does not snap the caret to the clamped value mid-edit.
     */
    function NumberField(props) {
      var pair = useState(String(props.value))
      var text = pair[0]
      var setText = pair[1]
      var focused = useRef(false)

      useEffect(
        function () {
          if (!focused.current) setText(String(props.value))
        },
        [props.value],
      )

      return h('input', {
        type: 'number',
        className: 'k2-input k2-num',
        value: text,
        min: props.min,
        max: props.max,
        step: props.step,
        disabled: props.disabled === true,
        'aria-label': props.label,
        onFocus: function () {
          focused.current = true
        },
        onBlur: function () {
          focused.current = false
          var parsed = Number(text)
          if (text === '' ) {
            setText(String(props.value))
            return
          }
          if (!Number.isFinite(parsed)) {
            setText(String(props.value))
            return
          }
          var clamped = Math.min(props.max === undefined ? Infinity : props.max, Math.max(props.min === undefined ? -Infinity : props.min, parsed))
          setText(String(clamped))
          if (props.onChange) props.onChange(clamped)
        },
        onChange: function (event) {
          var raw = event.target.value
          setText(raw)
          var parsed = Number(raw)
          if (raw !== '' && Number.isFinite(parsed) && props.onChange) props.onChange(parsed)
        },
      })
    }

    /* ------------------------------- panel ------------------------------ */

    /** Keep a saved name when it still exists; otherwise fall back to the first file. */
    function pickModel(list, current) {
      var value = typeof current === 'string' ? current : ''
      if (!Array.isArray(list) || list.length === 0) return value
      if (value !== '' && list.indexOf(value) >= 0) return value
      return list[0]
    }

    function fromSettings(settings, models) {
      var source = settings !== null && typeof settings === 'object' ? settings : {}
      var inventory = models !== null && typeof models === 'object' ? models : EMPTY_MODELS

      return {
        mode: source.mode === 'style_ref' ? 'style_ref' : 'txt2img',
        unet: pickModel(inventory.unet, source.unet),
        clip: pickModel(inventory.clip, source.clip),
        vae: pickModel(inventory.vae, source.vae),
        lora: pickModel(inventory.lora, source.lora),
        loraStrength: typeof source.loraStrength === 'number' ? source.loraStrength : 1,
        negative: typeof source.negative === 'string' ? source.negative : '',
        width: typeof source.width === 'number' ? source.width : 1024,
        height: typeof source.height === 'number' ? source.height : 1024,
        steps: typeof source.steps === 'number' ? source.steps : 8,
        cfg: typeof source.cfg === 'number' ? source.cfg : 1,
        sampler: typeof source.sampler === 'string' && source.sampler !== '' ? source.sampler : 'euler',
        showAdvanced: source.showAdvanced === true,
      }
    }

    function formatSeconds(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '0.0'
      return (ms / 1000).toFixed(ms < 10000 ? 1 : 0)
    }

    function formatVram(bytes) {
      if (typeof bytes !== 'number' || bytes <= 0) return ''
      return (bytes / 1024 ** 3).toFixed(1) + ' GB'
    }

    function Panel() {
      var loadingPair = useState(true)
      var loading = loadingPair[0]
      var setLoading = loadingPair[1]

      var modelsPair = useState(EMPTY_MODELS)
      var models = modelsPair[0]
      var setModels = modelsPair[1]

      var comfyPair = useState(null)
      var comfy = comfyPair[0]
      var setComfy = comfyPair[1]

      var formPair = useState(function () {
        return fromSettings(null, EMPTY_MODELS)
      })
      var form = formPair[0]
      var setForm = formPair[1]

      var serverPair = useState(null)
      var server = serverPair[0]
      var setServer = serverPair[1]

      var promptPair = useState('')
      var prompt = promptPair[0]
      var setPrompt = promptPair[1]

      var negativePair = useState('')
      var negative = negativePair[0]
      var setNegative = negativePair[1]

      var seedPair = useState('')
      var seed = seedPair[0]
      var setSeed = seedPair[1]

      var refPair = useState('')
      var reference = refPair[0]
      var setReference = refPair[1]

      var jobPair = useState(null)
      var job = jobPair[0]
      var setJob = jobPair[1]

      var resultsPair = useState([])
      var results = resultsPair[0]
      var setResults = resultsPair[1]

      var activePair = useState(0)
      var active = activePair[0]
      var setActive = activePair[1]

      var errorPair = useState('')
      var error = errorPair[0]
      var setError = errorPair[1]

      var bootErrorPair = useState('')
      var bootError = bootErrorPair[0]
      var setBootError = bootErrorPair[1]

      var submittingPair = useState(false)
      var submitting = submittingPair[0]
      var setSubmitting = submittingPair[1]

      var savedPair = useState(0)
      var savedAt = savedPair[0]
      var setSavedAt = savedPair[1]

      var zoomPair = useState(null)
      var zoom = zoomPair[0]
      var setZoom = zoomPair[1]

      var settingsOpenPair = useState(false)
      var settingsOpen = settingsOpenPair[0]
      var setSettingsOpen = settingsOpenPair[1]

      var initialized = useRef(false)
      var saveTimer = useRef(null)
      var pendingPatch = useRef({})

      var flushSave = useCallback(function () {
        var patch = pendingPatch.current
        pendingPatch.current = {}
        if (Object.keys(patch).length === 0) return
        postJson(API + 'settings', patch)
          .then(function (res) {
            setServer(res.settings)
            setSavedAt(Date.now())
          })
          .catch(function (failure) {
            setError(failure.message)
          })
      }, [])

      var scheduleSave = useCallback(
        function (patch) {
          Object.keys(patch).forEach(function (key) {
            pendingPatch.current[key] = patch[key]
          })
          if (saveTimer.current !== null) clearTimeout(saveTimer.current)
          saveTimer.current = setTimeout(function () {
            saveTimer.current = null
            flushSave()
          }, 420)
        },
        [flushSave],
      )

      useEffect(function () {
        return function () {
          if (saveTimer.current !== null) {
            clearTimeout(saveTimer.current)
            saveTimer.current = null
            flushSave()
          }
        }
      }, [flushSave])

      useEffect(
        function () {
          if (savedAt === 0) return undefined
          var timer = setTimeout(function () {
            setSavedAt(0)
          }, 1800)
          return function () {
            clearTimeout(timer)
          }
        },
        [savedAt],
      )

      var refresh = useCallback(function (showSpinner) {
        if (showSpinner === true) setLoading(true)
        getJson(API + 'status')
          .then(function (res) {
            setComfy(res.comfy === undefined ? null : res.comfy)
            setModels(res.models === undefined || res.models === null ? EMPTY_MODELS : res.models)
            setServer(res.settings === undefined ? null : res.settings)
            setBootError('')
            if (!initialized.current) {
              initialized.current = true
              var next = fromSettings(res.settings, res.models)
              setForm(next)
              setNegative(next.negative)
              if (res.settings !== null && typeof res.settings === 'object') {
                setSettingsOpen(res.settings.showAdvanced === true)
              }
            }
          })
          .catch(function (failure) {
            setBootError(failure.message || String(failure))
            setComfy({ online: false, error: failure.message })
          })
          .finally(function () {
            setLoading(false)
          })
      }, [])

      useEffect(
        function () {
          refresh(true)
        },
        [refresh],
      )

      // A refresh can drop a model the form still names. Re-pick only the
      // model fields: an unsaved width or prompt edit must survive a refresh.
      useEffect(
        function () {
          setForm(function (prev) {
            return Object.assign({}, prev, {
              unet: pickModel(models.unet, prev.unet),
              clip: pickModel(models.clip, prev.clip),
              vae: pickModel(models.vae, prev.vae),
              lora: pickModel(models.lora, prev.lora),
            })
          })
        },
        [models],
      )

      var update = useCallback(
        function (patch, persist) {
          setForm(function (prev) {
            return Object.assign({}, prev, patch)
          })
          if (persist !== false) scheduleSave(patch)
        },
        [scheduleSave],
      )

      var online = comfy !== null && comfy !== undefined && comfy.online === true
      var busy = job !== null && (job.state === 'queued' || job.state === 'running')

      var generate = useCallback(
        function () {
          if (submitting === true || busy === true) return
          if (prompt.trim() === '' && form.mode === 'txt2img') {
            setError(t('error.noPrompt'))
            return
          }
          if (form.mode === 'style_ref' && reference.trim() === '') {
            setError(t('error.noReference'))
            return
          }
          if (form.unet === '') {
            setError(t('error.noUnet'))
            return
          }
          setError('')
          setSubmitting(true)
          var body = {
            mode: form.mode,
            prompt: prompt,
            negative: negative,
            unet: form.unet,
            clip: form.clip,
            vae: form.vae,
            lora: form.lora,
            loraStrength: form.loraStrength,
            width: form.width,
            height: form.height,
            steps: form.steps,
            cfg: form.cfg,
            sampler: form.sampler,
            seed: seed.trim() === '' ? 0 : Number(seed),
          }
          if (form.mode === 'style_ref') body.referenceImage = reference.trim()
          postJson(API + 'generate', body)
            .then(function (res) {
              setJob(res.job)
            })
            .catch(function (failure) {
              setError(failure.message)
            })
            .finally(function () {
              setSubmitting(false)
            })
        },
        [busy, submitting, prompt, negative, reference, seed, form],
      )

      var cancel = useCallback(function () {
        if (job === null) return
        postJson(API + 'cancel', { id: job.id })
          .then(function () {
            setJob(function (prev) {
              return prev === null ? prev : Object.assign({}, prev, { state: 'canceled' })
            })
          })
          .catch(function (failure) {
            setError(failure.message)
          })
      }, [job])

      var pollId = job === null ? null : job.id
      var pollState = job === null ? null : job.state

      useEffect(
        function () {
          if (pollId === null) return undefined
          if (pollState !== 'queued' && pollState !== 'running') return undefined
          var alive = true
          var timer = setInterval(function () {
            getJson(API + 'job?id=' + encodeURIComponent(pollId))
              .then(function (res) {
                if (!alive) return
                setJob(res.job)
                if (res.job.state === 'done') {
                  setResults(function (prev) {
                    return [res.job].concat(prev).slice(0, 40)
                  })
                  setActive(0)
                }
              })
              .catch(function () {
                // One dropped poll is fine; the next tick retries.
              })
          }, 1200)
          return function () {
            alive = false
            clearInterval(timer)
          }
        },
        [pollId, pollState],
      )

      // Escape closes the full-size view.
      useEffect(
        function () {
          if (zoom === null) return undefined
          function onKey(event) {
            if (event.key === 'Escape') setZoom(null)
          }
          window.addEventListener('keydown', onKey)
          return function () {
            window.removeEventListener('keydown', onKey)
          }
        },
        [zoom],
      )

      var currentResult = results.length > 0 && results[active] !== undefined ? results[active] : null
      var latestPath =
        results.length > 0 && results[0].images.length > 0 ? results[0].images[0].path : ''

      var samplers = SAMPLER_FALLBACKS
      var loraOptions = [{ value: '', label: t('field.lora.none') }].concat(
        (models.lora || []).map(function (name) {
          return { value: name, label: name }
        }),
      )

      function renderSelectField(labelKey, value, options, onChange) {
        return h(
          'div',
          { className: 'k2-sec' },
          h(Label, { text: t(labelKey) }),
          h(Select, {
            options: options.map(function (option) {
              return option.value
            }),
            value: value,
            disabled: options.length === 0,
            emptyHint: t('empty.noModels'),
            render: function (key) {
              for (var i = 0; i < options.length; i += 1) {
                if (options[i].value === key) return options[i].label
              }
              return key
            },
            onChange: onChange,
          }),
        )
      }

      function renderHeight(input) {
        return h(
          'div',
          { className: 'k2-sec' },
          h(
            'div',
            { className: 'k2-row' },
            h(
              'div',
              { className: 'k2-grow' },
              h(Label, { text: t('field.width') }),
              h(NumberField, {
                value: input.width,
                min: 256,
                max: 1280,
                step: 64,
                label: t('field.width'),
                onChange: function (value) {
                  update({ width: value })
                },
              }),
            ),
            h(
              'div',
              { className: 'k2-grow' },
              h(Label, { text: t('field.height') }),
              h(NumberField, {
                value: input.height,
                min: 256,
                max: 1280,
                step: 64,
                label: t('field.height'),
                onChange: function (value) {
                  update({ height: value })
                },
              }),
            ),
          ),
          h(
            'div',
            { className: 'k2-chips' },
            SIZE_PRESETS.map(function (preset) {
              var on = input.width === preset.width && input.height === preset.height
              return h(
                'button',
                {
                  key: preset.label,
                  type: 'button',
                  className: 'k2-chip' + (on ? ' is-on' : ''),
                  onClick: function () {
                    update({ width: preset.width, height: preset.height })
                  },
                },
                preset.label,
              )
            }),
          ),
        )
      }

      var body = null
      if (loading === true && initialized.current === false) {
        body = h(
          'div',
          { className: 'k2-empty', style: { flex: '1 1 auto' } },
          h('div', { className: 'k2-spinner' }),
          h('span', null, t('comfy.checking')),
        )
      } else {
        body = h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'k2-side' },
            bootError !== ''
              ? h('div', { className: 'k2-alert', style: { marginBottom: '12px' } }, bootError)
              : null,
            h(
              'div',
              { className: 'k2-sec' },
              h(
                'div',
                { className: 'k2-seg' },
                ['txt2img', 'style_ref'].map(function (mode) {
                  return h(
                    'button',
                    {
                      key: mode,
                      type: 'button',
                      className: 'k2-seg-btn' + (form.mode === mode ? ' is-on' : ''),
                      onClick: function () {
                        update({ mode: mode })
                      },
                    },
                    t(mode === 'txt2img' ? 'mode.txt2img' : 'mode.style_ref'),
                  )
                }),
              ),
              h('div', { className: 'k2-hint' }, t(form.mode === 'txt2img' ? 'mode.txt2img.hint' : 'mode.style_ref.hint')),
            ),

            h(
              'div',
              { className: 'k2-sec' },
              h(
                'div',
                { className: 'k2-label' },
                h('span', null, t('field.prompt')),
                h('span', { className: 'k2-grow' }),
                h('span', { style: { fontSize: '11px', opacity: 0.7 } }, t('hint.enter')),
              ),
              h('textarea', {
                className: 'k2-textarea is-tall',
                value: prompt,
                placeholder: t('field.prompt.ph'),
                spellCheck: false,
                onChange: function (event) {
                  setPrompt(event.target.value)
                },
                onKeyDown: function (event) {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    generate()
                  }
                },
              }),
            ),

            form.mode === 'style_ref'
              ? h(
                  'div',
                  { className: 'k2-sec' },
                  h(Label, { text: t('field.reference') }),
                  h(
                    'div',
                    { className: 'k2-row' },
                    h('input', {
                      className: 'k2-input k2-grow',
                      value: reference,
                      placeholder: t('field.reference.ph'),
                      spellCheck: false,
                      onChange: function (event) {
                        setReference(event.target.value)
                      },
                    }),
                    latestPath !== ''
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'k2-btn is-small',
                            title: t('action.useLatest'),
                            onClick: function () {
                              setReference(latestPath)
                            },
                          },
                          t('action.useLatest'),
                        )
                      : null,
                  ),
                  h('div', { className: 'k2-hint' }, t('field.reference.hint')),
                )
              : null,

            renderSelectField(
              'field.unet',
              form.unet,
              (models.unet || []).map(function (name) {
                return { value: name, label: name }
              }),
              function (value) {
                update({ unet: value })
              },
            ),
            renderSelectField(
              'field.clip',
              form.clip,
              (models.clip || []).map(function (name) {
                return { value: name, label: name }
              }),
              function (value) {
                update({ clip: value })
              },
            ),
            renderSelectField(
              'field.vae',
              form.vae,
              (models.vae || []).map(function (name) {
                return { value: name, label: name }
              }),
              function (value) {
                update({ vae: value })
              },
            ),
            renderSelectField('field.lora', form.lora, loraOptions, function (value) {
              update({ lora: value })
            }),
            form.lora !== ''
              ? h(
                  'div',
                  { className: 'k2-sec' },
                  h(Label, { text: t('field.loraStrength') }),
                  h(
                    'div',
                    { className: 'k2-slider' },
                    h('input', {
                      type: 'range',
                      min: 0,
                      max: 2,
                      step: 0.05,
                      value: form.loraStrength,
                      onChange: function (event) {
                        update({ loraStrength: Number(event.target.value) })
                      },
                    }),
                    h('span', { className: 'k2-slider-val' }, form.loraStrength.toFixed(2)),
                  ),
                )
              : null,

            renderHeight(form),

            h(
              'div',
              { className: 'k2-sec' },
              h(
                'div',
                { className: 'k2-row' },
                h(
                  'div',
                  { className: 'k2-grow' },
                  h(Label, { text: t('field.steps') }),
                  h(NumberField, {
                    value: form.steps,
                    min: 1,
                    max: 60,
                    step: 1,
                    label: t('field.steps'),
                    onChange: function (value) {
                      update({ steps: value })
                    },
                  }),
                ),
                h(
                  'div',
                  { className: 'k2-grow' },
                  h(Label, { text: t('field.cfg') }),
                  h(NumberField, {
                    value: form.cfg,
                    min: 0,
                    max: 10,
                    step: 0.1,
                    label: t('field.cfg'),
                    onChange: function (value) {
                      update({ cfg: value })
                    },
                  }),
                ),
              ),
            ),

            h(
              'div',
              { className: 'k2-sec' },
              h(Label, { text: t('field.seed') }),
              h(
                'div',
                { className: 'k2-row' },
                h('input', {
                  className: 'k2-input k2-grow',
                  value: seed,
                  inputMode: 'numeric',
                  placeholder: t('field.seed.ph'),
                  onChange: function (event) {
                    setSeed(event.target.value.replace(/[^0-9]/g, ''))
                  },
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'k2-btn is-small',
                    onClick: function () {
                      setSeed(String(Math.floor(Math.random() * 1e9)))
                    },
                  },
                  t('action.random'),
                ),
              ),
            ),

            h(
              'div',
              { className: 'k2-sec' },
              form.mode === 'txt2img'
                ? h(
                    React.Fragment,
                    null,
                    h(Label, { text: t('field.negative') }),
                    h('input', {
                      className: 'k2-input',
                      value: negative,
                      placeholder: t('field.negative.ph'),
                      spellCheck: false,
                      onChange: function (event) {
                        setNegative(event.target.value)
                      },
                      onBlur: function () {
                        scheduleSave({ negative: negative })
                      },
                    }),
                  )
                : null,
              error !== '' ? h('div', { className: 'k2-alert' }, error) : null,
            ),

            h(
              'div',
              { className: 'k2-sec' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'k2-btn is-primary',
                  disabled: submitting === true || busy === true || online === false,
                  onClick: generate,
                },
                busy === true
                  ? h('span', null, t('action.generating') + '…')
                  : h(Icon, { name: 'bolt', size: 15 }),
                busy === true ? null : h('span', null, t('action.generate')),
              ),
              busy === true
                ? h(
                    'button',
                    { type: 'button', className: 'k2-btn is-danger', onClick: cancel },
                    h(Icon, { name: 'stop', size: 13 }),
                    h('span', null, t('action.cancel')),
                  )
                : null,
            ),

            h(
              'div',
              { className: 'k2-sec' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'k2-btn is-ghost',
                  style: { paddingLeft: 0, justifyContent: 'flex-start' },
                  onClick: function () {
                    var next = settingsOpen !== true
                    setSettingsOpen(next)
                    scheduleSave({ showAdvanced: next })
                  },
                },
                h(Icon, { name: 'gear', size: 14 }),
                h('span', null, t('settings.title')),
              ),
              settingsOpen === true
                ? h(
                    React.Fragment,
                    null,
                    h(
                      'div',
                      { style: { marginTop: '6px' } },
                      h(Label, { text: t('settings.comfyUrl') }),
                      h('input', {
                        className: 'k2-input',
                        value: server !== null && typeof server.comfyUrl === 'string' ? server.comfyUrl : '',
                        spellCheck: false,
                        onChange: function (event) {
                          var value = event.target.value
                          setServer(function (prev) {
                            return Object.assign({}, prev || {}, { comfyUrl: value })
                          })
                          scheduleSave({ comfyUrl: value })
                        },
                      }),
                    ),
                    h(
                      'div',
                      { style: { marginTop: '8px' } },
                      h(Label, { text: t('settings.comfyRoot') }),
                      h('input', {
                        className: 'k2-input',
                        value: server !== null && typeof server.comfyRoot === 'string' ? server.comfyRoot : '',
                        spellCheck: false,
                        onChange: function (event) {
                          var value = event.target.value
                          setServer(function (prev) {
                            return Object.assign({}, prev || {}, { comfyRoot: value })
                          })
                          scheduleSave({ comfyRoot: value })
                        },
                      }),
                      h('div', { className: 'k2-hint', style: { marginTop: '5px' } }, t('settings.comfyRoot.hint')),
                    ),
                    h(
                      'div',
                      { style: { marginTop: '10px' } },
                      h(Label, { text: t('field.sampler') }),
                      h(Select, {
                        options: samplers,
                        value: form.sampler,
                        onChange: function (value) {
                          update({ sampler: value })
                        },
                      }),
                    ),
                  )
                : null,
            ),
          ),

          h(
            'div',
            { className: 'k2-stage' },
            h(
              'div',
              { className: 'k2-stage-head' },
              h('span', { className: 'k2-stage-title' }, t('result.title')),
              h(
                'div',
                { className: 'k2-stage-meta' },
                results.length > 0 ? h('span', null, t('result.count', { n: results.length })) : null,
                currentResult !== null && currentResult.images.length > 0
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'k2-iconbtn',
                        title: t('action.copyPath'),
                        onClick: function () {
                          try {
                            if (navigator.clipboard) navigator.clipboard.writeText(currentResult.images[0].path)
                          } catch (failure) {
                            // Clipboard can be blocked; nothing else to do.
                          }
                        },
                      },
                      h(Icon, { name: 'copy', size: 14 }),
                    )
                  : null,
              ),
            ),

            h(
              'div',
              { className: 'k2-stage-body' },
              h(
                'div',
                {
                  className: 'k2-canvas' + (busy === true || currentResult === null ? ' is-empty' : ''),
                },
                busy === true
                  ? h(
                      'div',
                      { className: 'k2-busy' },
                      h('div', { className: 'k2-spinner' }),
                      h('div', { className: 'k2-busy-title' }, t(job.state === 'queued' ? 'state.queued' : 'state.running')),
                      h('div', { className: 'k2-busy-sub' }, formatSeconds(job.elapsedMs) + 's'),
                      h('div', { className: 'k2-busy-bar' }, h('i')),
                      h('div', { className: 'k2-busy-sub' }, form.width + '×' + form.height + ' · ' + form.steps + ' steps'),
                    )
                  : currentResult !== null && currentResult.images.length > 0
                    ? h('img', {
                        src: imageUrl(currentResult.images[0].path),
                        alt: currentResult.prompt,
                        onClick: function () {
                          setZoom({
                            src: imageUrl(currentResult.images[0].path),
                            path: currentResult.images[0].path,
                          })
                        },
                        style: { cursor: 'zoom-in' },
                      })
                    : h(
                        'div',
                        { className: 'k2-empty' },
                        h(Icon, { name: 'image', size: 34 }),
                        h('strong', null, online === false ? t('comfy.offline') : t('empty.title')),
                        h(
                          'span',
                          null,
                          online === false
                            ? t('empty.offline')
                            : (models.unet || []).length === 0
                              ? t('empty.noModels')
                              : t('empty.body'),
                        ),
                      ),
              ),
              currentResult !== null && currentResult.state === 'error' && currentResult.error
                ? h('div', { className: 'k2-alert' }, currentResult.error)
                : null,
              results.length > 0
                ? h(
                    'div',
                    { className: 'k2-strip' },
                    results.map(function (entry, index) {
                      var thumb = entry.images.length > 0 ? entry.images[0].path : ''
                      return h(
                        'button',
                        {
                          key: entry.id,
                          type: 'button',
                          className: 'k2-thumb' + (index === active ? ' is-on' : ''),
                          title: entry.prompt,
                          onClick: function () {
                            setActive(index)
                          },
                        },
                        thumb !== '' ? h('img', { src: imageUrl(thumb), alt: '' }) : null,
                      )
                    }),
                  )
                : null,
              h(
                'div',
                { className: 'k2-foot' },
                currentResult !== null
                  ? h(
                      'span',
                      null,
                      t('result.size', { w: currentResult.width, h: currentResult.height }),
                      ' · ',
                      currentResult.steps + ' steps',
                      ' · ',
                      t('result.seed', { seed: currentResult.seed }),
                      ' · ',
                      formatSeconds(currentResult.elapsedMs) + 's',
                    )
                  : h('span', null, loading === true ? '' : t('app.tagline')),
                savedAt > 0 ? h('span', { className: 'k2-saved' }, t('action.saved')) : null,
              ),
            ),
          ),
        )
      }

      var statusText = t('comfy.unknown')
      var statusClass = 'k2-pill'
      if (loading === true) {
        statusText = t('comfy.checking')
      } else if (online === true) {
        statusText = t('comfy.online')
        statusClass = 'k2-pill is-on'
      } else {
        statusText = t('comfy.offline')
        statusClass = 'k2-pill is-off'
      }

      var vram = comfy !== null && comfy !== undefined ? formatVram(comfy.vramTotal) : ''

      return h(
        'div',
        { className: 'k2-root' },
        h(
          'div',
          { className: 'k2-topbar' },
          h(
            'div',
            { className: 'k2-brand' },
            h('div', { className: 'k2-brand-mark' }, h(Icon, { name: 'spark', size: 16 })),
            h(
              'div',
              { className: 'k2-brand-text' },
              h('span', { className: 'k2-brand-title' }, t('app.title')),
              h(
                'span',
                { className: 'k2-brand-sub' },
                comfy !== null && comfy !== undefined && typeof comfy.deviceName === 'string'
                  ? comfy.deviceName + (vram !== '' ? ' · ' + vram : '')
                  : t('app.tagline'),
              ),
            ),
          ),
          h(
            'div',
            { className: 'k2-head-right' },
            h(
              'span',
              { className: statusClass, title: comfy !== null && comfy !== undefined && comfy.error ? comfy.error : '' },
              h('span', { className: 'k2-dot' }),
              h('span', null, statusText),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'k2-iconbtn' + (loading === true ? ' is-spinning' : ''),
                title: t('comfy.refresh'),
                onClick: function () {
                  refresh(true)
                },
              },
              h(Icon, { name: 'refresh', size: 15 }),
            ),
          ),
        ),
        h('div', { className: 'k2-body' }, body),
        zoom !== null
          ? h(
              'div',
              {
                className: 'k2-zoom',
                onClick: function () {
                  setZoom(null)
                },
              },
              h(
                'button',
                {
                  type: 'button',
                  className: 'k2-zoom-close',
                  onClick: function (event) {
                    event.stopPropagation()
                    setZoom(null)
                  },
                },
                h(Icon, { name: 'close', size: 17 }),
              ),
              h('img', {
                src: zoom.src,
                alt: '',
                onClick: function (event) {
                  event.stopPropagation()
                },
              }),
            )
          : null,
      )
    }

    /* ------------------------------ plugin ------------------------------ */

    function apply(ctx) {
      ctx.effect(function () {
        var style = document.createElement('style')
        style.dataset.plugin = 'dsh-krea2-panel'
        style.textContent = STYLE
        document.head.appendChild(style)
        return function () {
          style.remove()
        }
      })

      var locale = ctx.locale
      if (
        locale !== null &&
        locale !== undefined &&
        typeof locale.register === 'function' &&
        typeof locale.bind === 'function'
      ) {
        ctx.effect(function () {
          var dispose = locale.register('dsh-krea2-panel', DICTS)
          return function () {
            if (typeof dispose === 'function') dispose()
          }
        })
        try {
          var bound = locale.bind('dsh-krea2-panel')
          if (typeof bound === 'function') localeTranslate = bound
        } catch (failure) {
          localeTranslate = null
        }
      }

      function mount(name, registration, component) {
        ctx.effect(function () {
          var dispose = ctx.slots.inject(name, function () {
            return ctx.slots.register(registration, component)
          })
          return function () {
            if (typeof dispose === 'function') dispose()
          }
        })
      }

      mount(
        'sidebar.panellist',
        {
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 25,
          label: function () {
            return t('nav.label')
          },
        },
        KreaIcon,
      )

      mount('main', { name: 'main', key: PANEL_ID }, Panel)
    }

    return {
      name: 'dsh-krea2-panel',
      inject: ['slots', 'locale'],
      apply: apply,
    }
  },
})
