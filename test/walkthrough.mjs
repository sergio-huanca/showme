import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { serve } from '../serve.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shots = join(root, 'test', 'shots')
await mkdir(shots, { recursive: true })
const { server, port } = await serve(root)
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1 })
page.on('console', m => { if (m.type() === 'error') console.error('console error:', m.text()) })

let n = 0
const shot = name => page.screenshot({ path: join(shots, `${String(++n).padStart(2, '0')}-${name}.png`) })
const run = (name, input) => page.evaluate(async ([t, i]) => {
  const mc = document.modelContext
  const tool = (await mc.getTools()).find(x => x.name === t)
  if (!tool) return { ok: false, error: 'not registered with the browser: ' + t }
  const out = await mc.executeTool(tool, JSON.stringify(i))
  return typeof out === 'string' ? JSON.parse(out) : out
}, [name, input || {}])
const toolNames = () => page.evaluate(async () => (await document.modelContext.getTools()).map(t => t.name))
const click = id => page.click(`[data-guide="${id}"]`)
const sel = id => `[data-guide="${id}"]`
const plan = (...ids) => ids.map(id => ({ element_id: id, message: `Now ${id.split('.').pop().replace(/-/g, ' ')}.` }))

function start(input) {
  const p = run('run_walkthrough', input)
  p.catch(e => console.error('run_walkthrough rejected:', e.message.split('\n')[0]))
  return p
}

async function act(id, fn) {
  try {
    await page.waitForFunction(id => {
      const s = window.showme.state()
      return s.target === id && s.run && s.run.status === 'in_progress'
    }, id, { timeout: 8000 })
  } catch {
    throw new Error(`no spotlight on ${id}; state=${JSON.stringify(await page.evaluate(() => window.showme.state()))}`)
  }
  await page.waitForTimeout(400)
  await shot(id.replace(/[^a-z0-9]+/gi, '-'))
  try { await fn() } catch (e) { throw new Error(`step ${id}: ${e.message.split('\n')[0]}`) }
}

async function typeEnter(id, text) {
  await page.type(sel(id), text, { delay: 30 })
  await page.press(sel(id), 'Enter')
}

