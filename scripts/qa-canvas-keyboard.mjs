import './require-browser-qa-supervisor.mjs'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9362)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5215'
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page' && target.url.startsWith(base)) ?? targets.find((target) => target.type === 'page')
assert.ok(page, `No browser page available on CDP port ${port}`)
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
const browserErrors = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const item = pending.get(message.id)
    clearTimeout(item.timeout)
    pending.delete(message.id)
    if (message.error) item.reject(new Error(`${item.method}: ${message.error.message}`))
    else item.resolve(message.result)
  }
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '))
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) browserErrors.push(`http ${message.params.response.status}: ${message.params.response.url}`)
})

function call(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolveCall, reject) => {
    const timeout = setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
    }, 30000)
    pending.set(id, { resolve: resolveCall, reject, method, timeout })
  })
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}

async function waitFor(expression) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await evaluate(expression)) return
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error(`Timed out waiting for ${expression}`)
}

async function key(key, code, windowsVirtualKeyCode, shiftKey = false) {
  const params = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode, shiftKey }
  await call('Input.dispatchKeyEvent', { ...params, type: 'keyDown' })
  await call('Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
}

async function fingerprint() {
  return evaluate(`(() => {
    const canvas = document.querySelector('.attractor-canvas, .lsystem-canvas')
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !canvas.width || !canvas.height) return null
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const stride = Math.max(4, Math.floor(pixels.length / 50000 / 4) * 4)
    let hash = 2166136261
    for (let i = 0; i < pixels.length; i += stride) hash = Math.imul(hash ^ pixels[i], 16777619)
    return { width: canvas.width, height: canvas.height, sampledPixels: Math.ceil(pixels.length / stride), hash: hash >>> 0 }
  })()`)
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })

