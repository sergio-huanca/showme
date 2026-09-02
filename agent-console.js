const KEY = 'showme.anthropic.key'
const MODEL = 'claude-opus-5'

const SYSTEM = `You are the guide built into Meridian, a project tracker. The person next to you wants to learn how to do something in Meridian themselves.
Start with get_ui_map (once) and get_current_view. Plan the shortest path, then call run_walkthrough once with every step and a short friendly message per step; the page paces the person. Never describe menu paths in prose when you can show them.
When run_walkthrough returns in_progress call it again without steps. When it returns interrupted or blocked, read the reason and call it again with the remaining steps. Do not call do_step_for_person unless the person explicitly asks you to do a step for them; if Meridian refuses, say so briefly and keep guiding.
When the task is complete call end_walkthrough and tell the person the path in one line. Keep every message under two sentences.`

function headers(key) {
  const h = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
    'anthropic-beta': 'server-side-fallback-2026-07-01',
  }
  if (key.startsWith('sk-ant-api')) h['x-api-key'] = key
  else {
    h.authorization = 'Bearer ' + key
    h['anthropic-beta'] += ',oauth-2025-04-20'
  }
  return h
}

async function ask(key, messages) {
  const tools = window.showme.tools().map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({ model: MODEL, max_tokens: 16000, fallbacks: 'default', system: SYSTEM, tools, messages }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ? body.error.message : res.statusText)
  return body
}

export function mountConsole() {
  const host = window.showme.drawer()
  const box = document.createElement('div')
  box.className = 'console'
  box.innerHTML = `<details>
<summary>Backup agent · Claude talks to the same tools from this page</summary>
<input class="key" type="password" placeholder="Anthropic API key (kept in this browser only)" autocomplete="off">
<div class="thread"></div>
<textarea placeholder="Ask how to do something, e.g. How do I add a Code Review column to the board?"></textarea>
<div class="row"><button class="btn primary send">Ask</button><button class="btn subtle clear">Clear</button></div>
</details>`
  host.appendChild(box)

  const keyInput = box.querySelector('.key')
  const thread = box.querySelector('.thread')
  const textarea = box.querySelector('textarea')
  const send = box.querySelector('.send')
  let messages = []
  let busy = false

  try { keyInput.value = localStorage.getItem(KEY) || '' } catch {}
  keyInput.addEventListener('change', () => { try { localStorage.setItem(KEY, keyInput.value.trim()) } catch {} })

  const show = (text, cls = '') => {
    const div = document.createElement('div')
    div.className = 'msg ' + cls
    div.textContent = text
    thread.appendChild(div)
    thread.scrollTop = thread.scrollHeight
  }

  async function run(text) {
    messages.push({ role: 'user', content: text })
    show(text, 'me')
    for (let i = 0; i < 40; i++) {
      const res = await ask(keyInput.value.trim(), messages)
      if (res.stop_reason === 'refusal') { show('The model declined this request.', 'err'); return }
      messages.push({ role: 'assistant', content: res.content })
      for (const b of res.content) if (b.type === 'text' && b.text.trim()) show(b.text.trim())
      if (res.stop_reason !== 'tool_use') return
      const results = []
      for (const b of res.content) {
        if (b.type !== 'tool_use') continue
        const out = await window.showme.run(b.name, b.input)
        results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out) })
      }
      messages.push({ role: 'user', content: results })
    }
    show('Stopped after 40 turns.', 'err')
  }

  send.addEventListener('click', async () => {
    const text = textarea.value.trim()
    if (!text || busy) return
    if (!keyInput.value.trim()) { show('Paste an Anthropic API key first.', 'err'); return }
    textarea.value = ''
    busy = true
    send.disabled = true
    try { await run(text) }
    catch (e) { show('Error: ' + e.message, 'err') }
    finally { busy = false; send.disabled = false }
  })
  textarea.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send.click() } })
  box.querySelector('.clear').addEventListener('click', () => { messages = []; thread.innerHTML = '' })
}
