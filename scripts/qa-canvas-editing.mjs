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

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
async function waitFor(expression, description) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await evaluate(expression)) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function key(key, code, windowsVirtualKeyCode) {
  const params = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode }
  await call('Input.dispatchKeyEvent', { ...params, type: 'keyDown' })
  await call('Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
}

async function click(selector, description = selector, { scroll = false } = {}) {
  const clicked = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element || element.disabled) return false
    if (${scroll}) element.scrollIntoView({ block: 'nearest' })
    element.click()
    return true
  })()`)
  assert.equal(clicked, true, `${description} is available`)
}

async function clickText(label, root = 'document', { scroll = false } = {}) {
  const clicked = await evaluate(`(() => {
    const scope = ${root}
    const element = [...scope.querySelectorAll('button')].find((button) => button.textContent.trim() === ${JSON.stringify(label)})
    if (!element || element.disabled) return false
    if (${scroll}) element.scrollIntoView({ block: 'nearest' })
    element.click()
    return true
  })()`)
  assert.equal(clicked, true, `button “${label}” is available`)
}

async function waitForCount(selector, value, description) {
  await waitFor(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() === ${JSON.stringify(value)}`, description)
}

async function pixelHash(selector) {
  return evaluate(`(() => {
    const canvas = document.querySelector(${JSON.stringify(selector)})
    const context = canvas?.getContext('2d')
    if (!context || !canvas.width || !canvas.height) return null
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const stride = 4
    let hash = 2166136261
    for (let i = 0; i < pixels.length; i += stride) hash = Math.imul(hash ^ pixels[i], 16777619)
    return { hash: hash >>> 0, width: canvas.width, height: canvas.height }
  })()`)
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })

