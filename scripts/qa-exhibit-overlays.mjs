import './require-browser-qa-supervisor.mjs'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9362)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5215'
const evidenceRoot = resolve('docs/renaissance/evidence')
const allExhibits = JSON.parse(await readFile(resolve('src/data/experiments.json'), 'utf8'))
const exhibitFilter = process.env.ARMSTEEL_QA_EXHIBITS?.split(',').map((id) => id.trim()).filter(Boolean)
const exhibits = exhibitFilter ? allExhibits.filter((item) => exhibitFilter.includes(item.id)) : allExhibits
assert.ok(exhibits.length, 'No exhibits selected for overlay review')
const allViewports = [
  { width: 320, height: 740, mobile: true, name: 'narrow portrait' },
  { width: 390, height: 844, mobile: true, name: 'phone portrait' },
  { width: 768, height: 1024, mobile: true, name: 'tablet portrait' },
  { width: 1024, height: 768, mobile: false, name: 'tablet landscape' },
  { width: 1440, height: 900, mobile: false, name: 'desktop' },
  { width: 844, height: 390, mobile: true, name: 'phone landscape' },
]
const viewportFilter = process.env.ARMSTEEL_QA_VIEWPORTS?.split(',').map((name) => name.trim()).filter(Boolean)
const viewports = viewportFilter ? allViewports.filter((viewport) => viewportFilter.includes(viewport.name)) : allViewports
assert.ok(viewports.length, 'No viewports selected for overlay review')
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

async function setViewport({ width, height, mobile }) {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height })
  await call('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 1 } : { enabled: false })
}

async function waitForRoute(path) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await evaluate(`location.pathname === ${JSON.stringify(path)} && Boolean(document.querySelector('.experience-dock'))`)) return
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error(`Timed out loading ${path}`)
}

