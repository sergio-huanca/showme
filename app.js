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
    { t: 'Variance overview report page', e: ['Billing v2', 'purple'], p: 4, k: 136, type: 'story', who: 'AK', due: '2026-05-29', d: 'The variance report compares budgeted and actual spend per tenant. The page must load under two seconds for 10k rows and export to CSV.' },
    { t: 'Deploy atlas to UAT', e: ['Cost & capacity', 'yellow'], p: 4, k: 1420, type: 'task', who: 'DG' },
  ],
  'waiting-review': [
    { t: 'Alerts view (partner pilot)', e: ['Anomaly alerts', 'purple'], p: 4, k: 224, type: 'story', who: 'SH', d: 'A read-only view of anomaly alerts for the partner pilot. Filters by severity and site, no acknowledgement yet.' },
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

const people = { SH: 'Sergio H.', AK: 'Ana K.', AM: 'Ana M.', BC: 'Bruno C.', DG: 'Diego G.', GR: 'Gabriel R.', SB: 'Sofía B.' }
const priorities = { 4: 'Highest', 3: 'High', 2: 'Medium', 1: 'Low' }

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
const keyOf = c => 'ATL-' + c.k
const fmtDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function findIssue(key) {
  for (const col of columns) for (const c of cards[col.id] || []) if (keyOf(c) === key) return { c, col }
  return null
}

function card(c, col) {
  const avatar = c.who ? `<span class="avatar sm">${c.who}</span>` : '<svg class="muted"><use href="#i-user"/></svg>'
  const labels = (c.labels || []).map(l => `<span class="chip">${esc(l)}</span>`).join('')
  return `<div class="card${c.flag ? ' flag' : ''}" data-open-issue="${keyOf(c)}" data-guide="card.${keyOf(c)}" data-guide-delegable data-guide-desc="Issue card ${keyOf(c)} '${esc(c.t)}' in the ${esc(col.name)} column. Click it to open the issue panel">
    <div class="card-title">${esc(c.t)}</div>
    ${c.e ? `<span class="epic ${c.e[1]}">${esc(c.e[0])}</span>` : ''}
    ${labels ? `<div class="chips">${labels}</div>` : ''}
    ${c.due ? `<div class="due">${fmtDate(c.due)} ⚠</div>` : ''}
    <div class="card-meta"><span class="prio p${c.p}"><i></i><i></i><i></i><i></i></span><span class="type ${c.type}"></span><span class="key">${keyOf(c)}</span>${avatar}</div>
  </div>`
}

function renderBoard() {
  const q = $('#board-search').value.trim().toLowerCase()
  $('#board').innerHTML = columns.map(c => {
    const list = (cards[c.id] || []).filter(x => !q || x.t.toLowerCase().includes(q) || keyOf(x).toLowerCase().includes(q))
    const n = q ? list.length : (c.count || list.length)
    return `<div class="column" data-col="${c.id}">
      <div class="column-head"><span class="name" title="${esc(c.name)}">${esc(c.name)}</span>${n ? `<span class="num">${n}</span>` : ''}${c.max ? `<span class="limit">Max ${esc(c.max)}</span>` : ''}</div>
      ${list.map(x => card(x, c)).join('')}
    </div>`
  }).join('')
  renderForYou()
}

function renderForYou() {
  const mine = []
  for (const col of columns) for (const c of cards[col.id] || []) if (c.who === 'SH') mine.push({ c, col })
  $('#foryou-list').innerHTML = mine.map(({ c, col }) => `<div class="issue-row" data-open-issue="${keyOf(c)}" data-guide="foryou.${keyOf(c)}" data-guide-delegable data-guide-desc="Issue ${keyOf(c)} '${esc(c.t)}' in the For you list (${esc(col.name)}). Click it to open the issue panel"><span class="type ${c.type}"></span><span class="key">${keyOf(c)}</span>${esc(c.t)}</div>`).join('')
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
const notifModal = $('#notif-modal')
const issueModal = $('#issue-modal')

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
  notifModal.hidden = true
  issueModal.hidden = true
  window.scrollTo(0, 0)
}
function nav(to) {
  if (location.hash === '#' + to) go(to)
  else location.hash = to
}
window.addEventListener('hashchange', () => go(location.hash))

function closeMenus() { $$('.menu').forEach(m => { m.hidden = true }) }

let issue = null
let issueCol = null

function openIssue(key) {
  const hit = findIssue(key)
  if (!hit) return
  issue = hit.c
  issueCol = hit.col
  issue.labels ||= []
  issue.watchers ||= ['SH']
  issue.comments ||= [{ who: 'AK', when: '2 days ago', text: 'Design is in the wiki, ping me if the numbers look off.' }]
  $('#issue-key').textContent = key
  $('#issue-title').textContent = issue.t
  $('#issue-desc').textContent = issue.d || `${issue.t}. Part of the ${issue.e ? issue.e[0] : 'platform'} work. Acceptance criteria and the linked pull request are in the comments.`
  $('#issue-status').innerHTML = columns.map(c => `<option${c === issueCol ? ' selected' : ''}>${esc(c.statuses[0])}</option>`).join('')
  $('#issue-assignee').innerHTML = '<option value="">Unassigned</option>' + Object.entries(people).map(([k, v]) => `<option value="${k}"${issue.who === k ? ' selected' : ''}>${v}</option>`).join('')
  $('#issue-priority').value = priorities[issue.p]
  $('#issue-epic').value = issue.e ? issue.e[0] : ''
  $('#issue-due').value = issue.due || ''
  $('#issue-reporter').value = 'Sergio H.'
  $('#issue-details').hidden = true
  $('#issue-morefields').hidden = true
  $$('.section-toggle').forEach(b => b.setAttribute('aria-expanded', 'false'))
  $('#watchers-box').hidden = true
  $('#issue-comment').value = ''
  renderIssueBits()
  issueModal.hidden = false
}

function renderIssueBits() {
  $('#issue-type-icon').className = 'type ' + issue.type
  $('#issue-labels').innerHTML = issue.labels.map(l => `<span class="chip">${esc(l)}<button type="button" data-remove-label="${esc(l)}" title="Remove">×</button></span>`).join('')
  $('#issue-watch-count').textContent = issue.watchers.length
  $('#issue-watch-toggle').textContent = issue.watchers.includes('SH') ? 'Stop watching' : 'Watch this issue'
  $('#watchers-list').innerHTML = issue.watchers.map(w => `<span class="chip">${people[w] || esc(w)}</span>`).join('')
  $('#issue-flag-item').textContent = issue.flag ? 'Remove flag' : 'Add flag'
  $('#issue-comments').innerHTML = issue.comments.map(c => `<div class="comment"><span class="avatar sm">${c.who}</span><div><span class="who">${people[c.who] || c.who}</span><span class="when">${c.when}</span><div>${esc(c.text)}</div></div></div>`).join('')
}

const actions = {
  'issue.type.task': () => setType('task'),
  'issue.type.story': () => setType('story'),
  'issue.type.bug': () => setType('bug'),
  'issue.watch.toggle': () => {
    const i = issue.watchers.indexOf('SH')
    i >= 0 ? issue.watchers.splice(i, 1) : issue.watchers.push('SH')
    renderIssueBits()
    toast(i >= 0 ? 'You stopped watching this issue' : 'You are watching this issue')
  },
  'issue.watch.add': () => {
    $('#watchers-box').hidden = false
    $('#watchers-input').focus()
  },
  'issue.more.flag': () => {
    issue.flag = !issue.flag
    renderIssueBits()
    renderBoard()
    toast(issue.flag ? 'Flag added' : 'Flag removed')
  },
  'issue.more.delete': () => {
    if (!confirm(`Delete ${keyOf(issue)}? This cannot be undone.`)) return
    const list = cards[issueCol.id]
    list.splice(list.indexOf(issue), 1)
    issueModal.hidden = true
    renderBoard()
    toast(`${keyOf(issue)} deleted`)
  },
  'issue.close': () => { issueModal.hidden = true },
  'issue.details': b => toggleSection(b, '#issue-details'),
  'issue.morefields': b => toggleSection(b, '#issue-morefields'),
  'issue.comment.save': () => {
    const text = $('#issue-comment').value.trim()
    if (!text) return
    issue.comments.push({ who: 'SH', when: 'just now', text })
    $('#issue-comment').value = ''
    renderIssueBits()
    toast('Comment saved')
  },
}

function setType(type) {
  issue.type = type
  renderIssueBits()
  renderBoard()
  toast(`${keyOf(issue)} is now a ${type}`)
}

function toggleSection(btn, sel) {
  const box = $(sel)
  box.hidden = !box.hidden
  btn.setAttribute('aria-expanded', String(!box.hidden))
}

document.addEventListener('click', e => {
  const act = e.target.closest('[data-guide]')
  if (act && actions[act.dataset.guide]) {
    e.preventDefault()
    actions[act.dataset.guide](act)
    if (act.closest('.menu')) closeMenus()
    return
  }
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
  const removeLabel = e.target.closest('[data-remove-label]')
  if (removeLabel) {
    issue.labels.splice(issue.labels.indexOf(removeLabel.dataset.removeLabel), 1)
    renderIssueBits()
    renderBoard()
    return
  }
  const open = e.target.closest('[data-open-issue]')
  if (open) {
    openIssue(open.dataset.openIssue)
    return
  }
  const item = e.target.closest('.menu button')
  if (item) {
    closeMenus()
    toast(`"${item.textContent.trim()}" is not wired up in this demo`)
    return
  }
  if (!e.target.closest('.menu-anchor')) closeMenus()
  if (e.target === issueModal) issueModal.hidden = true
  const a = e.target.closest('a[href="#"]')
  if (a) {
    e.preventDefault()
    toast(`"${a.textContent.trim()}" is not wired up in this demo`)
  }
})

$('#issue-label-input').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return
  e.preventDefault()
  const label = e.target.value.trim().toLowerCase().replace(/\s+/g, '-')
  if (!label) return
  if (!issue.labels.includes(label)) issue.labels.push(label)
  e.target.value = ''
  renderIssueBits()
  renderBoard()
  toast(`Label "${label}" added to ${keyOf(issue)}`)
})
$('#watchers-input').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return
  e.preventDefault()
  const name = e.target.value.trim()
  if (!name) return
  const code = Object.keys(people).find(k => people[k].toLowerCase().startsWith(name.toLowerCase())) || name
  if (!issue.watchers.includes(code)) issue.watchers.push(code)
  e.target.value = ''
  renderIssueBits()
  toast(`${people[code] || code} is now watching ${keyOf(issue)}`)
})
$('#issue-status').addEventListener('change', e => {
  const to = columns.find(c => c.statuses[0] === e.target.value)
  if (!to || to === issueCol) return
  cards[issueCol.id].splice(cards[issueCol.id].indexOf(issue), 1)
  ;(cards[to.id] ||= []).unshift(issue)
  issueCol = to
  renderBoard()
  toast(`${keyOf(issue)} moved to ${to.name}`)
})
$('#issue-assignee').addEventListener('change', e => {
  issue.who = e.target.value
  renderBoard()
  toast(e.target.value ? `Assigned to ${people[e.target.value]}` : 'Unassigned')
})
$('#issue-priority').addEventListener('change', e => {
  issue.p = Number(Object.keys(priorities).find(k => priorities[k] === e.target.value))
  renderBoard()
  toast(`Priority set to ${e.target.value}`)
})
$('#issue-due').addEventListener('change', e => {
  issue.due = e.target.value
  renderBoard()
  toast(e.target.value ? `Due date set to ${fmtDate(e.target.value)}` : 'Due date cleared')
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
$('#notif-table').addEventListener('click', e => {
  const btn = e.target.closest('[data-guide^="projectsettings.notifications.edit."]')
  if (!btn) return
  editing = notifications.find(n => n.id === btn.dataset.guide.split('.').pop())
  $('#notif-modal-title').textContent = `Edit notifications: ${editing.event}`
  $$('#notif-checks input').forEach(i => { i.checked = editing.to.includes(i.parentElement.textContent.trim()) })
  notifModal.hidden = false
})
$('[data-guide="notif.cancel"]').addEventListener('click', () => { notifModal.hidden = true })
$('[data-guide="notif.save"]').addEventListener('click', () => {
  editing.to = [...$('#notif-checks').querySelectorAll('input:checked')].map(i => i.parentElement.textContent.trim())
  notifModal.hidden = true
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

$('#notif-checks').innerHTML = recipients.map(r => `<label><input type="checkbox" data-guide="notif.recipient.${slug(r)}" data-guide-desc="Checkbox in the edit notifications dialog: ${r} receives an email for the event being edited">${r}</label>`).join('')
renderBoard()
renderColumnsConfig()
renderNotifs()
renderRules()
go(location.hash)

startGuide({
  app: 'Meridian',
  state: () => ({
    board_columns: columns.map(c => c.max ? `${c.name} (max ${c.max})` : c.name),
    open_issue: issue && !issueModal.hidden ? { key: keyOf(issue), title: issue.t, type: issue.type, status: issueCol.statuses[0], labels: issue.labels, watchers: issue.watchers.map(w => people[w] || w), flagged: !!issue.flag, assignee: people[issue.who] || 'Unassigned' } : null,
    notification_recipients: Object.fromEntries(notifications.map(n => [n.event, n.to])),
    automation_rules: rules.map(r => r.name),
  }),
}).then(mountConsole)