const viewports = [
  { name: 'narrow', width: 320, height: 740, mobile: true },
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'phone landscape', width: 844, height: 390, mobile: true },
  { name: 'desktop', width: 1024, height: 768, mobile: false },
]
const results = []
for (const viewport of viewports) {
  await call('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile, screenWidth: viewport.width, screenHeight: viewport.height })
  await call('Emulation.setTouchEmulationEnabled', viewport.mobile ? { enabled: true, maxTouchPoints: 1 } : { enabled: false })

  await call('Page.navigate', { url: `${base}/exhibits/boids` })
  await waitFor(`location.pathname === '/exhibits/boids' && Boolean(document.querySelector('.boids-canvas'))`, 'the flocking study')
  await waitFor(`Boolean(document.querySelector('[aria-label="Resume experiment"]'))`, 'the reduced-motion pause state')
  await sleep(120)
  const flockBefore = await pixelHash('.boids-canvas')
  await click('[aria-label="Toggle experiment controls"]', 'open flock controls')
  await waitFor(`Boolean(document.querySelector('.control-panel.is-open'))`, 'open flock controls panel')
  await clickText('Barrier', 'document.querySelector(".control-panel")')
  const minimumTarget = viewport.mobile ? 43.9 : 39.9
  await waitFor(`Number(document.querySelector('.control-panel button[aria-label="Place barrier at the centre"]')?.getBoundingClientRect().height ?? 0) >= ${minimumTarget}`, `${viewport.name} centre-action touch target`)
  const placement = await evaluate(`(() => {
    const button = document.querySelector('.control-panel button[aria-label="Place barrier at the centre"]')
    if (!button) return null
    const bounds = button.getBoundingClientRect()
    return { name: button.getAttribute('aria-label'), height: bounds.height, selected: document.querySelector('.segmented-control button[aria-pressed="true"]')?.textContent.trim() }
  })()`)
  assert.ok(placement && placement.height >= minimumTarget, `Flock centre placement is exposed as a full-size action: ${JSON.stringify(placement)}`)
  assert.equal(placement.selected, 'Barrier', 'the selected flock tool matches the centre-placement action')
  await click('[aria-label="Place barrier at the centre"]', 'place the selected barrier', { scroll: true })
  await sleep(120)
  const flockWithBarrier = await pixelHash('.boids-canvas')
  assert.notEqual(flockWithBarrier.hash, flockBefore.hash, 'placing a barrier at the scene centre changes the flock rendering')
  await waitFor(`document.querySelector('.experiment-surface > .visually-hidden')?.textContent === 'barrier placed at the centre of the field.'`, 'the spoken barrier-placement confirmation')
  let screenshot
  if (viewport.name === 'phone') screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await click('.control-panel button[aria-label="Clear field marks"]', 'clear the flock field marks', { scroll: true })
  await sleep(100)
  const flockCleared = await pixelHash('.boids-canvas')
  assert.equal(flockCleared.hash, flockBefore.hash, 'clearing the flock field restores the original paused rendering')
  assert.equal(await evaluate(`document.querySelector('.experiment-surface > .visually-hidden')?.textContent.trim()`), 'Field marks cleared.', 'clearing the field is confirmed to assistive technology')
  if (screenshot) await writeFile(resolve('docs/renaissance/evidence/canvas-placement-boids-phone.png'), Buffer.from(screenshot.data, 'base64'))
  await click('[aria-label="Toggle experiment controls"]', 'close flock controls')
  results.push({ exhibit: 'boids', viewport, placement, before: flockBefore, afterPlacement: flockWithBarrier, afterClear: flockCleared, centerPlacement: true, clearRecovery: true, screenshot: screenshot ? 'canvas-placement-boids-phone.png' : null })

  await call('Page.navigate', { url: `${base}/exhibits/automata` })
  await waitFor(`location.pathname === '/exhibits/automata' && Boolean(document.querySelector('.automata-canvas'))`, 'the cellular automata study')
  if (!await evaluate(`Boolean(document.querySelector('[aria-label="Resume experiment"]'))`)) await click('[aria-label="Pause experiment"]', 'pause the cellular automaton')
  await waitFor(`Boolean(document.querySelector('[aria-label="Resume experiment"]'))`, 'a paused cellular automaton')
  await click('[aria-label="Toggle experiment controls"]', 'open automaton controls')
  await waitFor(`Boolean(document.querySelector('.control-panel.is-open'))`, 'open automaton controls panel')
  await clickText('Clear cells', 'document.querySelector(".control-panel")', { scroll: true })
  await waitForCount('.automata-stats > div:nth-child(2) strong', '0000', 'an empty cellular board')
  await click('[aria-label="Toggle experiment controls"]', 'close automaton controls')
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`)
  await key('Tab', 'Tab', 9)
  const focus = await evaluate(`(() => {
    const canvas = document.querySelector('.automata-canvas')
    const hint = document.querySelector('.automata-surface .canvas-keyboard-hint')
    const hintRect=hint?.getBoundingClientRect(),statusRect=document.querySelector('.automata-change')?.getBoundingClientRect()
    return { onCanvas: document.activeElement === canvas, tabIndex: canvas?.tabIndex ?? -1, label: canvas?.getAttribute('aria-label') ?? '', ring: canvas?.matches(':focus-visible') ?? false, outline: getComputedStyle(canvas).outlineWidth, hintVisible: Number.parseFloat(getComputedStyle(hint).opacity) > .9, hint: hint?.textContent.trim() ?? '', hintStatusOverlap:Boolean(hintRect&&statusRect&&hintRect.left<statusRect.right&&hintRect.right>statusRect.left&&hintRect.top<statusRect.bottom&&hintRect.bottom>statusRect.top) }
  })()`)
  const toolGroup = await evaluate(`(() => { const group=document.querySelector('.automata-tools'); const buttons=[...(group?.querySelectorAll('button')??[])]; return {role:group?.getAttribute('role'),label:group?.getAttribute('aria-label'),choices:buttons.map(button=>({name:button.textContent.trim(),pressed:button.getAttribute('aria-pressed'),selected:button.classList.contains('tool-active')}))} })()`)
  const automataTargets = await evaluate(`(() => [...document.querySelectorAll('.automata-tools button,.automata-stats button')].map(button=>({name:button.textContent.trim(),height:button.getBoundingClientRect().height})))()`)
  assert.equal(focus.tabIndex, 0, 'the cell grid is in the normal Tab order')
  assert.ok(focus.onCanvas && focus.ring && Number.parseFloat(focus.outline) >= 2, `the cell grid receives visible keyboard focus: ${JSON.stringify(focus)}`)
  assert.ok(focus.label.toLowerCase().includes('arrow keys') && focus.label.includes('Enter'), 'the grid accessible name explains selection and editing keys')
  assert.ok(focus.hintVisible, 'the visible key guide appears only when the grid is focused')
  assert.equal(focus.hintStatusOverlap, false, 'the keyboard guide does not cover the live generation/cell status')
  assert.equal(toolGroup.role, 'group', 'the paint tool choices expose a semantic group')
  assert.equal(toolGroup.label, 'Cell editing tool', 'the paint tool group has a descriptive accessible name')
  assert.equal(toolGroup.choices.filter((choice) => choice.pressed === 'true').length, 1, 'exactly one edit tool exposes selected state')
  assert.equal(toolGroup.choices.find((choice) => choice.pressed === 'true')?.selected, true, 'the selected tool state matches its visible styling')
  if (viewport.mobile) assert.ok(automataTargets.every((target) => target.height >= 43.9), `cell tools and step/pause actions meet mobile touch size: ${JSON.stringify(automataTargets)}`)
  const automataBefore = await pixelHash('.automata-canvas')
  await key('Enter', 'Enter', 13)
  await sleep(80)
  await waitForCount('.automata-stats > div:nth-child(2) strong', '0001', 'one keyboard-painted cell')
  const oneCell = await pixelHash('.automata-canvas')
  assert.notEqual(oneCell.hash, automataBefore.hash, 'Enter paints one real cell into the empty rendered board')
  assert.match(await evaluate('document.querySelector(".automata-change")?.textContent.trim() ?? ""'), /Lit cell at column 91, row 57/, 'the live status identifies the painted cell')
  await key('ArrowRight', 'ArrowRight', 39)
  await key('Enter', 'Enter', 13)
  await sleep(80)
  await waitForCount('.automata-stats > div:nth-child(2) strong', '0002', 'a second keyboard-painted cell')
  const twoCells = await pixelHash('.automata-canvas')
  assert.notEqual(twoCells.hash, oneCell.hash, 'arrow selection then Enter paints a neighbouring cell')
  await clickText('ERASE', 'document.querySelector(".automata-tools")')
  assert.equal(await evaluate(`document.querySelector('.automata-tools button[aria-pressed="true"]')?.textContent.trim()`), 'ERASE', 'the selected erase tool is announced')
  await evaluate(`document.querySelector('.automata-canvas').focus()`)
  await key('Home', 'Home', 36)
  await key('Enter', 'Enter', 13)
  await sleep(80)
  await waitForCount('.automata-stats > div:nth-child(2) strong', '0001', 'erasing the first keyboard-painted cell')
  const erased = await pixelHash('.automata-canvas')
  assert.notEqual(erased.hash, twoCells.hash, 'Home returns the cursor and Enter removes the selected cell')
  assert.match(await evaluate('document.querySelector(".automata-change")?.textContent.trim() ?? ""'), /Cleared cell at column 91, row 57/, 'the live status identifies the cleared cell')
  let automataScreenshot
  if (viewport.name === 'phone') automataScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  if (automataScreenshot) await writeFile(resolve('docs/renaissance/evidence/canvas-editing-automata-phone.png'), Buffer.from(automataScreenshot.data, 'base64'))
  await click('[aria-label="Toggle experiment controls"]', 'open the automaton rule controls')
  await waitFor(`Boolean(document.querySelector('.control-panel.is-open'))`, 'open the automaton rule controls')
  const selectedBrainRule = await evaluate(`(() => { const select=[...document.querySelectorAll('.control-panel select')].find((item)=>[...item.options].some((option)=>option.value==='brian')); if(!select)return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'brian'); select.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
  assert.equal(selectedBrainRule, true, 'Brian’s Brain can be selected in the rule control')
  await waitFor(`document.querySelector('.automata-heading p')?.textContent.includes('resting state')`, 'the Brian’s Brain rule description')
  await waitForCount('.automata-stats > div:nth-child(2) strong', '0001', 'the live cell remains before Brian’s Brain advances')
  await click('[aria-label="Toggle experiment controls"]', 'close the automaton rule controls')
  await click('[aria-label="Pause and advance exactly one generation"]', 'advance the Brian’s Brain model once')
  await waitForCount('.automata-stats > div:nth-child(2) strong', '0000', 'the resting state is excluded from the live-cell count')
  await sleep(80)
  const restingState = await pixelHash('.automata-canvas')
  assert.notEqual(restingState.hash, erased.hash, 'one Brian’s Brain step renders its refractory state')
  await clickText('ERASE', 'document.querySelector(".automata-tools")')
  await evaluate(`document.querySelector('.automata-canvas').focus()`)
  await key('Home', 'Home', 36)
  await key('ArrowRight', 'ArrowRight', 39)
  await key('Enter', 'Enter', 13)
  await sleep(80)
  await waitForCount('.automata-stats > div:nth-child(2) strong', '0000', 'clearing a refractory cell without reducing the live count')
  const clearedRestingState = await pixelHash('.automata-canvas')
  assert.notEqual(clearedRestingState.hash, restingState.hash, 'Enter erases a resting Brian’s Brain cell')
  assert.match(await evaluate('document.querySelector(".automata-change")?.textContent.trim() ?? ""'), /Cleared cell at column 92, row 57\. 0 cells alive\./, 'the resting-cell edit reports a correct zero live count')
  results.push({ exhibit: 'automata', viewport, focus, targets: automataTargets, before: automataBefore, oneCell, twoCells, erased, restingState, clearedRestingState, keyboardPaint: true, keyboardErase: true, refractoryEraseKeepsCount: true, liveStatus: true, screenshot: automataScreenshot ? 'canvas-editing-automata-phone.png' : null })
}

await call('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
socket.close()
assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join('; ')}`)
const report = {
  browser: 'HeadlessChrome 157 with SwiftShader; 320×740 narrow portrait, 390×844 phone portrait, 844×390 phone landscape and 1024×768 desktop touch/viewport emulation',
  method: 'Pause the deterministic flocking scene, choose Barrier, place it using the always-available centre action, compare rendered Canvas2D pixels and clear it. On a cleared cellular board, Tab focuses the canvas, CDP arrow and Enter events paint and erase real cells, and the live status announces the changed row and column. Brian’s Brain advances one firing cell to its refractory state before keyboard erasure checks that live-cell accounting remains at zero.',
  cases: results,
  browserErrors,
}
await mkdir(resolve('docs/renaissance/evidence'), { recursive: true })
await writeFile(resolve('docs/renaissance/evidence/canvas-editing-browser-checks.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`Canvas editing checks passed: ${results.length} narrow/phone/landscape/desktop states across Boids and Cellular Automata; centre placement/clear, Tab focus, cell navigation, keyboard paint/erase, Brian’s Brain refractory accounting, live status and pixel changes verified; 0 browser errors.`)