function viewportReview(viewport, exhibitId, expectedAbout) {
  return `(() => {
    const viewportName = ${JSON.stringify(viewport.name)}
    const exhibit = ${JSON.stringify(exhibitId)}
    const expectedModelDescription = ${JSON.stringify(expectedAbout)}
    const emulatedTouch = ${JSON.stringify(viewport.mobile)}
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
    const readPanel = (kind, triggerSelector, panelSelector) => {
      const trigger = document.querySelector(triggerSelector)
      trigger?.focus({ preventScroll: true })
      trigger?.click()
      return (async () => {
        let panel = null
        for (let attempt = 0; attempt < 60; attempt++) {
          await nextFrame()
          panel = document.querySelector(panelSelector)
          if (panel?.contains(document.activeElement)) break
        }
        const rect = panel?.getBoundingClientRect()
        const focusable = panel?.querySelector('button, input, select, [tabindex="0"]')
        const focusRect = focusable?.getBoundingClientRect()
        const scroller = kind === 'selector' ? panel?.querySelector('.selector-list') : panel
        const scroll = { scrollHeight: scroller?.scrollHeight, clientHeight: scroller?.clientHeight, overflowY: scroller && getComputedStyle(scroller).overflowY }
        const selectorRows = kind === 'selector' ? [...(panel?.querySelectorAll('.selector-list > button') ?? [])] : []
        let selectorReach = null
        if (kind === 'selector' && scroller && selectorRows.length) {
          scroller.scrollTop = scroller.scrollHeight
          for (let attempt = 0; attempt < 2; attempt++) await nextFrame()
          const listRect = scroller.getBoundingClientRect()
          const lastRect = selectorRows.at(-1).getBoundingClientRect()
          selectorReach = { rowCount: selectorRows.length, scrollTop: scroller.scrollTop, lastRowBottom: lastRect.bottom, listBottom: listRect.bottom, lastRowReachable: lastRect.bottom <= listRect.bottom + 1, minRowHeight: Math.min(...selectorRows.map((row) => row.getBoundingClientRect().height)) }
          scroller.scrollTop = 0
        }
        const open = {
          exhibit, viewport: viewportName, kind, width: innerWidth, height: innerHeight,
          panel: rect && { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
          scroll, selectorReach,
          focus: { tag: focusable?.tagName, label: focusable?.getAttribute('aria-label'), inside: Boolean(focusable && panel?.contains(document.activeElement)), visible: Boolean(focusRect && focusRect.width && focusRect.height) },
          triggerExpanded: trigger?.getAttribute('aria-expanded'), documentWidth: document.documentElement.scrollWidth,
        }
        const accessibleControls = panel ? [...panel.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]')].filter((element) => {
          const style = getComputedStyle(element)
          const bounds = element.getBoundingClientRect()
          return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0 && !element.closest('[aria-hidden="true"], [inert]')
        }).map((element) => {
          const labelledBy = element.getAttribute('aria-labelledby')?.split(/\\s+/).map((id) => document.getElementById(id)?.textContent.trim()).filter(Boolean).join(' ')
          const labels = element.labels ? [...element.labels].map((label) => label.textContent.trim()).filter(Boolean).join(' ') : ''
          const name = [element.getAttribute('aria-label'), labelledBy, labels, element.textContent?.trim(), element.getAttribute('title')].find((value) => value?.trim())?.trim() ?? ''
          return { tag: element.tagName.toLowerCase(), type: element.getAttribute('type'), name, className: String(element.className), text: element.textContent.trim().slice(0, 100), html: element.outerHTML.slice(0, 320) }
        }) : []
        open.accessibleControlCount = accessibleControls.length
        open.unnamedControls = accessibleControls.filter((element) => !element.name)
        open.issues = []
        if (kind === 'information') {
          const details = panel?.querySelector('.info-reading')
          const summary = details?.querySelector('summary')
          summary?.click()
          await nextFrame()
          const paragraph = details?.querySelector('p')
          const text = paragraph?.textContent?.trim() ?? ''
          const textRect = paragraph?.getBoundingClientRect()
          const panelRect = panel?.getBoundingClientRect()
          open.modelDescription = {
            available: Boolean(details && summary && paragraph),
            expanded: details?.open ?? false,
            exact: text === expectedModelDescription,
            accessibleLabel: summary?.textContent?.trim() ?? '',
            paragraphWidth: paragraph?.clientWidth ?? 0,
            paragraphScrollWidth: paragraph?.scrollWidth ?? 0,
            visibleInsidePanel: Boolean(textRect && panelRect && textRect.width > 0 && textRect.height > 0 && textRect.right <= panelRect.right + 1 && textRect.left >= panelRect.left - 1),
          }
          if (!open.modelDescription.available) open.issues.push('model description is unavailable')
          if (!open.modelDescription.expanded || !open.modelDescription.exact) open.issues.push('expanded model description differs from the exhibit metadata')
          if (!open.modelDescription.accessibleLabel) open.issues.push('model description disclosure has no visible label')
          if (open.modelDescription.paragraphScrollWidth > open.modelDescription.paragraphWidth + 1) open.issues.push('model description has horizontal text overflow')
          if (!open.modelDescription.visibleInsidePanel) open.issues.push('model description escapes the information panel')
        }
        if (!open.panel) open.issues.push('panel missing')
        else {
          if (open.panel.x < -1 || open.panel.y < -1 || open.panel.right > innerWidth + 1 || open.panel.bottom > innerHeight + 1) open.issues.push('panel escapes viewport')
          if (scroll.scrollHeight > scroll.clientHeight + 1 && !['auto', 'scroll'].includes(scroll.overflowY)) open.issues.push('overflowing panel cannot scroll')
        }
        if (!open.focus.inside) open.issues.push('focus did not enter panel')
        if (open.documentWidth > innerWidth + 1) open.issues.push('page has horizontal overflow')
        if (open.unnamedControls.length) open.issues.push(open.unnamedControls.length + ' visible controls have no accessible name')
        if (kind === 'selector') {
          if (selectorRows.length !== ${allExhibits.length}) open.issues.push('selector has an unexpected number of options')
          if (scroll.scrollHeight > scroll.clientHeight + 1 && !selectorReach?.lastRowReachable) open.issues.push('last selector option cannot be reached by scrolling')
          if (emulatedTouch && (selectorReach?.minRowHeight ?? 0) < 40) open.issues.push('selector option touch target is too small')
        }

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
        for (let attempt = 0; attempt < 6; attempt++) await nextFrame()
        open.closeState = { expanded: trigger?.getAttribute('aria-expanded'), returnedFocus: document.activeElement === trigger, closed: kind === 'selector' ? !document.querySelector(panelSelector) : !panel?.classList.contains('is-open') }
        if (!open.closeState.closed) open.issues.push('Escape did not close panel')
        if (!open.closeState.returnedFocus) open.issues.push('Escape did not return focus')
        return open
      })()
    }

    return (async () => {
      const pause = document.querySelector('button[aria-label="Pause experiment"]')
      pause?.click()
      const dockNode = document.querySelector('.experience-dock')
      const dockRect = dockNode?.getBoundingClientRect()
      const dockButtons = [...(dockNode?.querySelectorAll('button') ?? [])].filter((button) => getComputedStyle(button).display !== 'none').map((button) => {
        const rect = button.getBoundingClientRect()
        return { label: button.getAttribute('aria-label'), x: rect.x, right: rect.right, width: rect.width, height: rect.height }
      })
      const dock = {
        exhibit, viewport: viewportName, type: 'dock', width: innerWidth, height: innerHeight,
        documentWidth: document.documentElement.scrollWidth, x: dockRect?.x, right: dockRect?.right,
        widthPx: dockRect?.width, scrollWidth: dockNode?.scrollWidth, clientWidth: dockNode?.clientWidth, buttons: dockButtons, issues: [],
      }
      if (dock.x < -1 || dock.right > innerWidth + 1) dock.issues.push('dock escapes viewport')
      if (dock.documentWidth > innerWidth + 1) dock.issues.push('page has horizontal overflow')
      if (dockButtons.some((button) => button.x < -1 || button.right > innerWidth + 1)) dock.issues.push('dock control is clipped by the viewport')
      if (dockButtons.some((button) => button.x < dock.x + 1 || button.right > dock.right - 1)) dock.issues.push('dock control extends beyond its glass frame')
      if (emulatedTouch && dockButtons.some((button) => button.width < 40 || button.height < 40)) dock.issues.push('dock touch target is too small')
      const panels = []
      panels.push(await readPanel('controls', 'button[aria-label="Toggle experiment controls"]', '.control-panel.is-open'))
      panels.push(await readPanel('information', 'button[aria-label="Toggle experiment information"]', '#experiment-information'))
      panels.push(await readPanel('selector', '.dock-current', '#experiment-selector'))
      return [dock, ...panels]
    })()
  })()`
}

