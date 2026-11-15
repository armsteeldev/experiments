import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9362)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5217'
const evidenceRoot = resolve('docs/renaissance/evidence')
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page' && target.url === 'about:blank') ?? targets.find((target) => target.type === 'page')
assert.ok(page, `No page target found on CDP port ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let nextId = 0
const waiting = new Map()
const browserErrors = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && waiting.has(message.id)) {
    const { resolve: resolveCall, reject, method, timeout } = waiting.get(message.id)
    clearTimeout(timeout)
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
    const timeout = setTimeout(() => {
      if (!waiting.has(id)) return
      waiting.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
    }, 30000)
    waiting.set(id, { resolve: resolveCall, reject, method, timeout })
  })
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
async function waitFor(expression, label, attempts = 180) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await evaluate(expression)) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function navigate(id, selector) {
  await call('Page.navigate', { url: `${base}/exhibits/${id}` })
  await waitFor(`location.pathname === ${JSON.stringify(`/exhibits/${id}`)} && Boolean(document.querySelector(${JSON.stringify(selector)}))`, `the ${id} exhibit`)
}

async function click(selector, label = selector) {
  const clicked = await evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item || item.disabled) return false; item.click(); return true })()`)
  assert.equal(clicked, true, `${label} is present and enabled`)
}

async function clickText(text, root = 'document') {
  const clicked = await evaluate(`(() => { const item = [...${root}.querySelectorAll('button')].find((button) => button.textContent.trim() === ${JSON.stringify(text)}); if (!item || item.disabled) return false; item.click(); return true })()`)
  assert.equal(clicked, true, `button “${text}” is available`)
}

async function clickDiscoveryAction(text) {
  const visible = await evaluate(`Boolean(document.querySelector('.scene-nudge-action'))`)
  if (!visible) await click('[aria-label="Show interaction tip"]', 'reopen interaction tip')
  await clickText(text)
}

async function capture(name, selector) {
  let clip
  if (selector) {
    clip = await evaluate(`(() => { const {x,y,width,height} = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x,y,width,height,scale:1} })()`)
    assert.ok(clip.width > 0 && clip.height > 0, `${selector} has a visible frame`)
  }
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(clip ? { clip } : {}) })
  const image = Buffer.from(screenshot.data, 'base64')
  await writeFile(resolve(evidenceRoot, name), image)
  return createHash('sha256').update(image).digest('hex')
}

async function drag(selector, from, to) {
  const rect = await evaluate(`(() => { const {x,y,width,height} = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x,y,width,height} })()`)
  const start = { x: rect.x + rect.width * from[0], y: rect.y + rect.height * from[1] }
  const end = { x: rect.x + rect.width * to[0], y: rect.y + rect.height * to[1] }
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start })
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 })
  for (let step = 1; step <= 6; step++) {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (end.x - start.x) * step / 6, y: start.y + (end.y - start.y) * step / 6, button: 'left', buttons: 1 })
    await sleep(35)
  }
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0 })
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
await call('Emulation.setTouchEmulationEnabled', { enabled: false })

const interactions = []
const screenshots = []

// Mandelbrot: use the public zoom control, read the changed coordinates, then restore the view.
await navigate('mandelbrot', '.fractal-canvas')
await waitFor('Boolean(document.querySelector(".canvas-coordinate")?.textContent)', 'Mandelbrot coordinate readout')
const fractalBefore = await evaluate('document.querySelector(".canvas-coordinate").textContent.trim()')
await click('[aria-label="Toggle experiment controls"]')
await waitFor(`Boolean(document.querySelector('.control-panel.is-open button[aria-label="Zoom in"]'))`, 'Mandelbrot navigation controls')
await click('[aria-label="Zoom in"]', 'Mandelbrot zoom control')
await waitFor(`document.querySelector(".canvas-coordinate")?.textContent.trim() !== ${JSON.stringify(fractalBefore)}`, 'Mandelbrot zoom change')
const fractalAfter = await evaluate('document.querySelector(".canvas-coordinate").textContent.trim()')
assert.notEqual(fractalAfter, fractalBefore, 'Mandelbrot zoom action changes the displayed coordinates and scale')
screenshots.push({ exhibit: 'mandelbrot', file: 'interaction-mandelbrot-zoom.png', sha256: await capture('interaction-mandelbrot-zoom.png') })
await clickText('Reset', 'document.querySelector(".control-panel")')
await waitFor(`document.querySelector(".canvas-coordinate")?.textContent.trim() === ${JSON.stringify(fractalBefore)}`, 'Mandelbrot view reset')
interactions.push({ exhibit: 'mandelbrot', action: 'Zoom in then reset', before: fractalBefore, after: fractalAfter, reset: await evaluate('document.querySelector(".canvas-coordinate").textContent.trim()') })

