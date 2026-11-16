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

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
async function waitFor(expression, description) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await evaluate(expression)) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function key(key, code, windowsVirtualKeyCode, shiftKey = false) {
  const params = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode, shiftKey, modifiers: shiftKey ? 8 : 0 }
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
    let hash = 2166136261
    for (let i = 0; i < pixels.length; i++) hash = Math.imul(hash ^ pixels[i], 16777619)
    return { hash: hash >>> 0, width: canvas.width, height: canvas.height }
  })()`)
}

async function waitForPixelChange(selector, before, description) {
  let latest = before
  for (let attempt = 0; attempt < 40; attempt++) {
    latest = await pixelHash(selector)
    if (latest && (latest.hash !== before.hash || latest.width !== before.width || latest.height !== before.height)) return latest
    await sleep(50)
  }
  assert.notDeepEqual(latest, before, `${description} produces a visible canvas change`)
  return latest
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
  await waitForCount('.automata-stats > div:nth-child(2) strong', '0001', 'one keyboard-painted cell')
  const oneCell = await waitForPixelChange('.automata-canvas', automataBefore, 'Enter paints one real cell into the empty rendered board')
  assert.match(await evaluate('document.querySelector(".automata-change")?.textContent.trim() ?? ""'), /Lit cell at column 91, row 57/, 'the live status identifies the painted cell')
  await key('ArrowRight', 'ArrowRight', 39)
  await sleep(80)
  const twoCellSelection = await pixelHash('.automata-canvas')
  await key('Enter', 'Enter', 13)
  await waitForCount('.automata-stats > div:nth-child(2) strong', '0002', 'a second keyboard-painted cell')
  const twoCells = await waitForPixelChange('.automata-canvas', twoCellSelection, 'Enter paints a neighbouring cell after keyboard selection')
  await clickText('ERASE', 'document.querySelector(".automata-tools")')
  assert.equal(await evaluate(`document.querySelector('.automata-tools button[aria-pressed="true"]')?.textContent.trim()`), 'ERASE', 'the selected erase tool is announced')
  await evaluate(`document.querySelector('.automata-canvas').focus()`)
  await key('Home', 'Home', 36)
  await sleep(80)
  const eraseSelection = await pixelHash('.automata-canvas')
  await key('Enter', 'Enter', 13)
  await waitForCount('.automata-stats > div:nth-child(2) strong', '0001', 'erasing the first keyboard-painted cell')
  const erased = await waitForPixelChange('.automata-canvas', eraseSelection, 'Home returns the cursor and Enter removes the selected cell')
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
  const restingState = await waitForPixelChange('.automata-canvas', erased, 'one Brian’s Brain step renders its refractory state')
  await clickText('ERASE', 'document.querySelector(".automata-tools")')
  await evaluate(`document.querySelector('.automata-canvas').focus()`)
  await key('Home', 'Home', 36)
  await key('ArrowRight', 'ArrowRight', 39)
  await sleep(80)
  const refractoryEraseSelection = await pixelHash('.automata-canvas')
  await key('Enter', 'Enter', 13)
  await waitForCount('.automata-stats > div:nth-child(2) strong', '0000', 'clearing a refractory cell without reducing the live count')
  const clearedRestingState = await waitForPixelChange('.automata-canvas', refractoryEraseSelection, 'Enter erases a resting Brian’s Brain cell')
  assert.match(await evaluate('document.querySelector(".automata-change")?.textContent.trim() ?? ""'), /Cleared cell at column 92, row 57\. 0 cells alive\./, 'the resting-cell edit reports a correct zero live count')
  results.push({ exhibit: 'automata', viewport, focus, targets: automataTargets, before: automataBefore, oneCell, twoCells, erased, restingState, clearedRestingState, keyboardPaint: true, keyboardErase: true, refractoryEraseKeepsCount: true, liveStatus: true, screenshot: automataScreenshot ? 'canvas-editing-automata-phone.png' : null })

  await call('Page.navigate', { url: `${base}/exhibits/gravity` })
  await waitFor(`location.pathname === '/exhibits/gravity' && Boolean(document.querySelector('.gravity-canvas'))`, 'the N-body gravity study')
  if (!await evaluate(`Boolean(document.querySelector('[aria-label="Resume experiment"]'))`)) await click('[aria-label="Pause experiment"]', 'pause the gravity scene')
  await waitFor(`Boolean(document.querySelector('[aria-label="Resume experiment"]'))`, 'a paused gravity scene')
  const gravityCanvas = await evaluate(`(() => { const canvas=document.querySelector('.gravity-canvas'); return {tabIndex:canvas?.tabIndex??-1,label:canvas?.getAttribute('aria-label')??'',describedBy:canvas?.getAttribute('aria-describedby')??''} })()`)
  assert.equal(gravityCanvas.tabIndex, 0, 'the gravity canvas is in the normal Tab order')
  assert.match(gravityCanvas.label, /arrows cycle focus between bodies/i, 'the gravity canvas describes keyboard body navigation')
  await evaluate('document.activeElement instanceof HTMLElement && document.activeElement.blur()')
  await key('Tab', 'Tab', 9)
  await waitFor(`document.activeElement === document.querySelector('.gravity-canvas')`, 'keyboard focus on the gravity canvas')
  await waitFor(`Number.parseFloat(getComputedStyle(document.querySelector('.gravity-keyboard-help')).opacity) > .9`, 'Gravity keyboard help visibility')
  await sleep(180)
  const gravityFocus = await evaluate(`(() => { const canvas=document.querySelector('.gravity-canvas'),help=document.querySelector('.gravity-keyboard-help'),hud=document.querySelector('.gravity-hud'),a=help?.getBoundingClientRect(),b=hud?.getBoundingClientRect();return {onCanvas:document.activeElement===canvas,ring:canvas?.matches(':focus-visible')??false,outline:getComputedStyle(canvas).outlineWidth,hintVisible:Number.parseFloat(getComputedStyle(help).opacity)>.9,hintOverlap:Boolean(a&&b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)} })()`)
  assert.ok(gravityFocus.onCanvas && gravityFocus.ring && Number.parseFloat(gravityFocus.outline) >= 2, `Gravity receives visible keyboard focus: ${JSON.stringify(gravityFocus)}`)
  assert.ok(gravityFocus.hintVisible && !gravityFocus.hintOverlap, `Gravity help is visible and clear of its HUD: ${JSON.stringify(gravityFocus)}`)
  await key('ArrowRight', 'ArrowRight', 39)
  await waitFor(`document.querySelector('.gravity-keyboard-status')?.textContent.includes('Body 1 of')`, 'keyboard focus on the first body')
  await sleep(80)
  const gravityBeforeNudge = await pixelHash('.gravity-canvas')
  const gravityFirst = await evaluate(`({message:document.querySelector('.gravity-keyboard-status')?.textContent.trim(),inspection:document.querySelector('.gravity-inspect')?.textContent.trim()})`)
  assert.match(gravityFirst.inspection ?? '', /980\.0/, 'keyboard focus exposes the first body in its inspection readout')
  await key('ArrowRight', 'ArrowRight', 39, true)
  await waitFor(`document.querySelector('.gravity-keyboard-status')?.textContent.includes('Body moved to x 0.25, y 0.00')`, 'a keyboard-nudged selected body')
  const gravityMoved = await waitForPixelChange('.gravity-canvas', gravityBeforeNudge, 'Shift plus arrow visibly moves the selected gravity body')
  const gravityNudged = await evaluate(`({message:document.querySelector('.gravity-keyboard-status')?.textContent.trim(),inspection:document.querySelector('.gravity-inspect')?.textContent.trim()})`)
  assert.match(gravityNudged.inspection ?? '', /x 0\.25 · y 0\.00/, 'Shift plus arrow changes the real body position')
  await key('ArrowDown', 'ArrowDown', 40)
  await waitFor(`document.querySelector('.gravity-keyboard-status')?.textContent.includes('Body 2 of')`, 'keyboard focus on the next body')
  const gravitySecond = await evaluate(`({message:document.querySelector('.gravity-keyboard-status')?.textContent.trim(),inspection:document.querySelector('.gravity-inspect')?.textContent.trim()})`)
  assert.notEqual(gravitySecond.inspection, gravityFirst.inspection, 'arrow navigation selects a different real body')
  if (viewport.name === 'phone') {
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(resolve('docs/renaissance/evidence/canvas-keyboard-gravity-phone.png'), Buffer.from(screenshot.data, 'base64'))
  }
  await key('Home', 'Home', 36)
  await waitFor(`document.querySelector('.gravity-keyboard-status')?.textContent === 'Body focus cleared.'`, 'keyboard recovery of body focus')
  assert.equal(await evaluate(`Boolean(document.querySelector('.gravity-inspect'))`), false, 'Home clears the selected body and its inspection readout')
  results.push({ exhibit: 'gravity', viewport, canvas: gravityCanvas, focus: gravityFocus, first: gravityFirst, nudged: gravityNudged, renderedAfterNudge: gravityMoved, second: gravitySecond, homeClearsSelection: true, keyboardBodyNavigation: true, keyboardPositioning: true, screenshot: viewport.name === 'phone' ? 'canvas-keyboard-gravity-phone.png' : null })

  await call('Page.navigate', { url: `${base}/exhibits/neural` })
  await waitFor(`location.pathname === '/exhibits/neural' && Boolean(document.querySelector('.neural-learning-map'))`, 'the neural network study')
  await clickText('Blank canvas', 'document.querySelector(".neural-patterns")')
  await click('.class-tool.class-one', 'select teal examples')
  await evaluate('document.activeElement instanceof HTMLElement && document.activeElement.blur()')
  await key('Tab', 'Tab', 9)
  await waitFor(`document.activeElement === document.querySelector('.neural-learning-map')`, 'keyboard focus on the neural map')
  await waitFor(`Number.parseFloat(getComputedStyle(document.querySelector('.neural-map-keyboard-help')).opacity) > .9`, 'Neural keyboard help visibility')
  await sleep(180)
  const neuralFocus = await evaluate(`(() => { const canvas=document.querySelector('.neural-learning-map'),help=document.querySelector('.neural-map-keyboard-help'),bounds=help?.getBoundingClientRect();const names=['.neural-example-tools','.neural-map-legend','.neural-learning-controls'].map(selector=>{const rect=document.querySelector(selector)?.getBoundingClientRect();return {selector,overlap:Boolean(rect&&bounds&&bounds.left<rect.right&&bounds.right>rect.left&&bounds.top<rect.bottom&&bounds.bottom>rect.top)}});return {onCanvas:document.activeElement===canvas,tabIndex:canvas?.tabIndex??-1,label:canvas?.getAttribute('aria-label')??'',ring:canvas?.matches(':focus-visible')??false,outline:getComputedStyle(canvas).outlineWidth,hintVisible:Number.parseFloat(getComputedStyle(help).opacity)>.9,overlaps:names} })()`)
  assert.equal(neuralFocus.tabIndex, 0, 'the neural map is in the normal Tab order')
  assert.ok(neuralFocus.onCanvas && neuralFocus.ring && Number.parseFloat(neuralFocus.outline) >= 2, `Neural map receives visible keyboard focus: ${JSON.stringify(neuralFocus)}`)
  assert.ok(neuralFocus.label.includes('arrows move a point by 0.05') && neuralFocus.label.includes('Press M near an example') && neuralFocus.label.includes('Enter or Escape finishes'), 'the neural canvas describes coordinate movement, direct example editing and recovery')
  assert.ok(neuralFocus.hintVisible && neuralFocus.overlaps.every((entry) => !entry.overlap), `Neural key help is visible without covering controls at ${viewport.name}: ${JSON.stringify(neuralFocus)}`)
  const neuralLiveStatus = await evaluate(`(() => {const node=document.querySelector('.neural-tool-status');return {role:node?.getAttribute('role'),live:node?.getAttribute('aria-live'),atomic:node?.getAttribute('aria-atomic')}})()`)
  assert.deepEqual(neuralLiveStatus, { role: 'status', live: 'polite', atomic: 'true' }, 'Neural feedback announces the complete result with status semantics')
  await key('Home', 'Home', 36)
  const neuralBefore = await pixelHash('.neural-learning-map')
  await key('Enter', 'Enter', 13)
  await waitFor(`document.querySelector('.neural-score small')?.textContent.includes('1 teal')`, 'the first keyboard-placed neural example')
  await waitFor(`document.querySelector('.neural-tool-status small')?.textContent.includes('at x 0.00, y 0.00')`, 'the announced neural-map placement')
  const neuralOne = await waitForPixelChange('.neural-learning-map', neuralBefore, 'Enter adds a real training example to the rendered map')
  await click('.class-tool.class-zero', 'select coral examples')
  await evaluate(`document.querySelector('.neural-learning-map').focus()`)
  await key('ArrowRight', 'ArrowRight', 39)
  await waitFor(`document.querySelector('.neural-tool-status small')?.textContent.includes('Keyboard point at x 0.05, y 0.00')`, 'the announced neural keyboard coordinates')
  await sleep(80)
  const neuralSecondSelection = await pixelHash('.neural-learning-map')
  await key('Enter', 'Enter', 13)
  await waitFor(`document.querySelector('.neural-score small')?.textContent.includes('1 coral · 1 teal')`, 'a second example at a moved keyboard coordinate')
  await waitFor(`document.querySelector('.neural-tool-status small')?.textContent.includes('at x 0.05, y 0.00')`, 'the second neural-map placement announcement')
  const neuralTwo = await waitForPixelChange('.neural-learning-map', neuralSecondSelection, 'Enter adds an example at the newly selected map location')
  await key('Home', 'Home', 36)
  await key('m', 'KeyM', 77)
  await waitFor(`document.querySelector('.neural-tool-status small')?.textContent.includes('Selected the teal example at x 0.00, y 0.00')`, 'selecting a nearby neural example for keyboard movement')
  const neuralBeforeMove = await pixelHash('.neural-learning-map')
  await key('ArrowUp', 'ArrowUp', 38)
  await waitFor(`document.querySelector('.neural-tool-status small')?.textContent.includes('Moved the teal example to x 0.00, y 0.05')`, 'moving the selected neural example with the keyboard')
  const neuralMoved = await waitForPixelChange('.neural-learning-map', neuralBeforeMove, 'Arrow keys visibly move a selected training example')
  await key('Escape', 'Escape', 27)
  await waitFor(`document.querySelector('.neural-tool-status small')?.textContent.includes('Example placement finished')`, 'finishing keyboard placement of a moved example')
  await clickText('↶ Undo', 'document.querySelector(".neural-example-tools")')
  await waitFor(`document.querySelector('.neural-tool-status small')?.textContent === 'Last example edit undone.'`, 'undoing a keyboard-moved training example')
  assert.equal(await evaluate(`document.querySelector('.neural-score small')?.textContent.trim()`), '1 coral · 1 teal', 'undo restores the original count after moving a training example')
  const neuralDragPoints = await evaluate(`(() => {const canvas=document.querySelector('.neural-learning-map'),rect=canvas.getBoundingClientRect(),mobile=rect.width<720,plot=mobile?{x:16,y:Math.max(132,rect.height*.2),w:rect.width-32,h:Math.max(210,rect.height*.55)}:{x:44,y:154,w:rect.width-88,h:Math.max(280,rect.height-294)},point=(x,y)=>({x:rect.left+plot.x+(x+1)*plot.w/2,y:rect.top+plot.y+(1-y)*plot.h/2});return {start:point(0,0),clickNear:point(.02,0),intermediate:point(.2,.2),finish:point(.4,.4)}})()`)
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...neuralDragPoints.clickNear, buttons: 0 })
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...neuralDragPoints.clickNear, button: 'left', buttons: 1, clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...neuralDragPoints.clickNear, button: 'left', buttons: 0, clickCount: 1 })
  await evaluate(`document.querySelector('.neural-learning-map').focus()`)
  await key('Home', 'Home', 36)
  await key('m', 'KeyM', 77)
  await waitFor(`document.querySelector('.neural-tool-status small')?.textContent.includes('Selected the teal example at x 0.00, y 0.00')`, 'a click near an example leaves it at its original location')
  await key('Escape', 'Escape', 27)
  const neuralBeforePointerDrag = await pixelHash('.neural-learning-map')
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...neuralDragPoints.start, buttons: 0 })
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...neuralDragPoints.start, button: 'left', buttons: 1, clickCount: 1 })
  await Promise.all([
    call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...neuralDragPoints.intermediate, button: 'left', buttons: 1 }),
    call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...neuralDragPoints.finish, button: 'left', buttons: 1 }),
  ])
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...neuralDragPoints.finish, button: 'left', buttons: 0, clickCount: 1 })
  const neuralPointerMoved = await waitForPixelChange('.neural-learning-map', neuralBeforePointerDrag, 'pointer release commits the last position inside the drag throttle window')
  await evaluate(`document.querySelector('.neural-learning-map').focus()`)
  await key('m', 'KeyM', 77)
  await waitFor(`document.querySelector('.neural-tool-status small')?.textContent.includes('Selected the teal example at x 0.40, y 0.40')`, 'keyboard selection following a pointer-moved example')
  await key('Escape', 'Escape', 27)
  await clickText('↶ Undo', 'document.querySelector(".neural-example-tools")')
  await waitFor(`document.querySelector('.neural-tool-status small')?.textContent === 'Last example edit undone.'`, 'undoing a pointer-moved neural example')
  await key('Home', 'Home', 36)
  await key('m', 'KeyM', 77)
  await waitFor(`document.querySelector('.neural-tool-status small')?.textContent.includes('Selected the teal example at x 0.00, y 0.00')`, 'keyboard selection following pointer-drag undo')
  await key('Escape', 'Escape', 27)
  await key('Home', 'Home', 36)
  await key('m', 'KeyM', 77)
  await waitFor(`document.querySelector('.neural-tool-status small')?.textContent.includes('Selected the teal example at x 0.00, y 0.00')`, 'selecting a neural example for keyboard deletion')
  const neuralBeforeDelete = await pixelHash('.neural-learning-map')
  await key('Delete', 'Delete', 46)
  await waitFor(`document.querySelector('.neural-score small')?.textContent.trim() === '1 coral · 0 teal'`, 'deleting the selected neural training example')
  await waitFor(`document.querySelector('.neural-tool-status small')?.textContent.includes('Removed the selected teal example at x 0.00, y 0.00')`, 'the keyboard deletion announcement')
  const neuralDeleted = await waitForPixelChange('.neural-learning-map', neuralBeforeDelete, 'Delete visibly removes the selected training example')
  await clickText('↶ Undo', 'document.querySelector(".neural-example-tools")')
  await waitFor(`document.querySelector('.neural-score small')?.textContent.trim() === '1 coral · 1 teal'`, 'undoing a keyboard-deleted training example')
  const neuralTargets = await evaluate(`({teachDisabled:document.querySelector('.neural-learn-button')?.disabled,controls:[...document.querySelectorAll('.neural-patterns button,.neural-example-tools button,.neural-learning-controls > button')].map(button=>({name:button.textContent.trim(),height:button.getBoundingClientRect().height}))})`)
  assert.equal(neuralTargets.teachDisabled, false, 'keyboard-placed examples enable actual network training')
  if (viewport.mobile) assert.ok(neuralTargets.controls.filter((button) => button.height > 0).every((button) => button.height >= 43.9), `Neural Network visible controls meet the mobile touch target size: ${JSON.stringify(neuralTargets.controls)}`)
  await click('.neural-probe-button', 'select the neural prediction probe')
  await evaluate(`document.querySelector('.neural-learning-map').focus()`)
  await key('Home', 'Home', 36)
  await sleep(80)
  const neuralProbeSelection = await pixelHash('.neural-learning-map')
  await key('Enter', 'Enter', 13)
  await waitFor(`document.querySelector('.neural-tool-status strong')?.textContent.includes('The model guesses')`, 'keyboard testing a neural prediction')
  await waitFor(`document.querySelector('.neural-tool-status small')?.textContent.includes('test points stay out of training')`, 'the non-training probe explanation')
  assert.equal(await evaluate(`document.querySelector('.neural-score small')?.textContent.trim()`), '1 coral · 1 teal', 'keyboard prediction probes leave the training examples unchanged')
  const neuralProbe = await waitForPixelChange('.neural-learning-map', neuralProbeSelection, 'Enter places a visible neural prediction probe')
  if (viewport.name === 'phone') {
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(resolve('docs/renaissance/evidence/canvas-keyboard-neural-phone.png'), Buffer.from(screenshot.data, 'base64'))
  }
  await clickText('↶ Undo', 'document.querySelector(".neural-example-tools")')
  await waitFor(`document.querySelector('.neural-score small')?.textContent.includes('1 teal')`, 'recovering the prior neural pattern')
  await clickText('⌫ Erase', 'document.querySelector(".neural-example-tools")')
  await evaluate(`document.querySelector('.neural-learning-map').focus()`)
  await key('Home', 'Home', 36)
  await sleep(80)
  const neuralEraseSelection = await pixelHash('.neural-learning-map')
  await key('Enter', 'Enter', 13)
  await waitFor(`document.querySelector('.neural-score small')?.textContent === 'Add examples to begin'`, 'keyboard erasure of the final neural example')
  await waitForPixelChange('.neural-learning-map', neuralEraseSelection, 'Enter removes the selected neural example from the map')
  assert.match(await evaluate(`document.querySelector('.neural-tool-status small')?.textContent.trim()??''`), /Removed the example at x 0\.00, y 0\.00/, 'the erase action announces which map point changed')
  results.push({ exhibit: 'neural', viewport, focus: neuralFocus, liveStatus: neuralLiveStatus, oneExample: neuralOne, twoExamples: neuralTwo, movedExample: neuralMoved, pointerMovedExample: neuralPointerMoved, deletedExample: neuralDeleted, probe: neuralProbe, trainingEnabled: !neuralTargets.teachDisabled, keyboardPlacement: true, keyboardMoveAndUndo: true, keyboardDeleteAndUndo: true, keyboardProbeWithoutAdding: true, keyboardErase: true, pointerDragKeyboardSelection: true, undoRecovery: true, screenshot: viewport.name === 'phone' ? 'canvas-keyboard-neural-phone.png' : null })
}

await call('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
socket.close()
assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join('; ')}`)
const report = {
  browser: 'HeadlessChrome 157 with SwiftShader; 320×740 narrow portrait, 390×844 phone portrait, 844×390 phone landscape and 1024×768 desktop touch/viewport emulation',
  method: 'Pause the deterministic flocking scene, choose Barrier, place it using the always-available centre action, compare rendered Canvas2D pixels and clear it. On a cleared cellular board, Tab focuses the canvas, CDP arrow and Enter events paint and erase real cells, and the live status announces the changed row and column. Brian’s Brain advances one firing cell to its refractory state before keyboard erasure checks that live-cell accounting remains at zero. Gravity arrow keys select distinct bodies, Shift+arrow moves the selected body by 0.25 world units and the inspector plus rendered pixels confirm the move, then Home clears focus. Neural Networks arrow/Enter keyboard input places examples at stated coordinates; M selects a nearby existing example, arrows move it, Escape finishes and Undo restores its position. A near-dot click leaves the example in place. A pointer-dragged example is selected at its final coordinate and undone, checking pointer/keyboard cursor synchronization and recovery when release lands inside the drag throttle interval. Prediction probing visibly updates the test point without adding training data, and erase/undo recover the lesson. The browser waits for image changes between edits and checks focus hints, touch targets and overlay geometry at every viewport.',
  cases: results,
  browserErrors,
}
await mkdir(resolve('docs/renaissance/evidence'), { recursive: true })
await writeFile(resolve('docs/renaissance/evidence/canvas-editing-browser-checks.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`Canvas interaction checks passed: ${results.length} viewport/study states across Boids, Cellular Automata, Gravity and Neural Networks; centre placement, keyboard editing/probing, pointer/keyboard example synchronization, undo recovery, focus guidance, status semantics, touch targets and rendered/model changes verified; 0 browser errors.`)
