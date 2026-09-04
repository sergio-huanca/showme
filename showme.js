const mc = () => document.modelContext
const registry = new Map()
const calls = []
let listedNames = null
const stats = { toolchange: 0 }
const shownAt = new Map()
const lastAction = new Map()
let app = { app: 'this app', state: () => ({}), auto: true }
let walk = null
let pending = null
let ui, root, spot, caption, cursor, drawer

const HOW = [
  'You are guiding a person who wants to learn where things are. You show, they click.',
  'Plan the whole path from the current screen with the ids below, then call run_walkthrough once with every step. An element that is not visible says where it is and, in open_first, which element to click first; put that click in an earlier step. Screens are reached through elements whose "opens" names the screen.',
  'The page paces the person: each spotlight appears the instant they finish the previous step, so do not split the path into several calls.',
  'If run_walkthrough returns in_progress, the guide is still running on the page without you. Reply to the person: tell them to follow the spotlight and to tell you when they are done. Do not call run_walkthrough again in a loop. When they say they are done, call it once without steps to get the result.',
  'Wrong clicks are handled on the page: it nudges the person, and if they leave the screen it rewinds to the last step they can still see. You only get interrupted or blocked when the path is truly lost. Then read reason and now, and call run_walkthrough again with steps that start from an element in now.visible_elements.',
  'Only call do_step_for_person when the person explicitly asks you to do a step for them. Most steps are theirs by policy and the tool will say so.',
  'When the walkthrough is completed, tell the person the path in one line so they remember it next time, and call end_walkthrough.',
]

function q(id) {
  const el = document.querySelector(`[data-guide="${CSS.escape(id)}"]`)
  if (el || !app.auto) return el
  let a = autoIds.get(id)
  if (!a || !a.isConnected) { autoScan(); a = autoIds.get(id) }
  return a || null
}
const visible = el => !!el && el.getClientRects().length > 0
const sleep = ms => new Promise(r => setTimeout(r, ms))
const desc = el => el.dataset.guideDesc || accName(el)
const idOf = el => el ? el.dataset.guide || autoIdOf.get(el) || null : null
const delegable = el => 'guideDelegable' in el.dataset || !!(app.delegable && el.matches(app.delegable))
const danger = el => 'guideDanger' in el.dataset || !!(app.danger && el.matches(app.danger))
const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
const DIALOGS = '[data-dialog], dialog, [role=dialog], [role=alertdialog]'
const INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], [role=switch], [role=checkbox], [role=link]'
let autoIds = new Map(), autoIdOf = new Map()

function accName(el) {
  const by = el.getAttribute('aria-labelledby')
  if (by) {
    const t = by.split(/\s+/).map(i => document.getElementById(i)?.textContent.trim()).filter(Boolean).join(' ')
    if (t) return t
  }
  const al = el.getAttribute('aria-label')
  if (al && al.trim()) return al.trim()
  if (el.matches('input, select, textarea')) {
    const lab = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label')
    const t = lab && lab.textContent.trim().replace(/\s+/g, ' ')
    if (t) return t
    if (el.placeholder) return el.placeholder
  }
  const t = (el.matches('input[type=submit], input[type=button]') ? el.value : el.textContent).trim().replace(/\s+/g, ' ')
  return t || el.title || el.getAttribute('alt') || el.querySelector('img[alt]')?.alt || ''
}

function autoScan() {
  autoIds = new Map(); autoIdOf = new Map()
  if (!app.auto) return
  const seen = new Map()
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (el.disabled || el.closest('[data-guide]')) continue
    const name = accName(el)
    if (!name || name.length > 120) continue
    if (!visible(el) && !containerOf(el)) continue
    let id = kind(el).replace(/ /g, '-') + ':' + slug(name)
    const n = (seen.get(id) || 0) + 1
    seen.set(id, n)
    if (n > 1) id += '-' + n
    autoIds.set(id, el)
    autoIdOf.set(el, id)
  }
}

