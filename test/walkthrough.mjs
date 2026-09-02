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
const run = (name, input) => page.evaluate(([t, i]) => window.showme.run(t, i), [name, input || {}])
const toolNames = () => page.evaluate(() => window.showme.tools().map(t => t.name))
const click = id => page.click(`[data-guide="${id}"]`)

async function step(id, message, act) {
  const h = await run('highlight_step', { element_id: id, message })
  assert.equal(h.ok, true, `highlight ${id}: ${h.error}`)
  await page.waitForTimeout(450)
  await shot(id.replace(/[^a-z0-9]+/gi, '-'))
  const waiting = run('wait_for_action', { element_id: id })
  waiting.catch(() => {})
  await page.waitForTimeout(120)
  try { await act() } catch (e) { throw new Error(`step ${id}: ${e.message.split('\n')[0]}`) }
  const r = await waiting
  assert.equal(r.done, true, `wait ${id}: ${r.reason}`)
  return r
}

try {
  await page.goto(`http://localhost:${port}/`)
  await page.waitForFunction(() => window.showme)
  assert.deepEqual(await toolNames(), ['get_ui_map', 'get_current_view', 'highlight_step', 'wait_for_action', 'do_step_for_person'])
  await shot('board')

  const map = await run('get_ui_map')
  assert.ok(map.screens.some(s => s.id === 'board-settings'))
  const configure = map.screens.find(s => s.id === 'board').elements.find(e => e.id === 'board.more.configure')
  assert.equal(configure.inside_menu, 'board.more')
  assert.equal(configure.opens, 'board-settings')
  assert.equal(configure.visible, false)

  const early = await run('highlight_step', { element_id: 'board.more.configure', message: 'too early' })
  assert.equal(early.ok, false)
  assert.match(early.error, /board\.more/)

  let r = await step('board.more', 'Click the three dots at the right of the toolbar.', () => click('board.more'))
  assert.equal(r.now.open_menu, 'board.more')
  assert.ok((await toolNames()).includes('end_walkthrough'))

  r = await step('board.more.configure', 'Choose Configure board.', () => click('board.more.configure'))
  assert.equal(r.now.screen.id, 'board-settings')

  await page.click('#agent-activity-btn')
  await page.waitForTimeout(400)
  assert.equal(await page.locator('.agent-drawer .tools li').count(), 6)
  await shot('drawer')

  r = await step('boardsettings.tab.columns', 'Open the Columns tab.', () => click('boardsettings.tab.columns'))
  assert.equal(r.now.panel, 'columns')

  r = await step('boardsettings.columns.add', 'Press Add column.', () => click('boardsettings.columns.add'))
  assert.ok(r.now.visible_elements.includes('boardsettings.columns.name'))

  r = await step('boardsettings.columns.name', 'Type the name: Code Review.', () => page.type('[data-guide="boardsettings.columns.name"]', 'Code Review', { delay: 40 }))
  assert.match(r.action, /Code Review/)

  let h = await run('highlight_step', { element_id: 'boardsettings.columns.create', message: 'Press Add to create it.' })
  assert.equal(h.ok, true)
  let waiting = run('wait_for_action', { element_id: 'boardsettings.columns.create' })
  await page.waitForTimeout(120)
  await page.click('[data-screen="board-settings"] h1')
  r = await waiting
  assert.equal(r.done, false)
  assert.match(r.reason, /somewhere else.*board-settings/)
  await shot('clicked-elsewhere')

  r = await step('boardsettings.columns.create', 'Press Add to create it.', () => click('boardsettings.columns.create'))
  assert.ok(r.now.app_state.board_columns.includes('Code Review'))
  await page.waitForTimeout(500)
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

  const slow = await run('wait_for_action', { element_id: 'boardsettings.tab.swimlanes', timeout_seconds: 1 })
  assert.equal(slow.done, false)
  assert.equal(slow.reason, 'still waiting')

  h = await run('highlight_step', { element_id: 'boardsettings.tab.columns', message: 'Back to Columns.' })
  await click('boardsettings.tab.columns')
  r = await run('wait_for_action', { element_id: 'boardsettings.tab.columns' })
  assert.equal(r.done, true)
  assert.equal(r.action, 'already done')

  const ended = await run('end_walkthrough')
  assert.equal(ended.ok, true)
  assert.ok(!(await toolNames()).includes('end_walkthrough'))
  await shot('ended')

  await page.click('[data-guide="boardsettings.back"]')
  r = await step('sidebar.project.more', 'Open the project menu in the sidebar.', () => click('sidebar.project.more'))
  r = await step('sidebar.project.settings', 'Choose Project settings.', () => click('sidebar.project.settings'))
  assert.equal(r.now.screen.id, 'project-settings')
  r = await step('projectsettings.tab.notifications', 'Open Notifications.', () => click('projectsettings.tab.notifications'))
  r = await step('projectsettings.notifications.edit.assigned', 'Press Edit on the Issue assigned row.', () => click('projectsettings.notifications.edit.assigned'))
  assert.equal(r.now.open_dialog, 'edit-notifications')
  r = await step('notif.recipient.all-watchers', 'Tick All watchers.', () => page.click('label:has([data-guide="notif.recipient.all-watchers"])'))
  assert.equal(r.action, 'checked')
  r = await step('notif.save', 'Press Save.', () => click('notif.save'))
  assert.ok(r.now.app_state.notification_recipients['Issue assigned'].includes('All watchers'))
  await run('end_walkthrough')
  await shot('notifications-saved')

  await page.click('[data-guide="sidebar.filters"]')
  await page.waitForFunction(() => !document.querySelector('[data-screen="filters"]').hidden)
  assert.equal((await run('get_current_view')).screen.id, 'filters')
  await page.click('[data-guide="sidebar.board.kanban"]')
  await page.waitForFunction(() => !document.querySelector('[data-screen="board"]').hidden)

  const closedDialog = await run('highlight_step', { element_id: 'issue.labels', message: 'x' })
  assert.equal(closedDialog.ok, false)
  assert.match(closedDialog.error, /"issue" dialog/)

  r = await step('card.ATL-136', 'Open ATL-136.', () => click('card.ATL-136'))
  assert.equal(r.now.open_dialog, 'issue')
  const collapsed = await run('highlight_step', { element_id: 'issue.labels', message: 'x' })
  assert.equal(collapsed.ok, false)
  assert.match(collapsed.error, /issue\.details/)

  r = await step('issue.details', 'Expand Details.', () => click('issue.details'))
  assert.ok(r.now.visible_elements.includes('issue.labels'))
  r = await step('issue.labels', 'Type needs-design and press Enter.', async () => {
    await page.type('[data-guide="issue.labels"]', 'needs-design', { delay: 30 })
    await page.press('[data-guide="issue.labels"]', 'Enter')
  })
  assert.ok(r.now.app_state.open_issue.labels.includes('needs-design'))

  r = await step('issue.type', 'Click the type icon next to the key.', () => click('issue.type'))
  assert.equal(r.now.open_menu, 'issue.type')
  r = await step('issue.type.bug', 'Choose Bug.', () => click('issue.type.bug'))
  assert.equal(r.now.app_state.open_issue.type, 'bug')
  const noLabels = await run('do_step_for_person', { element_id: 'issue.labels', value: 'x' })
  assert.equal(noLabels.refused, true)

  await step('issue.watch', 'Click the eye icon.', () => click('issue.watch'))
  await step('issue.watch.add', 'Choose Add watchers.', () => click('issue.watch.add'))
  r = await step('issue.watchers.input', 'Type Ana and press Enter.', async () => {
    await page.type('[data-guide="issue.watchers.input"]', 'Ana K', { delay: 30 })
    await page.press('[data-guide="issue.watchers.input"]', 'Enter')
  })
  assert.ok(r.now.app_state.open_issue.watchers.includes('Ana K.'))
  await shot('issue-panel')
  r = await step('issue.close', 'Close the issue.', () => click('issue.close'))
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
      ? { content: [{ type: 'text', text: 'Let me show you.' }, { type: 'tool_use', id: 'toolu_1', name: 'highlight_step', input: { element_id: 'board.more', message: 'Click the three dots.' } }], stop_reason: 'tool_use' }
      : { content: [{ type: 'text', text: 'Done, that is the menu.' }], stop_reason: 'end_turn' }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(reply) })
  })
  await page.click('[data-guide="sidebar.board.kanban"]')
  await page.click('.agent-drawer summary')
  await page.fill('.agent-drawer .key', 'sk-ant-api-test')
  await page.fill('.agent-drawer textarea', 'How do I configure the board?')
  await page.click('.agent-drawer .send')
  await page.waitForSelector('.agent-drawer .msg:has-text("Done, that is the menu.")')
  assert.equal(apiCalls.length, 2)
  assert.equal(apiCalls[0].headers['x-api-key'], 'sk-ant-api-test')
  assert.equal(apiCalls[0].body.model, 'claude-opus-5')
  assert.equal(apiCalls[0].body.fallbacks, 'default')
  assert.ok(apiCalls[0].body.tools.some(x => x.name === 'wait_for_action'))
  const last = apiCalls[1].body.messages.at(-1)
  assert.equal(last.content[0].type, 'tool_result')
  assert.equal(JSON.parse(last.content[0].content).ok, true)
  assert.ok(apiCalls[1].body.tools.some(x => x.name === 'end_walkthrough'))
  assert.equal((await run('get_current_view')).walkthrough.highlighted, 'board.more')
  await page.waitForTimeout(500)
  await shot('console')

  console.log(`PASS  ${n} screenshots in test/shots`)
} finally {
  await browser.close()
  server.close()
}
