import './require-browser-qa-supervisor.mjs'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9362)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5215'
const evidenceRoot = resolve('docs/renaissance/evidence')
const allExhibits = JSON.parse(await readFile(resolve('src/data/experiments.json'), 'utf8'))
const filter = process.env.ARMSTEEL_QA_EXHIBITS?.split(',').map((value) => value.trim()).filter(Boolean)
const exhibits = filter ? allExhibits.filter(({ id }) => filter.includes(id)) : allExhibits
assert.ok(exhibits.length, 'No exhibits selected for accessibility review')
const allViewports = [
  { name: 'narrow phone', width: 320, height: 740, mobile: true },
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
]
const viewportFilter = process.env.ARMSTEEL_QA_VIEWPORTS?.split(',').map((value) => value.trim()).filter(Boolean)
const viewports = viewportFilter ? allViewports.filter(({ name }) => viewportFilter.includes(name)) : allViewports
assert.ok(viewports.length, 'No viewports selected for accessibility review')

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page' && target.url.startsWith(base)) ?? targets.find((target) => target.type === 'page')
assert.ok(page, `No browser page available on CDP port ${port}`)
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
    const pending = waiting.get(message.id)
    clearTimeout(pending.timeout)
    waiting.delete(message.id)
    if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`))
    else pending.resolve(message.result)
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
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

async function waitForRoute(path) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await evaluate(`location.pathname === ${JSON.stringify(path)} && Boolean(document.querySelector('.experience-dock'))`)) return
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error(`Timed out loading ${path}`)
}

async function waitFor(selector) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return true
    await new Promise((done) => setTimeout(done, 50))
  }
  return false
}

async function setViewport({ width, height, mobile }) {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height })
  await call('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 1 } : { enabled: false })
  await new Promise((done) => setTimeout(done, 400))
}

const measurePanel = (kind, exhibit, viewport) => `(() => {
  const kind = ${JSON.stringify(kind)}
  const exhibit = ${JSON.stringify(exhibit)}
  const viewport = ${JSON.stringify(viewport)}
  const panel = document.querySelector(kind === 'controls' ? '.control-panel.is-open' : '#experiment-information')
  const visible = (element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  const sample = (element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      text: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().replace(/\\s+/g, ' ').slice(0, 100),
      fontPx: Number.parseFloat(style.fontSize),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      tag: element.tagName,
      selector: element.className && typeof element.className === 'string' ? element.className : element.tagName.toLowerCase(),
    }
  }
  const rect = panel?.getBoundingClientRect()
  const readings = kind === 'controls'
    ? [...(panel?.querySelectorAll('.panel-content > p, .panel-content .control-note, .panel-content .adder-control-copy, .range-control > span, .select-control > span, .segmented-control > span, .preset-row > span, .panel-action, .small-action, .select-control select, .segmented-control button, .preset-row button') ?? [])].filter(visible).map(sample)
    : [...(panel?.querySelectorAll(':scope > p, .related-studies a, .related-studies a strong, .info-method strong, .info-actions button, .info-reading summary, .info-reading p, .saved-experiment-save input, .saved-experiment-save button, .saved-experiment-save > p, .panel-close') ?? [])].filter(visible).map(sample)
  const interactive = [...(panel?.querySelectorAll('button, a, input, select, textarea, summary') ?? [])].filter(visible).map(sample)
  const selectionGroups = kind === 'controls' ? [...(panel?.querySelectorAll('.segmented-control, .preset-row') ?? [])].filter(visible).map((group) => ({
    label: group.getAttribute('aria-label') ?? '',
    role: group.getAttribute('role') ?? '',
    hasChoiceState: Boolean(group.querySelector('button[aria-pressed], button.chosen, button.selected')),
    buttons: [...group.querySelectorAll('button')].map((button) => ({
      text: (button.innerText || '').trim(),
      pressed: button.getAttribute('aria-pressed'),
      selectedStyle: button.classList.contains('chosen') || button.classList.contains('selected'),
    })),
  })) : []
  return {
    kind, exhibit, viewport,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    panel: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
    documentWidth: document.documentElement.scrollWidth,
    text: readings,
    interactive,
    selectionGroups,
  }
})()`

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })

const results = []
const motionStates = []
for (const exhibit of exhibits) {
  await call('Page.navigate', { url: `${base}/exhibits/${exhibit.id}` })
  await waitForRoute(`/exhibits/${exhibit.id}`)
  for (const viewport of viewports) {
    await setViewport(viewport)
    const motion = await evaluate(`(() => ({
      preference: matchMedia('(prefers-reduced-motion: reduce)').matches,
      pausedByDefault: document.querySelector('button[aria-label="Resume experiment"]') !== null,
      pageAnimationDuration: document.querySelector('.exhibit-page') ? getComputedStyle(document.querySelector('.exhibit-page')).animationDuration : null,
    }))()`)
    motionStates.push({ exhibit: exhibit.id, viewport: viewport.name, ...motion })

    const controlsTrigger = 'button[aria-label="Toggle experiment controls"]'
    if (await waitFor(controlsTrigger)) {
      await evaluate(`document.querySelector(${JSON.stringify(controlsTrigger)}).click()`)
      if (await waitFor('.control-panel.is-open')) {
        await new Promise((done) => setTimeout(done, 280))
        results.push(await evaluate(measurePanel('controls', exhibit.id, viewport.name)))
      }
      else results.push({ kind: 'controls', exhibit: exhibit.id, viewport: viewport.name, panel: null, text: [], interactive: [], documentWidth: await evaluate('document.documentElement.scrollWidth') })
      if (exhibit.id === 'adder' && viewport.name === 'phone') {
        const capture = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        await mkdir(evidenceRoot, { recursive: true })
        await writeFile(resolve(evidenceRoot, 'accessibility-controls-phone.png'), Buffer.from(capture.data, 'base64'))
      }
      await evaluate(`document.querySelector(${JSON.stringify(controlsTrigger)}).click()`)
      await new Promise((done) => setTimeout(done, 90))
    }

    const infoTrigger = 'button[aria-label="Toggle experiment information"]'
    if (await waitFor(infoTrigger)) {
      await evaluate(`document.querySelector(${JSON.stringify(infoTrigger)}).click()`)
      if (await waitFor('#experiment-information')) {
        await new Promise((done) => setTimeout(done, 260))
        results.push(await evaluate(measurePanel('information', exhibit.id, viewport.name)))
      }
      else results.push({ kind: 'information', exhibit: exhibit.id, viewport: viewport.name, panel: null, text: [], interactive: [], documentWidth: await evaluate('document.documentElement.scrollWidth') })
      if (exhibit.id === 'adder' && viewport.name === 'phone') {
        const capture = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        await mkdir(evidenceRoot, { recursive: true })
        await writeFile(resolve(evidenceRoot, 'accessibility-about-phone.png'), Buffer.from(capture.data, 'base64'))
      }
    }
  }
}

await call('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
socket.close()
const issues = []
for (const result of results) {
  if (!result.panel) issues.push({ exhibit: result.exhibit, viewport: result.viewport, kind: result.kind, issue: 'shared panel did not open' })
  const expectedWidth = result.viewport === 'desktop' ? 1440 : result.viewport === 'phone' ? 390 : 320
  const expectedHeight = result.viewport === 'desktop' ? 900 : result.viewport === 'phone' ? 844 : 740
  if (result.viewportWidth !== expectedWidth || result.viewportHeight !== expectedHeight) issues.push({ exhibit: result.exhibit, viewport: result.viewport, kind: result.kind, issue: `viewport emulation mismatch ${result.viewportWidth}×${result.viewportHeight}` })
  if (result.documentWidth > result.viewportWidth) issues.push({ exhibit: result.exhibit, viewport: result.viewport, kind: result.kind, issue: 'document has horizontal overflow' })
  if (result.panel && (result.panel.x < -1 || result.panel.y < -1 || result.panel.right > result.viewportWidth + 1 || result.panel.bottom > result.viewportHeight + 1)) issues.push({ exhibit: result.exhibit, viewport: result.viewport, kind: result.kind, issue: 'panel extends beyond viewport' })
  for (const item of result.text) {
    if (item.fontPx < 11) issues.push({ exhibit: result.exhibit, viewport: result.viewport, kind: result.kind, issue: `small visitor-facing text ${item.fontPx}px`, text: item.text, selector: item.selector })
  }
  if (result.kind === 'controls') {
    for (const group of result.selectionGroups ?? []) {
      if (group.role !== 'group' || !group.label) issues.push({ exhibit: result.exhibit, viewport: result.viewport, kind: result.kind, issue: 'preset/segmented options lack a named group', label: group.label })
      if (group.hasChoiceState) for (const button of group.buttons) {
          if (!['true', 'false'].includes(button.pressed)) issues.push({ exhibit: result.exhibit, viewport: result.viewport, kind: result.kind, issue: 'selection button does not expose aria-pressed state', text: button.text })
          else if ((button.pressed === 'true') !== button.selectedStyle) issues.push({ exhibit: result.exhibit, viewport: result.viewport, kind: result.kind, issue: 'announced selection differs from visible selection', text: button.text })
      }
    }
    for (const item of result.interactive) {
      if (item.tag === 'BUTTON' && item.text && item.height < 38) issues.push({ exhibit: result.exhibit, viewport: result.viewport, kind: result.kind, issue: `small control target ${item.width}×${item.height}`, text: item.text })
    }
  } else {
    for (const item of result.interactive) {
      if ((item.tag === 'BUTTON' || item.tag === 'A') && item.text && item.height < 38) issues.push({ exhibit: result.exhibit, viewport: result.viewport, kind: result.kind, issue: `small information target ${item.width}×${item.height}`, text: item.text })
    }
  }
}
for (const state of motionStates) {
  if (!state.preference) issues.push({ exhibit: state.exhibit, viewport: state.viewport, kind: 'motion', issue: 'reduced-motion preference was not emulated' })
  if (!state.pausedByDefault) issues.push({ exhibit: state.exhibit, viewport: state.viewport, kind: 'motion', issue: 'exhibit did not start paused under reduced motion' })
}

const report = {
  browser: 'HeadlessChrome 157, SwiftShader, CSS viewport and touch emulation',
  coverage: { exhibits: exhibits.map(({ id }) => id), viewports, reducedMotionStates: motionStates.length, sharedPanelChecks: results.length },
  method: 'DOM-computed typography and target-size checks for shared Controls and About panels. Reduced motion is emulated before each direct route load. This does not inspect Chrome accessibility trees or test with assistive technology.',
  thresholds: { sharedPanelReadingAndControlTextMinimumPx: 11, labeledPanelTargetHeightMinimumPx: 38, choiceGroupsNamedAndChoiceStateExposed: true, noPanelOrDocumentHorizontalOverflow: true, reducedMotionStartsExhibitsPaused: true },
  samples: { smallestControlsText: Math.min(...results.filter((result) => result.kind === 'controls').flatMap((result) => result.text.map((item) => item.fontPx))), smallestAboutText: Math.min(...results.filter((result) => result.kind === 'information').flatMap((result) => result.text.map((item) => item.fontPx))) },
  results,
  motionStates,
  issues,
  browserErrors,
}
await mkdir(evidenceRoot, { recursive: true })
await writeFile(resolve(evidenceRoot, 'accessibility-readability-review.json'), `${JSON.stringify(report, null, 2)}\n`)
if (issues.length || browserErrors.length) {
  console.error(`Accessibility readability review found ${issues.length} issues across ${results.length} panels and ${motionStates.length} reduced-motion states; ${browserErrors.length} browser errors.`)
  console.error(JSON.stringify({ issues: issues.slice(0, 40), browserErrors: browserErrors.slice(0, 20) }, null, 2))
  process.exitCode = 1
} else {
  console.log(`Accessibility readability review passed: ${exhibits.length} exhibits, ${viewports.length} viewports, ${results.length} shared panels, ${motionStates.length} reduced-motion states, no browser errors.`)
}
