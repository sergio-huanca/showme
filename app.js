import { startGuide, toggleDrawer } from './showme.js'
import { mountConsole } from './agent-console.js'

const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]

const columns = [
  { id: 'backlog', name: 'Backlog', count: 156, statuses: ['Backlog'] },
  { id: 'selected', name: 'Selected for development', count: 60, statuses: ['Selected for Development'] },
  { id: 'in-progress', name: 'In progress', count: 45, statuses: ['In Progress'] },
  { id: 'waiting-review', name: 'Waiting for review', count: 3, statuses: ['Waiting for Review'] },
  { id: 'blocked', name: 'Blocked', count: 0, statuses: ['Blocked'] },
  { id: 'dev-deployed', name: 'Dev deployed', count: 0, statuses: ['Dev Deployed'] },
  { id: 'dev-test', name: 'Dev test', count: 4, statuses: ['Dev Test'] },
  { id: 'ready-qa', name: 'Ready for QA', count: 7, statuses: ['Ready for QA'] },
]

const cards = {
  backlog: [
    { t: 'Rate limiter leaks tokens when the source is blocked', e: ['Platform hardening', 'blue'], p: 4, k: 888, type: 'task' },
    { t: 'Mobile support for SSO login', e: ['Mobile parity', 'blue'], p: 4, k: 195, type: 'task' },
    { t: 'Release bot stopped posting to the channel', p: 4, k: 435, type: 'bug' },
    { t: 'Operations dashboard', p: 2, k: 902, type: 'story', who: 'SB' },
  ],
  selected: [
    { t: 'Object storage for the demo org', e: ['Tenant onboarding', 'purple'], p: 1, k: 1509, type: 'task', who: 'SB' },
    { t: 'Promote demo storage to staging', e: ['Tenant onboarding', 'purple'], p: 1, k: 1510, type: 'task', who: 'SB' },
    { t: 'Configure the east region tenant (auth, roles, billing)', e: ['Tenant onboarding', 'purple'], p: 3, k: 944, type: 'task', who: 'SB' },
  ],
  'in-progress': [
    { t: 'Team capacity card', e: ['Search relevance', 'purple'], p: 4, k: 131, type: 'story' },
    { t: 'Variance overview report page', e: ['Billing v2', 'purple'], p: 4, k: 136, type: 'story', who: 'AK', due: '29 May 2026' },
    { t: 'Deploy atlas to UAT', e: ['Cost & capacity', 'yellow'], p: 4, k: 1420, type: 'task', who: 'DG' },
  ],
  'waiting-review': [
    { t: 'Alerts view (partner pilot)', e: ['Anomaly alerts', 'purple'], p: 4, k: 224, type: 'story', who: 'SH' },
    { t: 'Assistant ignores the delivery date filter', e: ['Search relevance', 'purple'], p: 4, k: 1171, type: 'bug', who: 'AM', flag: true },
    { t: 'Spreadsheet import drops the discount column', e: ['Billing v2', 'purple'], p: 4, k: 1174, type: 'bug', who: 'AK' },
  ],
  blocked: [],
  'dev-deployed': [],
  'dev-test': [
    { t: 'Reviewer approves every release note before publishing', e: ['CI/CD pipeline', 'blue'], p: 3, k: 1268, type: 'task', who: 'SB', flag: true },
    { t: 'Follow-ups module', e: ['Follow-ups', 'gray'], p: 4, k: 815, type: 'story', who: 'SH' },
    { t: 'Nightly full and incremental load to the mart', e: ['Data warehouse', 'purple'], p: 4, k: 1354, type: 'task', who: 'AM' },
  ],
  'ready-qa': [
    { t: 'Collect evidence for the audit bundle', e: ['Platform hardening', 'teal'], p: 4, k: 1290, type: 'task', who: 'GR', flag: true },
    { t: 'Investigation timeline and audit trail', e: ['Platform hardening', 'teal'], p: 3, k: 1301, type: 'story', who: 'GR' },
    { t: 'Move evidence into the vault', e: ['Platform hardening', 'teal'], p: 2, k: 1312, type: 'task' },
  ],
}

const recipients = ['Reporter', 'Current assignee', 'Previous assignee', 'All watchers', 'Project lead', 'Component lead']
const notifications = [
  { id: 'created', event: 'Issue created', to: ['Reporter', 'Project lead'] },
  { id: 'assigned', event: 'Issue assigned', to: ['Current assignee'] },
  { id: 'resolved', event: 'Issue resolved', to: ['Reporter', 'Current assignee'] },
  { id: 'commented', event: 'Comment added', to: ['Reporter', 'Current assignee'] },
  { id: 'moved', event: 'Issue moved', to: ['Current assignee'] },
]
const rules = [
  { name: 'Assign new bugs to the on-call engineer', on: true },
  { name: 'Move to Done when the pull request merges', on: true },
]

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function card(c) {
  const avatar = c.who ? `<span class="avatar sm">${c.who}</span>` : '<svg class="muted"><use href="#i-user"/></svg>'
  return `<div class="card${c.flag ? ' flag' : ''}" data-key="ATL-${c.k}">
    <div class="card-title">${esc(c.t)}</div>
    ${c.e ? `<span class="epic ${c.e[1]}">${esc(c.e[0])}</span>` : ''}
    ${c.due ? `<div class="due">${c.due} ⚠</div>` : ''}
    <div class="card-meta"><span class="prio p${c.p}"><i></i><i></i><i></i><i></i></span><span class="type ${c.type}"></span><span class="key">ATL-${c.k}</span>${avatar}</div>
  </div>`
}