try {
  await page.addInitScript({ path: join(root, 'vendor', 'webmcp-polyfill.js') })
  await page.goto(`http://localhost:${port}/`)
  await page.waitForFunction(() => window.showme)
  assert.deepEqual(await toolNames(), ['get_ui_map', 'get_current_view', 'run_walkthrough', 'do_step_for_person'])
  await shot('board')

  const map = await run('get_ui_map')
  assert.ok(map.screens.some(s => s.id === 'board-settings'))
  const configure = map.screens.find(s => s.id === 'board').elements.find(e => e.id === 'board.more.configure')
  assert.equal(configure.inside_menu, 'board.more')
  assert.equal(configure.opens, 'board-settings')
  assert.equal(configure.visible, false)
  assert.ok(map.dialogs.some(d => d.id === 'issue' && d.elements.some(e => e.id === 'issue.labels')))

  const bad = await run('run_walkthrough', { steps: plan('board.more', 'nope.nothing') })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /nope\.nothing/)
  const blockedAtStart = await run('run_walkthrough', { steps: plan('board.more.configure') })
  assert.equal(blockedAtStart.status, 'blocked')
  assert.match(blockedAtStart.reason, /board\.more/)
  await run('end_walkthrough')

  let running = start({ steps: plan('board.more', 'board.more.configure', 'boardsettings.tab.columns', 'boardsettings.columns.add', 'boardsettings.columns.name', 'boardsettings.columns.create') })
  await act('board.more', () => click('board.more'))
  assert.ok((await toolNames()).includes('end_walkthrough'))
  await act('board.more.configure', () => click('board.more.configure'))
  await page.click('#agent-activity-btn')
  await page.waitForTimeout(700)
  assert.equal(await page.locator('.agent-drawer .tools li').count(), 5)
  const aligned = await page.evaluate(() => {
    const spot = document.querySelector('.showme-spot')
    const r = document.querySelector('[data-guide="boardsettings.tab.columns"]').getBoundingClientRect()
    return !spot.hidden && Math.abs(parseFloat(spot.style.left) - (r.left - 6)) < 2 && Math.abs(parseFloat(spot.style.top) - (r.top - 6)) < 2
  })
  assert.ok(aligned, 'spotlight follows the Columns tab after the drawer opens')
  const mapBefore = Number(/(\d+) elements/.exec(await page.textContent('.agent-drawer .map'))[1])
  assert.ok(mapBefore > 100, 'map line shows a real element count')
  await shot('drawer')
  await act('boardsettings.tab.columns', () => click('boardsettings.tab.columns'))
  await act('boardsettings.columns.add', () => click('boardsettings.columns.add'))
  await act('boardsettings.columns.name', () => page.type(sel('boardsettings.columns.name'), 'Code Review', { delay: 40 }))
  await act('boardsettings.columns.create', () => page.click('[data-screen="board-settings"] h1'))
  let r = await running
  assert.equal(r.status, 'interrupted')
  assert.equal(r.completed_steps.length, 5)
  assert.match(r.completed_steps[4].action, /Code Review/)
  assert.match(r.reason, /somewhere else.*board-settings/)
  assert.equal(r.now.screen.id, 'board-settings')
  await shot('clicked-elsewhere')

  running = start({ steps: plan('boardsettings.columns.create') })
  await act('boardsettings.columns.create', () => click('boardsettings.columns.create'))
  r = await running
  assert.equal(r.status, 'completed')
  assert.ok(r.now.app_state.board_columns.includes('Code Review'))
  await page.waitForTimeout(600)
  const mapAfter = Number(/(\d+) elements/.exec(await page.textContent('.agent-drawer .map'))[1])
  assert.ok(mapAfter > mapBefore, `map grew after adding a column (${mapBefore} -> ${mapAfter})`)
  await page.click('.agent-drawer .mapdump summary')
  await page.waitForFunction(() => document.querySelector('.agent-drawer .mapdump pre').textContent.length > 100)
  assert.match(await page.textContent('.agent-drawer .mapdump pre'), /"board\.more"/)
  await page.click('.agent-drawer .mapdump summary')
  await shot('column-added')

  const refused = await run('do_step_for_person', { element_id: 'boardsettings.columns.create' })
  assert.equal(refused.refused, true)
  const danger = await run('do_step_for_person', { element_id: 'boardsettings.columns.delete.backlog' })
  assert.equal(danger.refused, true)
  assert.match(danger.reason, /irreversible/)
  const typed = await run('do_step_for_person', { element_id: 'nav.search', value: 'ATL-131' })
  assert.equal(typed.ok, true)
  assert.equal(await page.inputValue('#global-search'), 'ATL-131')
  const navigated = await run('do_step_for_person', { element_id: 'boardsettings.tab.general' })
  assert.equal(navigated.ok, true)
  assert.equal(navigated.now.panel, 'general')

  const chunk = await run('run_walkthrough', { steps: plan('boardsettings.tab.swimlanes'), timeout_seconds: 1 })
  assert.equal(chunk.status, 'in_progress')
  assert.equal(chunk.current_step.element_id, 'boardsettings.tab.swimlanes')
  assert.equal(chunk.current_step.number, 1)
  running = start({})
  await act('boardsettings.tab.swimlanes', () => click('boardsettings.tab.swimlanes'))
  r = await running
  assert.equal(r.status, 'completed')

  const ended = await run('end_walkthrough')
  assert.equal(ended.ok, true)
  assert.ok(!(await toolNames()).includes('end_walkthrough'))
  const nothing = await run('run_walkthrough', {})
  assert.equal(nothing.ok, false)
  await shot('ended')

  await page.click(sel('boardsettings.back'))
  await page.waitForFunction(() => !document.querySelector('[data-screen="board"]').hidden)
  running = start({ title: 'Email all watchers when an issue is assigned', steps: plan('sidebar.project.more', 'sidebar.project.settings', 'projectsettings.tab.notifications', 'projectsettings.notifications.edit.assigned', 'notif.recipient.all-watchers', 'notif.save') })
  await act('sidebar.project.more', () => click('sidebar.project.more'))
  await act('sidebar.project.settings', () => click('sidebar.project.settings'))
  await act('projectsettings.tab.notifications', () => click('projectsettings.tab.notifications'))
  await act('projectsettings.notifications.edit.assigned', () => click('projectsettings.notifications.edit.assigned'))
  await act('notif.recipient.all-watchers', () => page.click('label:has([data-guide="notif.recipient.all-watchers"])'))
  await act('notif.save', () => click('notif.save'))
  r = await running
  assert.equal(r.status, 'completed')
  assert.equal(r.completed_steps[4].action, 'checked')
  assert.ok(r.now.app_state.notification_recipients['Issue assigned'].includes('All watchers'))
  assert.equal(r.learned_path.length, 6)
  assert.ok(r.learned_path.includes('Project settings'))
  await run('end_walkthrough')
  await page.waitForTimeout(300)
  assert.match(await page.textContent('.agent-drawer .learned'), /Email all watchers when an issue is assigned/)
  await shot('notifications-saved')

  await page.click(sel('sidebar.filters'))
  await page.waitForFunction(() => !document.querySelector('[data-screen="filters"]').hidden)
  assert.equal((await run('get_current_view')).screen.id, 'filters')
  await page.click(sel('sidebar.board.kanban'))
  await page.waitForFunction(() => !document.querySelector('[data-screen="board"]').hidden)

  const closedDialog = await run('run_walkthrough', { steps: plan('issue.labels') })
  assert.equal(closedDialog.status, 'blocked')
  assert.match(closedDialog.reason, /"issue" dialog/)
  await run('end_walkthrough')

  running = start({ steps: plan('card.ATL-136', 'issue.details', 'issue.labels', 'issue.type', 'issue.type.bug', 'issue.watch', 'issue.watch.add', 'issue.watchers.input', 'issue.close') })
  await act('card.ATL-136', () => click('card.ATL-136'))
  await act('issue.details', () => click('issue.details'))
  await act('issue.labels', () => typeEnter('issue.labels', 'needs-design'))
  await act('issue.type', () => click('issue.type'))
  await act('issue.type.bug', () => click('issue.type.bug'))
  await act('issue.watch', () => click('issue.watch'))
  await act('issue.watch.add', () => click('issue.watch.add'))
  await act('issue.watchers.input', async () => {
    const noLabels = await run('do_step_for_person', { element_id: 'issue.labels', value: 'x' })
    assert.equal(noLabels.refused, true)
    await typeEnter('issue.watchers.input', 'Ana K')
  })
  await act('issue.close', async () => {
    const view = await run('get_current_view')
    assert.ok(view.app_state.open_issue.labels.includes('needs-design'))
    assert.equal(view.app_state.open_issue.type, 'bug')
    assert.ok(view.app_state.open_issue.watchers.includes('Ana K.'))
    await shot('issue-panel')
    await click('issue.close')
  })
  r = await running
  assert.equal(r.status, 'completed')
  assert.equal(r.now.open_dialog, null)
  assert.equal(await page.locator('.card[data-open-issue="ATL-136"] .type.bug').count(), 1)
  assert.equal(await page.locator('.card[data-open-issue="ATL-136"] .chip:has-text("needs-design")').count(), 1)
  await run('end_walkthrough')
  await shot('board-after-issue')

  const apiCalls = []
  await page.route('https://api.anthropic.com/v1/messages', route => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    apiCalls.push({ headers: route.request().headers(), body: route.request().postDataJSON() })
    const reply = apiCalls.length === 1
      ? { content: [{ type: 'text', text: 'Let me show you.' }, { type: 'tool_use', id: 'toolu_1', name: 'run_walkthrough', input: { steps: [{ element_id: 'board.more', message: 'Click the three dots.' }] } }], stop_reason: 'tool_use' }
      : { content: [{ type: 'text', text: 'Done, that is the menu.' }], stop_reason: 'end_turn' }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(reply) })
  })
  await page.click('.agent-drawer .console summary')
  await page.fill('.agent-drawer .key', 'sk-ant-api-test')
  await page.fill('.agent-drawer textarea', 'How do I configure the board?')
  await page.click('.agent-drawer .send')
  await act('board.more', () => click('board.more'))
  await page.waitForSelector('.agent-drawer .msg:has-text("Done, that is the menu.")')
  assert.equal(apiCalls.length, 2)
  assert.equal(apiCalls[0].headers['x-api-key'], 'sk-ant-api-test')
  assert.equal(apiCalls[0].body.model, 'claude-opus-5')
  assert.equal(apiCalls[0].body.fallbacks, 'default')
  assert.ok(apiCalls[0].body.tools.some(x => x.name === 'run_walkthrough'))
  const last = apiCalls[1].body.messages.at(-1)
  assert.equal(last.content[0].type, 'tool_result')
  assert.equal(JSON.parse(last.content[0].content).status, 'completed')
  assert.ok(apiCalls[1].body.tools.some(x => x.name === 'end_walkthrough'))
  assert.equal(await page.getAttribute('.agent-drawer .console', 'data-via'), 'document.modelContext')
  await page.waitForTimeout(500)
  await shot('console')

  await page.setViewportSize({ width: 820, height: 900 })
  const drawerOpen = () => page.evaluate(() => !document.querySelector('.agent-drawer').hidden)
  const setDrawer = async open => { if ((await drawerOpen()) !== open) await page.click('#agent-activity-btn') }
  await setDrawer(false)
  await page.goto(`http://localhost:${port}/#board`)
  await page.reload()
  await page.waitForFunction(() => window.showme)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert.ok(overflow <= 0, `no horizontal page overflow at 820px (got ${overflow})`)
  assert.equal(await page.evaluate(() => document.querySelector('.sidebar').getClientRects().length), 0)
  await shot('narrow-board')
  const closedSidebar = await run('run_walkthrough', { steps: plan('sidebar.project.more') })
  assert.equal(closedSidebar.status, 'blocked')
  assert.match(closedSidebar.reason, /nav\.menu/)
  await run('end_walkthrough')
  await click('nav.menu')
  assert.ok(await page.evaluate(() => document.querySelector('.sidebar').getClientRects().length > 0))
  await shot('narrow-sidebar')
  await click('sidebar.project.more')
  await click('sidebar.project.settings')
  await page.waitForFunction(() => !document.querySelector('[data-screen="project-settings"]').hidden)
  await setDrawer(true)
  await page.waitForTimeout(300)
  await shot('narrow-settings-drawer')
  await setDrawer(false)
  await page.click(sel('nav.menu'))
  await click('sidebar.board.kanban')
  await page.waitForFunction(() => !document.querySelector('[data-screen="board"]').hidden)
  await click('card.ATL-136')
  await page.waitForTimeout(300)
  await shot('narrow-issue')
  await setDrawer(true)
  await page.waitForTimeout(300)
  const modalRight = await page.evaluate(() => document.querySelector('#issue-modal .modal').getBoundingClientRect().right)
  assert.ok(modalRight <= 820 - 340, `issue panel stays clear of the drawer at 820px (right edge ${Math.round(modalRight)})`)
  await shot('narrow-issue-drawer')

  console.log(`PASS  ${n} screenshots in test/shots`)
} finally {
  await browser.close()
  server.close()
}