function guidedNodes(root) {
  autoScan()
  return [...root.querySelectorAll('[data-guide]'), ...[...autoIds.values()].filter(el => el !== root && root.contains(el))]
}

function openerOf(n) {
  if (n.id) {
    const o = document.querySelector(`[aria-controls~="${CSS.escape(n.id)}"], [popovertarget="${CSS.escape(n.id)}"]`)
    if (o) return o
  }
  const by = n.getAttribute('aria-labelledby')
  const tab = by && document.getElementById(by.split(/\s+/)[0])
  return tab && tab.matches('[role=tab]') ? tab : null
}

function containerOf(el) {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    if (n.matches('details') && !n.open && !el.closest('summary')) {
      const sum = n.querySelector(':scope > summary')
      return { where: `in the collapsed "${sum ? accName(sum) : 'section'}" section`, opener: idOf(sum) }
    }
    if (visible(n)) continue
    if (n.dataset.menu) return { where: 'in a menu', opener: n.dataset.menu }
    if (n.matches('[role=menu]')) return { where: 'in a menu', opener: idOf(openerOf(n)) }
    if (n.dataset.dialog !== undefined) return { where: `in the "${n.dataset.dialog}" dialog`, opener: idOf(openerOf(n)) }
    if (n.matches('dialog, [role=dialog], [role=alertdialog]')) return { where: `in the "${accName(n) || 'dialog'}" dialog`, opener: idOf(openerOf(n)) }
    if (n.dataset.panel) return { where: `in the "${n.dataset.panel}" panel`, opener: idOf(openerOf(n)) }
    if (n.matches('[role=tabpanel]')) return { where: `in the "${accName(n)}" tab`, opener: idOf(openerOf(n)) }
    if (n.dataset.region) return { where: `in the ${n.dataset.region}`, opener: n.dataset.regionOpener }
    if (n.dataset.screen) {
      const g = document.querySelector(`[data-guide-goto="${CSS.escape(n.dataset.screen)}"]`)
      return { where: `on the "${n.dataset.screen}" screen`, opener: g ? g.dataset.guide : null }
    }
    const t = openerOf(n)
    if (t) return { where: `in the collapsed "${accName(t)}" section`, opener: idOf(t) }
  }
  return null
}

const dialogId = d => d.dataset.dialog !== undefined ? d.dataset.dialog : d.id || slug(accName(d)) || 'dialog'

function kind(el) {
  const t = el.tagName.toLowerCase()
  if (t === 'input') return el.type === 'checkbox' || el.type === 'radio' ? 'checkbox' : el.type === 'search' ? 'search box' : 'text field'
  if (t === 'select') return 'dropdown'
  if (t === 'textarea') return 'text field'
  if (t === 'summary') return 'section header'
  if (el.closest('[data-menu], [role=menu]')) return 'menu item'
  if (el.matches('[role=tab]')) return 'tab'
  if (t === 'a') return el.classList.contains('tab') ? 'tab' : 'link'
  return 'button'
}

function describe(el) {
  const d = { id: idOf(el), what: desc(el), kind: kind(el), visible: visible(el) }
  if (el.dataset.guideGoto) d.opens = el.dataset.guideGoto
  else if (!el.dataset.guide && el.matches('a[href]') && !/^#?$/.test(el.getAttribute('href'))) {
    const u = new URL(el.href, location.href)
    if (u.origin === location.origin && u.pathname + u.hash !== location.pathname + location.hash) d.opens = u.pathname + u.hash
  }
  if (el.dataset.guideMenu) d.inside_menu = el.dataset.guideMenu
  const panel = el.closest('[data-panel]')
  if (panel) d.panel = panel.dataset.panel
  const dialog = el.closest('[data-dialog]')
  if (dialog) d.inside_dialog = dialog.dataset.dialog
  if (!d.visible) {
    const c = containerOf(el)
    if (c) { d.where = c.where; if (c.opener) d.open_first = c.opener }
  }
  if (delegable(el)) d.agent_may_do_this = true
  if (danger(el)) d.irreversible = true
  return d
}

