import './require-browser-qa-supervisor.mjs'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9345)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5197'
const evidenceRoot = resolve(process.env.ARMSTEEL_EVIDENCE_DIR ?? 'docs/invisible-world/evidence')
const errors = []
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
let networkDeliverySummary = null
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && waiting.has(message.id)) {
    const { resolve: resolveCall, reject, method, timeout } = waiting.get(message.id)
    waiting.delete(message.id)
    clearTimeout(timeout)
    if (message.error) reject(new Error(`${method}: ${message.error.message}`))
    else resolveCall(message.result)
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(`uncaught: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(`console: ${message.params.args.map((item) => item.value ?? item.description ?? '').join(' ')}`)
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(`log: ${message.params.entry.text}`)
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) errors.push(`http ${message.params.response.status}: ${message.params.response.url}`)
})

function call(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolveCall, reject) => {
    const timeout = setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); reject(new Error(`CDP timeout: ${method}`)) } }, 30000)
    waiting.set(id, { resolve: resolveCall, reject, method, timeout })
  })
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function waitForScene(id) {
  await call('Page.navigate', { url: `${base}/exhibits/${id}` })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`Boolean(document.querySelector('.iw-scene') && document.querySelector('.iw-canvas')?.width > 0)`)) return
    await sleep(100)
  }
  throw new Error(`${id} did not mount its exhibit scene`)
}

async function saveScreenshot(relativePath) {
  const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  const path = resolve(evidenceRoot, relativePath)
  await mkdir(resolve(path, '..'), { recursive: true })
  await writeFile(path, Buffer.from(shot.data, 'base64'))
  return path
}

async function clickAt(x, y) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
}

async function pressKey(key) {
  const codes = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, ' ': 32 }
  const code = codes[key] ?? 0
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code })
}

async function focusCanvas() { await evaluate(`document.querySelector('.iw-canvas')?.focus()`) }

async function clickButton(label) {
  const target = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const button = buttons.find((item) => {
      const text = (item.getAttribute('aria-label') || item.innerText).replace(/\\s+/g, ' ').trim()
      return text === ${JSON.stringify(label)} || text.startsWith(${JSON.stringify(label + ' ')})
    })
    if (!button || button.disabled) return null
    const panel = button.closest('.control-panel')
    if (panel) {
      const panelRect = panel.getBoundingClientRect(), buttonRect = button.getBoundingClientRect()
      if (buttonRect.bottom > panelRect.bottom) panel.scrollTop += buttonRect.bottom - panelRect.bottom + 8
      else if (buttonRect.top < panelRect.top) panel.scrollTop -= panelRect.top - buttonRect.top + 8
    } else {
      const rect = button.getBoundingClientRect()
      if (rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight) {
        button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }
    const rect = button.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: button.innerText.trim() }
  })()`)
  assert.ok(target, `Missing or disabled button: ${label}`)
  await clickAt(target.x, target.y)
}

