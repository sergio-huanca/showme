const mc = () => document.modelContext
const registry = new Map()
const calls = []
let listedNames = null
const stats = { toolchange: 0 }
const shownAt = new Map()
const lastAction = new Map()
let app = { app: 'this app', state: () => ({}) }
let walk = null
let pending = null
let ui, spot, caption, cursor, drawer

const HOW = [
  'You are guiding a person who wants to learn where things are. You show, they click.',
  'Plan the whole path from the current screen with the ids below, then call run_walkthrough once with every step. Elements with inside_menu need that menu opened in an earlier step. Screens are reached through elements whose "opens" names the screen. Collapsed sections and dialogs need their opener as an earlier step.',
  'The page paces the person: each spotlight appears the instant they finish the previous step, so do not split the path into several calls.',
  'If run_walkthrough returns in_progress, call it again without steps to keep waiting. If it returns interrupted or blocked, read the reason and now, then call it again with the remaining steps.',
  'Only call do_step_for_person when the person explicitly asks you to do a step for them. Most steps are theirs by policy and the tool will say so.',
  'When the walkthrough is completed, tell the person the path in one line so they remember it next time, and call end_walkthrough.',
]

const q = id => document.querySelector(`[data-guide="${CSS.escape(id)}"]`)
const visible = el => !!el && el.getClientRects().length > 0
const sleep = ms => new Promise(r => setTimeout(r, ms))
const desc = el => el.dataset.guideDesc || el.textContent.trim()

function kind(el) {
  const t = el.tagName.toLowerCase()
  if (t === 'input') return el.type === 'checkbox' ? 'checkbox' : el.type === 'search' ? 'search box' : 'text field'
  if (t === 'select') return 'dropdown'
  if (t === 'textarea') return 'text field'
  if (el.closest('[data-menu]')) return 'menu item'
  if (t === 'a') return el.classList.contains('tab') ? 'tab' : 'link'
  return 'button'
}

function describe(el) {
  const d = { id: el.dataset.guide, what: desc(el), kind: kind(el), visible: visible(el) }
  if (el.dataset.guideGoto) d.opens = el.dataset.guideGoto
  if (el.dataset.guideMenu) d.inside_menu = el.dataset.guideMenu
  const panel = el.closest('[data-panel]')
  if (panel) d.panel = panel.dataset.panel
  const dialog = el.closest('[data-dialog]')
  if (dialog) d.inside_dialog = dialog.dataset.dialog
  if ('guideDelegable' in el.dataset) d.agent_may_do_this = true
  if ('guideDanger' in el.dataset) d.irreversible = true
  return d
}

function uiMap() {
  const screens = [...document.querySelectorAll('[data-screen]')].map(s => ({
    id: s.dataset.screen,
    title: s.querySelector('h1')?.textContent.trim() || s.dataset.screen,
    what: s.dataset.screenDesc,
    current: visible(s),
    panels: [...s.querySelectorAll('[data-panel]')].map(p => ({ id: p.dataset.panel, what: p.dataset.panelDesc, current: visible(p) })),
    elements: [...s.querySelectorAll('[data-guide]')].map(describe),
  }))
  const dialogs = [...document.querySelectorAll('[data-dialog]')].map(d => ({
    id: d.dataset.dialog,
    what: d.dataset.dialogDesc,
    open: visible(d),
    elements: [...d.querySelectorAll('[data-guide]')].map(describe),
  }))
  const global = [...document.querySelectorAll('[data-guide]')].filter(el => !el.closest('[data-screen]') && !el.closest('[data-dialog]')).map(describe)
  return { app: app.app, how_to_guide: HOW, screens, dialogs, always_available: global }
}

function view() {
  const s = [...document.querySelectorAll('[data-screen]')].find(visible)
  const p = s && [...s.querySelectorAll('[data-panel]')].find(visible)
  const menu = [...document.querySelectorAll('[data-menu]')].find(visible)
  const dialog = [...document.querySelectorAll('[data-dialog]')].find(visible)
  return {
    screen: s ? { id: s.dataset.screen, title: s.querySelector('h1')?.textContent.trim() } : null,
    panel: p ? p.dataset.panel : null,
    open_menu: menu ? menu.dataset.menu : null,
    open_dialog: dialog ? dialog.dataset.dialog : null,
    visible_elements: [...document.querySelectorAll('[data-guide]')].filter(visible).map(e => e.dataset.guide),
    walkthrough: walk ? { active: true, step: walk.step, highlighted: walk.target } : { active: false },
    app_state: app.state(),
  }
}

