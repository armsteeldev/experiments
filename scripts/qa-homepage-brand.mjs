import './require-browser-qa-supervisor.mjs'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9345)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5197'
const screenshotDir = resolve('docs/rebrand/screenshots')
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

async function setViewport(width, height, mobile) {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height })
  await call('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 1 })
  await evaluate('window.scrollTo(0, 0)')
}

async function waitFor(expression, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`Boolean(${expression})`)) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function inspectHome(width, height, mobile) {
  await setViewport(width, height, mobile)
  const state = await evaluate(`(() => {
    const title = document.querySelector('.portal-hero h1')
    const byline = document.querySelector('.portal-hero .hero-byline')
    const entry = document.querySelector('.portal-hero .hero-explore')
    const brand = document.querySelector('.site-header .brand')
    const nav = document.querySelector('.site-header nav')
    const mark = brand?.querySelector('.brand-mark')
    const rect = (element) => { const box = element?.getBoundingClientRect(); return box && { x: box.x, y: box.y, width: box.width, height: box.height, left: box.left, right: box.right, bottom: box.bottom } }
    const titleRect = rect(title)
    const bylineRect = rect(byline)
    const entryRect = rect(entry)
    const brandRect = rect(brand)
    const navRect = rect(nav)
    const entryStyle = entry && getComputedStyle(entry)
    return {
      width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
      title: title?.innerText.replace(/\\n/g, ' '), titleLines: title?.querySelectorAll('span').length,
      titleRect, titleAnimation: title && getComputedStyle(title).animationName,
      byline: byline?.innerText, bylineRect, entryText: entry?.innerText.trim(), entryRect,
      entryOpacity: entryStyle?.opacity, entryBlur: entryStyle?.backdropFilter,
      entryRadius: entryStyle?.borderRadius, entryOutline: entryStyle?.outlineStyle,
      brandName: brand?.querySelector('.brand-words strong')?.textContent.trim(),
      brandRect, navRect, markLoaded: Boolean(mark?.complete && mark.naturalWidth), markBox: rect(mark),
      preview: document.querySelector('.hero-study-art canvas.artwork-preview')?.tagName ?? null,
      hasTaglineInCollection: Boolean(document.querySelector('.collection-section .collection-tagline')),
      taglineInHero: Boolean(document.querySelector('.portal-hero .collection-tagline')),
    }
  })()`)

  assert.equal(state.title, 'The Shape of Motion', 'hero title has the approved name')
  assert.equal(state.titleLines, 2, 'hero title remains in two lines')
  assert.ok(Math.abs(state.titleRect.x + state.titleRect.width / 2 - width / 2) <= 1.5, `title is horizontally centered at ${width}px (${JSON.stringify({ actualWidth: state.width, titleRect: state.titleRect })})`)
  assert.ok(Math.abs(state.titleRect.y + state.titleRect.height / 2 - height / 2) <= 1.5, `title is vertically centered at ${height}px`)
  assert.ok(state.byline.startsWith('A collection by') && state.byline.includes('ARMSTEEL'), 'the centered ARMSTEEL attribution remains below the title')
  assert.ok(Math.abs(state.bylineRect.x + state.bylineRect.width / 2 - width / 2) <= 1.5, 'attribution is centered')
  assert.ok(state.entryText.startsWith('Explore the collection'), 'the entry has a clear accessible label')
  assert.ok(state.entryRect.height >= 50 && state.entryRect.width >= 44, 'collection entry has a comfortable target')
  assert.ok(state.entryRect.y > state.bylineRect.bottom && state.entryRect.y - state.bylineRect.bottom <= 30, 'collection entry sits directly below the byline')
  assert.ok(Math.abs(state.entryRect.x + state.entryRect.width / 2 - width / 2) <= 1.5, 'collection entry is centered')
  assert.equal(state.entryOpacity, '1', 'collection entry remains available during the title entrance')
  assert.match(state.entryBlur, /blur\(/, 'collection entry uses a glass-like blurred surface')
  assert.ok(state.markLoaded && state.brandName === 'THE SHAPE OF MOTION', 'homepage header shows the approved symbol and compact wordmark')
  assert.ok(state.brandRect.right < state.navRect.left, `brand and navigation do not collide (${JSON.stringify({ viewport: state.width, expectedWidth: width, brandRect: state.brandRect, navRect: state.navRect, gap: state.navRect.left - state.brandRect.right })})`)
  assert.ok(state.documentWidth <= width + 1, `homepage has no horizontal overflow at ${width}px`)
  assert.equal(state.preview, 'CANVAS', 'the live exhibit preview remains a canvas')
  assert.ok(state.hasTaglineInCollection && !state.taglineInHero, 'the tagline remains in the collection heading, outside the hero')
  return state
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Page.navigate', { url: `${base}/` })
await waitFor(`document.querySelector('.portal-hero .hero-explore') && document.querySelector('.portal-hero h1')`, 'the homepage entrance')
await sleep(1500)

const viewports = [
  { width: 1440, height: 900, mobile: false, file: 'home-desktop.png' },
  { width: 1024, height: 768, mobile: false, file: 'home-tablet.png' },
  { width: 844, height: 390, mobile: true, file: 'home-landscape.png' },
  { width: 390, height: 844, mobile: true, file: 'home-mobile.png' },
  { width: 320, height: 740, mobile: true, file: 'home-narrow.png' },
]
await mkdir(screenshotDir, { recursive: true })
const results = []
for (const viewport of viewports) {
  const state = await inspectHome(viewport.width, viewport.height, viewport.mobile)
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true })
  await writeFile(resolve(screenshotDir, viewport.file), Buffer.from(screenshot.data, 'base64'))
  results.push({ ...state, screenshot: viewport.file })
}

