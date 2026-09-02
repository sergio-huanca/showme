const mc = document.modelContext
const registry = new Map()
const calls = []
const shownAt = new Map()
const lastAction = new Map()
let app = { app: 'this app', state: () => ({}) }
let walk = null
let pending = null
let ui, spot, caption, cursor, drawer

const HOW = [
  'You are guiding a person who wants to learn where things are. You show, they click.',
  'Plan the shortest path from the current screen with the ids below. Elements with inside_menu need that menu opened first. Screens are reached through elements whose "opens" names the screen.',
  'For every step call highlight_step with one short friendly sentence, then wait_for_action on the same element. One step at a time, never several highlights in a row.',
  'Read what wait_for_action returns before the next step. done:false explains why; adapt instead of repeating the same step.',
  'Only call do_step_for_person when the person explicitly asks you to do a step for them. Most steps are theirs by policy and the tool will say so.',
  'When the task is complete call end_walkthrough and tell the person the path in one line so they remember it next time.',
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
  if (el.closest('.menu')) return 'menu item'
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
    current: !s.hidden,
    panels: [...s.querySelectorAll('[data-panel]')].map(p => ({ id: p.dataset.panel, what: p.dataset.panelDesc, current: !p.hidden })),
    elements: [...s.querySelectorAll('[data-guide]')].map(describe),
  }))
  const global = [...document.querySelectorAll('[data-guide]')].filter(el => !el.closest('[data-screen]')).map(describe)
  return { app: app.app, how_to_guide: HOW, screens, always_available: global }
}

function view() {
  const s = [...document.querySelectorAll('[data-screen]')].find(x => !x.hidden)
  const p = s && [...s.querySelectorAll('[data-panel]')].find(x => !x.hidden)
  const menu = document.querySelector('.menu:not([hidden])')
  const dialog = [...document.querySelectorAll('[data-dialog]')].find(x => !x.hidden)
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
  const dialog = el.closest('[data-dialog]')
  if (dialog && dialog.hidden) return `"${id}" lives in the "${dialog.dataset.dialog}" dialog, which is not open. It opens from an Edit button on the Notifications page.`
  const screen = el.closest('[data-screen]')
  if (screen && screen.hidden) return `"${id}" is on the "${screen.dataset.screen}" screen and the person is on "${view().screen?.id}". Guide them there first through an element whose "opens" is "${screen.dataset.screen}".`
  const panel = el.closest('[data-panel]')
  if (panel && panel.hidden) return `"${id}" is in the "${panel.dataset.panel}" panel, which is not selected. Guide them to the "${panel.dataset.panel}" tab first.`
  return `"${id}" exists but is not visible right now. It probably appears after another action, for example Add column reveals the name field.`
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
  const r = walk.el.getBoundingClientRect()
  const pad = 6
  spot.style.top = r.top - pad + 'px'
  spot.style.left = r.left - pad + 'px'
  spot.style.width = r.width + pad * 2 + 'px'
  spot.style.height = r.height + pad * 2 + 'px'
  const cw = caption.offsetWidth, ch = caption.offsetHeight
  const below = r.bottom + 14 + ch < window.innerHeight
  caption.style.top = (below ? r.bottom + 14 : r.top - ch - 14) + 'px'
  caption.style.left = Math.max(8, Math.min(r.left, window.innerWidth - cw - 8)) + 'px'
  const pos = `translate(${r.left + r.width * 0.6}px, ${r.top + r.height * 0.55}px)`
  cursor.style.setProperty('--pos', pos)
  cursor.style.transform = pos
}

function startWalk() {
  const end = new AbortController()
  walk = { step: 0, target: null, el: null, end }
  register(endTool, { signal: end.signal })
  requestAnimationFrame(place)
}

