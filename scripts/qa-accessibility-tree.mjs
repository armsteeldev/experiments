import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9350)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5198'
const evidenceRoot = resolve('docs/renaissance/evidence')
const exhibits = JSON.parse(await readFile(resolve('src/data/experiments.json'), 'utf8'))
const interactiveRoles = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'slider', 'spinbutton', 'checkbox', 'radio', 'switch', 'tab'])

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page' && target.url.startsWith(base))
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
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
async function waitFor(expression, label) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await evaluate(expression)) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function navigate(path) {
  await call('Page.navigate', { url: `${base}${path}` })
  await waitFor(`location.pathname === ${JSON.stringify(path)} && ${path === '/' ? 'Boolean(document.querySelector(".gallery-grid"))' : 'Boolean(document.querySelector(".experience-dock"))'}`, path)
}

async function inspect(label) {
  const tree = await call('Accessibility.getFullAXTree')
  const active = tree.nodes.filter((node) => node.ignored !== true)
  const controls = active.filter((node) => interactiveRoles.has(node.role?.value))
  const read = (node, name) => node.properties?.find((property) => property.name === name)?.value?.value
  const unnamed = controls.filter((node) => !node.name?.value?.trim()).map((node) => ({ role: node.role?.value, backendNodeId: node.backendDOMNodeId }))
  const sliders = controls.filter((node) => node.role?.value === 'slider').map((node) => ({
    name: node.name?.value ?? '',
    min: read(node, 'valuemin'),
    max: read(node, 'valuemax'),
    now: read(node, 'valuenow'),
    valueText: read(node, 'valuetext'),
  }))
  const incompleteSliders = sliders.filter(({ min, max }) => !Number.isFinite(min) || !Number.isFinite(max) || min > max)
  assert.deepEqual(unnamed, [], `${label}: computed accessibility tree has unnamed interactive controls`)
  assert.deepEqual(incompleteSliders, [], `${label}: range controls have incomplete value bounds`)
  return {
    label,
    nodeCount: tree.nodes.length,
    interactiveCount: controls.length,
    roles: Object.fromEntries([...new Set(controls.map((node) => node.role.value))].sort().map((role) => [role, controls.filter((node) => node.role.value === role).length])),
    sliderCount: sliders.length,
    unnamedCount: unnamed.length,
    unboundedSliderCount: incompleteSliders.length,
  }
}

function nodeHas(tree, role, name) {
  return tree.nodes.some((node) => node.ignored !== true && node.role?.value === role && node.name?.value === name)
}

function nodeProperty(tree, role, name, property) {
  const node = tree.nodes.find((candidate) => candidate.ignored !== true && candidate.role?.value === role && candidate.name?.value === name)
  return node?.properties?.find((candidate) => candidate.name === property)?.value?.value
}