function whyHidden(el) {
  const id = el.dataset.guide
  if (el.dataset.guideMenu) {
    const opener = q(el.dataset.guideMenu)
    return `"${id}" is inside a closed menu. Guide the person to open "${el.dataset.guideMenu}" first (${opener ? desc(opener) : 'menu'}).`
  }
  const region = el.closest('[data-region]')
  if (region && !visible(region)) return `"${id}" is in the ${region.dataset.region}, which is closed at this screen size. Guide the person to open it first with "${region.dataset.regionOpener}".`
  const dialog = el.closest('[data-dialog]')
  if (dialog && !visible(dialog)) return `"${id}" lives in the "${dialog.dataset.dialog}" dialog, which is not open. ${dialog.dataset.dialogDesc || ''}`
  const screen = el.closest('[data-screen]')
  if (screen && !visible(screen)) return `"${id}" is on the "${screen.dataset.screen}" screen and the person is on "${view().screen?.id}". Guide them there first through an element whose "opens" is "${screen.dataset.screen}".`
  const panel = el.closest('[data-panel]')
  if (panel && !visible(panel)) return `"${id}" is in the "${panel.dataset.panel}" panel, which is not selected. Guide them to the "${panel.dataset.panel}" tab first.`
  let box = el
  while (box.parentElement && !visible(box.parentElement)) box = box.parentElement
  const toggle = box.previousElementSibling
  if (toggle && toggle.dataset.guide) return `"${id}" is inside the collapsed "${toggle.textContent.trim()}" section. Guide the person to click "${toggle.dataset.guide}" first.`
  return `"${id}" exists but is not visible right now. It probably appears after another action on this screen, such as a button that reveals a form.`
}

function whatWasClicked(node) {
  const g = node.closest && node.closest('[data-guide]')
  if (g) return `"${g.dataset.guide}" (${desc(g)})`
  const s = node.closest && node.closest('[data-screen]')
  return s ? `an unmarked area of the ${s.dataset.screen} screen` : 'an unmarked area of the page'
}

function hintFor(el) {
  const k = kind(el)
  if (k === 'text field' || k === 'search box') return 'Type here'
  if (k === 'checkbox') return 'Tick the box'
  if (k === 'dropdown') return 'Pick an option'
  return 'Click it'
}

function place() {
  if (!walk) return
  requestAnimationFrame(place)
  if (!walk.el) return
  if (!visible(walk.el)) {
    spot.hidden = true
    cursor.classList.remove('on')
    if (!walk.hideAt) walk.hideAt = performance.now() + 900
    else if (performance.now() > walk.hideAt) clearSpot()
    return
  }
  const box = walk.el.matches('input[type=checkbox], input[type=radio]') && walk.el.closest('label') || walk.el
  const r = box.getBoundingClientRect()
  const e = walk.el.getBoundingClientRect()
  const pad = 6
  spot.style.top = r.top - pad + 'px'
  spot.style.left = r.left - pad + 'px'
  spot.style.width = r.width + pad * 2 + 'px'
  spot.style.height = r.height + pad * 2 + 'px'
  const cw = caption.offsetWidth, ch = caption.offsetHeight
  const below = r.bottom + 14 + ch < window.innerHeight
  caption.style.top = (below ? r.bottom + 14 : r.top - ch - 14) + 'px'
  caption.style.left = Math.max(8, Math.min(r.left, window.innerWidth - cw - 8)) + 'px'
  const pos = `translate(${e.left + e.width * 0.6}px, ${e.top + e.height * 0.55}px)`
  cursor.style.setProperty('--pos', pos)
  cursor.style.transform = pos
  const d = drawer.getBoundingClientRect()
  drawer.classList.toggle('aside', !drawer.hidden && r.right > d.left && r.left < d.right && r.bottom > d.top && r.top < d.bottom)
}

function startWalk() {
  const end = new AbortController()
  walk = { step: 0, target: null, el: null, end }
  register(endTool, { signal: end.signal })
  logEvent('Tool added: end_walkthrough. It exists only while a guide is running, so the agent\'s tool list changes live')
  requestAnimationFrame(place)
}

function clearSpot() {
  spot.hidden = true
  caption.hidden = true
  cursor.classList.remove('on')
  drawer.classList.remove('aside')
  if (walk) walk.el = null
}

function markDone() {
  spot.classList.add('done')
  caption.classList.add('done')
  caption.querySelector('.step').textContent = `Step ${walk ? walk.step : ''} ✓`
  caption.querySelector('.hint').textContent = 'Nice'
  cursor.classList.remove('busy')
  void cursor.offsetWidth
  cursor.classList.add('busy')
}

function endWalk(reason) {
  const steps = walk ? walk.step : 0
  stopRun('the walkthrough ended: ' + reason)
  clearSpot()
  if (pending) pending.cancel('the walkthrough ended: ' + reason)
  if (walk) {
    walk.end.abort()
    try { if (mc() && typeof mc().unregisterTool === 'function') mc().unregisterTool(endTool.name) } catch {}
    logEvent('Tool removed: end_walkthrough')
  }
  walk = null
  return { ok: true, steps_completed: steps, reason }
}