// Fluid: quiet and pause the renderer so a real pointer injection has an unambiguous pixel effect.
await navigate('fluid', '.fluid-canvas')
await click('[aria-label="Toggle experiment controls"]')
await waitFor('Boolean(document.querySelector(".control-panel.is-open"))', 'fluid controls')
await clickText('Quiet', 'document.querySelector(".control-panel")')
await clickText('Strokes only', 'document.querySelector(".control-panel")')
await click('[aria-label="Toggle experiment controls"]', 'close fluid controls')
await click('[aria-label="Pause experiment"]', 'pause fluid simulation')
await waitFor(`Boolean(document.querySelector('[aria-label="Resume experiment"]'))`, 'paused fluid simulation')
if (await evaluate('Boolean(document.querySelector("#fluid-first-move"))')) await click('[aria-label="Dismiss first-move hint"]', 'dismiss fluid hint before capture')
await sleep(180)
const fluidBefore = await capture('interaction-fluid-before.png', '.fluid-canvas')
await drag('.fluid-canvas', [.40, .52], [.62, .49])
await sleep(220)
const fluidAfter = await capture('interaction-fluid-injected.png', '.fluid-canvas')
assert.notEqual(fluidAfter, fluidBefore, 'dragging on the fluid changes its rendered dye and velocity field')
screenshots.push({ exhibit: 'fluid', file: 'interaction-fluid-injected.png', sha256: fluidAfter })
await click('[aria-label="Toggle experiment controls"]', 'open fluid controls to clear the field')
await waitFor(`Boolean(document.querySelector('.control-panel.is-open'))`, 'fluid controls after opening')
await click('.control-panel .panel-action', 'clear the fluid field')
await click('[aria-label="Toggle experiment controls"]', 'close fluid controls after clear')
await click('[aria-label="Show interaction tip"]', 'reopen fluid interaction tip')
await waitFor('Boolean(document.querySelector(".scene-nudge-action"))', 'fluid keyboard-stir action')
const fluidActionBefore = await capture('interaction-fluid-action-before.png', '.fluid-canvas')
await clickText('Stir the centre')
await sleep(100)
const fluidActionAfter = await capture('interaction-fluid-action.png', '.fluid-canvas')
assert.notEqual(fluidActionAfter, fluidActionBefore, 'the visible keyboard-stir action changes the fluid while paused')
screenshots.push({ exhibit: 'fluid', file: 'interaction-fluid-action.png', sha256: fluidActionAfter })
interactions.push({ exhibit: 'fluid', action: 'Pause, drag and use the Stir the centre button', dragBeforeFrame: fluidBefore, dragAfterFrame: fluidAfter, buttonBeforeFrame: fluidActionBefore, buttonAfterFrame: fluidActionAfter, changed: true })

// Reaction–diffusion: paint through the canvas, not just its parameter controls.
await navigate('reaction', '.reaction-canvas')
await click('[aria-label="Pause experiment"]', 'pause reaction simulation')
await waitFor(`Boolean(document.querySelector('[aria-label="Resume experiment"]'))`, 'paused reaction simulation')
if (await evaluate('Boolean(document.querySelector("#reaction-first-move"))')) await click('[aria-label="Dismiss first-move hint"]', 'dismiss reaction hint before capture')
await sleep(100)
const reactionBefore = await capture('interaction-reaction-before.png', '.reaction-canvas')
await drag('.reaction-canvas', [.88, .86], [.92, .86])
await sleep(180)
const reactionAfter = await capture('interaction-reaction-seed.png', '.reaction-canvas')
assert.notEqual(reactionAfter, reactionBefore, 'painting on the reaction canvas changes its rendered chemical field')
screenshots.push({ exhibit: 'reaction', file: 'interaction-reaction-seed.png', sha256: reactionAfter })
interactions.push({ exhibit: 'reaction', action: 'Plant a seed by dragging on the canvas', beforeFrame: reactionBefore, afterFrame: reactionAfter, changed: true })