async function clickCollectionDockLink() {
  const target = await evaluate(`(() => {
    const link = document.querySelector('.experience-dock a.dock-home')
    if (!link || !link.getAttribute('aria-label')?.includes('return to the collection')) return null
    const rect = link.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  assert.ok(target, 'The exhibit dock exposes its accessible return-to-collection link')
  await clickAt(target.x, target.y)
}

async function clickPartialLabel(label) {
  const target = await evaluate(`(() => {
    const element = [...document.querySelectorAll('label.range-control')].find((item) => item.innerText.toLowerCase().includes(${JSON.stringify(label.toLowerCase())}))
    if (!element) return null
    element.scrollIntoView({ block: 'center' })
    const input = element.querySelector('input[type=range]')
    const rect = input.getBoundingClientRect()
    return { x: rect.left + rect.width * .78, y: rect.top + rect.height / 2 }
  })()`)
  assert.ok(target, `Missing range control: ${label}`)
  await clickAt(target.x, target.y)
}

async function toggleControls() { await clickButton('Toggle experiment controls'); await sleep(180) }

async function clickExhibitLink(id) {
  const opened = await evaluate(`(() => {
    const link = document.querySelector(${JSON.stringify(`a[href="/exhibits/${id}"]`)})
    if (!link) return false
    link.click()
    return true
  })()`)
  assert.ok(opened, `Gallery has no link for ${id}`)
}

async function waitForRoute(id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`location.pathname === ${JSON.stringify(`/exhibits/${id}`)} && Boolean(document.querySelector('.iw-scene'))`)) return
    await sleep(100)
  }
  throw new Error(`SPA navigation to ${id} did not mount its scene`)
}

async function touch(x, y, moveTo) {
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
  if (moveTo) {
    await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: moveTo.x, y: moveTo.y, id: 1 }] })
    await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: moveTo.x, y: moveTo.y, id: 1 }] })
  }
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: moveTo?.x ?? x, y: moveTo?.y ?? y, id: 1 }] })
}

async function viewport(width, height, mobile = false) {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height })
  await call('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 1 })
  const actual = await evaluate(`({ width: innerWidth, height: innerHeight })`)
  assert.ok(Math.abs(actual.width - width) <= 2 && Math.abs(actual.height - height) <= 2, `Viewport override ${width}×${height} did not apply: ${JSON.stringify(actual)}`)
}

async function assertNoHorizontalOverflow(id, panelExpected = false) {
  const result = await evaluate(`(() => {
    const scene = document.querySelector('.iw-scene')
    const panel = document.querySelector('#experiment-controls')
    const rect = scene?.getBoundingClientRect()
    return { innerWidth, documentWidth: document.documentElement.scrollWidth, scene: rect && { width: rect.width, right: rect.right }, panelVisible: panel?.classList.contains('is-open'), panelRight: panel?.getBoundingClientRect().right }
  })()`)
  assert.ok(result.documentWidth <= result.innerWidth + 1, `${id} has horizontal document overflow: ${JSON.stringify(result)}`)
  assert.ok(result.scene && Math.abs(result.scene.width - result.innerWidth) < 2, `${id} canvas width does not fill the viewport: ${JSON.stringify(result)}`)
  if (panelExpected) assert.ok(result.panelVisible, `${id} control panel is not open`)
}

async function waitForCanvasFit(id, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const layout = await evaluate(`(() => { const rect = document.querySelector('.iw-scene')?.getBoundingClientRect(); return rect && { innerWidth, width: rect.width } })()`)
    if (layout && Math.abs(layout.innerWidth - layout.width) < 2) return
    await sleep(100)
  }
  await assertNoHorizontalOverflow(id)
}

async function scrollGalleryCardIntoView(id) {
  const target = await evaluate(`(() => {
    const card = document.querySelector(${JSON.stringify(`.gallery-card a[href="/exhibits/${id}"]`)})?.closest('.gallery-card')
    if (!card) return null
    document.documentElement.style.scrollBehavior = 'auto'
    document.body.style.scrollBehavior = 'auto'
    const top = card.getBoundingClientRect().top + scrollY - 28
    window.scrollTo({ top, left: 0, behavior: 'instant' })
    return { top, scrollY, width: innerWidth }
  })()`)
  assert.ok(target, `Gallery preview card is missing for ${id}`)
  await sleep(700)
  const visible = await evaluate(`(() => {
    const card = document.querySelector(${JSON.stringify(`.gallery-card a[href="/exhibits/${id}"]`)})?.closest('.gallery-card')
    const canvas = card?.querySelector('.artwork-preview')
    const rect = card?.getBoundingClientRect()
    return Boolean(canvas && canvas.width > 0 && canvas.height > 0 && rect && rect.top >= -120 && rect.top < innerHeight)
  })()`)
  assert.ok(visible, `Gallery preview did not enter the viewport for ${id}`)
}

async function prepareDesktop(id) {
  await waitForScene(id)
  await viewport(1440, 900, false)
  await sleep(120)
  await sleep(id === 'lensing' ? 2300 : 800)
  await assertNoHorizontalOverflow(id)
  if (id === 'sound') assert.equal(await evaluate(`document.querySelector('.iw-sound-actions span')?.textContent.trim()`), 'AUDIO OFF', 'Sound remains silent until a visitor starts it')
  await saveScreenshot(`${id}/01-opening-desktop.png`)
  await sleep(2200)
  await saveScreenshot(`${id}/02-evolved-desktop.png`)
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Page.setLifecycleEventsEnabled', { enabled: true })
await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const Native = window.AudioContext; window.__armsteelAudioContexts = []; window.AudioContext = function(...args) { const context = new Native(...args); window.__armsteelAudioContexts.push(context); return context }; Object.setPrototypeOf(window.AudioContext, Native); window.AudioContext.prototype = Native.prototype })()` })