async function highlight({ element_id, message, step }) {
  const el = q(element_id)
  if (!el) return { ok: false, error: `No element with id "${element_id}". Call get_ui_map to see the ids.` }
  if (!visible(el)) return { ok: false, error: whyHidden(el), now: view() }
  if (!walk) startWalk()
  walk.step = step || walk.step + 1
  walk.target = element_id
  walk.el = el
  walk.hideAt = null
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  spot.hidden = false
  caption.hidden = false
  spot.classList.remove('done')
  caption.classList.remove('done')
  caption.querySelector('.step').textContent = `Step ${walk.step}${walk.total ? ' of ' + walk.total : ''}`
  caption.querySelector('.text').textContent = message || desc(el)
  caption.querySelector('.hint').textContent = hintFor(el)
  cursor.classList.add('on')
  shownAt.set(element_id, performance.now())
  return { ok: true, step: walk.step, highlighted: describe(el), screen: view().screen }
}

function waitFor({ element_id, timeout_seconds }, ctx) {
  const el = q(element_id)
  if (!el) return { ok: false, error: `No element with id "${element_id}". Call get_ui_map to see the ids.` }
  if (!visible(el)) return { done: false, reason: whyHidden(el), now: view() }
  const since = shownAt.has(element_id) ? shownAt.get(element_id) : performance.now()
  if ((lastAction.get(element_id) || 0) > since) {
    if (walk && walk.target === element_id) markDone()
    return { done: true, action: 'already done', note: 'The person did this step before you asked to wait.', element_id, now: view() }
  }
  if (pending) pending.cancel('a newer wait replaced it')
  const seconds = Number(timeout_seconds) > 0 ? Number(timeout_seconds) : 45
  const isText = el.matches('input:not([type=checkbox]):not([type=radio]), textarea')
  const isToggle = el.matches('input[type=checkbox], input[type=radio], select')

  return new Promise(resolve => {
    let timer, debounce, poll
    let over = false
    const finish = out => {
      if (over) return
      over = true
      cleanup()
      pending = null
      resolve({ ...out, element_id, now: view() })
    }
    const later = (out, effect) => setTimeout(() => { if (!over) { effect(); finish(out) } }, 80)
    const done = action => later({ done: true, action }, () => { if (walk && walk.target === element_id) markDone() })
    const fail = reason => later({ done: false, reason }, clearSpot)
    const onClick = () => done('clicked')
    const onChange = () => done(el.type === 'checkbox' ? (el.checked ? 'checked' : 'unchecked') : `chose "${el.value}"`)
    const onKey = e => { if (e.key === 'Enter' && el.value.trim()) done(`typed "${el.value.trim()}"`) }
    const onInput = () => {
      clearTimeout(debounce)
      if (el.value.trim()) debounce = setTimeout(() => done(`typed "${el.value.trim()}"`), 900)
    }
    const onDown = e => {
      const label = e.target.closest && e.target.closest('label')
      const neutral = app.neutral && e.target.closest && e.target.closest(app.neutral)
      const inside = el.contains(e.target) || (label && label.contains(el)) || ui.contains(e.target) || drawer.contains(e.target) || neutral
      if (!inside) fail('The person clicked somewhere else: ' + whatWasClicked(e.target))
    }
    const onAbort = () => finish({ done: false, reason: 'cancelled by the agent' })
    function cleanup() {
      el.removeEventListener('click', onClick)
      el.removeEventListener('change', onChange)
      el.removeEventListener('keydown', onKey)
      el.removeEventListener('input', onInput)
      document.removeEventListener('pointerdown', onDown, true)
      if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort)
      clearTimeout(timer)
      clearTimeout(debounce)
      clearInterval(poll)
    }
    if (isText) {
      el.addEventListener('keydown', onKey)
      el.addEventListener('input', onInput)
    } else if (isToggle) el.addEventListener('change', onChange)
    else el.addEventListener('click', onClick)
    document.addEventListener('pointerdown', onDown, true)
    if (ctx.signal) ctx.signal.addEventListener('abort', onAbort)
    poll = setInterval(() => {
      if (!visible(el)) fail(`"${element_id}" disappeared before the person acted (a menu closed or the screen changed).`)
    }, 400)
    timer = setTimeout(() => finish({
      done: false,
      reason: 'still waiting',
      note: `No action after ${seconds}s. The highlight stays on.`,
    }), seconds * 1000)
    pending = { cancel: reason => finish({ done: false, reason }) }
  })
}

async function moveCursor(el) {
  const r = el.getBoundingClientRect()
  cursor.classList.add('on')
  const pos = `translate(${r.left + r.width * 0.6}px, ${r.top + r.height * 0.55}px)`
  cursor.style.setProperty('--pos', pos)
  cursor.style.transform = pos
  await sleep(650)
  cursor.classList.remove('busy')
  void cursor.offsetWidth
  cursor.classList.add('busy')
}