await setViewport(1440, 900, false)
await call('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
for (let tab = 0; tab < 7; tab++) {
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  if (await evaluate(`document.activeElement?.classList.contains('hero-explore')`)) break
}
const focusState = await evaluate(`(() => ({ focused: document.activeElement?.classList.contains('hero-explore'), outline: getComputedStyle(document.activeElement).outlineStyle, width: document.activeElement?.getBoundingClientRect().width }))()`)
assert.ok(focusState.focused && focusState.outline !== 'none', 'collection entry has a visible keyboard focus indicator')
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await waitFor(`location.hash === '#collection'`, 'keyboard entry into the collection')

await call('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await call('Page.navigate', { url: `${base}/` })
await waitFor(`document.querySelector('.portal-hero .hero-explore')`, 'the reduced-motion homepage')
const reducedMotion = await evaluate(`(() => ({ preference: matchMedia('(prefers-reduced-motion: reduce)').matches, titleAnimation: getComputedStyle(document.querySelector('.portal-hero h1')).animationName, titleOpacity: getComputedStyle(document.querySelector('.portal-hero h1')).opacity, bylineAnimation: getComputedStyle(document.querySelector('.hero-byline')).animationName, entryTransition: getComputedStyle(document.querySelector('.hero-explore')).transitionDuration }))()`)
assert.equal(reducedMotion.preference, true)
assert.equal(reducedMotion.titleAnimation, 'none', 'reduced motion removes the title entrance')
assert.equal(reducedMotion.titleOpacity, '1', 'the title remains visible immediately under reduced motion')
assert.equal(reducedMotion.bylineAnimation, 'none', 'reduced motion removes the attribution entrance')
assert.ok(Number.parseFloat(reducedMotion.entryTransition) <= 0.001, 'reduced motion reduces CTA transitions to an imperceptible duration')

await call('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
await call('Page.navigate', { url: `${base}/privacy` })
await waitFor(`document.querySelector('.information-page .site-header .brand-lockup')`, 'the interior navigation lockup')
await waitFor(`document.title === 'Privacy — The Shape of Motion'`, 'the interior page metadata')
const interior = await evaluate(`(() => ({ title: document.title, lockup: document.querySelector('.information-page .site-header .brand-words strong')?.textContent.trim(), markLoaded: Boolean(document.querySelector('.information-page .site-header .brand-mark')?.naturalWidth), overflow: document.documentElement.scrollWidth > innerWidth, hasManifest: Boolean(document.querySelector('link[rel="manifest"]')), hasFavicon: Boolean(document.querySelector('link[rel="icon"][href="/favicon.svg"]')), theme: document.querySelector('meta[name="theme-color"]')?.content, description: document.querySelector('meta[name="description"]')?.content, ogTitle: document.querySelector('meta[property="og:title"]')?.content }))()`)
assert.equal(interior.lockup, 'THE SHAPE OF MOTION', 'information pages use the wordmark navigation')
assert.ok(interior.markLoaded && !interior.overflow, 'interior brand loads without horizontal overflow')
assert.ok(interior.hasManifest && interior.hasFavicon, 'manifest and favicon links are present')
assert.equal(interior.theme, '#090b0d')
assert.equal(interior.ogTitle, 'Privacy — The Shape of Motion')
assert.ok(interior.description)
const interiorMobile = []
for (const width of [390, 320]) {
  await setViewport(width, 844, true)
  const mobileState = await evaluate(`(() => { const brand = document.querySelector('.information-page .site-header .brand')?.getBoundingClientRect(); const nav = document.querySelector('.information-page .site-header nav')?.getBoundingClientRect(); return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, hasBrand: Boolean(brand), hasNav: Boolean(nav), brandRight: brand?.right, navLeft: nav?.left } })()`)
  assert.ok(mobileState.hasBrand && mobileState.hasNav && mobileState.documentWidth <= width + 1, `interior navigation fits at ${width}px`)
  assert.ok(mobileState.brandRight < mobileState.navLeft, `interior lockup and links remain separated at ${width}px`)
  interiorMobile.push(width)
}

const report = {
  createdAt: new Date().toISOString(),
  method: 'Supervised Chromium production preview: centered hero geometry, entry placement and target size, live preview canvas, keyboard focus and activation, reduced-motion styles, interior brand lockup, metadata, and mobile overflow.',
  screenshots: results.map(({ screenshot }) => screenshot),
  viewports: results,
  focusState,
  reducedMotion,
  interior,
  interiorMobile,
  browserErrors,
}
await writeFile(resolve(screenshotDir, 'homepage-brand-checks.json'), `${JSON.stringify(report, null, 2)}\n`)
socket.close()
if (browserErrors.length) {
  console.error(JSON.stringify(report, null, 2))
  process.exitCode = 1
} else {
  console.log(`Homepage brand checks passed: ${results.length} homepage viewport layouts, centered title and byline, glass entry, keyboard navigation, reduced motion, interior lockup at ${interiorMobile.join('/')}px and metadata; no browser or HTTP errors.`)
}