function renderBoard() {
  const q = $('#board-search').value.trim().toLowerCase()
  $('#board').innerHTML = columns.map(c => {
    const list = (cards[c.id] || []).filter(x => !q || x.t.toLowerCase().includes(q) || ('atl-' + x.k).includes(q))
    const n = q ? list.length : (c.count || list.length)
    return `<div class="column" data-col="${c.id}">
      <div class="column-head"><span class="name" title="${esc(c.name)}">${esc(c.name)}</span>${n ? `<span class="num">${n}</span>` : ''}${c.max ? `<span class="limit">Max ${esc(c.max)}</span>` : ''}</div>
      ${list.map(card).join('')}
    </div>`
  }).join('')
}

function renderColumnsConfig() {
  $('#columns-config').innerHTML = columns.map(c => `<div class="col-card" data-col="${c.id}">
    <div class="head"><span>${esc(c.name)}</span><button class="icon-btn sm" data-guide="boardsettings.columns.delete.${c.id}" data-guide-danger data-guide-desc="Delete the ${esc(c.name)} column. Its issues move to Unmapped"><svg><use href="#i-x"/></svg></button></div>
    ${c.statuses.map(s => `<div class="status">${esc(s)}</div>`).join('')}
    <div class="limits">
      <label>Min<input value="${esc(c.min || '')}" data-guide="boardsettings.columns.min.${c.id}" data-guide-desc="Min limit for the ${esc(c.name)} column. Saves automatically when you leave the field"></label>
      <label>Max<input value="${esc(c.max || '')}" data-guide="boardsettings.columns.max.${c.id}" data-guide-desc="Max limit (WIP limit) for the ${esc(c.name)} column. Saves automatically when you leave the field"></label>
    </div>
  </div>`).join('') + '<div class="col-card unmapped"><div class="head">Unmapped statuses</div><div class="status">Canceled</div><div class="status">Archived</div></div>'
}

function renderNotifs() {
  $('#notif-table').innerHTML = '<tr><th>Event</th><th>Recipients</th><th></th></tr>' + notifications.map(n => `<tr>
    <td>${n.event}</td>
    <td><span class="recips">${n.to.map(r => `<span class="chip">${r}</span>`).join('')}</span></td>
    <td><button class="btn subtle" data-guide="projectsettings.notifications.edit.${n.id}" data-guide-desc="Edit button of the '${n.event}' row. Opens a dialog to choose who gets emailed when ${n.event.toLowerCase()}">Edit</button></td>
  </tr>`).join('')
}

function renderRules() {
  $('#rules').innerHTML = rules.map(r => `<div class="rule"><svg><use href="#i-bolt"/></svg><span>${esc(r.name)}</span><span class="state">${r.on ? 'ON' : 'OFF'}</span></div>`).join('')
}

let toastTimer
function toast(msg) {
  const t = $('#toast')
  t.textContent = msg
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, 2600)
}

const screens = $$('[data-screen]')
function go(hash) {
  const [screen, panel] = (hash || '').replace(/^#/, '').split('/')
  const sec = screens.find(s => s.dataset.screen === screen) || screens[0]
  screens.forEach(s => { s.hidden = s !== sec })
  const panels = [...sec.querySelectorAll('[data-panel]')]
  if (panels.length) {
    const want = panels.find(p => p.dataset.panel === panel) || panels[0]
    panels.forEach(p => { p.hidden = p !== want })
    sec.querySelectorAll('.snav').forEach(b => b.classList.toggle('active', b.dataset.panelTarget === want.dataset.panel))
  }
  const id = sec.dataset.screen
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.guideGoto === id))
  $$('.sidebar .side-item').forEach(t => t.classList.toggle('active', t.dataset.guideGoto === id))
  closeMenus()
  window.scrollTo(0, 0)
}
function nav(to) {
  if (location.hash === '#' + to) go(to)
  else location.hash = to
}
window.addEventListener('hashchange', () => go(location.hash))

function closeMenus() { $$('.menu').forEach(m => { m.hidden = true }) }