const studies = ['waves', 'optics', 'sound', 'garden', 'network', 'lensing']
for (const id of studies) {
  await prepareDesktop(id)

  if (id === 'waves') {
    await clickAt(1050, 470)
    await sleep(260)
  } else if (id === 'optics') {
    await clickAt(1440 * 0.47, 900 * 0.5)
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1440 * 0.55, y: 900 * 0.56, buttons: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1440 * 0.55, y: 900 * 0.56, button: 'left', buttons: 0 })
    await sleep(250)
  } else if (id === 'sound') {
    await toggleControls()
    await clickButton('2nd')
    await toggleControls()
    await clickButton('Listen to the signal')
    await sleep(350)
    assert.equal(await evaluate(`document.querySelector('.iw-sound-actions span')?.textContent.trim()`), 'AUDIO ON · LOW LEVEL', 'The audio graph starts only after the explicit button action')
    await clickButton('Mute generated sound')
    assert.ok(await evaluate(`Boolean(document.querySelector('.iw-sound-actions button[aria-label="Unmute generated sound"]'))`), 'The mute control silences the running oscillator')
    await clickButton('Unmute generated sound')
    await clickButton('Stop sound')
    await clickButton('Listen to the signal')
    await clickButton('Stop sound')
    await clickButton('Listen to the signal')
    assert.equal(await evaluate(`window.__armsteelAudioContexts?.length`), 1, 'Repeated start, mute and stop reuses one Web Audio context')
  } else if (id === 'garden') {
    await clickButton('Scatter food')
    await clickAt(770, 500)
    await sleep(700)
  } else if (id === 'network') {
    await toggleControls()
    await clickButton('Send a burst')
    await toggleControls()
    await clickButton('Fail link')
    await clickAt(1440 * 0.24, 900 * 0.35)
    await sleep(700)
    await clickButton('Send')
    await clickAt(1440 * 0.13, 900 * 0.5)
    await clickAt(1440 * 0.9, 900 * 0.5)
    assert.ok((await evaluate(`document.querySelector('.iw-network-route')?.textContent`)).includes('Sent'), 'Choosing source then destination sends a packet directly from the graph')
  } else if (id === 'lensing') {
    await toggleControls()
    await clickButton('Near-critical flyby')
    await clickButton('Ray path')
    await toggleControls()
    await sleep(650)
  }
  await assertNoHorizontalOverflow(id)
  await saveScreenshot(`${id}/03-interaction-desktop.png`)
  if (id === 'sound') await clickButton('Stop sound')
  if (id === 'network') {
    await sleep(1800)
    networkDeliverySummary = await evaluate(`(() => { const text = document.querySelector('.iw-network-stats')?.innerText ?? ''; const match = text.match(/(\\d+) delivered/); return { tick: Number(text.match(/TICK (\\d+)/)?.[1] ?? 0), delivered: Number(match?.[1] ?? 0), status: document.querySelector('.iw-network-route')?.innerText ?? '' } })()`)
    assert.ok(networkDeliverySummary.delivered > 0, `A graph-sent packet delivers after traversing the live network: ${JSON.stringify(networkDeliverySummary)}`)
    await saveScreenshot('network/08-delivered-desktop.png')
  }

  if (id === 'waves') {
    await focusCanvas()
    const before = await evaluate(`document.querySelector('.iw-wave-meter > span').textContent`)
    await pressKey('ArrowRight'); await pressKey('Enter')
    assert.notEqual(await evaluate(`document.querySelector('.iw-wave-meter > span').textContent`), before, 'Wave probe responds to keyboard input')
  } else if (id === 'optics') {
    await focusCanvas()
    await pressKey('ArrowRight')
    const angle = await evaluate(`document.querySelectorAll('label.range-control input')[4]?.value`)
    assert.equal(Number(angle), 0.04, 'Optical source direction responds to keyboard input')
  } else if (id === 'sound') {
    await toggleControls(); await focusCanvas()
    const amplitude = await evaluate(`[...document.querySelectorAll('label.range-control')].find((label) => label.innerText.toLowerCase().includes('harmonic 2 amplitude'))?.querySelector('input')?.value`)
    await pressKey('ArrowUp')
    const nextAmplitude = await evaluate(`[...document.querySelectorAll('label.range-control')].find((label) => label.innerText.toLowerCase().includes('harmonic 2 amplitude'))?.querySelector('input')?.value`)
    assert.notEqual(nextAmplitude, amplitude, 'Harmonic amplitude responds to keyboard input')
    await toggleControls()
  } else if (id === 'garden') {
    await focusCanvas()
    const before = await evaluate(`document.querySelector('.iw-garden-canvas')?.getAttribute('aria-label')`)
    await pressKey('ArrowRight'); await pressKey('Enter')
    assert.ok(before?.includes('arrow keys'), 'Garden canvas documents keyboard tool placement')
  } else if (id === 'network') {
    await focusCanvas()
    await pressKey('Enter')
    assert.ok((await evaluate(`document.querySelector('.iw-network-canvas')?.getAttribute('aria-label')`))?.includes('press Enter'), 'Network canvas documents keyboard message sending')
  } else if (id === 'lensing') {
    await focusCanvas()
    assert.ok(await evaluate(`document.activeElement?.classList.contains('iw-lensing-canvas')`), 'Lensing canvas receives keyboard focus')
    const before = await evaluate(`document.querySelector('.iw-lensing-readout > div').textContent`)
    await pressKey('ArrowLeft')
    await sleep(90)
    assert.notEqual(await evaluate(`document.querySelector('.iw-lensing-readout > div').textContent`), before, 'Lensing impact parameter responds to keyboard input')
  }

  await toggleControls()
  if (id === 'lensing') await clickButton('Inspect the mathematical model')
  if (id === 'waves') await clickButton('Energy')
  if (id === 'optics') await clickButton('Periscope')
  if (id === 'sound') {
    await clickButton('Spectrogram')
    const active = await evaluate(`document.querySelector('.iw-sound-canvas')?.getAttribute('aria-label')`)
    assert.ok(active?.includes('10 harmonics'), 'Adding a second harmonic changes the triangle-wave signal model')
  }
  if (id === 'garden') await clickButton('Cool bloom')
  if (id === 'network') await clickButton('Reset network')
  await sleep(250)
  await assertNoHorizontalOverflow(id, true)
  await saveScreenshot(`${id}/04-advanced-desktop.png`)
  if (id === 'waves') {
    await clickButton('Resonant chamber')
    await sleep(420)
    assert.ok(await evaluate(`Boolean([...document.querySelectorAll('.iw-button-row button')].find((button) => button.innerText === 'Resonant chamber')?.classList.contains('selected'))`), 'The cavity preset selects its discrete resonant mode')
    await toggleControls()
    await saveScreenshot('waves/08-resonant-chamber-desktop.png')
    await toggleControls()
    await clickButton('Amplitude')
    for (const [label, path] of [['Double slit', 'waves/09-double-slit-desktop.png'], ['Standing', 'waves/10-standing-desktop.png']]) {
      await clickButton(label)
      await sleep(label === 'Double slit' ? 1800 : 520)
      assert.ok(await evaluate(`Boolean([...document.querySelectorAll('.iw-button-row button')].find((button) => button.innerText === ${JSON.stringify(label)})?.classList.contains('selected'))`), `${label} selects its wave scene`)
      await toggleControls()
      await saveScreenshot(path)
      await toggleControls()
    }
  } else if (id === 'garden') {
    await toggleControls()
    await clickButton('Pause experiment')
    assert.ok(await evaluate(`Boolean(document.querySelector('[aria-label="Resume experiment"]')?.getAttribute('aria-pressed') === 'true')`), 'The garden can be paused before a dense visual stress scene')
    await clickButton('Add life')
    assert.equal(await evaluate(`document.querySelector('.iw-garden-tools button[aria-pressed="true"]')?.textContent`), 'Add life', 'Add life is the selected direct-manipulation tool')
    for (let index = 0; index < 400; index++) {
      await clickAt(250 + (index % 10) * 58, 180 + (Math.floor(index / 10) % 16) * 29)
    }
    await sleep(720)
    const population = Number.parseInt(await evaluate(`document.querySelector('.iw-garden-stats strong')?.textContent ?? '0'`), 10)
    assert.ok(population >= 300 && population <= 320, `The garden renders its near-cap population without exceeding the cap: ${population}`)
    await saveScreenshot('garden/08-high-population-desktop.png')
    await clickButton('Inspect')
  }

  await waitForScene(id)
  await viewport(390, 844, true)
  await sleep(120)
  await sleep(id === 'lensing' ? 850 : 350)
  await assertNoHorizontalOverflow(id)
  await saveScreenshot(`${id}/05-opening-mobile.png`)

  if (id === 'waves') await touch(278, 470)
  else if (id === 'optics') await touch(183, 422, { x: 215, y: 450 })
  else if (id === 'sound') await touch(190, 740)
  else if (id === 'garden') {
    await clickButton('Scatter food')
    await touch(211, 495)
  } else if (id === 'network') {
    await clickButton('Fail link')
    await touch(94, 300)
  } else if (id === 'lensing') await touch(295, 421)
  await sleep(250)
  await saveScreenshot(`${id}/06-interaction-mobile.png`)
  await toggleControls()
  await assertNoHorizontalOverflow(id, true)
  await saveScreenshot(`${id}/07-controls-mobile.png`)

  await toggleControls()
  if (id === 'sound') await clickButton('Listen to the signal')
  for (let cycle = 0; cycle < 2; cycle++) {
    await clickCollectionDockLink()
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(`Boolean(document.querySelector('.exhibition-page'))`)) break
      await sleep(60)
    }
    if (id === 'sound' && cycle === 0) {
      await sleep(180)
      const audio = await evaluate(`({ count: window.__armsteelAudioContexts?.length ?? 0, states: window.__armsteelAudioContexts?.map((context) => context.state) ?? [] })`)
      assert.equal(audio.count, 1, 'Repeated listening reuses one Web Audio context')
      assert.ok(audio.states.every((state) => state === 'closed'), `Leaving the sound study closes its audio context: ${JSON.stringify(audio)}`)
    }
    await clickExhibitLink(id)
    await waitForRoute(id)
    await viewport(390, 844, true)
    await waitForCanvasFit(id)
    await assertNoHorizontalOverflow(id)
  }
}

