# ShowMe · your agent points, you click

**Live demo:** https://sergio-huanca.github.io/showme/ is PeruBank, https://sergio-huanca.github.io/showme/meridian/ is Meridian.
**Video:** YouTube link goes here.

Where did they hide that setting? ShowMe is my entry for OpenAI's WebMCP Challenge. It's a small thing you add to a web app so people can ask their own AI agent that question and get walked through the answer on their own screen. The site hands the agent a map of its interface through WebMCP, the agent plans the path once, and the page lights up one element at a time. You do every click yourself. Click somewhere else and the agent notices and re-plans. And the site's own markup says which steps an agent may ever do for you, so a bank can let an agent teach you how to move your money without being able to move it.

![The agent spotlights the Confirm button in PeruBank. Asked to press it, PeruBank refuses](docs/bank-confirm.png)

I built two fake sites to show it, and neither of them has any guide code in it:

- **PeruBank** is a made-up online bank. The switch for international transfers is four levels deep (profile menu, a settings tab, a collapsed "Advanced" section), and the final Confirm is a button I never want an agent pressing. Disputing a charge is behind three dots inside a dialog. Freezing a card is behind three dots on the card.
- **Meridian** at `/meridian/` is a team issue tracker: board settings behind one three-dots menu, project settings behind another, a Labels field inside a collapsed section, and a type icon that nobody realises is a button.

## Why I built it

Every time I join a new team I have to learn their tools fast, usually in front of people. Last time it was the team's issue tracker, and within days I was driving standup with it, hunting for a setting while everyone waited. I'm genuinely bad at this. Not finding a setting stresses me out more than it should.

Same thing at home. Whenever I've had to explain to someone (usually my parents, honestly) how to do something in an app, the help article never matches what's on their screen, and if I just do it for them they'll ask again next month. Agents make the second option worse in a way: now the site has to trust a robot with your money or your configuration, and you still didn't learn anything.

So this is a third option. The agent plans, the page paces, you click. At the end the agent tells you the path in one line, and the second time you probably don't need it.

Who it's for. First, anyone using an app with hundreds of settings: developer dashboards, admin consoles, merchant back offices. The answer to "where is it" is four pages deep, and the wrong click changes production. The agent can show you the way and the site can keep the production change human. Second, people who should never hand an agent their account: online banking, health portals, government services. Older people especially. My parents. That's PeruBank. Third, anyone learning a tool in front of other people, like a new hire on the team tracker. That's Meridian. The people who'd actually install it are the support and product teams answering "where is X" all day, with the sentences their help center already wrote.

## Try it

**In the ChatGPT desktop app** (its browser has WebMCP built in): open the live URL in ChatGPT's browser, click **Site tools** in the address bar to see what the site exposes, and ask. Use GPT-5.6 Sol or Terra; Luna has site tools switched off. The first answer takes about a minute while the agent reads the map and plans. After that every step is instant, because the model isn't in the loop between steps.

PeruBank:

1. `How do I turn on international transfers?` Profile menu, settings tab, collapsed section, toggle, confirmation code.
2. While the profile menu is lit: `Just do it for me.` PeruBank lets the agent open a menu. When Confirm lights up, ask again. PeruBank refuses, the agent explains, you press it.
3. Now switch it off yourself, no agent: profile menu › Settings › Transfer limits › Advanced. Four clicks. That's the part I actually care about.
4. `Lumen Coffee charged me twice. How do I dispute it?` The dispute form is behind three dots inside the transaction dialog.
5. `What did I spend this week?` One merchant descriptor in the list carries instructions for the agent. It only reaches the agent through a result flagged `untrustedContentHint`, and even a fooled model couldn't move money, because Transfer is marked irreversible in the markup.

Meridian:

1. `How do I add the label "needs-design" to ATL-136?` The Labels field is inside a collapsed Details section.
2. `How do I add a "Code Review" column to this board?`
3. `ATL-136 is actually a bug. How do I change its type?` The type icon next to the key is a button.
4. `Who gets an email when an issue is assigned, and how do I add all watchers?`