await call('Page.enable')
await call('Runtime.enable')
await call('Accessibility.enable')
await call('Network.enable')
await call('Log.enable')
await call('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })

const results = []
await navigate('/')
await evaluate(`localStorage.removeItem('armsteel:saved-scenes'); location.reload()`)
await waitFor(`Boolean(document.querySelector('.gallery-grid') && document.querySelector('.saved-experiments-empty'))`, 'an empty, deterministic gallery notebook')
results.push(await inspect('gallery'))
const galleryTree = await call('Accessibility.getFullAXTree')
assert.ok(nodeHas(galleryTree, 'button', 'Export saved setups as a notebook file') && nodeProperty(galleryTree, 'button', 'Export saved setups as a notebook file', 'disabled') === true, 'the computed tree exposes disabled export state for an empty notebook')
assert.ok(nodeHas(galleryTree, 'button', 'Import setups from a notebook file') && nodeProperty(galleryTree, 'button', 'Import setups from a notebook file', 'disabled') !== true, 'the computed tree keeps notebook import available')

await evaluate(`document.querySelector('button[aria-label="Search the collection"]')?.click()`)
await waitFor(`Boolean(document.querySelector('.search-panel input'))`, 'the gallery search field')
const gallerySearch = await inspect('gallery search')
const searchTree = await call('Accessibility.getFullAXTree')
assert.ok(['searchbox', 'textbox'].some((role) => nodeHas(searchTree, role, 'Search studies by name, discipline or idea')), 'the computed tree names the collection search field')
results.push(gallerySearch)

const panelChecks = []
for (const exhibit of exhibits) {
  await navigate(`/exhibits/${exhibit.id}`)
  await waitFor(`Boolean(document.querySelector('button[aria-label="Toggle experiment controls"]'))`, `${exhibit.id} shared dock`)

  const panels = [
    { kind: 'controls', trigger: 'button[aria-label="Toggle experiment controls"]', root: '.control-panel.is-open', role: 'complementary' },
    { kind: 'about', trigger: 'button[aria-label="Toggle experiment information"]', root: '#experiment-information', role: 'region' },
    { kind: 'selector', trigger: '.dock-current', root: '#experiment-selector', role: 'dialog', expectedName: 'Choose an experiment' },
  ]

  for (const panel of panels) {
    await evaluate(`(() => { const trigger=document.querySelector(${JSON.stringify(panel.trigger)}); trigger?.focus(); trigger?.click() })()`)
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(panel.root)}))`, `${exhibit.id} ${panel.kind} panel`)
    await waitFor(`document.querySelector(${JSON.stringify(panel.root)})?.contains(document.activeElement) === true`, `${exhibit.id} ${panel.kind} focus to enter the panel`)
    const expectedName = panel.expectedName ?? await evaluate(`(() => { const root=document.querySelector(${JSON.stringify(panel.root)}); return root?.getAttribute('aria-label') || root?.getAttribute('aria-labelledby') && document.getElementById(root.getAttribute('aria-labelledby'))?.textContent.trim() || '' })()`)
    const state = await inspect(`${exhibit.id} ${panel.kind}`)
    const tree = await call('Accessibility.getFullAXTree')
    const expectedDialogName = panel.expectedName ?? expectedName
    const hasRoot = tree.nodes.some((node) => node.ignored !== true && node.role?.value === panel.role && node.name?.value === expectedDialogName)
    assert.ok(hasRoot, `${exhibit.id} ${panel.kind}: computed tree exposes its named ${panel.role} landmark`)
    const triggerName = await evaluate(`document.querySelector(${JSON.stringify(panel.trigger)})?.getAttribute('aria-label') || document.querySelector(${JSON.stringify(panel.trigger)})?.textContent.trim()`)
    const expanded = nodeProperty(tree, 'button', triggerName, 'expanded') === true
    assert.ok(expanded, `${exhibit.id} ${panel.kind}: trigger exposes expanded state`)
    const focusState = await evaluate(`(() => { const root=document.querySelector(${JSON.stringify(panel.root)}), active=document.activeElement; return { withinPanel:Boolean(root && active && root.contains(active)), name:active?.getAttribute('aria-label') || active?.textContent?.trim().replace(/\\s+/g,' ').slice(0,100) || active?.tagName || '' } })()`)
    assert.ok(focusState.withinPanel, `${exhibit.id} ${panel.kind}: focus must be inside the opened panel`)
    const panelCheck = { exhibit: exhibit.id, panel: panel.kind, role: panel.role, name: expectedDialogName, landmarkVerified: hasRoot, expandedStateVerified: expanded, focusWithinPanelVerified: focusState.withinPanel, focusedElement: focusState.name, interactiveCount: state.interactiveCount, sliders: state.sliderCount }
    panelChecks.push(panelCheck)
    let phoneCheck = null
    results.push(state)

    if (panel.kind === 'controls') {
      const canvasViewport = await evaluate(`({ width: innerWidth, height: innerHeight })`)
      if (canvasViewport.width === 1440) {
        await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 })
        await waitFor('innerWidth === 390', `${exhibit.id} phone viewport`)
      }
      const phoneState = await inspect(`${exhibit.id} ${panel.kind} phone`)
      results.push(phoneState)
      const phoneFocus = await evaluate(`Boolean(document.querySelector(${JSON.stringify(panel.root)})?.contains(document.activeElement))`)
      assert.ok(phoneFocus, `${exhibit.id} controls: phone viewport retains focus inside the panel`)
      phoneCheck = { exhibit: exhibit.id, panel: 'controls-phone', role: panel.role, name: expectedDialogName, landmarkVerified: hasRoot, expandedStateVerified: expanded, focusWithinPanelVerified: phoneFocus, focusedElement: focusState.name, interactiveCount: phoneState.interactiveCount, sliders: phoneState.sliderCount }
      panelChecks.push(phoneCheck)
      await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
      await waitFor('innerWidth === 1440', `${exhibit.id} desktop viewport restoration`)
    }
    await call('Runtime.evaluate', { expression: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))` })
    await waitFor(`!document.querySelector(${JSON.stringify(panel.root)}) || document.querySelector(${JSON.stringify(panel.root)})?.getAttribute('aria-hidden') === 'true'`, `${exhibit.id} ${panel.kind} close`)
    await waitFor(`document.activeElement === document.querySelector(${JSON.stringify(panel.trigger)})`, `${exhibit.id} ${panel.kind} focus to return to its trigger`)
    panelCheck.focusReturnedToTriggerVerified = true
    if (phoneCheck) phoneCheck.focusReturnedToTriggerVerified = true
  }
}

await call('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
const browser = await evaluate('navigator.userAgent')
socket.close()
assert.deepEqual(browserErrors, [], `Browser or network errors occurred: ${browserErrors.join('; ')}`)

const report = {
  browser,
  method: 'Chrome Accessibility.getFullAXTree against the rendered gallery, search field, and shared controls/about/selector surfaces; reduced motion enabled for route traversal. This checks computed browser semantics, not speech output from an assistive technology.',
  coverage: { exhibits: exhibits.length, panelChecks: panelChecks.length, treeSnapshots: results.length, browserErrors },
  findings: {
    unnamedInteractiveControls: results.reduce((total, snapshot) => total + snapshot.unnamedCount, 0),
    unboundedSliders: results.reduce((total, snapshot) => total + snapshot.unboundedSliderCount, 0),
    unnamedSharedLandmarks: panelChecks.filter((check) => !check.landmarkVerified).length,
    missingExpandedTriggerState: panelChecks.filter((check) => !check.expandedStateVerified).length,
    missingPanelFocus: panelChecks.filter((check) => !check.focusWithinPanelVerified).length,
    missingFocusReturn: panelChecks.filter((check) => !check.focusReturnedToTriggerVerified).length,
  },
  panels: panelChecks,
  snapshots: results,
}
await mkdir(evidenceRoot, { recursive: true })
await writeFile(resolve(evidenceRoot, 'accessibility-tree-review.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`Accessibility tree review passed: gallery/search, all ${exhibits.length} exhibits, named controls/about/selector surfaces, phone control snapshots, and no browser/network errors.`)