async function doStep({ element_id, value }) {
  const el = q(element_id)
  if (!el) return { ok: false, error: `No element with id "${element_id}". Call get_ui_map to see the ids.` }
  if ('guideDanger' in el.dataset) return { ok: false, refused: true, reason: `${app.app} policy: "${desc(el)}" is irreversible and is never done by an agent. Guide the person with run_walkthrough instead.` }
  if (!('guideDelegable' in el.dataset)) return { ok: false, refused: true, reason: `${app.app} policy: "${desc(el)}" is a change the person makes themselves. Agents may only navigate and type into search boxes here. Guide them with run_walkthrough instead.` }
  if (!visible(el)) return { ok: false, error: whyHidden(el) }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  await moveCursor(el)
  if (el.matches('input, textarea')) {
    el.focus()
    el.value = ''
    for (const ch of String(value ?? '')) {
      el.value += ch
      el.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(45)
    }
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    el.click()
  }
  await sleep(300)
  if (!walk) cursor.classList.remove('on')
  return { ok: true, did: value != null && el.matches('input, textarea') ? `typed "${value}" into ${element_id}` : `clicked ${element_id}`, now: view() }
}

const untilVisible = async (el, ms) => {
  const until = performance.now() + ms
  while (!visible(el) && performance.now() < until) await sleep(100)
  return visible(el)
}

