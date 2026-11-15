import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9345)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5197'
const evidenceRoot = resolve('docs/invisible-world/evidence')
const legacyStudies = ['mandelbrot', 'fluid', 'boids', 'attractors', 'reaction', 'lsystem', 'gravity', 'machine', 'neural', 'logic', 'forces', 'automata', 'adder']
const browserErrors = []
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page')
assert.ok(page, `No page target found on CDP port ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const waiting = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && waiting.has(message.id)) {
    const { resolve: resolveCall, reject, method } = waiting.get(message.id)
    waiting.delete(message.id)
    if (message.error) reject(new Error(`${method}: ${message.error.message}`))
    else resolveCall(message.result)
  }
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(`uncaught: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push(`console: ${message.params.args.map((item) => item.value ?? item.description ?? '').join(' ')}`)
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') browserErrors.push(`log: ${message.params.entry.text}`)
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) browserErrors.push(`http ${message.params.response.status}: ${message.params.response.url}`)
})

function call(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolveCall, reject) => {
    waiting.set(id, { resolve: resolveCall, reject, method })
    setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); reject(new Error(`CDP timeout: ${method}`)) } }, 30000)
  })
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function setViewport(width, height, mobile) {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height })
  await call('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 1 })
}

async function waitForStudy(id) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const mounted = await evaluate(`location.pathname === ${JSON.stringify(`/exhibits/${id}`)} && Boolean(document.querySelector('.experiment-viewport')?.children.length) && Boolean(document.querySelector('.dock-current span'))`)
    if (mounted) return
    await sleep(100)
  }
  throw new Error(`${id} did not mount a titled exhibit canvas`)
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
const routes = []

for (const id of legacyStudies) {
  await call('Page.navigate', { url: `${base}/exhibits/${id}` })
  await waitForStudy(id)
  for (const viewport of [{ width: 1440, height: 900, mobile: false }, { width: 390, height: 844, mobile: true }]) {
    await setViewport(viewport.width, viewport.height, viewport.mobile)
    await sleep(220)
    const state = await evaluate(`(() => {
      const stage = document.querySelector('.experiment-viewport')
      const title = document.querySelector('.dock-current span')
      const canvas = document.querySelector('.experiment-viewport canvas')
      const svg = document.querySelector('.experiment-viewport svg')
      const rect = stage?.getBoundingClientRect()
      return { path: location.pathname, innerWidth, innerHeight, documentWidth: document.documentElement.scrollWidth, title: title?.textContent.trim(), content: Boolean(stage?.children.length && (canvas && canvas.width > 0 && canvas.height > 0 || svg || stage.textContent.trim().length > 12)), rendering: canvas && canvas.width > 0 && canvas.height > 0 ? 'canvas' : svg ? 'svg' : 'dom', stage: rect && { left: rect.left, right: rect.right, width: rect.width } }
    })()`)
    assert.equal(state.path, `/exhibits/${id}`)
    assert.ok(state.title, `${id} has no visible exhibit title`)
    assert.ok(state.content, `${id} has no mounted exhibit content`)
    assert.ok(state.documentWidth <= state.innerWidth + 1, `${id} overflows at ${state.innerWidth}px: ${JSON.stringify(state)}`)
    assert.ok(state.stage.left >= -1 && state.stage.right <= state.innerWidth + 1, `${id} stage escapes the viewport at ${state.innerWidth}px: ${JSON.stringify(state)}`)
    routes.push({ id, viewport: `${viewport.width}x${viewport.height}`, title: state.title, rendering: state.rendering })
  }
}

socket.close()
const report = { routes, browserErrors }
await mkdir(evidenceRoot, { recursive: true })
await writeFile(resolve(evidenceRoot, 'existing-route-regression.json'), `${JSON.stringify(report, null, 2)}\n`)
if (browserErrors.length) {
  console.error(JSON.stringify(report, null, 2))
  process.exitCode = 1
} else {
  console.log(`Existing exhibit browser regression passed: ${legacyStudies.length} routes at desktop and mobile viewports; no browser or HTTP errors.`)
}