function uiMap() {
  const screenNodes = [...document.querySelectorAll('[data-screen]')]
  const dialogNodes = [...document.querySelectorAll(DIALOGS)].filter(d => d.dataset.dialog !== undefined || !d.parentElement.closest(DIALOGS))
  const screens = screenNodes.length ? screenNodes.map(s => ({
    id: s.dataset.screen,
    title: s.querySelector('h1')?.textContent.trim() || s.dataset.screen,
    what: s.dataset.screenDesc,
    current: visible(s),
    panels: [...s.querySelectorAll('[data-panel]')].map(p => ({ id: p.dataset.panel, what: p.dataset.panelDesc, current: visible(p) })),
    elements: guidedNodes(s).map(describe),
  })) : [{
    id: location.pathname + location.hash,
    title: document.querySelector('h1')?.textContent.trim() || document.title,
    current: true,
    elements: guidedNodes(document.body).filter(el => !el.closest(DIALOGS)).map(describe),
  }]
  const dialogs = dialogNodes.map(d => ({
    id: dialogId(d),
    what: d.dataset.dialogDesc || (d.dataset.dialog === undefined ? accName(d) : undefined),
    open: visible(d),
    elements: guidedNodes(d).map(describe),
  }))
  const global = screenNodes.length ? guidedNodes(document.body).filter(el => !el.closest('[data-screen]') && !el.closest(DIALOGS)).map(describe) : []
  return { app: app.app, how_to_guide: HOW, screens, dialogs, always_available: global }
}

function view() {
  const hasScreens = !!document.querySelector('[data-screen]')
  const s = [...document.querySelectorAll('[data-screen]')].find(visible)
  const p = s && [...s.querySelectorAll('[data-panel]')].find(visible)
  const menu = [...document.querySelectorAll('[data-menu], [role=menu]')].find(visible)
  const dialog = [...document.querySelectorAll(DIALOGS)].find(visible)
  return {
    screen: s ? { id: s.dataset.screen, title: s.querySelector('h1')?.textContent.trim() } : hasScreens ? null : { id: location.pathname + location.hash, title: document.querySelector('h1')?.textContent.trim() || document.title },
    panel: p ? p.dataset.panel : null,
    open_menu: menu ? menu.dataset.menu || idOf(openerOf(menu)) || accName(menu) || 'menu' : null,
    open_dialog: dialog ? dialogId(dialog) : null,
    visible_elements: guidedNodes(document.body).filter(visible).map(idOf),
    walkthrough: walk ? { active: true, step: walk.step, highlighted: walk.target } : { active: false },
    app_state: app.state(),
  }
}

function whyHidden(el) {
  const id = idOf(el)
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
  if (toggle && idOf(toggle)) return `"${id}" is inside the collapsed "${toggle.textContent.trim()}" section. Guide the person to click "${idOf(toggle)}" first.`
  const c = containerOf(el)
  if (c) return `"${id}" is ${c.where}, which is not open. ${c.opener ? `Guide the person to click "${c.opener}" first.` : 'It opens after another action on this screen.'}`
  return `"${id}" exists but is not visible right now. It probably appears after another action on this screen, such as a button that reveals a form.`
}

