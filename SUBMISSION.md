# Kit de entrega · WebMCP Challenge

Fecha límite: **3 de septiembre de 2026, 1:00 pm hora del Pacífico** (Devpost). Todo lo que se entrega va en inglés.

## Estado al despertar

Hecho y probado en localhost:

- Meridian, la réplica tipo Jira, con tablero, ajustes de tablero, ajustes de proyecto, menús, diálogo de notificaciones, panel de ticket (tipo, etiquetas en la sección Details colapsada, watchers tras el icono del ojo, bandera en el menú "⋯", estado, comentarios) y todas las entradas del menú lateral con su pantalla.
- La capa ShowMe con las seis herramientas WebMCP, overlay, cursor y panel "Agent activity".
- Consola de agente de respaldo (Claude desde la página). Probada con la API simulada, no con una clave real.
- `npm test`: recorrido completo con Playwright sobre tu Chrome instalado, 19 capturas en `test/shots`.
- README en inglés, licencia MIT, repo git con commits fechados dentro del periodo.

Pendiente, en este orden:

1. Probarlo en la app de escritorio de ChatGPT (ver abajo).
2. Desplegar con HTTPS y poner la URL en el README.
3. Grabar el video (guion abajo) y subirlo público a YouTube.
4. Crear el repo público en GitHub y hacer push.
5. Enviar en Devpost con el texto de abajo.

## Antes de grabar

```
cd ~/hackatons/showme
npm start            # http://localhost:8080  (para ChatGPT necesitas la URL desplegada)
```

- Abre la URL en el navegador de la app de escritorio de ChatGPT. Modelo GPT-5.6 Sol o Terra. Pulsa **Site tools** en la barra de direcciones y confirma que aparecen las cinco herramientas base.
- Recarga la página antes de cada toma: el estado vive en memoria y así el tablero vuelve a estar limpio.
- Abre **Agent activity** en la barra superior en la segunda toma, no en la primera: primero el efecto, después la explicación.
- Ventana de 1440 de ancho o más. Zoom 100 %.
- El agente entrega toda la ruta en una sola llamada a `run_walkthrough` y la página marca el ritmo: cada spotlight aparece al instante cuando terminas el paso anterior. Si ChatGPT corta una llamada larga antes de 40 s, baja el valor por defecto en `showme.js` (busca `: 40`) a 25 y vuelve a desplegar.
- En ChatGPT elige el razonamiento más bajo disponible para el modelo (Sol "Low" o similar): solo planifica una vez, así que no necesita pensar mucho y el arranque es más rápido.

Prompts exactos, en este orden:

1. `How do I add a "Code Review" column to this board?`
2. En mitad de la guía, haz clic en otro sitio a propósito (por ejemplo en "Swimlanes"). El agente lo nota.
3. Cuando ilumine el botón **Add**: `Just do it for me.` Meridian lo rechaza, el agente lo explica y sigue guiando.
4. Tras terminar: `How do I add the label "needs-design" to ATL-136?` La guía abre la tarjeta, expande la sección Details que está colapsada y llega al campo Labels. Es el ejemplo más rebuscado, úsalo.
5. Opcional si sobra tiempo: `ATL-136 is actually a bug. How do I change its type?` El icono de tipo junto a la clave es un botón que nadie descubre.
6. Opcional: `Who gets an email when an issue is assigned, and how do I add all watchers?`

## Plan B si ChatGPT no muestra Site tools

- Chrome 149 o superior con `chrome://flags/#enable-webmcp-testing` activado y la extensión Model Context Tool Inspector para invocar herramientas, o
- El panel **Backup agent** dentro de Agent activity con una clave de Anthropic. Mismo flujo, mismo overlay.

## Despliegue

Es un sitio estático. Cualquiera de estas dos:

```
npx vercel --prod          # sigue el asistente, raíz del proyecto, sin build
```

o arrastra la carpeta (sin `node_modules`) a https://app.netlify.com/drop. Necesitas HTTPS: WebMCP exige contexto seguro. Después pon la URL al principio del README y haz commit.

## Guion del video (menos de 3 minutos, narración en inglés)

**0:00 – 0:20 · El problema.** Pantalla: el tablero de Meridian.
"This is Meridian, a tracker like the one your team lives in. Try to find where you add a column. Today you have two options: a help article that says 'go to board settings' while your screen looks nothing like it, or an agent that does it for you, so you learn nothing and the site has to trust a robot with its configuration. We built the third option."

**0:20 – 1:35 · La demo.** Pantalla dividida: ChatGPT a la izquierda, Meridian a la derecha. Si prefieres un solo caso, el de la etiqueta en ATL-136 cruza tarjeta, sección colapsada y campo, y se entiende sin explicar nada.
Escribe el prompt 1. Mientras el agente guía: "The agent asks Meridian for a map of its own interface, plans the path, and lights up one step at a time. I do every click." Haz clic en otro sitio a propósito: "If I wander off, it notices and adapts." Cuando ilumine Add, escribe "Just do it for me": "Meridian refuses. Navigation can be delegated; changing the board configuration is mine. The site decides, not the prompt." Termina la guía: "At the end it tells me the path so next time I don't need it."