const firstClause = d => {
  let out = d.split(/[.,(:]/)[0].trim()
  if (out.length > 34) out = out.slice(0, 34).replace(/\s+\S*$/, '')
  return out
}

const labelOf = el => {
  if (!el) return '?'
  if (el.dataset.guideLabel) return el.dataset.guideLabel
  if (el.matches('input, select, textarea')) {
    const lab = el.closest('label')
    const own = lab ? [...lab.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim() : ''
    return own || el.placeholder || firstClause(desc(el))
  }
  const text = el.textContent.trim().replace(/\s+/g, ' ')
  if (text.length >= 3 && text.length <= 28 && !/^\d+$/.test(text)) return text
  return firstClause(desc(el))
}

function finishRun(run, status, reason) {
  if (run.status !== 'in_progress') return
  run.status = status
  run.reason = reason || null
  if (status === 'completed') {
    run.learned_path = run.steps.map(x => labelOf(q(x.element_id)))
    caption.querySelector('.step').textContent = 'Done ✓'
    caption.querySelector('.text').textContent = 'That was the last step. You did every click yourself.'
    caption.querySelector('.hint').textContent = 'Your agent will tell you the path in one line'
    setTimeout(() => { if (walk && walk.run === run) clearSpot() }, 2500)
  }
  run.waiters.splice(0).forEach(fn => fn())
}

function stopRun(reason) {
  const run = walk && walk.run
  if (run && run.status === 'in_progress') {
    finishRun(run, 'interrupted', reason)
    if (pending) pending.cancel(reason)
  }
}

async function drive(run) {
  while (run.index < run.steps.length && run.status === 'in_progress') {
    const step = run.steps[run.index]
    const el = q(step.element_id)
    if (!el) { finishRun(run, 'blocked', `No element with id "${step.element_id}" exists right now. Call get_ui_map to see the ids.`); return }
    const ready = run.index === 0 ? visible(el) : await untilVisible(el, 6000)
    if (run.status !== 'in_progress') return
    if (!ready) { finishRun(run, 'blocked', whyHidden(el)); return }
    await highlight({ element_id: step.element_id, message: step.message })
    let r
    do { r = await waitFor({ element_id: step.element_id, timeout_seconds: 600 }, {}) }
    while (r.done === false && r.reason === 'still waiting' && run.status === 'in_progress')
    if (run.status !== 'in_progress') return
    if (!r.done) { finishRun(run, 'interrupted', r.reason); return }
    run.results.push({ element_id: step.element_id, action: r.action })
    run.index++
    await sleep(350)
  }
  finishRun(run, 'completed')
}

const NEXT = {
  in_progress: 'The walkthrough keeps running on the page. Call run_walkthrough again without steps to keep waiting.',
  completed: 'Tell the person the path in one line and call end_walkthrough.',
  interrupted: 'Read reason and now, then call run_walkthrough with the remaining steps. Re-plan if the person went somewhere else.',
  blocked: 'That step was not reachable when its turn came. Check now.visible_elements and call run_walkthrough with a corrected plan.',
}

function report(run) {
  return {
    status: run.status,
    steps_total: run.steps.length,
    completed_steps: run.results,
    current_step: run.status === 'in_progress' ? { number: run.index + 1, ...run.steps[run.index] } : null,
    reason: run.reason || undefined,
    learned_path: run.learned_path,
    next: NEXT[run.status],
    now: view(),
  }
}

async function runWalkthrough({ steps, title, timeout_seconds }, ctx = {}) {
  const seconds = Number(timeout_seconds) > 0 ? Number(timeout_seconds) : 40
  if (Array.isArray(steps) && steps.length) {
    const unknown = steps.filter(x => !x || !q(x.element_id)).map(x => x && x.element_id)
    if (unknown.length) return { ok: false, error: `Unknown element ids: ${unknown.join(', ')}. Call get_ui_map to see the ids.` }
    stopRun('replaced by a new walkthrough')
    if (!walk) startWalk()
    walk.step = 0
    walk.total = steps.length
    walk.run = { title: title || '', steps: steps.map(x => ({ element_id: x.element_id, message: x.message || '' })), index: 0, results: [], status: 'in_progress', reason: null, waiters: [] }
    drive(walk.run)
  } else if (!walk || !walk.run) {
    return { ok: false, error: 'No walkthrough is running. Pass steps to start one.' }
  }
  const run = walk.run
  if (run.status === 'in_progress') {
    await new Promise(resolve => {
      run.waiters.push(resolve)
      setTimeout(resolve, seconds * 1000)
      if (ctx.signal) ctx.signal.addEventListener('abort', resolve)
    })
  }
  return report(run)
}

const objSchema = (props = {}, required = []) => ({ type: 'object', properties: props, ...(required.length ? { required } : {}) })
const elementId = { type: 'string', description: 'Element id from get_ui_map, for example board.more' }

const baseTools = () => [
  {
    name: 'get_ui_map',
    description: `Map of every screen, panel, menu and interactive element of ${app.app}, with the ids the other tools accept and short instructions on how to guide. Call it once at the start of a guide. Read-only; names typed by people appear in it.`,
    inputSchema: objSchema(),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: uiMap,
  },
  {
    name: 'get_current_view',
    description: 'Where the person is right now: current screen and panel, any open menu or dialog, which element ids are visible, the state of the walkthrough, and a snapshot of app data. Read-only.',
    inputSchema: objSchema(),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: view,
  },
  {
    name: 'run_walkthrough',
    description: 'Guide the person through a whole path. Pass every step in order. The page spotlights each element with your message, waits for the person to click, tick or type, then moves to the next step by itself, so they never wait for you between steps. Returns completed, interrupted (with the reason: they clicked elsewhere or stopped), blocked (a step was not reachable when its turn came), or in_progress after timeout_seconds (default 40) while it keeps running; call again without steps to keep waiting.',
    inputSchema: objSchema({
      steps: {
        type: 'array',
        description: 'The full path, in order. Omit to keep waiting for the walkthrough that is already running.',
        items: {
          type: 'object',
          properties: {
            element_id: elementId,
            message: { type: 'string', description: 'One short friendly sentence for this step, e.g. "Click the three dots at the right of the toolbar."' },
          },
          required: ['element_id', 'message'],
        },
      },
      title: { type: 'string', description: 'What the person wanted, in their words, e.g. "Turn on international transfers". Shown in the Agent activity transcript.' },
      timeout_seconds: { type: 'integer', description: 'How long this call waits before returning in_progress. Default 40.' },
    }),
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: runWalkthrough,
  },
  {
    name: 'do_step_for_person',
    description: `Perform one step on behalf of the person, only when they explicitly ask you to. ${app.app} allows this for navigation and search boxes and refuses anything else, which the person does themselves. Returns refused:true with the policy when not allowed.`,
    inputSchema: objSchema({
      element_id: elementId,
      value: { type: 'string', description: 'Text to type when the element is a text field' },
    }, ['element_id']),
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: doStep,
  },
]

const endTool = {
  name: 'end_walkthrough',
  description: 'Finish the current guide: removes the spotlight and the message. Call it when the task is complete or the person wants to stop. Only exists while a walkthrough is active.',
  inputSchema: objSchema(),
  annotations: { readOnlyHint: false },
  execute: () => endWalk('finished by the agent'),
}

const short = v => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 160 ? s.slice(0, 157) + '…' : s
}

async function register(def, opts = {}) {
  const entry = {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    execute: async (input, ctx) => {
      const c = { name: def.name, input: input || {}, at: new Date(), signal: !!(ctx && ctx.signal) }
      if (c.signal) ctx.signal.addEventListener('abort', () => { c.aborted = true; renderCalls() }, { once: true })
      calls.unshift(c)
      renderCalls()
      let out
      try { out = await def.execute(input || {}, ctx || {}) }
      catch (e) { out = { ok: false, error: e.message } }
      c.out = out
      c.done = new Date()
      renderCalls()
      return JSON.stringify(out)
    },
  }
  if (def.annotations) entry.annotations = def.annotations
  registry.set(def.name, entry)
  if (opts.signal) opts.signal.addEventListener('abort', () => { registry.delete(def.name); renderTools() })
  if (mc()) {
    const variants = [def.annotations, def.annotations && def.annotations.readOnlyHint ? { readOnlyHint: true } : null, null]
    for (const annotations of variants) {
      const tool = { name: entry.name, description: entry.description, inputSchema: entry.inputSchema, execute: entry.execute }
      if (annotations) tool.annotations = annotations
      try {
        await mc().registerTool(tool, opts.signal ? { signal: opts.signal } : undefined)
        entry.registered = true
        entry.error = null
        entry.dropped = Object.keys(def.annotations || {}).filter(k => !annotations || !(k in annotations))
        entry.accepted = annotations ? Object.keys(annotations) : []
        break
      } catch (e) {
        entry.error = e && e.message ? e.message : String(e)
      }
    }
  }
  renderTools()
}

function buildOverlay() {
  ui = document.createElement('div')
  ui.id = 'showme'
  ui.innerHTML = `<div class="showme-spot" hidden></div>
<div class="showme-caption" hidden><span class="step"></span><button class="stop" title="Stop the guide"><svg><use href="#i-x"/></svg></button><div class="text"></div><span class="hint"></span></div>
<svg class="showme-cursor" viewBox="0 0 24 24"><path d="M5 3l14 8-6.5 1.6L9 19z" fill="#fff" stroke="#172b4d" stroke-width="1.6" stroke-linejoin="round"/></svg>`
  document.body.appendChild(ui)
  spot = ui.querySelector('.showme-spot')
  caption = ui.querySelector('.showme-caption')
  cursor = ui.querySelector('.showme-cursor')
  caption.querySelector('.stop').addEventListener('click', () => endWalk('stopped by the person'))
}

function buildRibbon() {
  if (!app.hint) return
  const key = 'showme.ribbon.' + app.app
  try { if (localStorage.getItem(key)) return } catch {}
  const r = document.createElement('div')
  r.className = 'showme-ribbon'
  r.innerHTML = `<b>Agent-ready site.</b> Open it in ChatGPT's browser, or Chrome with WebMCP, and ask: <q>${esc(app.hint)}</q>${app.also ? ` · Also try <a href="${esc(app.also.url)}">${esc(app.also.name)}</a>` : ''}<button class="close" title="Dismiss">×</button>`
  r.querySelector('.close').addEventListener('click', () => { r.remove(); try { localStorage.setItem(key, '1') } catch {} })
  ui.appendChild(r)
}

function buildDrawer() {
  drawer = document.createElement('aside')
  drawer.className = 'agent-drawer'
  drawer.hidden = true
  drawer.innerHTML = `<header><span class="dot"></span>Agent activity<button class="icon-btn" title="Close"><svg><use href="#i-x"/></svg></button></header>
<div class="api"></div>
<h3>WebMCP in this session</h3>
<ul class="score"></ul>
<h3>Tools the agent can see right now</h3>
<ul class="tools"></ul>
<h3>Transcript · every call goes through document.modelContext</h3>
<div class="empty empty-calls">No calls yet. Ask your agent how to do something in ${app.app}.</div>
<ul class="calls"></ul>
<h3>The map the site publishes</h3>
<div class="map"></div>
<details class="mapdump"><summary>Show exactly what get_ui_map returns</summary><pre></pre></details>`
  drawer.querySelector('header .icon-btn').addEventListener('click', () => { drawer.hidden = true; document.body.classList.remove('drawer-open') })
  drawer.querySelector('.mapdump').addEventListener('toggle', e => { if (e.target.open) e.target.querySelector('pre').textContent = JSON.stringify(uiMap(), null, 2) })
  document.body.appendChild(drawer)
}

const tagFor = t => {
  if (t.annotations && t.annotations.readOnlyHint) return '<span class="tag ro">read-only</span>'
  if (t.name === 'run_walkthrough') return '<span class="tag wait">paces you</span>'
  if (t.name === 'end_walkthrough') return '<span class="tag guide">guide only</span>'
  if (t.name === 'do_step_for_person') return '<span class="tag">policy gated</span>'
  return ''
}

async function renderTools() {
  if (!drawer || drawer.hidden) return
  let listed = null
  try { listed = new Set((await mc().getTools()).map(t => t.name)) } catch {}
  listedNames = listed
  const api = drawer.querySelector('.api')
  if (!mc()) api.textContent = 'This browser does not expose document.modelContext. Tools are only reachable from this page.'
  else if (listed) api.textContent = `The browser lists ${listed.size} tool${listed.size === 1 ? '' : 's'} from this page.`
  else api.textContent = 'document.modelContext is present. getTools is not available here, showing what the page registered.'
  const ul = drawer.querySelector('.tools')
  const known = new Set([...ul.children].map(li => li.dataset.name))
  ul.innerHTML = [...registry.values()].map(t => {
    let state = ''
    if (mc()) {
      const seen = listed ? listed.has(t.name) : t.registered
      if (!seen) state = `<span class="tag bad">${t.error ? 'rejected' : 'not listed'}</span>`
    }
    const err = t.error && !(listed && listed.has(t.name)) ? `<div class="err">${t.error}</div>` : ''
    const note = t.dropped && t.dropped.length ? `<div class="note">registered without ${t.dropped.join(', ')}: this browser did not accept it</div>` : ''
    const acc = t.accepted && t.accepted.length ? `<div class="note ok">annotations: ${t.accepted.join(', ')}</div>` : ''
    return `<li data-name="${t.name}" class="${known.size && !known.has(t.name) ? 'new' : ''}">${t.name}${tagFor(t)}${state}</li>${err}${note}${acc}`
  }).join('')
  renderScore()
}

function renderScore() {
  if (!drawer) return
  const tools = [...registry.values()]
  const accepted = [...new Set(tools.flatMap(t => t.accepted || []))]
  const runs = calls.filter(c => c.name === 'run_walkthrough')
  const open = runs.find(c => !c.out)
  const held = Math.round(Math.max(0, ...runs.filter(c => c.out).map(c => (c.done - c.at) / 1000)))
  const steps = calls.filter(c => c.name === 'do_step_for_person' && c.out)
  const refused = steps.filter(c => c.out.refused).length
  const flagged = calls.filter(c => c.out && (registry.get(c.name)?.accepted || []).includes('untrustedContentHint')).length
  const signals = calls.filter(c => c.signal).length
  const aborted = calls.filter(c => c.aborted).length
  const rows = [
    ['registerTool', tools.length, `${tools.length} tools registered from this page`],
    ['annotations', accepted.length, accepted.length ? `accepted by this browser: ${accepted.join(', ')}` : 'none accepted by this browser'],
    ['getTools', listedNames, listedNames ? `the browser lists ${listedNames.size} tools right now` : 'not available in this browser'],
    ['toolchange', stats.toolchange, stats.toolchange ? `${stats.toolchange} events fired by the browser` : 'no event fired yet'],
    ['long-running execute', runs.length, open ? `run_walkthrough open for ${Math.round((Date.now() - open.at) / 1000)}s while you act` : held ? `run_walkthrough held open ${held}s while you acted` : 'no walkthrough yet'],
    ['AbortSignal', signals, signals ? `received on ${signals} calls, ${aborted} aborted by the agent` : 'no signal received yet'],
    ['policy in the markup', steps.length, steps.length ? `${steps.length - refused} steps delegated, ${refused} refused by ${app.app}` : 'no step requested yet'],
    ['untrustedContentHint', flagged, flagged ? `${flagged} results carried people-typed text, flagged for the agent` : 'no flagged result yet'],
  ]
  drawer.querySelector('.score').innerHTML = rows.map(([k, on, text]) => `<li class="${on ? 'on' : ''}"><span class="dot"></span><code>${k}</code><span>${esc(text)}</span></li>`).join('')
}

function renderMap() {
  if (!drawer || drawer.hidden) return
  const m = uiMap()
  const all = [...m.screens.flatMap(x => x.elements), ...m.dialogs.flatMap(x => x.elements), ...m.always_available]
  const count = (k) => all.filter(e => e[k]).length
  drawer.querySelector('.map').textContent = `Right now: ${all.length} elements across ${m.screens.length} screens and ${m.dialogs.length} dialogs, read from the live page. ${count('visible')} visible, ${count('agent_may_do_this')} the agent may do for you, ${count('irreversible')} irreversible.`
  const dump = drawer.querySelector('.mapdump')
  if (dump.open) dump.querySelector('pre').textContent = JSON.stringify(m, null, 2)
}

const esc = v => String(v).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))