document.addEventListener('click', e => {
  const opener = e.target.closest('[data-opens]')
  if (opener) {
    e.preventDefault()
    const menu = document.querySelector(`.menu[data-menu="${opener.dataset.opens}"]`)
    const wasOpen = !menu.hidden
    closeMenus()
    menu.hidden = wasOpen
    return
  }
  const goto = e.target.closest('[data-guide-goto]')
  if (goto) {
    e.preventDefault()
    nav(goto.dataset.guideGoto)
    return
  }
  const snav = e.target.closest('.snav')
  if (snav) {
    nav(snav.closest('[data-screen]').dataset.screen + '/' + snav.dataset.panelTarget)
    return
  }
  const item = e.target.closest('.menu button')
  if (item) {
    closeMenus()
    toast(`"${item.textContent.trim()}" is not wired up in this demo`)
    return
  }
  if (!e.target.closest('.menu-anchor')) closeMenus()
  const a = e.target.closest('a[href="#"]')
  if (a) {
    e.preventDefault()
    toast(`"${a.textContent.trim()}" is not wired up in this demo`)
  }
})

$('#board-search').addEventListener('input', renderBoard)
$('#global-search').addEventListener('keydown', e => { if (e.key === 'Enter') toast(`Searching for "${e.target.value}"…`) })
$('[data-guide="nav.create"]').addEventListener('click', () => toast('Create issue is not wired up in this demo'))
$('#agent-activity-btn').addEventListener('click', toggleDrawer)

const addForm = $('#add-column-form')
const newName = $('#new-column-name')
$('[data-guide="boardsettings.columns.add"]').addEventListener('click', () => {
  addForm.hidden = false
  newName.value = ''
  newName.focus()
})
$('[data-guide="boardsettings.columns.cancel"]').addEventListener('click', () => { addForm.hidden = true })
addForm.addEventListener('submit', e => {
  e.preventDefault()
  const name = newName.value.trim()
  if (!name) { newName.focus(); return }
  columns.push({ id: slug(name) || 'col-' + columns.length, name, count: 0, statuses: [name] })
  addForm.hidden = true
  renderBoard()
  renderColumnsConfig()
  toast(`Column "${name}" added to the board`)
})
$('#columns-config').addEventListener('change', e => {
  const m = /^boardsettings\.columns\.(min|max)\.(.+)$/.exec(e.target.dataset.guide || '')
  if (!m) return
  const col = columns.find(c => c.id === m[2])
  col[m[1]] = e.target.value.trim()
  renderBoard()
  toast(col[m[1]] ? `${m[1] === 'max' ? 'Max' : 'Min'} limit for ${col.name} set to ${col[m[1]]}` : `${m[1] === 'max' ? 'Max' : 'Min'} limit for ${col.name} removed`)
})
$('#columns-config').addEventListener('click', e => {
  const del = e.target.closest('[data-guide^="boardsettings.columns.delete."]')
  if (!del) return
  const id = del.dataset.guide.split('.').pop()
  const col = columns.find(c => c.id === id)
  if (confirm(`Delete the "${col.name}" column? Its statuses become unmapped.`)) {
    columns.splice(columns.indexOf(col), 1)
    renderBoard()
    renderColumnsConfig()
    toast(`Column "${col.name}" deleted`)
  }
})

let editing = null
const modal = $('#notif-modal')
$('#notif-table').addEventListener('click', e => {
  const btn = e.target.closest('[data-guide^="projectsettings.notifications.edit."]')
  if (!btn) return
  editing = notifications.find(n => n.id === btn.dataset.guide.split('.').pop())
  $('#notif-modal-title').textContent = `Edit notifications: ${editing.event}`
  $('#notif-checks').innerHTML = recipients.map(r => `<label><input type="checkbox" ${editing.to.includes(r) ? 'checked' : ''} data-guide="notif.recipient.${slug(r)}" data-guide-desc="Checkbox: ${r} receives an email when ${editing.event.toLowerCase()}">${r}</label>`).join('')
  modal.hidden = false
})
$('[data-guide="notif.cancel"]').addEventListener('click', () => { modal.hidden = true })
$('[data-guide="notif.save"]').addEventListener('click', () => {
  editing.to = [...$('#notif-checks').querySelectorAll('input:checked')].map(i => i.parentElement.textContent.trim())
  modal.hidden = true
  renderNotifs()
  toast(`Recipients for "${editing.event}" saved`)
})

const ruleForm = $('#rule-form')
$('[data-guide="projectsettings.automation.create"]').addEventListener('click', () => {
  ruleForm.hidden = false
  ruleForm.reset()
})
$('[data-guide="automation.cancel"]').addEventListener('click', () => { ruleForm.hidden = true })
ruleForm.addEventListener('submit', e => {
  e.preventDefault()
  const when = $('[data-guide="automation.trigger"]').value
  const then = $('[data-guide="automation.action"]').value
  if (!when || !then) { toast('Pick a trigger and an action first'); return }
  rules.push({ name: `${when} → ${then}`, on: true })
  ruleForm.hidden = true
  renderRules()
  toast('Rule turned on')
})

renderBoard()
renderColumnsConfig()
renderNotifs()
renderRules()
go(location.hash)

startGuide({
  app: 'Meridian',
  state: () => ({
    board_columns: columns.map(c => c.max ? `${c.name} (max ${c.max})` : c.name),
    notification_recipients: Object.fromEntries(notifications.map(n => [n.event, n.to])),
    automation_rules: rules.map(r => r.name),
  }),
}).then(mountConsole)