const results = []
await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')

for (const exhibit of exhibits) {
  await call('Page.navigate', { url: `${base}/exhibits/${exhibit.id}` })
  await waitForRoute(`/exhibits/${exhibit.id}`)
  for (const viewport of viewports) {
    await setViewport(viewport)
    results.push(...await evaluate(viewportReview(viewport, exhibit.id, exhibit.about)))
  }
}

socket.close()
await mkdir(evidenceRoot, { recursive: true })
const issues = results.filter((result) => result.issues?.length)
const checkGroups = results.reduce((counts, result) => {
  const key = result.kind ?? result.type
  counts[key] = (counts[key] ?? 0) + 1
  return counts
}, {})
const narrowDock = results.find((result) => result.type === 'dock' && result.exhibit === 'mandelbrot' && result.viewport === 'narrow portrait')
const narrowSelector = results.find((result) => result.kind === 'selector' && result.exhibit === 'mandelbrot' && result.viewport === 'narrow portrait')
const lazyControlFocus = results.find((result) => result.kind === 'controls' && result.exhibit === 'machine' && result.viewport === 'narrow portrait')
const report = {
  base,
  chromium: 'HeadlessChrome 157, SwiftShader WebGL, viewport and touch emulation',
  coverage: { totalExhibits: allExhibits.length, exhibitsChecked: exhibits.map(({ id }) => id), viewports, checks: results.length, groups: checkGroups },
  accessibleNames: {
    method: 'DOM heuristic: aria-label, aria-labelledby, associated labels, text content or title; not the browser accessibility tree or a screen-reader test.',
    controlObservations: results.reduce((total, result) => total + (result.accessibleControlCount ?? 0), 0),
    unnamedControls: results.reduce((total, result) => total + (result.unnamedControls?.length ?? 0), 0),
  },
  representative: {
    narrowPhoneDock: narrowDock && { bounds: { x: narrowDock.x, right: narrowDock.right, width: narrowDock.widthPx }, targets: narrowDock.buttons.map(({ label, width, height }) => ({ label, width, height })) },
    narrowPhoneSelector: narrowSelector && { rowCount: narrowSelector.selectorReach?.rowCount, minRowHeight: narrowSelector.selectorReach?.minRowHeight, lastRowReachable: narrowSelector.selectorReach?.lastRowReachable },
    lazyControlFocus: lazyControlFocus && { focusedIntoPanel: lazyControlFocus.focus?.inside, EscapeReturnedFocus: lazyControlFocus.closeState?.returnedFocus },
  },
  issues,
  browserErrors,
}
await writeFile(resolve(evidenceRoot, 'exhibit-overlay-review.json'), `${JSON.stringify(report, null, 2)}\n`)
if (issues.length || browserErrors.length) {
  console.error(`${issues.length} layout/accessibility findings across ${results.length} checks; ${browserErrors.length} browser errors.`)
  console.error(JSON.stringify({ issues: issues.slice(0, 30), browserErrors: browserErrors.slice(0, 20) }, null, 2))
  process.exitCode = 1
} else {
  console.log(`Exhibit overlay review passed: ${exhibits.length} exhibits, ${viewports.length} viewports, ${results.length} dock/panel checks, no browser errors.`)
}