function clearSpot() {
  spot.hidden = true
  caption.hidden = true
  cursor.classList.remove('on')
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
  clearSpot()
  if (pending) pending.cancel('the walkthrough ended: ' + reason)
  if (walk) walk.end.abort()
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
  caption.querySelector('.step').textContent = `Step ${walk.step}`
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
  if (pending) pending.cancel('a newer wait_for_action replaced it')
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
      const inside = el.contains(e.target) || (label && label.contains(el)) || ui.contains(e.target) || drawer.contains(e.target)
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
      note: `No action after ${seconds}s. The highlight stays on. Call wait_for_action again with the same element_id if the person is still on this step.`,
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
  if ('guideDanger' in el.dataset) return { ok: false, refused: true, reason: `${app.app} policy: "${desc(el)}" is irreversible and is never done by an agent. Guide the person with highlight_step and wait_for_action instead.` }
  if (!('guideDelegable' in el.dataset)) return { ok: false, refused: true, reason: `${app.app} policy: "${desc(el)}" is a change the person makes themselves. Agents may only navigate and type into search boxes here. Guide them with highlight_step and wait_for_action instead.` }
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

const objSchema = (props = {}, required = []) => ({ type: 'object', properties: props, ...(required.length ? { required } : {}) })
const elementId = { type: 'string', description: 'Element id from get_ui_map, for example board.more' }

const baseTools = [
  {
    name: 'get_ui_map',
    description: 'Map of every screen, panel, menu and interactive element of Meridian, with the ids the other tools accept and short instructions on how to guide. Call it once at the start of a guide. Read-only.',
    inputSchema: objSchema(),
    annotations: { readOnlyHint: true },
    execute: uiMap,
  },
  {
    name: 'get_current_view',
    description: 'Where the person is right now: current screen and panel, any open menu or dialog, which element ids are visible, the state of the walkthrough, and a snapshot of app data such as board columns and notification recipients. Read-only.',
    inputSchema: objSchema(),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: view,
  },
  {
    name: 'highlight_step',
    description: 'Dim the page and put a spotlight on one element with a short message for the person. Use it for each step of a guide, then call wait_for_action on the same element. If the element is not visible yet it explains what to do first.',
    inputSchema: objSchema({
      element_id: elementId,
      message: { type: 'string', description: 'One short friendly sentence telling the person what to do, e.g. "Click the three dots at the right of the toolbar."' },
      step: { type: 'integer', description: 'Step number to show. Defaults to the next number.' },
    }, ['element_id', 'message']),
    execute: highlight,
  },
  {
    name: 'wait_for_action',
    description: 'Wait until the person clicks, ticks or types into the highlighted element. Returns done:true with the new view when they do it, or done:false with a reason when they click somewhere else, the element disappears, or nothing happens for timeout_seconds (default 45, then call it again). Read the result before choosing the next step.',
    inputSchema: objSchema({
      element_id: elementId,
      timeout_seconds: { type: 'integer', description: 'How long to wait before returning "still waiting". Default 45.' },
    }, ['element_id']),
    execute: waitFor,
  },
  {
    name: 'do_step_for_person',
    description: 'Perform one step on behalf of the person, only when they explicitly ask you to. Meridian allows this for navigation and search boxes and refuses configuration changes, which the person makes themselves. Returns refused:true with the policy when not allowed.',
    inputSchema: objSchema({
      element_id: elementId,
      value: { type: 'string', description: 'Text to type when the element is a text field' },
    }, ['element_id']),
    execute: doStep,
  },
]

const endTool = {
  name: 'end_walkthrough',
  description: 'Finish the current guide: removes the spotlight and the message. Call it when the task is complete or the person wants to stop. Only exists while a walkthrough is active.',
  inputSchema: objSchema(),
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
    annotations: def.annotations,
    execute: async (input, ctx) => {
      const c = { name: def.name, input: input || {}, at: new Date(), who: 'agent' }
      calls.unshift(c)
      renderCalls()
      let out
      try { out = await def.execute(input || {}, ctx || {}) }
      catch (e) { out = { ok: false, error: e.message } }
      c.out = out
      renderCalls()
      return JSON.stringify(out)
    },
  }
  registry.set(def.name, entry)
  if (opts.signal) opts.signal.addEventListener('abort', () => { registry.delete(def.name); renderTools() })
  if (mc) await mc.registerTool(entry, opts)
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

function buildDrawer() {
  drawer = document.createElement('aside')
  drawer.className = 'agent-drawer'
  drawer.hidden = true
  drawer.innerHTML = `<header><span class="dot"></span>Agent activity<button class="icon-btn" title="Close"><svg><use href="#i-x"/></svg></button></header>
<h3>Tools the agent can see right now</h3>
<ul class="tools"></ul>
<h3>Calls</h3>
<div class="empty">No calls yet. Ask your agent how to do something in Meridian.</div>
<ul class="calls"></ul>`
  drawer.querySelector('header .icon-btn').addEventListener('click', () => { drawer.hidden = true; document.body.classList.remove('drawer-open') })
  document.body.appendChild(drawer)
}

const tagFor = t => {
  if (t.annotations && t.annotations.readOnlyHint) return '<span class="tag ro">read-only</span>'
  if (t.name === 'wait_for_action') return '<span class="tag wait">waits for you</span>'
  if (t.name === 'end_walkthrough') return '<span class="tag guide">guide only</span>'
  if (t.name === 'do_step_for_person') return '<span class="tag">policy gated</span>'
  return ''
}

async function renderTools() {
  if (!drawer || drawer.hidden) return
  let list
  try { list = (await mc.getTools()).map(t => ({ name: t.name, annotations: t.annotations })) }
  catch { list = [...registry.values()] }
  const ul = drawer.querySelector('.tools')
  const known = new Set([...ul.children].map(li => li.dataset.name))
  ul.innerHTML = list.map(t => `<li data-name="${t.name}" class="${known.size && !known.has(t.name) ? 'new' : ''}">${t.name}${tagFor(t)}</li>`).join('')
}

function renderCalls() {
  if (!drawer) return
  drawer.querySelector('.empty').hidden = calls.length > 0
  drawer.querySelector('.calls').innerHTML = calls.slice(0, 40).map(c => {
    const bad = c.out && (c.out.ok === false || c.out.done === false)
    const t = c.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    return `<li><span class="who">${t} · ${c.who}</span><br><span class="name">${c.name}</span>(${short(c.input).replace(/^\{\}$/, '')})<div class="res${bad ? ' bad' : ''}">${c.out ? short(c.out) : '…'}</div></li>`
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

export function toggleDrawer() {
  drawer.hidden = !drawer.hidden
  document.body.classList.toggle('drawer-open', !drawer.hidden)
  if (!drawer.hidden) { renderTools(); renderCalls() }
}

export async function startGuide(opts) {
  app = { ...app, ...opts }
  buildOverlay()
  buildDrawer()
  trackActions()
  if (!mc) console.warn('document.modelContext is not available, the guide tools were not registered')
  else mc.addEventListener('toolchange', renderTools)
  for (const t of baseTools) await register(t)
  window.showme = {
    run: async (name, input) => {
      const entry = registry.get(name)
      if (!entry) return { ok: false, error: 'unknown tool ' + name }
      return JSON.parse(await entry.execute(input || {}, {}))
    },
    tools: () => [...registry.values()].map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    drawer: () => drawer,
    log: (name, input, out, who) => { calls.unshift({ name, input, out, at: new Date(), who }); renderCalls() },
  }
  return window.showme
}