Click the wrong thing on purpose once and watch the agent notice. Open **Agent activity** before you ask and the scoreboard lights up as things happen.

Both sites are fakes, so not every button does something, but every button tells you which it is. Everything the prompts above touch really changes state. Anything else shows a small "not wired up in this demo" note when you click it, so nothing fails silently.

**In Chrome 149+**: turn on `chrome://flags/#enable-webmcp-testing`, open the URL, and call the tools from DevTools (Application › WebMCP) or the [Model Context Tool Inspector](https://github.com/GoogleChromeLabs/webmcp-tools) extension. `check.html` next to the sites tells you whether your browser has the API at all.

**Locally**:

```
npm install
npm start          # http://localhost:8080 is PeruBank, http://localhost:8080/meridian/ is Meridian
npm test           # Playwright drives both sites through document.modelContext in your installed Chrome
```

## The convention

Two files and three attributes, more or less. Load the files from the top-level page, start them with the app's name and a snapshot of its state, and mark the elements you want the agent to be able to point at:

```html
<link rel="stylesheet" href="showme.css">
<script type="module">
  import { startGuide } from './showme.js'
  startGuide({ app: 'PeruBank', state: () => ({ international_transfers: 'off' }) })
</script>

<button data-guide="settings.limits.advanced"
        data-guide-desc="Advanced section header on the Transfer limits page. Collapsed by default; expand it to reach International transfers"
        data-guide-delegable>
```

- `data-guide` is the id agents use.
- `data-guide-desc` is the sentence the agent reads. Write it the way you'd explain it to a new colleague. If you have a help center, you've already written most of these.
- `data-guide-delegable` marks steps the site allows an agent to do for the person. Leave it off and the step is theirs.
- `data-guide-goto="screen-id"` says where a click leads, `data-guide-menu="opener-id"` says the element lives inside a menu, `data-guide-danger` marks things that can't be undone, which are never delegated.
- `data-screen`, `data-panel`, `data-dialog` and `data-menu` group elements so the agent knows what has to be open first.

The map is rebuilt from the live DOM on every call, so anything rendered dynamically (transaction rows, the WIP limit fields for each column) is in it without doing anything. Colours come from `--showme-*` variables, which is why the spotlight is teal on PeruBank and blue on Meridian with the same two files.

One honest caveat: the map only knows about screens that are in the DOM. Both demo sites keep every screen on the page and hide the inactive ones. A router that unmounts inactive screens would show the agent just the current one. I haven't tried it on a site built that way yet.

## How WebMCP is used

| Tool | What it does | WebMCP detail |
|---|---|---|
| `get_ui_map` | Every screen, panel, menu and element, with ids and a few guiding rules, read from the live DOM | `readOnlyHint`, `untrustedContentHint` (merchant names, column names and issue titles are typed by people) |
| `get_current_view` | Screen, panel, open menu or dialog, visible ids, walkthrough state, a snapshot of app data | `readOnlyHint`, `untrustedContentHint` |
| `run_walkthrough` | Takes the whole path. The page spotlights each element with the agent's message, waits for the person to click, tick or type, then moves on by itself. Returns `completed`, `interrupted` with the reason (wrong click, stopped), `blocked` when a step isn't reachable, or `in_progress` after `timeout_seconds` while the walkthrough keeps running | long-running `execute` that honours the `AbortSignal`; returns what the person did and the new view, so the agent verifies instead of guessing; `untrustedContentHint` because the view echoes people-typed text |
| `do_step_for_person` | Performs a step only if the site allows it; refuses money moves and configuration changes with the policy text | the policy lives in the markup, not in the prompt; `untrustedContentHint` |
| `end_walkthrough` | Clears the guide | registered with an `AbortController` only while a walkthrough is active, so the agent's tool list changes live (`toolchange`) |

Registration goes through `document.modelContext.registerTool`. If a browser rejects an annotation, the tool gets registered again without it and the drawer tells you. Nothing in the page talks to the tools except through that API; the test discovers them with `getTools()` and runs them with `executeTool()`.

Why one call for the whole path: my first version did one spotlight per call, and in ChatGPT every round trip cost 10 to 20 seconds of model time, so the person sat there waiting between every click. Handing the whole plan to the page fixed that.

Something that confused me at first: the agent's call log is really short. It reads the map once and calls `run_walkthrough` once per path, and everything interesting happens inside that one call. So each site has an **Agent activity** panel that shows what's going on inside it: which parts of the API have actually been used this session, what `getTools` lists right now, and a transcript of every call and every click you did. If a spotlighted step sits underneath the panel, it fades out and lets the click through.

![Agent activity on PeruBank after a guide: the WebMCP scoreboard](docs/bank-drawer.png)

## How it's different from what exists

| | Help article | Scripted tour (Pendo, Intro.js) | Screen-reading agent | ShowMe on WebMCP |
|---|---|---|---|---|
| Who plans the path | a writer, once | the site, one tour at a time | the model, from pixels | the agent, from the site's own map, for any question |
| Matches your screen | no | for the tours the site wrote | mostly | yes, read from the live DOM on every call |
| Waits for you to do the step | no | yes | no, it acts or guesses | yes, as a structured tool result |
| Knows what you did | no | yes | no | yes: clicked, typed what, chose what |
| Site decides what an agent may do | n/a | n/a | no | yes, in the markup |
| Works with any agent | n/a | n/a | one vendor | any agent in a WebMCP browser |

Microsoft's Copilot Vision "Highlights" is the closest thing I know of, and it proved people want "show me how". But it works from pixels, for one assistant, and it can't know whether you did the step or whether the site would even let an agent do it.

## Reading the code

It's all in [`showme.js`](showme.js), about 750 lines of vanilla JavaScript, no build step. If you only have five minutes, read `register()`, `runWalkthrough()` and `doStep()`. `uiMap()` builds the map, `waitFor()` is the wait for one real human action, `whyHidden()` works out what has to be opened first and says so in a sentence the agent can act on.

## What I deliberately didn't use

- **Declarative tools** (`<form toolname>`). ChatGPT's browser only supports the imperative API, and a walkthrough isn't a form submission anyway.
- **Cross-origin tools** (`exposedTo`, `allow="tools"` iframes). Not in ChatGPT's browser, and the files live in the page they annotate.
- **`requestUserInteraction`**. Still a proposal. The refusal policy in `do_step_for_person` is the version that works today.

## What I'd do next

- Scoped maps. `get_ui_map` returns the whole site, about 20K characters on PeruBank and 40K on Meridian. That's more than I'd like, and it's most of the minute the first answer takes. The fix is to return the list of screens plus the current screen's elements, and let the agent fetch other screens on demand.
- `requestUserInteraction` once browsers ship it, so the browser does the waiting instead of the page.
- Declarative tools for the two read-only tools, once ChatGPT's browser supports them.
- Run it on a site I didn't build.

## Notes

- `run_walkthrough` returns `in_progress` after 40 seconds by default while the walkthrough keeps running on the page, so a runtime with a shorter tool timeout just calls it again. If yours cuts earlier, change the default in `showme.js`.
- The pages only ever talk to `document.modelContext`. `npm test` injects Google's polyfill (in `vendor/`, Apache-2.0) into the test browser so the walkthrough runs on a stock Chrome. The pages never load it.
- PeruBank and Meridian are fakes I built for this. Names, balances, issues and people are invented. Nothing leaves your browser.
- Opening the HTML files from disk shows a banner instead of the app, because browsers block ES modules on `file://`. Use `npm start` or the live URL.

MIT © 2026 Sergio Huanca