**1:35 – 1:55 · Lo que ve el agente.** Abre Agent activity.
"This panel is the live tool list from document.modelContext. Two read-only tools, run_walkthrough, which takes the whole path and only resolves as the person acts, one policy-gated action, and end_walkthrough, which only exists while a guide is running. Every call the agent made is logged here."

**1:55 – 2:20 · Cómo se hace.** Muestra `index.html` con un elemento `data-guide` y `showme.js` con `registerTool`.
"Three attributes on an element make it teachable: an id, a sentence written for a colleague, and whether the site allows an agent to do that step. The map is built from the live page, so anything rendered dynamically is included. The whole layer is one file."

**2:20 – 2:45 · Por qué WebMCP.**
"Microsoft's Copilot Vision showed people want 'show me how'. But it guesses from screen pixels, on Windows, for one assistant. With WebMCP the site publishes its own map, any agent in any browser can teach it, it waits for the person as a structured tool call, and the last click stays human. That is what an open, agent-ready web should feel like."

**2:45 – 2:55 · Cierre.** "ShowMe. Agents that teach instead of doing. Built on WebMCP."

## Texto para Devpost (pegar tal cual)

**Project name:** ShowMe

**Tagline:** Agents that teach instead of doing. The site publishes a map of its UI through WebMCP; your agent lights up the path and waits for your click.

**Description:**

Every "how do I…" on the web today ends one of two ways: a help article that says "go to Settings › Columns" while your screen looks nothing like the article, or an agent that does it for you, so you learn nothing and the site has to trust a robot with its configuration. ShowMe is the third option.

**Why WebMCP is a strong fit.** Teaching needs three things only the page has: a truthful map of its own interface, the ability to wait for a real human action, and a say in what an agent may do. WebMCP gives the site a standard channel for all three. Meridian, our Jira-style demo tracker, registers five tools with document.modelContext: two read-only tools (get_ui_map, get_current_view), run_walkthrough, a long-running tool that takes the whole planned path and lets the page pace the person, moving the spotlight the instant each step is done and reporting why when they do something else, a policy-gated do_step_for_person, and end_walkthrough, which is registered with an AbortController only while a guide is active so the agent's tool list changes live. Results carry the new view so the agent verifies instead of guessing; hidden elements return an explanation of what to open first; user-typed values are flagged with untrustedContentHint.

**How it creates a better user experience.** The person keeps their hands. The page dims, one element is spotlighted with a one-line message, and the spotlight moves to the next step the instant the person has done this one, with no model round trip in between. If they click somewhere else, the agent notices and adapts. If they ask the agent to just do it, Meridian allows navigation and search boxes but refuses configuration changes, and the agent explains why. An Agent activity panel shows the live tool list and every call, so nothing happens behind the person's back. At the end the agent says the path in one line so next time they won't need it.

**What people and agents can accomplish together that was difficult or impossible before.** On-demand, question-driven guidance on any site, by the person's own agent, without the site scripting a single tour and without the agent guessing from pixels. Microsoft's Copilot Vision "Highlights" proved people want "show me how", but it works from screen pixels, on Windows, in the US, for one assistant, and cannot know whether you did the step. Here the site publishes its own map, any agent in any WebMCP browser can teach it, waiting for the person is a structured tool call, and the site decides which steps stay human.

**How WebMCP is implemented.** One vanilla JS file (showme.js) builds the map from data-guide attributes in the live DOM (id, description, where a click leads, which menu or dialog it lives in, whether it is delegable or irreversible), renders the spotlight overlay, registers the tools, and renders getTools() in the Agent activity drawer on every toolchange. Three attributes make any site teachable. A Playwright walkthrough test drives two complete guides, the wrong-click recovery, the policy refusals, the dynamic tool list, and a mocked run of the in-page backup agent that talks to Claude through the same tools.

**Built with:** WebMCP (document.modelContext), vanilla JavaScript, HTML, CSS, Playwright for tests, Google's WebMCP polyfill for browsers without the native API.

**Testing instructions:** Open the live URL in ChatGPT's desktop browser (GPT-5.6 Sol or Terra), click Site tools to see the tools, and ask: "How do I add a Code Review column to this board?" Follow the spotlight, click the wrong thing once, and ask "Just do it for me" on the final Add button. Then ask "Who gets an email when an issue is assigned, and how do I add all watchers?" In Chrome 149+, enable chrome://flags/#enable-webmcp-testing and use DevTools or the Model Context Tool Inspector; the Agent activity button shows the live tool list. Locally: npm install, npm start, npm test.

**Category:** Web (alternativa: Machine Learning/AI).