function logEvent(text) {
  calls.unshift({ event: text, at: new Date() })
  renderCalls()
}

const mapSize = m => m.screens.flatMap(x => x.elements).length + m.dialogs.flatMap(x => x.elements).length + m.always_available.length
const nameOf = id => labelOf(q(id))
const secs = (from, to) => Math.round(((to || Date.now()) - from) / 1000)

function headline(c) {
  const i = c.input, o = c.out, site = app.app
  switch (c.name) {
    case 'get_ui_map':
      return [`Agent asked for the map of ${site}`, o && `${site} answered: ${mapSize(o)} elements across ${o.screens.length} screens and ${o.dialogs.length} dialogs, plus ${o.how_to_guide.length} guiding rules written by the site`]
    case 'get_current_view':
      return ['Agent asked where you are', o && `${site} answered: ${o.screen ? o.screen.title : 'no screen'}${o.panel ? ' › ' + o.panel : ''}${o.open_dialog ? `, dialog "${o.open_dialog}" open` : ''}${o.open_menu ? `, menu "${o.open_menu}" open` : ''}, ${o.visible_elements.length} elements visible`]
    case 'run_walkthrough': {
      const n = Array.isArray(i.steps) ? i.steps.length : 0
      const head = n ? `Agent handed over a ${n}-step path${i.title ? ': ' + i.title : ''}` : 'Agent kept waiting on the running path'
      if (!o) return [head, null]
      if (o.ok === false) return [head, `${site} answered: ${o.error}`]
      const tail = {
        completed: `completed, you did all ${o.steps_total} steps yourself`,
        interrupted: `interrupted after ${o.completed_steps.length} of ${o.steps_total} steps. ${o.reason}`,
        blocked: `blocked. ${o.reason}`,
        in_progress: `still running after ${o.completed_steps.length} of ${o.steps_total} steps, the agent calls again`,
      }[o.status]
      return [head, `${site} answered after ${secs(c.at, c.done)}s: ${tail}`]
    }
    case 'do_step_for_person':
      return [`Agent asked to do "${nameOf(i.element_id)}" for you`, o && (o.refused ? `${site} refused. ${o.reason}` : o.ok ? `${site} allowed it and ${o.did}` : `${site} answered: ${o.error}`)]
    case 'end_walkthrough':
      return ['Agent ended the guide', o && `${site} answered: ${o.steps_completed} steps had been completed`]
  }
  return [c.name, o && short(o)]
}