// Gravity: launch a real body, inspect its readout, and use the recovery action to remove it.
await navigate('gravity', '.gravity-canvas')
const gravityBefore = await evaluate('Number(document.querySelector(".gravity-hud strong")?.textContent.match(/[0-9]+/)?.[0])')
await clickDiscoveryAction('Launch a gentle orbit')
await waitFor(`Number(document.querySelector(".gravity-hud strong")?.textContent.match(/[0-9]+/)?.[0]) === ${gravityBefore + 1}`, 'new orbiting gravity body')
const gravityAfter = await evaluate('document.querySelector(".gravity-inspect")?.textContent.trim() ?? ""')
const gravityNumbers = gravityAfter.match(/-?[0-9]+(?:\.[0-9]+)?/g)?.map(Number) ?? []
assert.ok(gravityNumbers.length >= 2 && gravityNumbers.every(Number.isFinite), 'launched gravity body has finite displayed mass and velocity')
screenshots.push({ exhibit: 'gravity', file: 'interaction-gravity-launched.png', sha256: await capture('interaction-gravity-launched.png') })
await click('[aria-label="Remove selected body"]', 'remove selected gravity body')
await waitFor(`Number(document.querySelector(".gravity-hud strong")?.textContent.match(/[0-9]+/)?.[0]) === ${gravityBefore}`, 'gravity body removal')
interactions.push({ exhibit: 'gravity', action: 'Launch and remove an orbiting body', beforeBodies: gravityBefore, launchedBodies: gravityBefore + 1, launchedReadout: gravityAfter, recoveredBodies: await evaluate('Number(document.querySelector(".gravity-hud strong")?.textContent.match(/[0-9]+/)?.[0])') })

// CPU: step one real instruction and read the machine clock.
await navigate('machine', '.machine-step-button')
const clockBefore = Number(await evaluate('document.querySelector(".machine-status strong").textContent'))
await click('.machine-step-button', 'step the CPU')
await waitFor(`Number(document.querySelector(".machine-status strong")?.textContent) > ${clockBefore}`, 'one executed CPU instruction')
const clockAfter = Number(await evaluate('document.querySelector(".machine-status strong").textContent'))
assert.equal(clockAfter, clockBefore + 1, 'one click advances the CPU by exactly one instruction')
screenshots.push({ exhibit: 'machine', file: 'interaction-cpu-first-instruction.png', sha256: await capture('interaction-cpu-first-instruction.png') })
interactions.push({ exhibit: 'machine', action: 'Step one CPU instruction', clockBefore, clockAfter })

// Neural network: train from its existing labelled examples and check a changed numeric loss.
await navigate('neural', '.neural-learn-button')
const lossBefore = Number(await evaluate('document.querySelector(".neural-loss-readout strong").textContent'))
await click('.neural-learn-button', 'start neural training')
await waitFor(`Number(document.querySelector(".neural-loss-readout strong")?.textContent) !== ${lossBefore}`, 'a changed neural network loss', 240)
const lossAfter = Number(await evaluate('document.querySelector(".neural-loss-readout strong").textContent'))
assert.ok(Number.isFinite(lossAfter) && lossAfter !== lossBefore, 'training changes the displayed network loss')
await click('.neural-learn-button', 'pause neural training')
screenshots.push({ exhibit: 'neural', file: 'interaction-neural-training.png', sha256: await capture('interaction-neural-training.png') })
interactions.push({ exhibit: 'neural', action: 'Train the labelled examples', lossBefore, lossAfter })