const viewports = [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'desktop', width: 1024, height: 768, mobile: false },
]
const studies = [
  { id: 'lsystem', labelNeedle: 'arrow keys to pan', title: 'A Grammar of Growth' },
  { id: 'attractors', labelNeedle: 'arrow keys to rotate', title: 'Weather, Remembered' },
]
const results = []
for (const viewport of viewports) {
  await call('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile, screenWidth: viewport.width, screenHeight: viewport.height })
  await call('Emulation.setTouchEmulationEnabled', viewport.mobile ? { enabled: true, maxTouchPoints: 1 } : { enabled: false })
  for (const study of studies) {
    await call('Page.navigate', { url: `${base}/exhibits/${study.id}` })
    const canvasSelector = study.id === 'attractors' ? '.attractor-canvas' : '.lsystem-canvas'
    await waitFor(`location.pathname === '/exhibits/${study.id}' && Boolean(document.querySelector('${canvasSelector}'))`)
    await new Promise((done) => setTimeout(done, 500))

    if (study.id === 'attractors') {
      const resume = await evaluate(`Boolean(document.querySelector('button[aria-label="Resume experiment"]'))`)
      if (resume) {
        await evaluate(`document.querySelector('button[aria-label="Resume experiment"]').click()`)
        await new Promise((done) => setTimeout(done, 800))
        await evaluate(`document.querySelector('button[aria-label="Pause experiment"]')?.click()`)
      }
    }

    const before = await fingerprint()
    assert.ok(before && before.sampledPixels > 1000, `${study.id} has no readable Canvas 2D output at ${viewport.name}`)
    const canvasState = await evaluate(`(() => { const canvas=document.querySelector('.${study.id === 'attractors' ? 'attractor-canvas' : 'lsystem-canvas'}'); return {tabIndex:canvas?.tabIndex ?? -1,label:canvas?.getAttribute('aria-label') ?? '',focusRing:canvas?.matches(':focus-visible') ?? false,outline:getComputedStyle(canvas).outlineWidth} })()`)
    assert.equal(canvasState.tabIndex, 0, `${study.id} canvas cannot receive keyboard focus`)
    assert.ok(canvasState.label.toLowerCase().includes(study.labelNeedle), `${study.id} accessible name is missing keyboard instructions`)

    await evaluate('document.activeElement instanceof HTMLElement && document.activeElement.blur()')
    await key('Tab', 'Tab', 9)
    await new Promise((done) => setTimeout(done, 180))
    const focus = await evaluate(`(() => { const canvas=document.querySelector('.${study.id === 'attractors' ? 'attractor-canvas' : 'lsystem-canvas'}'); const hint=document.querySelector('.canvas-keyboard-hint'); return {onCanvas:document.activeElement===canvas,visible:canvas?.matches(':focus-visible')??false,outline:getComputedStyle(canvas).outlineWidth,instructionsVisible:Number.parseFloat(getComputedStyle(hint).opacity)>.9,instructions:hint?.textContent?.trim()??''} })()`)
    assert.ok(focus.onCanvas, `${study.id} canvas is not in the normal keyboard tab order`)
    assert.ok(focus.visible && Number.parseFloat(focus.outline) >= 2, `${study.id} keyboard focus ring is not visible: ${JSON.stringify(focus)}`)
    assert.ok(focus.instructionsVisible, `${study.id} keyboard instructions do not appear on focus`)

    await key('ArrowRight', 'ArrowRight', 39)
    await new Promise((done) => setTimeout(done, 60))
    assert.equal(await evaluate('location.pathname'), `/exhibits/${study.id}`, `${study.id} arrow key was captured by global exhibit navigation`)
    const panned = await fingerprint()
    assert.notEqual(panned.hash, before.hash, `${study.id} arrow key did not change the rendered view at ${viewport.name}`)

    await key('+', 'Equal', 187, true)
    await new Promise((done) => setTimeout(done, 60))
    const zoomed = await fingerprint()
    assert.notEqual(zoomed.hash, panned.hash, `${study.id} plus key did not change the rendered view at ${viewport.name}`)
    let screenshot
    if (viewport.name === 'phone') screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })

    await key('Home', 'Home', 36)
    await new Promise((done) => setTimeout(done, 90))
    const reset = await fingerprint()
    assert.equal(reset.hash, before.hash, `${study.id} Home key did not restore the initial camera at ${viewport.name}`)
    await key(' ', 'Space', 32)
    await new Promise((done) => setTimeout(done, 50))
    assert.ok(await evaluate(`Boolean(document.querySelector('button[aria-label="Pause experiment"]'))`), `${study.id} canvas focus broke the shared Space-to-run shortcut`)
    await key(' ', 'Space', 32)
    await new Promise((done) => setTimeout(done, 50))
    assert.ok(await evaluate(`Boolean(document.querySelector('button[aria-label="Resume experiment"]'))`), `${study.id} canvas focus broke the shared Space-to-pause shortcut`)
    if (screenshot) {
      const evidenceRoot = resolve('docs/renaissance/evidence')
      await mkdir(evidenceRoot, { recursive: true })
      await writeFile(resolve(evidenceRoot, `canvas-keyboard-${study.id}-phone.png`), Buffer.from(screenshot.data, 'base64'))
    }
    results.push({ study: study.id, viewport, title: study.title, canvasState, focus, before, panned, zoomed, reset, keyboardPan: true, keyboardZoom: true, homeRestore: true, spacePauseResume: true, screenshot: screenshot ? `canvas-keyboard-${study.id}-phone.png` : null })
  }
}

await call('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
socket.close()

const report = {
  browser: 'HeadlessChrome 157 with SwiftShader; 390×844 phone touch emulation and 1024×768 desktop viewport',
  method: 'CDP Tab and key events move and zoom real Canvas 2D scenes. Sampled pixel fingerprints confirm rendered view changes; Home must exactly restore the paused starting image. Space must still resume and pause the focused exhibit through the shared shell. The browser preference is reduced motion so each experiment begins paused.',
  cases: results,
  browserErrors,
}
const evidence = resolve('docs/renaissance/evidence/canvas-keyboard-browser-checks.json')
await writeFile(evidence, `${JSON.stringify(report, null, 2)}\n`)
console.log(`Canvas keyboard checks passed: ${results.length} phone/desktop interactions across ${studies.length} exhibits; Tab focus, visible ring, pan, zoom, exact Home restore and Space pause/resume verified; ${browserErrors.length} browser errors.`)