function whatWasClicked(node) {
  const g = node.closest && node.closest('[data-guide]')
  if (g) return `"${g.dataset.guide}" (${desc(g)})`
  const a = node.closest && node.closest(INTERACTIVE)
  if (a && idOf(a)) return `"${idOf(a)}" (${desc(a)})`
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
    const onKey = e => { if (e.key === 'Enter' && el.value.trim()) done(`typed "${el.value.trim()}" and pressed Enter`) }
    const onInput = () => {
      clearTimeout(debounce)
      if (el.value.trim()) debounce = setTimeout(() => done(`typed "${el.value.trim()}"`), 900)
    }
    const onDown = e => {
      if (e.button) return
      const label = e.target.closest && e.target.closest('label')
      const neutral = app.neutral && e.target.closest && e.target.closest(app.neutral)
      const inside = el.contains(e.target) || (label && label.contains(el)) || ui.contains(e.target) || drawer.contains(e.target) || neutral
      if (!inside) nudge(whatWasClicked(e.target))
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

function nudge(what) {
  const run = walk && walk.run
  if (run) { run.detours.push({ step: run.index + 1, clicked: what }); run.lastClicked = what }
  caption.querySelector('.hint').textContent = 'Not that one. This one.'
  spot.classList.remove('nudge')
  void spot.offsetWidth
  spot.classList.add('nudge')
  logEvent(`You clicked ${what}. The guide kept waiting.`)
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
  if (danger(el)) return { ok: false, refused: true, reason: `${app.app} policy: "${desc(el)}" is irreversible and is never done by an agent. Guide the person with run_walkthrough instead.` }
  if (!delegable(el)) return { ok: false, refused: true, reason: `${app.app} policy: "${desc(el)}" is a change the person makes themselves. Agents may only navigate and type into search boxes here. Guide them with run_walkthrough instead.` }
  if (!visible(el)) return { ok: false, error: whyHidden(el) }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  await moveCursor(el)
  const typed = el.matches('input:not([type=checkbox]):not([type=radio]), textarea')
  if (typed) {
    el.focus()
    el.value = ''
    for (const ch of String(value ?? '')) {
      el.value += ch
      el.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(45)
    }
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else if (el.matches('select') && value != null) {
    el.value = value
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    el.click()
  }
  await sleep(300)
  if (!walk) cursor.classList.remove('on')
  return { ok: true, did: typed ? `typed "${value ?? ''}" into ${element_id}` : el.matches('select') && value != null ? `chose "${value}" in ${element_id}` : `clicked ${element_id}`, now: view() }
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

const rewindIndex = run => {
  for (let i = run.index - 1; i >= 0; i--) if (visible(q(run.steps[i].element_id))) return i
  return -1
}

async function drive(run) {
  let back = false
  while (run.index < run.steps.length && run.status === 'in_progress') {
    const step = run.steps[run.index]
    const el = q(step.element_id)
    if (!el) { finishRun(run, 'blocked', `No element with id "${step.element_id}" exists right now. Call get_ui_map to see the ids.`); return }
    const prev = run.results[run.index - 1]
    const prevEl = !back && prev && /pressed Enter$/.test(prev.action) && q(prev.element_id)
    if (prevEl && prevEl.form && prevEl.form === el.form && !visible(el)) {
      run.results.push({ element_id: step.element_id, action: 'submitted with Enter' })
      run.index++
      continue
    }
    const ready = run.index === 0 && !back ? visible(el) : await untilVisible(el, back ? 1500 : 6000)
    if (run.status !== 'in_progress') return
    if (!ready) {
      const i = back && run.detours.length < 12 ? rewindIndex(run) : -1
      if (i < 0) {
        finishRun(run, back ? 'interrupted' : 'blocked', back ? `The person left the path${run.lastClicked ? ' by clicking ' + run.lastClicked : ''} and none of the earlier steps is visible now.` : whyHidden(el))
        return
      }
      run.detours.push({ step: run.index + 1, clicked: run.lastClicked || null, rewound_to: i + 1 })
      logEvent(`You left the path at step ${run.index + 1}. The guide went back to step ${i + 1}.`)
      run.index = i
      run.results.length = i
      continue
    }
    await highlight({ element_id: step.element_id, message: (back ? 'Back on track. ' : '') + step.message, step: run.index + 1 })
    back = false
    let r
    do { r = await waitFor({ element_id: step.element_id, timeout_seconds: 600 }, {}) }
    while (r.done === false && r.reason === 'still waiting' && run.status === 'in_progress')
    if (run.status !== 'in_progress') return
    if (!r.done) {
      if (/disappeared/.test(r.reason)) { back = true; continue }
      finishRun(run, 'interrupted', r.reason)
      return
    }
    run.results.push({ element_id: step.element_id, action: r.action })
    run.index++
    await sleep(350)
  }
  finishRun(run, 'completed')
}

const NEXT = {
  in_progress: 'The walkthrough keeps running on the page without you. Reply to the person now: tell them to follow the spotlight and to tell you when they are done. Do not call run_walkthrough again in a loop; call it once without steps when they say they are done.',
  completed: 'Tell the person the path in one line and call end_walkthrough.',
  interrupted: 'The path was lost. Read reason and now. If the person wants to continue, call run_walkthrough again with steps that start from an element in now.visible_elements.',
  blocked: 'That step was not reachable when its turn came. Check now.visible_elements and call run_walkthrough with a corrected plan that starts from a visible element.',
}

function report(run) {
  return {
    status: run.status,
    steps_total: run.steps.length,
    completed_steps: run.results,
    detours: run.detours,
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
    walk.run = { title: title || '', steps: steps.map(x => ({ element_id: x.element_id, message: x.message || '' })), index: 0, results: [], detours: [], lastClicked: null, status: 'in_progress', reason: null, waiters: [] }
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
const elementId = { type: 'string', description: 'Element id from get_ui_map, for example nav.profile or button:confirm' }

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
    description: 'Guide the person through a whole path. Pass every step in order. The page spotlights each element with your message, waits for the person to click, tick or type, then moves to the next step by itself; wrong clicks are handled on the page. Returns completed, interrupted (they stopped or got lost), blocked (a step was not reachable when its turn came), or in_progress after timeout_seconds (default 40) while it keeps running.',
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
    description: `Perform one step on behalf of the person, only when they explicitly ask you to. ${app.app} allows it only for steps it marks as delegable, typically navigation and search boxes, and refuses the rest, which the person does themselves. Returns refused:true with the policy when not allowed.`,
    inputSchema: objSchema({
      element_id: elementId,
      value: { type: 'string', description: 'Text to type into a text field, or the option to choose in a dropdown' },
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
  root = ui.attachShadow({ mode: 'open' })
  root.innerHTML = `<link rel="stylesheet" href="${new URL('./showme.css', import.meta.url)}">
<div class="showme-spot" hidden></div>
<div class="showme-caption" hidden><span class="step"></span><button class="stop" title="Stop the guide"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button><div class="text"></div><span class="hint"></span></div>
<svg class="showme-cursor" viewBox="0 0 24 24"><path d="M5 3l14 8-6.5 1.6L9 19z" fill="#fff" stroke="#172b4d" stroke-width="1.6" stroke-linejoin="round"/></svg>`
  document.body.appendChild(ui)
  spot = root.querySelector('.showme-spot')
  caption = root.querySelector('.showme-caption')
  cursor = root.querySelector('.showme-cursor')
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
  root.appendChild(r)
}

function buildDrawer() {
  drawer = document.createElement('aside')
  drawer.className = 'agent-drawer'
  drawer.hidden = true
  drawer.innerHTML = `<header><span class="dot"></span>Agent activity<button class="icon-btn" title="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
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
  root.appendChild(drawer)
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
        completed: `completed, you did all ${o.steps_total} steps yourself${o.detours && o.detours.length ? `, ${o.detours.length} detour${o.detours.length === 1 ? '' : 's'} handled on the page` : ''}`,
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
    const g = e.target.closest && (e.target.closest('[data-guide]') || e.target.closest(INTERACTIVE))
    const id = idOf(g)
    if (id) lastAction.set(id, performance.now())
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
    root,
    state: () => ({ target: walk ? walk.target : null, step: walk ? walk.step : 0, run: walk && walk.run ? { index: walk.run.index, status: walk.run.status } : null }),
  }
}