// Logic laboratory: keyboard-operated switches must recompute the real AND circuit.
await navigate('logic', '.circuit-canvas')
const toggleInput = async (name) => {
  const selector = `g.node-input[aria-label^="Switch ${name.toUpperCase()} is"]`
  const dispatched = await evaluate(`(() => { const button = document.querySelector(${JSON.stringify(selector)}); if (!button) return false; button.focus(); if (document.activeElement !== button) return false; button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true })()`)
  assert.equal(dispatched, true, `keyboard focus and Enter reach switch ${name.toUpperCase()}`)
}
await toggleInput('a')
await waitFor(`Boolean(document.querySelector('g.node-input[aria-label^="Switch A is on"]'))`, 'keyboard switch A')
await toggleInput('b')
await waitFor(`document.querySelector('g.node-input[aria-label^="Switch B is on"]') && /LAMP 1/.test(document.querySelector('.logic-inspector')?.textContent ?? '')`, 'AND gate output')
const logicResult = await evaluate('({ switches: [...document.querySelectorAll("g.node-input")].map((node) => node.getAttribute("aria-label")), lamp: document.querySelector(".logic-inspector")?.textContent.trim() })')
screenshots.push({ exhibit: 'logic', file: 'interaction-logic-and.png', sha256: await capture('interaction-logic-and.png') })
interactions.push({ exhibit: 'logic', action: 'Turn on both switches by keyboard', result: logicResult })

// Adder: select a known example, run the gate-level arithmetic, then assert the completed result.
await navigate('adder', '.adder-run-button')
await clickText('7 + 9', 'document')
await waitFor(`document.querySelector('[aria-label="First number"]')?.value === '7' && document.querySelector('[aria-label="Second number"]')?.value === '9'`, 'Adder example values')
await click('.adder-run-button', 'calculate with the gate-level Adder')
await waitFor(`document.querySelector('.adder-answer strong')?.textContent.trim() === '16'`, 'completed 7 + 9 calculation', 240)
const adderResult = await evaluate('({ result: document.querySelector(".adder-answer strong")?.textContent.trim(), binary: document.querySelector(".adder-answer code")?.textContent.trim() })')
assert.equal(adderResult.result, '16', 'the gate-level Adder completes 7 + 9 correctly')
screenshots.push({ exhibit: 'adder', file: 'interaction-adder-7-plus-9.png', sha256: await capture('interaction-adder-7-plus-9.png') })
interactions.push({ exhibit: 'adder', action: 'Run a gate-level addition', ...adderResult })

// Cellular Automaton: pause, then advance exactly one generation.
await navigate('automata', '.automata-stats')
await clickText('Ⅱ PAUSE')
await waitFor(`document.querySelector('.automata-stats button')?.textContent.includes('RESUME')`, 'paused automaton')
const generationBefore = Number(await evaluate('document.querySelector(".automata-stats > div strong")?.textContent'))
await click('[aria-label="Pause and advance exactly one generation"]', 'step one automaton generation')
await waitFor(`Number(document.querySelector(".automata-stats > div strong")?.textContent) === ${generationBefore + 1}`, 'single automaton generation')
const generationAfter = Number(await evaluate('document.querySelector(".automata-stats > div strong")?.textContent'))
screenshots.push({ exhibit: 'automata', file: 'interaction-automata-one-generation.png', sha256: await capture('interaction-automata-one-generation.png') })
interactions.push({ exhibit: 'automata', action: 'Pause and step once', generationBefore, generationAfter })

const browser = await evaluate(`(() => {
  let renderer = 'unavailable'
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
  const extension = gl?.getExtension('WEBGL_debug_renderer_info')
  if (gl && extension) renderer = gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
  return { userAgent: navigator.userAgent, renderer }
})()`)
await mkdir(evidenceRoot, { recursive: true })
socket.close()
const report = {
  browser,
  server: base,
  note: 'State-changing browser interactions; canvas evidence is HeadlessChrome/SwiftShader with desktop viewport emulation, not physical GPU or mobile-device evidence.',
  interactions,
  screenshots,
  browserErrors,
}
await writeFile(resolve(evidenceRoot, 'original-interaction-browser-checks.json'), `${JSON.stringify(report, null, 2)}\n`)
assert.equal(browserErrors.length, 0, `browser errors: ${browserErrors.join('; ')}`)
console.log(`Original exhibit interactions passed: ${interactions.length} real state-change checks across ${new Set(interactions.map(({ exhibit }) => exhibit)).size} exhibits; ${screenshots.length} captures; no browser/network errors.`)