function liveLine(c) {
  const run = c.name === 'run_walkthrough' && walk && walk.run
  if (!run) return `open for ${secs(c.at)}s`
  const step = run.steps[run.index]
  return `open for ${secs(c.at)}s · waiting for you · step ${run.index + 1} of ${run.steps.length}${step ? ' · ' + esc(nameOf(step.element_id)) : ''}`
}

function renderCalls() {
  if (!drawer) return
  renderMap()
  renderScore()
  drawer.querySelector('.empty-calls').hidden = calls.length > 0
  drawer.querySelector('.calls').innerHTML = calls.slice(0, 40).map(c => {
    const t = c.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    if (c.event) return `<li class="event"><span class="who">${t} · ${app.app}</span><div class="ev">${esc(c.event)}</div></li>`
    const bad = c.out && (c.out.ok === false || c.out.refused || c.out.status === 'interrupted' || c.out.status === 'blocked')
    const [head, tail] = headline(c)
    const acts = c.out ? c.out.completed_steps : (c.name === 'run_walkthrough' && walk && walk.run ? walk.run.results : null)
    const you = acts && acts.length ? `<ul class="you">${acts.map(s => `<li>${esc(nameOf(s.element_id))} · ${esc(s.action)}</li>`).join('')}</ul>` : ''
    const flags = [c.signal ? 'signal' : '', c.aborted ? 'aborted' : ''].filter(Boolean).map(f => ` · ${f}`).join('')
    return `<li class="${c.out ? '' : 'pending'}"><span class="who">${t} · <span class="name">${c.name}</span>${flags}</span>
<div class="head">${esc(head)}</div>
${c.out ? `<div class="res${bad ? ' bad' : ''}">${esc(tail)}</div>` : `<div class="live"><span class="pulse"></span>${liveLine(c)}</div>`}
${you}
<div class="raw">${esc(short(c.input)).replace(/^\{\}$/, '')}${c.out ? ' → ' + esc(short(c.out)) : ''}</div></li>`
  }).join('')
}

