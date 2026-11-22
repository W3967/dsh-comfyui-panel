/**
 * dsh-comfyui-panel — Web Client half.
 *
 * Registers a sidebar entry and the main panel behind it. The panel is a
 * generic ComfyUI front end: pick a workflow preset, fill the form generated
 * from its graph, generate.
 */

window.__ModuleLoader__.load({
  id: 'dsh-comfyui-panel',
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

    var GROUP_ORDER = ['prompt', 'size', 'sampling', 'models', 'other']
    var GROUP_LABEL = {
      prompt: 'group.prompt',
      size: 'group.size',
      sampling: 'group.sampling',
      models: 'group.models',
      other: 'group.other',
    }

    /**
     * Ratio presets for a width/height pair. Values assume a ~1 MP budget
     * (1024² ); presets outside the workflow's declared range are hidden.
     */
    var SIZE_PRESETS = [
      { key: '1:1', label: '1:1 · 1024²', w: 1024, h: 1024 },
      { key: '4:3', label: '4:3 · 1152×864', w: 1152, h: 864 },
      { key: '3:4', label: '3:4 · 864×1152', w: 864, h: 1152 },
      { key: '16:9', label: '16:9 · 1280×720', w: 1280, h: 720 },
      { key: '9:16', label: '9:16 · 720×1280', w: 720, h: 1280 },
      { key: '3:2', label: '3:2 · 1152×768', w: 1152, h: 768 },
      { key: '2:3', label: '2:3 · 768×1152', w: 768, h: 1152 },
    ]

    /* ------------------------------- i18n ------------------------------- */

    var DICTS = {
      zh: {
        'nav.label': 'Krea 2',
        'app.title': 'ComfyUI 工作台',
        'app.tagline': '本地 ComfyUI',

        'comfy.online': '已连接',
        'comfy.offline': '未连接',
        'comfy.checking': '检测中',
        'comfy.refresh': '刷新状态',

        'workflow.label': '工作流',
        'workflow.import': '导入',
        'workflow.delete': '删除',
        'workflow.builtin': '内置',

        'params.none': '这个工作流没有可调参数。',
        'params.offline': '连不上 ComfyUI，读不到节点定义，无法生成表单。',
        'params.reset': '恢复默认',

        'group.prompt': '提示词',
        'group.size': '尺寸',
        'group.sampling': '采样',
        'group.models': '模型',
        'group.other': '其他',

        'action.generate': '生成',
        'action.generating': '生成中',
        'action.cancel': '取消',
        'action.random': '随机',
        'action.useLatest': '用最近结果',
        'action.copyPath': '复制路径',
        'action.close': '关闭',
        'action.saved': '已保存',
        'action.recover': '恢复参数',
        'action.reveal': '打开文件夹',
        'action.delete': '删除',
        'action.startComfy': '启动 ComfyUI',
        'action.starting': '正在启动…',

        'state.queued': '排队中',
        'state.running': '生成中',
        'state.done': '已完成',
        'state.error': '失败',
        'state.canceled': '已取消',

        'empty.title': '还没有图',
        'empty.body': '调好参数，点「生成」。',
        'empty.offline': 'ComfyUI 没连上，先启动它，再点右上角刷新。',

        'settings.title': '设置',
        'settings.comfyUrl': 'ComfyUI 地址',
        'settings.comfyRoot': 'ComfyUI 目录',
        'settings.comfyRoot.hint': '指向含 models / input / output 的目录，用于读取生成的图和复制输入图片。',

        'import.title': '导入工作流',
        'import.name': '名称',
        'import.json': 'API 格式 JSON',
        'import.hint': '在 ComfyUI 里用「Save (API Format)」导出，把整个 JSON 内容粘进来。',
        'import.submit': '导入',
        'import.cancel': '取消',
        'import.invalid': 'JSON 解析失败，请检查是否完整。',
        'import.defaultName': '导入的工作流',

        'queue.title': '队列',
        'queue.running': '运行中',
        'queue.pending': '等待中',
        'queue.empty': '队列是空的。',
        'queue.clear': '清空等待',
        'queue.remove': '移除',
        'queue.unknown': '未知任务',
        'queue.unreachable': '连不上 ComfyUI，读不到队列。',

        'history.title': '历史图片',
        'history.empty': 'output 目录里还没有图片。',
        'history.count': '找到 {n} 张',

        'preset.label': '参数预设',
        'preset.save': '存为预设',
        'preset.delete': '删除',
        'preset.name': '预设名称',
        'preset.namePh': '例如：宽屏风景',
        'preset.empty': '还没有预设',
        'preset.none': '未选择',

        'result.title': '结果',
        'result.count': '本次会话 {n} 张',
        'result.seed': '种子 {seed}',
        'result.time': '{s}s',
        'hint.enter': 'Ctrl + Enter 生成',
      },
      en: {
        'nav.label': 'Krea 2',
        'app.title': 'ComfyUI Studio',
        'app.tagline': 'Local ComfyUI',

        'comfy.online': 'Connected',
        'comfy.offline': 'Offline',
        'comfy.checking': 'Checking',
        'comfy.refresh': 'Refresh status',

        'workflow.label': 'Workflow',
        'workflow.import': 'Import',
        'workflow.delete': 'Delete',
        'workflow.builtin': 'built-in',

        'params.none': 'This workflow exposes no adjustable parameters.',
        'params.offline': 'ComfyUI is unreachable, so the node definitions cannot be read and no form can be built.',
        'params.reset': 'Reset to defaults',

        'group.prompt': 'Prompt',
        'group.size': 'Size',
        'group.sampling': 'Sampling',
        'group.models': 'Models',
        'group.other': 'Other',

        'action.generate': 'Generate',
        'action.generating': 'Generating',
        'action.cancel': 'Cancel',
        'action.random': 'Random',
        'action.useLatest': 'Use latest',
        'action.copyPath': 'Copy path',
        'action.close': 'Close',
        'action.saved': 'Saved',
        'action.recover': 'Restore parameters',
        'action.reveal': 'Show in folder',
        'action.delete': 'Delete',
        'action.startComfy': 'Start ComfyUI',
        'action.starting': 'Starting…',

        'state.queued': 'Queued',
        'state.running': 'Generating',
        'state.done': 'Done',
        'state.error': 'Failed',
        'state.canceled': 'Canceled',

        'empty.title': 'No images yet',
        'empty.body': 'Set your parameters and press Generate.',
        'empty.offline': 'ComfyUI is not reachable. Start it, then refresh.',

        'settings.title': 'Settings',
        'settings.comfyUrl': 'ComfyUI URL',
        'settings.comfyRoot': 'ComfyUI directory',
        'settings.comfyRoot.hint': 'The folder holding models / input / output.',

        'import.title': 'Import workflow',
        'import.name': 'Name',
        'import.json': 'API-format JSON',
        'import.hint': 'Export with "Save (API Format)" in ComfyUI, then paste the whole JSON here.',
        'import.submit': 'Import',
        'import.cancel': 'Cancel',
        'import.invalid': 'Could not parse that JSON.',
        'import.defaultName': 'Imported workflow',

        'queue.title': 'Queue',
        'queue.running': 'Running',
        'queue.pending': 'Pending',
        'queue.empty': 'The queue is empty.',
        'queue.clear': 'Clear pending',
        'queue.remove': 'Remove',
        'queue.unknown': 'Unknown job',
        'queue.unreachable': 'ComfyUI is unreachable, so the queue cannot be read.',

        'history.title': 'History',
        'history.empty': 'No images in the output folder yet.',
        'history.count': '{n} found',

        'preset.label': 'Preset',
        'preset.save': 'Save as preset',
        'preset.delete': 'Delete',
        'preset.name': 'Preset name',
        'preset.namePh': 'e.g. wide landscape',
        'preset.empty': 'No presets yet',
        'preset.none': 'None',

        'result.title': 'Result',
        'result.count': '{n} this session',
        'result.seed': 'seed {seed}',
        'result.time': '{s}s',
        'hint.enter': 'Ctrl + Enter to generate',
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

    /** Prefer the localized field, fall back to the other one. */
    function pick(zh, en) {
      if (LANG === 'zh') return typeof zh === 'string' && zh !== '' ? zh : en
      return typeof en === 'string' && en !== '' ? en : zh
    }

    /* ------------------------------- HTTP ------------------------------- */

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

    function getJson(url) {
      return fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } }).then(readEnvelope)
    }

    function postJson(url, payload) {
      return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload === undefined ? {} : payload),
      }).then(readEnvelope)
    }

    function sendJson(method, url, payload) {
      return fetch(url, {
        method: method,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      }).then(readEnvelope)
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
.k2-row{display:flex;align-items:center;gap:8px}
.k2-grow{flex:1 1 auto;min-width:0}

.k2-hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8a93);line-height:1.5}
.k2-label{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#a1a1aa);min-height:18px}
.k2-label .k2-grow{flex:1 1 auto}
.k2-input,.k2-select,.k2-textarea{width:100%;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.035));color:var(--dsw-alias-label-primary,#f4f4f5);font:inherit;font-size:13px;padding:0 10px;height:32px;outline:none;min-width:0}
.k2-input::placeholder,.k2-textarea::placeholder{color:var(--dsw-alias-label-tertiary,#8a8a93)}
.k2-input:focus,.k2-select:focus,.k2-textarea:focus{border-color:var(--dsw-alias-state-business-primary,#4176E6);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176E6) 16%,transparent)}
.k2-select{appearance:none;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 15px) 14px,calc(100% - 10px) 14px;background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:28px;cursor:pointer}
.k2-select option{background:var(--dsw-alias-bg-layer-1,#1a1a1e);color:var(--dsw-alias-label-primary,#f4f4f5)}
.k2-textarea{height:auto;min-height:80px;padding:9px 10px;line-height:1.55;resize:vertical;font-size:13px}
.k2-num{text-align:center;font-variant-numeric:tabular-nums}
.k2-input:disabled,.k2-select:disabled,.k2-textarea:disabled{opacity:.55;cursor:not-allowed}

.k2-slider{display:flex;align-items:center;gap:8px}
.k2-slider input[type=range]{flex:1 1 auto;height:16px;appearance:none;background:transparent;cursor:pointer;min-width:0}
.k2-slider input[type=range]::-webkit-slider-runnable-track{height:3px;border-radius:2px;background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.12))}
.k2-slider input[type=range]::-moz-range-track{height:3px;border-radius:2px;background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.12))}
.k2-slider input[type=range]::-webkit-slider-thumb{appearance:none;width:11px;height:11px;margin-top:-4px;border-radius:50%;background:var(--dsw-alias-label-primary,#f4f4f5);box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1,#15151a)}
.k2-slider input[type=range]::-moz-range-thumb{width:11px;height:11px;border:0;border-radius:50%;background:var(--dsw-alias-label-primary,#f4f4f5)}
.k2-slider-val{width:44px;flex:none;text-align:right;font-size:12px;color:var(--dsw-alias-label-secondary,#a1a1aa);font-variant-numeric:tabular-nums}

.k2-btn{height:32px;padding:0 14px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.05));color:var(--dsw-alias-label-primary,#f4f4f5);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.k2-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.k2-btn:disabled{opacity:.5;cursor:not-allowed}
.k2-btn.is-primary{width:100%;height:38px;font-size:13.5px;font-weight:600;border-color:transparent;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,#4176E6));color:var(--dsw-alias-label-primary-foreground,#fff)}
.k2-btn.is-primary:hover{background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-state-business-primary,#4176E6));filter:brightness(1.05)}
.k2-btn.is-danger{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 40%,transparent);color:var(--dsw-alias-state-error-primary,#e5484d);background:transparent}
.k2-btn.is-small{height:26px;padding:0 9px;font-size:12px}
.k2-btn.is-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa)}
.k2-btn.is-ghost:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07));color:var(--dsw-alias-label-primary,#f4f4f5)}

.k2-chips{display:flex;flex-wrap:wrap;gap:6px}
.k2-chip{height:24px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa);font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}
.k2-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07));color:var(--dsw-alias-label-primary,#f4f4f5)}
.k2-chip.is-on{background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.1));color:var(--dsw-alias-label-primary,#f4f4f5);border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.16))}

.k2-qlist{display:flex;flex-direction:column;gap:4px;max-height:50vh;overflow-y:auto}
.k2-qrow{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.04));font-size:12.5px}
.k2-qname{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.k2-qtag{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a93);padding:1px 6px;border-radius:6px;background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.08))}
.k2-qmeta{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a93);font-variant-numeric:tabular-nums}
.k2-dialog-count{font-size:11.5px;font-weight:400;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.k2-history-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;max-height:56vh;overflow-y:auto}
.k2-history-item{position:relative;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#18181d);aspect-ratio:1}
.k2-history-pic{display:block;width:100%;height:100%;padding:0;border:0;background:transparent;cursor:pointer}
.k2-history-pic img{width:100%;height:100%;object-fit:cover;display:block}
.k2-history-item:hover{border-color:var(--dsw-alias-state-business-primary,#4176E6)}
.k2-history-acts{position:absolute;right:3px;bottom:3px;display:flex;gap:2px;opacity:0;transition:opacity .12s}
.k2-history-item:hover .k2-history-acts,.k2-history-acts:focus-within{opacity:1}
.k2-history-acts .k2-iconbtn{width:24px;height:24px;background:rgba(8,8,10,.72);color:#fff}
.k2-history-acts .k2-iconbtn:hover{background:rgba(8,8,10,.9)}
.k2-zoom-actions{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);display:flex;gap:8px;padding:6px;border-radius:10px;background:rgba(8,8,10,.7);backdrop-filter:blur(4px)}

.k2-alert{display:flex;gap:8px;padding:9px 11px;border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 10%,transparent);color:var(--dsw-alias-state-error-primary,#e5484d);font-size:12px;line-height:1.5}

.k2-stage-head{display:flex;align-items:center;gap:10px;flex:none;min-height:24px}
.k2-stage-title{font-size:13px;font-weight:620;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.k2-stage-meta{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8a93)}
.k2-stage-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:10px}
.k2-canvas{position:relative;flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));background:var(--dsw-alias-bg-layer-1,#15151a);overflow:hidden}
.k2-canvas img{max-width:100%;max-height:100%;display:block;object-fit:contain;cursor:zoom-in}
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

.k2-foot{display:flex;align-items:center;gap:8px;flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a93);min-height:16px}
.k2-saved{color:var(--dsw-alias-state-success-primary,#3fb950)}

.k2-modal{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:32px;background:rgba(8,8,10,.72);backdrop-filter:blur(4px)}
.k2-dialog{width:min(560px,100%);max-height:100%;display:flex;flex-direction:column;gap:12px;padding:18px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:var(--dsw-alias-bg-layer-1,#1a1a1e);box-shadow:0 24px 80px rgba(0,0,0,.5)}
.k2-dialog-title{font-size:14px;font-weight:650}
.k2-dialog textarea{min-height:180px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.k2-dialog-actions{display:flex;justify-content:flex-end;gap:8px}

.k2-zoom{position:fixed;inset:0;z-index:210;display:flex;align-items:center;justify-content:center;padding:32px;background:rgba(8,8,10,.82);backdrop-filter:blur(6px)}
.k2-zoom img{max-width:100%;max-height:100%;display:block;border-radius:10px;box-shadow:0 24px 80px rgba(0,0,0,.6)}
.k2-zoom-close{position:absolute;top:18px;right:18px;width:34px;height:34px;display:grid;place-items:center;border:0;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;cursor:pointer}
.k2-zoom-close:hover{background:rgba(255,255,255,.22)}

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
      close: 'M6.5 6.5l11 11 M17.5 6.5l-11 11',
      bolt: 'M13.5 2.5 5.5 13.5h5l-1 8 8-11h-5l1-8Z',
      plus: 'M12 5v14 M5 12h14',
      trash: 'M4 7h16 M9 7V5h6v2 M6 7l1 13h10l1-13',
      list: 'M4 6h16 M4 12h16 M4 18h10',
      clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7.5V12l3.2 2',
      check: 'M5 12.5l4.5 4.5L19 7',
      folder: 'M3.5 6.5h6l2 2.5h9v10h-17z',
      power: 'M12 4v8 M7.1 7.2a7 7 0 1 0 9.8 0',
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
          style: { display: 'block', opacity: active ? 1 : 0.82 },
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
          ? h('div', { className: 'k2-sec-head' }, h('span', { className: 'k2-sec-title' }, props.title))
          : null,
        props.children,
      )
    }

    function Label(props) {
      return h('div', { className: 'k2-label' }, h('span', null, props.text), props.children)
    }

    function Select(props) {
      var options = Array.isArray(props.options) ? props.options : []
      var known = options.indexOf(props.value) >= 0
      return h(
        'select',
        {
          className: 'k2-select',
          value: known ? props.value : options.length > 0 ? options[0] : '',
          disabled: props.disabled === true || options.length === 0,
          title: props.title,
          onChange: function (event) {
            if (props.onChange) props.onChange(event.target.value)
          },
        },
        options.length === 0 ? h('option', { value: '' }, '—') : null,
        options.map(function (value) {
          return h('option', { key: value, value: value }, props.render ? props.render(value) : value)
        }),
      )
    }

    /**
     * Number input that keeps the raw text while focused, so clearing the field
     * does not snap the caret to the clamped value mid-edit.
     */
    function NumberField(props) {
      var pair = useState(String(props.value === undefined || props.value === null ? '' : props.value))
      var text = pair[0]
      var setText = pair[1]
      var focused = useRef(false)

      useEffect(
        function () {
          if (!focused.current) {
            setText(String(props.value === undefined || props.value === null ? '' : props.value))
          }
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
          if (text === '') {
            setText(String(props.value))
            return
          }
          var parsed = Number(text)
          if (!Number.isFinite(parsed)) {
            setText(String(props.value))
            return
          }
          var lower = props.min === undefined ? -Infinity : props.min
          var upper = props.max === undefined ? Infinity : props.max
          var clamped = Math.min(upper, Math.max(lower, parsed))
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

    function formatSeconds(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '0.0'
      return (ms / 1000).toFixed(ms < 10000 ? 1 : 0)
    }

    function Panel() {
      var statusPair = useState(null)
      var status = statusPair[0]
      var setStatus = statusPair[1]

      var loadingPair = useState(true)
      var loading = loadingPair[0]
      var setLoading = loadingPair[1]

      var bootErrorPair = useState('')
      var bootError = bootErrorPair[0]
      var setBootError = bootErrorPair[1]

      var workflowIdPair = useState(null)
      var workflowId = workflowIdPair[0]
      var setWorkflowId = workflowIdPair[1]

      var workflowPair = useState(null)
      var workflow = workflowPair[0]
      var setWorkflow = workflowPair[1]

      var valuesPair = useState({})
      var values = valuesPair[0]
      var setValues = valuesPair[1]

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

      var savedPair = useState(0)
      var savedAt = savedPair[0]
      var setSavedAt = savedPair[1]

      var zoomPair = useState(null)
      var zoom = zoomPair[0]
      var setZoom = zoomPair[1]

      var settingsOpenPair = useState(false)
      var settingsOpen = settingsOpenPair[0]
      var setSettingsOpen = settingsOpenPair[1]

      var importOpenPair = useState(false)
      var importOpen = importOpenPair[0]
      var setImportOpen = importOpenPair[1]

      var startingPair = useState(false)
      var starting = startingPair[0]
      var setStarting = startingPair[1]

      var queueOpenPair = useState(false)
      var queueOpen = queueOpenPair[0]
      var setQueueOpen = queueOpenPair[1]

      var queuePair = useState({ running: [], pending: [], error: '' })
      var queue = queuePair[0]
      var setQueue = queuePair[1]

      var historyOpenPair = useState(false)
      var historyOpen = historyOpenPair[0]
      var setHistoryOpen = historyOpenPair[1]

      var historyPair = useState({ items: [], error: '' })
      var history = historyPair[0]
      var setHistory = historyPair[1]

      var valuePresetsPair = useState([])
      var valuePresets = valuePresetsPair[0]
      var setValuePresets = valuePresetsPair[1]

      var presetPickPair = useState('')
      var presetPick = presetPickPair[0]
      var setPresetPick = presetPickPair[1]

      var presetDialogPair = useState(false)
      var presetDialogOpen = presetDialogPair[0]
      var setPresetDialogOpen = presetDialogPair[1]

      var saveTimer = useRef(null)
      var pendingValues = useRef(null)
      /** Values from a recovered PNG, applied once the target workflow loads. */
      var recoverRef = useRef(null)

      var scheduleSave = useCallback(function (next) {
        pendingValues.current = next
        if (saveTimer.current !== null) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(function () {
          saveTimer.current = null
          var id = workflowId
          if (id === null || pendingValues.current === null) return
          var patch = { values: {} }
          patch.values[id] = pendingValues.current
          postJson(API + 'settings', patch)
            .then(function () {
              setSavedAt(Date.now())
            })
            .catch(function () {
              // Persisting is a convenience, never a reason to block the UI.
            })
        }, 500)
      }, [workflowId])

      useEffect(function () {
        return function () {
          if (saveTimer.current !== null) clearTimeout(saveTimer.current)
        }
      }, [])

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
            setStatus(res)
            setBootError('')
            setWorkflowId(function (prev) {
              return prev === null ? res.settings.activeWorkflow : prev
            })
          })
          .catch(function (failure) {
            setBootError(failure.message || String(failure))
            setStatus(null)
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

      // Load the selected workflow's discovered parameters.
      useEffect(
        function () {
          if (workflowId === null) return undefined
          var alive = true
          setWorkflow(null)
          setError('')
          getJson(API + 'workflow?id=' + encodeURIComponent(workflowId))
            .then(function (res) {
              if (!alive) return
              setWorkflow(res.workflow)
              var base = res.workflow.values === undefined ? {} : res.workflow.values
              var recovered = recoverRef.current
              recoverRef.current = null
              setValues(recovered === null ? base : Object.assign({}, base, recovered))
              if (res.workflow.error) setError(res.workflow.error)
            })
            .catch(function (failure) {
              if (alive) setError(failure.message)
            })
          return function () {
            alive = false
          }
        },
        [workflowId],
      )

      // Queue polling while its overlay is open.
      useEffect(
        function () {
          if (queueOpen !== true) return undefined
          var alive = true
          function load() {
            getJson(API + 'queue')
              .then(function (res) {
                if (alive) setQueue({ running: res.running, pending: res.pending, error: '' })
              })
              .catch(function (failure) {
                if (alive) setQueue({ running: [], pending: [], error: failure.message })
              })
          }
          load()
          var timer = setInterval(load, 2000)
          return function () {
            alive = false
            clearInterval(timer)
          }
        },
        [queueOpen],
      )

      // History is a snapshot per open, not a live feed.
      useEffect(
        function () {
          if (historyOpen !== true) return undefined
          var alive = true
          getJson(API + 'history?limit=60')
            .then(function (res) {
              if (alive) setHistory({ items: res.items, error: '' })
            })
            .catch(function (failure) {
              if (alive) setHistory({ items: [], error: failure.message })
            })
          return function () {
            alive = false
          }
        },
        [historyOpen],
      )

      // Value presets belong to the selected workflow.
      useEffect(
        function () {
          if (workflowId === null) return undefined
          var alive = true
          setPresetPick('')
          getJson(API + 'presets?workflow=' + encodeURIComponent(workflowId))
            .then(function (res) {
              if (alive) setValuePresets(res.presets)
            })
            .catch(function () {
              if (alive) setValuePresets([])
            })
          return function () {
            alive = false
          }
        },
        [workflowId],
      )

      var updateValue = useCallback(
        function (id, value) {
          setValues(function (prev) {
            var next = Object.assign({}, prev)
            next[id] = value
            scheduleSave(next)
            return next
          })
        },
        [scheduleSave],
      )

      function reloadValuePresets() {
        if (workflowId === null) return
        getJson(API + 'presets?workflow=' + encodeURIComponent(workflowId))
          .then(function (res) {
            setValuePresets(res.presets)
          })
          .catch(function () {
            // Presets are a convenience; a failed reload leaves the old list.
          })
      }

      function applyValuePreset(preset) {
        setValues(function (previous) {
          var next = Object.assign({}, previous, preset.values)
          scheduleSave(next)
          return next
        })
      }

      function saveValuePreset(name) {
        return postJson(API + 'presets', { workflowId: workflowId, name: name, values: values }).then(function () {
          setPresetDialogOpen(false)
          reloadValuePresets()
        })
      }

      function removeValuePreset(id) {
        sendJson('DELETE', API + 'presets?id=' + encodeURIComponent(id))
          .then(function () {
            setPresetPick('')
            reloadValuePresets()
          })
          .catch(function (failure) {
            setError(failure.message)
          })
      }

      /** Ask the Host to launch a local ComfyUI, then re-read the status. */
      function startComfy() {
        if (starting === true) return
        setStarting(true)
        setError('')
        postJson(API + 'start', {})
          .then(function (res) {
            if (res.online !== true) {
              setError('ComfyUI 已经拉起来了，但还没就绪。等几秒再点刷新。')
            }
            refresh(true)
          })
          .catch(function (failure) {
            setError(failure.message)
          })
          .finally(function () {
            setStarting(false)
          })
      }

      function clearQueue() {
        postJson(API + 'queue', { action: 'clear' }).catch(function (failure) {
          setError(failure.message)
        })
      }

      function removeFromQueue(promptId) {
        postJson(API + 'queue', { action: 'delete', ids: [promptId] }).catch(function (failure) {
          setError(failure.message)
        })
      }

      function revealFile(path) {
        postJson(API + 'reveal', { path: path }).catch(function (failure) {
          setError(failure.message)
        })
      }

      function deleteImage(path) {
        sendJson('DELETE', API + 'image?path=' + encodeURIComponent(path))
          .then(function () {
            setHistory(function (previous) {
              return {
                items: previous.items.filter(function (item) {
                  return item.path !== path
                }),
                error: '',
              }
            })
            if (zoom !== null && zoom.path === path) setZoom(null)
          })
          .catch(function (failure) {
            setError(failure.message)
          })
      }

      /** Read the graph a PNG carries and put its values back into the form. */
      function recoverFrom(path) {
        getJson(API + 'recover?path=' + encodeURIComponent(path))
          .then(function (res) {
            if (res.workflowId === workflowId) {
              setValues(function (previous) {
                return Object.assign({}, previous, res.values)
              })
            } else {
              // Switching workflows reloads the form, so stash the values and let
              // the load effect merge them.
              recoverRef.current = res.values
              setWorkflowId(res.workflowId)
            }
            setZoom(null)
            setHistoryOpen(false)
          })
          .catch(function (failure) {
            setError(failure.message)
          })
      }

      var switchWorkflow = useCallback(
        function (id) {
          setWorkflowId(id)
          postJson(API + 'settings', { activeWorkflow: id }).catch(function () {
            // Non-fatal: the selection still works for this session.
          })
        },
        [],
      )

      var online = status !== null && status.comfy !== undefined && status.comfy.online === true
      var busy = job !== null && (job.state === 'queued' || job.state === 'running')

      var generate = useCallback(
        function () {
          if (busy === true || workflowId === null) return
          if (workflow === null || workflow.params.length === 0) {
            setError(t('params.none'))
            return
          }
          setError('')
          postJson(API + 'generate', { workflowId: workflowId, values: values })
            .then(function (res) {
              setJob(res.job)
            })
            .catch(function (failure) {
              setError(failure.message)
            })
        },
        [busy, workflowId, workflow, values],
      )

      var cancel = useCallback(
        function () {
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
        },
        [job],
      )

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
      var latestPath = results.length > 0 && results[0].images.length > 0 ? results[0].images[0].path : ''
      var presets = status !== null && Array.isArray(status.workflows) ? status.workflows : []
      var currentPreset = null
      for (var i = 0; i < presets.length; i += 1) {
        if (presets[i].id === workflowId) currentPreset = presets[i]
      }

      /** Localized preset name by id. */
      function presetName(id) {
        for (var index = 0; index < presets.length; index += 1) {
          if (presets[index].id === id) return pick(presets[index].name, presets[index].nameEn)
        }
        return id
      }

      function importWorkflow(name, json) {
        var template
        try {
          template = JSON.parse(json)
        } catch (failure) {
          throw new Error(t('import.invalid'))
        }
        if (template === null || typeof template !== 'object' || Array.isArray(template)) {
          throw new Error(t('import.invalid'))
        }
        return postJson(API + 'workflow', { name: name, template: template }).then(function (res) {
          setImportOpen(false)
          return getJson(API + 'status').then(function (next) {
            setStatus(next)
            if (res.workflow && res.workflow.id) setWorkflowId(res.workflow.id)
          })
        })
      }

      function removeWorkflow(id) {
        sendJson('DELETE', API + 'workflow?id=' + encodeURIComponent(id))
          .then(function () {
            return getJson(API + 'status')
          })
          .then(function (next) {
            setStatus(next)
            switchWorkflow(next.settings.activeWorkflow === id ? 'krea2-txt2img' : next.settings.activeWorkflow)
          })
          .catch(function (failure) {
            setError(failure.message)
          })
      }

      /* -------- one control per discovered parameter -------- */

      function renderControl(param) {
        var label = pick(param.label, param.labelEn)
        var value = values[param.id]

        if (param.control === 'textarea') {
          return h('textarea', {
            className: 'k2-textarea',
            value: value === undefined || value === null ? '' : String(value),
            spellCheck: false,
            onChange: function (event) {
              updateValue(param.id, event.target.value)
            },
            onKeyDown: function (event) {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                generate()
              }
            },
          })
        }

        if (param.control === 'select') {
          var choices = Array.isArray(param.choices) ? param.choices : []
          return h(Select, {
            options: choices,
            value: value === undefined ? '' : String(value),
            onChange: function (next) {
              updateValue(param.id, next)
            },
          })
        }

        if (param.control === 'slider') {
          var lower = Number.isFinite(param.min) ? param.min : 0
          var upper = Number.isFinite(param.max) ? param.max : 1
          var numeric = Number(value)
          if (!Number.isFinite(numeric)) numeric = lower
          return h(
            'div',
            { className: 'k2-slider' },
            h('input', {
              type: 'range',
              min: lower,
              max: upper,
              step: Number.isFinite(param.step) ? param.step : 0.01,
              value: numeric,
              onChange: function (event) {
                updateValue(param.id, Number(event.target.value))
              },
            }),
            h('span', { className: 'k2-slider-val' }, String(Math.round(numeric * 100) / 100)),
          )
        }

        if (param.control === 'seed') {
          return h(
            'div',
            { className: 'k2-row' },
            h('input', {
              className: 'k2-input k2-grow',
              value: value === undefined || value === null ? '' : String(value),
              inputMode: 'numeric',
              placeholder: '0',
              onChange: function (event) {
                var raw = event.target.value.replace(/[^0-9]/g, '')
                updateValue(param.id, raw === '' ? '' : Number(raw))
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'k2-btn is-small',
                onClick: function () {
                  updateValue(param.id, Math.floor(Math.random() * 1e9))
                },
              },
              t('action.random'),
            ),
          )
        }

        if (param.control === 'image') {
          return h(
            'div',
            { className: 'k2-row' },
            h('input', {
              className: 'k2-input k2-grow',
              value: value === undefined || value === null ? '' : String(value),
              spellCheck: false,
              onChange: function (event) {
                updateValue(param.id, event.target.value)
              },
            }),
            latestPath !== ''
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'k2-btn is-small',
                    onClick: function () {
                      updateValue(param.id, latestPath)
                    },
                  },
                  t('action.useLatest'),
                )
              : null,
          )
        }

        if (param.control === 'toggle') {
          return h('input', {
            type: 'checkbox',
            checked: value === true,
            onChange: function (event) {
              updateValue(param.id, event.target.checked)
            },
          })
        }

        if (param.control === 'number') {
          return h(NumberField, {
            value: typeof value === 'number' ? value : Number(value) || 0,
            min: param.min,
            max: param.max,
            step: param.step,
            label: label,
            onChange: function (next) {
              updateValue(param.id, next)
            },
          })
        }

        return h('input', {
          className: 'k2-input',
          value: value === undefined || value === null ? '' : String(value),
          spellCheck: false,
          onChange: function (event) {
            updateValue(param.id, event.target.value)
          },
        })
      }

      /* -------- ratio presets for a width/height pair -------- */

      function renderSizePresets(sizeParams) {
        var widthParam = null
        var heightParam = null
        for (var index = 0; index < sizeParams.length; index += 1) {
          if (sizeParams[index].field === 'width') widthParam = sizeParams[index]
          if (sizeParams[index].field === 'height') heightParam = sizeParams[index]
        }
        if (widthParam === null || heightParam === null) return null

        function within(value, param) {
          if (Number.isFinite(param.min) && value < param.min) return false
          if (Number.isFinite(param.max) && value > param.max) return false
          return true
        }

        var usable = SIZE_PRESETS.filter(function (preset) {
          return within(preset.w, widthParam) && within(preset.h, heightParam)
        })
        if (usable.length === 0) return null

        var currentWidth = Number(values[widthParam.id])
        var currentHeight = Number(values[heightParam.id])

        return h(
          'div',
          { className: 'k2-chips' },
          usable.map(function (preset) {
            var active = currentWidth === preset.w && currentHeight === preset.h
            return h(
              'button',
              {
                key: preset.key,
                type: 'button',
                className: 'k2-chip' + (active ? ' is-on' : ''),
                onClick: function () {
                  setValues(function (previous) {
                    var next = Object.assign({}, previous)
                    next[widthParam.id] = preset.w
                    next[heightParam.id] = preset.h
                    scheduleSave(next)
                    return next
                  })
                },
              },
              preset.label,
            )
          }),
        )
      }

      /* -------- grouped parameter form -------- */

      function renderParams() {
        if (workflow === null) {
          return h(
            'div',
            { className: 'k2-empty' },
            h('div', { className: 'k2-spinner' }),
            h('span', null, t('comfy.checking')),
          )
        }
        if (workflow.params.length === 0) {
          return h(
            'div',
            { className: 'k2-empty' },
            h('strong', null, t('params.none')),
            h('span', null, workflow.error ? t('params.offline') : ''),
          )
        }

        var grouped = {}
        for (var index = 0; index < workflow.params.length; index += 1) {
          var param = workflow.params[index]
          var bucket = grouped[param.group]
          if (bucket === undefined) {
            bucket = []
            grouped[param.group] = bucket
          }
          bucket.push(param)
        }

        return GROUP_ORDER.filter(function (group) {
          return grouped[group] !== undefined
        }).map(function (group) {
          var children = []

          // A size group that carries a width/height pair gets ratio presets.
          if (group === 'size') {
            var presets = renderSizePresets(grouped[group])
            if (presets !== null) children.push(presets)
          }

          grouped[group].forEach(function (param) {
            children.push(
              h(
                'div',
                { key: param.id, style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                param.control === 'toggle'
                  ? h(
                      'label',
                      { className: 'k2-label', style: { cursor: 'pointer' } },
                      renderControl(param),
                      h('span', null, pick(param.label, param.labelEn)),
                    )
                  : h(
                      React.Fragment,
                      null,
                      h(Label, { text: pick(param.label, param.labelEn) }),
                      renderControl(param),
                    ),
              ),
            )
          })

          return h(Section, { key: group, title: t(GROUP_LABEL[group]) }, children)
        })
      }

      var body = null
      if (loading === true && status === null) {
        body = h('div', { className: 'k2-empty', style: { flex: '1 1 auto' } }, h('span', null, t('comfy.checking')))
      } else {
        body = h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'k2-side' },
            bootError !== '' ? h('div', { className: 'k2-alert', style: { marginBottom: '12px' } }, bootError) : null,

            h(
              'div',
              { className: 'k2-sec' },
              h(
                'div',
                { className: 'k2-label' },
                h('span', null, t('workflow.label')),
                h('span', { className: 'k2-grow' }),
                currentPreset !== null && currentPreset.builtin === false
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'k2-iconbtn',
                        title: t('workflow.delete'),
                        onClick: function () {
                          removeWorkflow(workflowId)
                        },
                      },
                      h(Icon, { name: 'trash', size: 14 }),
                    )
                  : null,
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'k2-iconbtn',
                    title: t('workflow.import'),
                    onClick: function () {
                      setImportOpen(true)
                    },
                  },
                  h(Icon, { name: 'plus', size: 14 }),
                ),
              ),
              h(Select, {
                options: presets.map(function (preset) {
                  return preset.id
                }),
                value: workflowId === null ? '' : workflowId,
                render: presetName,
                onChange: switchWorkflow,
              }),
              workflow !== null && workflow.description !== ''
                ? h('div', { className: 'k2-hint' }, pick(workflow.description, workflow.descriptionEn))
                : null,
            ),

            h(
              'div',
              { className: 'k2-sec' },
              h(
                'div',
                { className: 'k2-label' },
                h('span', null, t('preset.label')),
                h('span', { className: 'k2-grow' }),
                presetPick !== ''
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'k2-iconbtn',
                        title: t('preset.delete'),
                        onClick: function () {
                          removeValuePreset(presetPick)
                        },
                      },
                      h(Icon, { name: 'trash', size: 14 }),
                    )
                  : null,
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'k2-iconbtn',
                    title: t('preset.save'),
                    disabled: workflow === null,
                    onClick: function () {
                      setPresetDialogOpen(true)
                    },
                  },
                  h(Icon, { name: 'plus', size: 14 }),
                ),
              ),
              valuePresets.length === 0
                ? h('div', { className: 'k2-hint' }, t('preset.empty'))
                : h(Select, {
                    options: [''].concat(
                      valuePresets.map(function (preset) {
                        return preset.id
                      }),
                    ),
                    value: presetPick,
                    render: function (id) {
                      if (id === '') return t('preset.none')
                      for (var index = 0; index < valuePresets.length; index += 1) {
                        if (valuePresets[index].id === id) return valuePresets[index].name
                      }
                      return id
                    },
                    onChange: function (id) {
                      setPresetPick(id)
                      for (var index = 0; index < valuePresets.length; index += 1) {
                        if (valuePresets[index].id === id) {
                          applyValuePreset(valuePresets[index])
                          return
                        }
                      }
                    },
                  }),
            ),

            renderParams(),

            error !== '' ? h('div', { className: 'k2-alert', style: { marginTop: '10px' } }, error) : null,

            h(
              'div',
              { className: 'k2-sec', style: { marginTop: '14px' } },
              h(
                'button',
                {
                  type: 'button',
                  className: 'k2-btn is-primary',
                  disabled: busy === true || online === false,
                  onClick: generate,
                },
                busy === true ? null : h(Icon, { name: 'bolt', size: 15 }),
                h('span', null, busy === true ? t('action.generating') + '…' : t('action.generate')),
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
                    setSettingsOpen(settingsOpen !== true)
                  },
                },
                h(Icon, { name: 'gear', size: 14 }),
                h('span', null, t('settings.title')),
              ),
              settingsOpen === true && status !== null
                ? h(
                    React.Fragment,
                    null,
                    h(
                      'div',
                      { style: { marginTop: '6px' } },
                      h(Label, { text: t('settings.comfyUrl') }),
                      h('input', {
                        className: 'k2-input',
                        value: status.settings.comfyUrl,
                        spellCheck: false,
                        onChange: function (event) {
                          var value = event.target.value
                          setStatus(function (prev) {
                            var next = Object.assign({}, prev)
                            next.settings = Object.assign({}, next.settings, { comfyUrl: value })
                            return next
                          })
                          postJson(API + 'settings', { comfyUrl: value }).catch(function () {})
                        },
                      }),
                    ),
                    h(
                      'div',
                      { style: { marginTop: '8px' } },
                      h(Label, { text: t('settings.comfyRoot') }),
                      h('input', {
                        className: 'k2-input',
                        value: status.settings.comfyRoot,
                        spellCheck: false,
                        onChange: function (event) {
                          var value = event.target.value
                          setStatus(function (prev) {
                            var next = Object.assign({}, prev)
                            next.settings = Object.assign({}, next.settings, { comfyRoot: value })
                            return next
                          })
                          postJson(API + 'settings', { comfyRoot: value }).catch(function () {})
                        },
                      }),
                      h('div', { className: 'k2-hint', style: { marginTop: '5px' } }, t('settings.comfyRoot.hint')),
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
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'k2-iconbtn',
                    title: t('history.title'),
                    onClick: function () {
                      setHistoryOpen(true)
                    },
                  },
                  h(Icon, { name: 'clock', size: 14 }),
                ),
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
                { className: 'k2-canvas' + (busy === true || currentResult === null ? ' is-empty' : '') },
                busy === true
                  ? h(
                      'div',
                      { className: 'k2-busy' },
                      h('div', { className: 'k2-spinner' }),
                      h('div', { className: 'k2-busy-title' }, t(job.state === 'queued' ? 'state.queued' : 'state.running')),
                      h('div', { className: 'k2-busy-sub' }, formatSeconds(job.elapsedMs) + 's'),
                      h('div', { className: 'k2-busy-bar' }, h('i')),
                    )
                  : currentResult !== null && currentResult.images.length > 0
                    ? h('img', {
                        src: imageUrl(currentResult.images[0].path),
                        alt: '',
                        onClick: function () {
                          setZoom({
                            url: imageUrl(currentResult.images[0].path),
                            path: currentResult.images[0].path,
                          })
                        },
                      })
                    : h(
                        'div',
                        { className: 'k2-empty' },
                        h(Icon, { name: 'image', size: 34 }),
                        h('strong', null, online === false ? t('comfy.offline') : t('empty.title')),
                        h('span', null, online === false ? t('empty.offline') : t('empty.body')),
                        online === false
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className: 'k2-btn' + (starting === true ? ' is-primary' : ''),
                                style: { marginTop: '10px' },
                                disabled: starting === true,
                                onClick: startComfy,
                              },
                              starting === true
                                ? h('span', null, t('action.starting'))
                                : h(Icon, { name: 'power', size: 14 }),
                              starting === true ? null : h('span', null, t('action.startComfy')),
                            )
                          : null,
                      ),
              ),
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
                      currentResult.workflowName,
                      ' · ',
                      currentResult.seed === undefined ? '' : t('result.seed', { seed: currentResult.seed }) + ' · ',
                      formatSeconds(currentResult.elapsedMs) + 's',
                    )
                  : h('span', null, t('app.tagline')),
                savedAt > 0 ? h('span', { className: 'k2-saved' }, t('action.saved')) : null,
              ),
            ),
          ),
        )
      }

      var statusText = t('comfy.offline')
      var statusClass = 'k2-pill is-off'
      if (loading === true) {
        statusText = t('comfy.checking')
        statusClass = 'k2-pill'
      } else if (online === true) {
        statusText = t('comfy.online')
        statusClass = 'k2-pill is-on'
      }

      var subtitle = t('app.tagline')
      if (status !== null && status.comfy !== undefined && typeof status.comfy.deviceName === 'string') {
        subtitle = status.comfy.deviceName.split(':').slice(1).join(':').trim() || status.comfy.deviceName
      }

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
              h('span', { className: 'k2-brand-sub' }, subtitle),
            ),
          ),
          h(
            'div',
            { className: 'k2-head-right' },
            h(
              'span',
              { className: statusClass, title: status !== null && status.comfy && status.comfy.error ? status.comfy.error : '' },
              h('span', { className: 'k2-dot' }),
              h('span', null, statusText),
            ),
            online === false && loading === false
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'k2-iconbtn',
                    title: t('action.startComfy'),
                    disabled: starting === true,
                    onClick: startComfy,
                  },
                  h(Icon, { name: 'power', size: 15 }),
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'k2-iconbtn',
                title: t('queue.title'),
                onClick: function () {
                  setQueueOpen(true)
                },
              },
              h(Icon, { name: 'list', size: 15 }),
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
        importOpen === true
          ? h(ImportDialog, {
              onCancel: function () {
                setImportOpen(false)
              },
              onSubmit: importWorkflow,
            })
          : null,
        presetDialogOpen === true
          ? h(PresetDialog, {
              onCancel: function () {
                setPresetDialogOpen(false)
              },
              onSubmit: saveValuePreset,
            })
          : null,
        queueOpen === true
          ? h(
              'div',
              {
                className: 'k2-modal',
                onClick: function (event) {
                  if (event.target === event.currentTarget) setQueueOpen(false)
                },
              },
              h(
                'div',
                { className: 'k2-dialog' },
                h('div', { className: 'k2-dialog-title' }, t('queue.title')),
                queue.error !== ''
                  ? h('div', { className: 'k2-alert' }, queue.error)
                  : queue.running.length === 0 && queue.pending.length === 0
                    ? h('div', { className: 'k2-hint' }, t('queue.empty'))
                    : h(
                        'div',
                        { className: 'k2-qlist' },
                        queue.running.map(function (item) {
                          return h(
                            'div',
                            { key: item.promptId, className: 'k2-qrow' },
                            h('span', { className: 'k2-qname' }, item.workflowName || t('queue.unknown')),
                            h('span', { className: 'k2-qtag' }, t('queue.running')),
                            h('span', { className: 'k2-qmeta' }, Math.round((item.elapsedMs || 0) / 1000) + 's'),
                          )
                        }),
                        queue.pending.map(function (item, index) {
                          return h(
                            'div',
                            { key: item.promptId, className: 'k2-qrow' },
                            h('span', { className: 'k2-qname' }, item.workflowName || t('queue.unknown')),
                            h('span', { className: 'k2-qtag' }, t('queue.pending') + ' #' + (index + 1)),
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'k2-iconbtn',
                                title: t('queue.remove'),
                                onClick: function () {
                                  removeFromQueue(item.promptId)
                                },
                              },
                              h(Icon, { name: 'trash', size: 13 }),
                            ),
                          )
                        }),
                      ),
                h(
                  'div',
                  { className: 'k2-dialog-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'k2-btn is-ghost',
                      disabled: queue.pending.length === 0,
                      onClick: clearQueue,
                    },
                    t('queue.clear'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'k2-btn',
                      onClick: function () {
                        setQueueOpen(false)
                      },
                    },
                    t('action.close'),
                  ),
                ),
              ),
            )
          : null,
        historyOpen === true
          ? h(
              'div',
              {
                className: 'k2-modal',
                onClick: function (event) {
                  if (event.target === event.currentTarget) setHistoryOpen(false)
                },
              },
              h(
                'div',
                { className: 'k2-dialog' },
                h(
                  'div',
                  { className: 'k2-dialog-title' },
                  t('history.title'),
                  history.items.length > 0
                    ? h(
                        'span',
                        { className: 'k2-dialog-count' },
                        ' · ' + t('history.count', { n: history.items.length }),
                      )
                    : null,
                ),
                history.error !== ''
                  ? h('div', { className: 'k2-alert' }, history.error)
                  : history.items.length === 0
                    ? h('div', { className: 'k2-hint' }, t('history.empty'))
                    : h(
                        'div',
                        { className: 'k2-history-grid' },
                        history.items.map(function (item) {
                          return h(
                            'div',
                            { key: item.path, className: 'k2-history-item' },
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'k2-history-pic',
                                title: item.name,
                                onClick: function () {
                                  setZoom({ url: imageUrl(item.path), path: item.path })
                                },
                              },
                              h('img', { src: imageUrl(item.path), alt: '' }),
                            ),
                            h(
                              'div',
                              { className: 'k2-history-acts' },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'k2-iconbtn',
                                  title: t('action.reveal'),
                                  onClick: function () {
                                    revealFile(item.path)
                                  },
                                },
                                h(Icon, { name: 'folder', size: 13 }),
                              ),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'k2-iconbtn',
                                  title: t('action.delete'),
                                  onClick: function () {
                                    deleteImage(item.path)
                                  },
                                },
                                h(Icon, { name: 'trash', size: 13 }),
                              ),
                            ),
                          )
                        }),
                      ),
                h(
                  'div',
                  { className: 'k2-dialog-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'k2-btn',
                      onClick: function () {
                        setHistoryOpen(false)
                      },
                    },
                    t('action.close'),
                  ),
                ),
              ),
            )
          : null,
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
                src: zoom.url,
                alt: '',
                onClick: function (event) {
                  event.stopPropagation()
                },
              }),
              h(
                'div',
                { className: 'k2-zoom-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'k2-btn is-small',
                    onClick: function (event) {
                      event.stopPropagation()
                      recoverFrom(zoom.path)
                    },
                  },
                  t('action.recover'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'k2-btn is-small',
                    onClick: function (event) {
                      event.stopPropagation()
                      revealFile(zoom.path)
                    },
                  },
                  t('action.reveal'),
                ),
              ),
            )
          : null,
      )
    }

    /** Paste-a-graph dialog. */
    function ImportDialog(props) {
      var namePair = useState('')
      var name = namePair[0]
      var setName = namePair[1]

      var jsonPair = useState('')
      var json = jsonPair[0]
      var setJson = jsonPair[1]

      var errorPair = useState('')
      var error = errorPair[0]
      var setError = errorPair[1]

      var busyPair = useState(false)
      var busy = busyPair[0]
      var setBusy = busyPair[1]

      function submit() {
        if (busy === true) return
        setBusy(true)
        setError('')
        Promise.resolve()
          .then(function () {
            return props.onSubmit(name.trim() === '' ? t('import.defaultName') : name.trim(), json)
          })
          .catch(function (failure) {
            setError(failure.message || String(failure))
          })
          .finally(function () {
            setBusy(false)
          })
      }

      return h(
        'div',
        {
          className: 'k2-modal',
          onClick: function (event) {
            if (event.target === event.currentTarget) props.onCancel()
          },
        },
        h(
          'div',
          { className: 'k2-dialog' },
          h('div', { className: 'k2-dialog-title' }, t('import.title')),
          h(Label, { text: t('import.name') }),
          h('input', {
            className: 'k2-input',
            value: name,
            onChange: function (event) {
              setName(event.target.value)
            },
          }),
          h(Label, { text: t('import.json') }),
          h('textarea', {
            className: 'k2-textarea',
            value: json,
            spellCheck: false,
            placeholder: '{ "1": { "class_type": "...", "inputs": { ... } } }',
            onChange: function (event) {
              setJson(event.target.value)
            },
          }),
          h('div', { className: 'k2-hint' }, t('import.hint')),
          error !== '' ? h('div', { className: 'k2-alert' }, error) : null,
          h(
            'div',
            { className: 'k2-dialog-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'k2-btn is-ghost',
                onClick: function () {
                  props.onCancel()
                },
              },
              t('import.cancel'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'k2-btn',
                disabled: busy === true || json.trim() === '',
                onClick: submit,
              },
              t('import.submit'),
            ),
          ),
        ),
      )
    }

    /** Name-the-current-parameters dialog. */
    function PresetDialog(props) {
      var namePair = useState('')
      var name = namePair[0]
      var setName = namePair[1]

      var errorPair = useState('')
      var error = errorPair[0]
      var setError = errorPair[1]

      var busyPair = useState(false)
      var busy = busyPair[0]
      var setBusy = busyPair[1]

      function submit() {
        if (busy === true) return
        setBusy(true)
        setError('')
        Promise.resolve()
          .then(function () {
            return props.onSubmit(name.trim())
          })
          .catch(function (failure) {
            setError(failure.message || String(failure))
          })
          .finally(function () {
            setBusy(false)
          })
      }

      return h(
        'div',
        {
          className: 'k2-modal',
          onClick: function (event) {
            if (event.target === event.currentTarget) props.onCancel()
          },
        },
        h(
          'div',
          { className: 'k2-dialog' },
          h('div', { className: 'k2-dialog-title' }, t('preset.save')),
          h(Label, { text: t('preset.name') }),
          h('input', {
            className: 'k2-input',
            value: name,
            placeholder: t('preset.namePh'),
            spellCheck: false,
            onChange: function (event) {
              setName(event.target.value)
            },
            onKeyDown: function (event) {
              if (event.key === 'Enter') submit()
            },
          }),
          error !== '' ? h('div', { className: 'k2-alert' }, error) : null,
          h(
            'div',
            { className: 'k2-dialog-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'k2-btn is-ghost',
                onClick: function () {
                  props.onCancel()
                },
              },
              t('import.cancel'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'k2-btn',
                disabled: busy === true,
                onClick: submit,
              },
              t('preset.save'),
            ),
          ),
        ),
      )
    }

    /* ------------------------------ plugin ------------------------------ */

    function apply(ctx) {
      ctx.effect(function () {
        var style = document.createElement('style')
        style.dataset.plugin = 'dsh-comfyui-panel'
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
          var dispose = locale.register('dsh-comfyui-panel', DICTS)
          return function () {
            if (typeof dispose === 'function') dispose()
          }
        })
        try {
          var bound = locale.bind('dsh-comfyui-panel')
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
      name: 'dsh-comfyui-panel',
      inject: ['slots', 'locale'],
      apply: apply,
    }
  },
})
