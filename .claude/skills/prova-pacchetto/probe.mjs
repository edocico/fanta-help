// Read what the running app actually renders, over the DevTools protocol.
// Node has a built-in WebSocket client since v22, so nothing needs installing.
const PORT = process.env.PORT || '9222'
const deadline = Date.now() + 25000

let pages = null
while (Date.now() < deadline) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    const found = list.filter((t) => t.type === 'page')
    if (found.length) { pages = found; break }
  } catch {}
  await new Promise((r) => setTimeout(r, 400))
}
if (!pages) {
  console.log(`NESSUN TARGET DEVTOOLS su :${PORT} — la finestra non si è aperta.`)
  console.log('Cause tipiche: ELECTRON_RUN_AS_NODE=1 ancora impostata, oppure la porta era occupata.')
  process.exit(1)
}

const target = pages[0]
console.log('target:', target.title, '|', target.url)

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve) => { ws.onopen = resolve })

const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const evaluate = (expression, id) =>
  new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  })

// Give React a moment to resolve its first IPC round-trip before sampling.
await new Promise((r) => setTimeout(r, 1500))

const dom = await evaluate('document.body.innerText', 1)
console.log('\n===== TESTO A SCHERMO =====')
console.log(dom.result?.result?.value ?? JSON.stringify(dom))

const env = await evaluate(
  `JSON.stringify({
     api: typeof window.api,
     bg: getComputedStyle(document.body).backgroundColor,
     font: getComputedStyle(document.body).fontFamily.slice(0, 60)
   })`, 2)
console.log('\n===== AMBIENTE =====')
console.log(env.result?.result?.value ?? JSON.stringify(env))

ws.close()