function trackActions() {
  const mark = e => {
    const g = e.target.closest && e.target.closest('[data-guide]')
    if (g) lastAction.set(g.dataset.guide, performance.now())
  }
  document.addEventListener('click', mark, true)
  document.addEventListener('change', mark, true)
  document.addEventListener('input', mark, true)
}

let tick
export function toggleDrawer() {
  drawer.hidden = !drawer.hidden
  document.body.classList.toggle('drawer-open', !drawer.hidden)
  clearInterval(tick)
  if (!drawer.hidden) {
    renderTools(); renderCalls(); renderMap()
    tick = setInterval(() => { if (calls.some(c => !c.event && !c.out)) renderCalls() }, 1000)
  }
}

export async function startGuide(opts) {
  app = { ...app, ...opts }
  buildOverlay()
  buildDrawer()
  buildRibbon()
  trackActions()
  for (let i = 0; i < 25 && !mc(); i++) await sleep(200)
  const m = mc()
  const onToolChange = () => { stats.toolchange++; renderTools() }
  if (!m) console.warn('document.modelContext is not available in this browser, the tools are only reachable from this page')
  else if (typeof m.addEventListener === 'function') m.addEventListener('toolchange', onToolChange)
  else if ('ontoolchange' in m) m.ontoolchange = onToolChange
  for (const t of baseTools()) await register(t)
  const accepted = [...new Set([...registry.values()].flatMap(t => t.accepted || []))]
  logEvent(m ? `Registered ${registry.size} tools with document.modelContext.registerTool${accepted.length ? ' · annotations accepted: ' + accepted.join(', ') : ''}` : 'document.modelContext is not available in this browser: tools are only reachable from this page')
  window.showme = {
    state: () => ({ target: walk ? walk.target : null, step: walk ? walk.step : 0, run: walk && walk.run ? { index: walk.run.index, status: walk.run.status } : null }),
  }
}