await viewport(1440, 900, false)
await clickCollectionDockLink()
for (let attempt = 0; attempt < 100; attempt++) {
  if (await evaluate(`Boolean(document.querySelector('.exhibition-page'))`)) break
  await sleep(60)
}
await viewport(1440, 900, false)
const gallerySummary = await evaluate(`({ count: document.querySelectorAll('.featured-piece').length + document.querySelectorAll('.gallery-card').length, cards: document.querySelectorAll('.gallery-card').length })`)
assert.equal(gallerySummary.count, 19, 'The gallery renders all nineteen pieces')
await scrollGalleryCardIntoView('waves')
await saveScreenshot('gallery-19-previews.png')
await scrollGalleryCardIntoView('network')
await saveScreenshot('gallery-19-previews-continued.png')
await evaluate(`document.querySelector('button[aria-label="Search the collection"]')?.click()`)
await sleep(100)
assert.ok(await evaluate(`Boolean(document.querySelector('#collection-search input'))`), 'Collection search opens')
await call('Input.insertText', { text: 'Schwarzschild' })
await sleep(250)
const searchSummary = await evaluate(`({ count: document.querySelector('.result-count')?.textContent.trim(), lensingLink: Boolean(document.querySelector('#gallery-grid a[href="/exhibits/lensing"]')) })`)
assert.equal(searchSummary.count, '01 WORK', 'The collection search finds the relativity work')
assert.ok(searchSummary.lensingLink)
await scrollGalleryCardIntoView('lensing')
await saveScreenshot('gallery-search-schwarzschild.png')

const summary = {
  browser: await evaluate(`({ userAgent: navigator.userAgent, devicePixelRatio, webgl: (() => { const canvas = document.createElement('canvas'); const gl = canvas.getContext('webgl2'); return gl ? gl.getParameter(gl.RENDERER) : 'unavailable' })() })`),
  studies,
  screenshots: studies.length * 7 + 8,
  repeatedSpaEntryExitCycles: studies.length * 2,
  gallery: gallerySummary,
  search: searchSummary,
  networkDelivery: networkDeliverySummary,
  browserErrors: errors,
}
await writeFile(resolve(evidenceRoot, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
socket.close()
if (errors.length) {
  console.error(JSON.stringify(summary, null, 2))
  process.exitCode = 1
} else {
  console.log(`Browser QA passed: ${studies.length} studies, ${summary.screenshots} screenshots, ${summary.repeatedSpaEntryExitCycles} repeated route entries, desktop and mobile routes, no console/HTTP errors.`)
  console.log(JSON.stringify(summary.browser))
}
