import './require-browser-qa-supervisor.mjs'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9362)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5215'
const evidenceRoot = resolve('docs/renaissance/evidence')
const exhibits = JSON.parse(await readFile(resolve('src/data/experiments.json'), 'utf8'))
const concepts = JSON.parse(await readFile(resolve('src/data/discovery-concepts.json'), 'utf8'))
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page' && (target.url === 'about:blank' || target.url.startsWith(base)))
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
async function waitFor(expression, label) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await evaluate(expression)) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function setViewport(width, height, mobile) {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height })
  await call('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 1 } : { enabled: false })
}

function normalize(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
}

function colorChannels(value) {
  const match = value.match(/rgba?\(([^)]+)\)/)
  return match ? match[1].split(',').map((channel) => Number.parseFloat(channel.trim())) : []
}

function matchingIds(query, category = null) {
  return exhibits.filter((item) => {
    const text = normalize([item.title, item.category, item.description, item.subtitle, item.about, item.method, item.metaDescription, ...item.concepts].join(' '))
    return (!category || item.category === category) && text.includes(normalize(query.trim()))
  }).map(({ id }) => id).sort()
}

async function setSearchQuery(value) {
  await evaluate(`(() => {
    const input = document.querySelector('.search-panel input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(60)
}

async function visibleGalleryIds() {
  return evaluate(`[...document.querySelectorAll('.featured-art-link[href], .gallery-grid .card-art-link[href]')].map((link) => link.getAttribute('href').split('/').at(-1)).sort()`)
}

async function capture(name) {
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(resolve(evidenceRoot, name), Buffer.from(screenshot.data, 'base64'))
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await setViewport(1440, 900, false)
await call('Page.navigate', { url: `${base}/` })
await waitFor(`location.pathname === '/' && Boolean(document.querySelector('.gallery-grid'))`, 'the collection')
await evaluate(`localStorage.removeItem('armsteel:favorites')`)
await call('Page.reload')
await waitFor(`location.pathname === '/' && Boolean(document.querySelector('.gallery-grid'))`, 'the collection with isolated favorites')
await evaluate(`document.querySelector('#collection')?.scrollIntoView({ block: 'start', behavior: 'instant' })`)
await sleep(150)
await evaluate(`document.querySelector('button[aria-label="Search the collection"]')?.click()`)
await waitFor(`Boolean(document.querySelector('.search-panel input') && document.activeElement === document.querySelector('.search-panel input'))`, 'focused collection search')
const desktopSuggestions = await evaluate(`({
  labels: [...document.querySelectorAll('.search-ideas button')].map((button) => button.textContent.trim()),
  heights: [...document.querySelectorAll('.search-ideas button')].map((button) => button.getBoundingClientRect().height),
  fontSizes: [...document.querySelectorAll('.search-ideas button')].map((button) => Number.parseFloat(getComputedStyle(button).fontSize)),
  placeholderColor: getComputedStyle(document.querySelector('.search-panel input'), '::placeholder').color,
  overflow: document.documentElement.scrollWidth > innerWidth + 1,
})`)
assert.deepEqual(desktopSuggestions.labels.map((label) => normalize(label)), concepts.map(({ term }) => term), 'desktop search presents each curated idea')
assert.ok(desktopSuggestions.heights.every((height) => height >= 40), 'desktop idea suggestions have 40 px targets')
assert.ok(desktopSuggestions.fontSizes.every((size) => size >= 11), 'desktop idea labels are at least 11 px')
const desktopPlaceholder = colorChannels(desktopSuggestions.placeholderColor)
assert.ok(desktopPlaceholder.length >= 4 && desktopPlaceholder[0] >= 165 && desktopPlaceholder[1] >= 180 && desktopPlaceholder[2] >= 190 && desktopPlaceholder[3] >= .85, `The search prompt is too faint: ${desktopSuggestions.placeholderColor}`)
assert.equal(desktopSuggestions.overflow, false, 'desktop idea suggestions do not cause horizontal overflow')
await capture('collection-ideas-desktop.png')

const conceptChecks = []
for (const concept of concepts) {
  await evaluate(`(() => [...document.querySelectorAll('.search-ideas button')].find((button) => button.textContent.trim() === ${JSON.stringify(concept.label)})?.click())()`)
  await waitFor(`document.querySelector('.result-count')?.textContent.trim().startsWith(${JSON.stringify(String(matchingIds(concept.term).length).padStart(2, '0'))})`, `results for ${concept.term}`)
  const actual = await visibleGalleryIds()
  const expected = matchingIds(concept.term)
  assert.deepEqual(actual, expected, `${concept.term} search returns the relevant metadata matches`)
  conceptChecks.push({ term: concept.term, results: actual })
  await evaluate(`document.querySelector('button[aria-label="Clear search"]')?.click()`)
  await waitFor(`Boolean(document.querySelector('.search-ideas button'))`, `idea suggestions after clearing ${concept.term}`)
}

await setSearchQuery('no-such-concept-renaissance')
const emptyState = await evaluate(`({
  count: document.querySelector('.result-count')?.textContent.trim(),
  status: document.querySelector('.empty-state[role="status"]')?.textContent.trim(),
  clearAvailable: Boolean(document.querySelector('button[aria-label="Clear search"]')),
})`)
assert.match(emptyState.count ?? '', /^00 STUDIES$/)
assert.ok(emptyState.status && emptyState.clearAvailable, 'no-results state is announced and easy to recover from')
await evaluate(`document.querySelector('button[aria-label="Clear search"]')?.click()`)
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await waitFor(`!document.querySelector('.search-panel') && document.activeElement?.getAttribute('aria-label') === 'Search the collection'`, 'search Escape/focus recovery')

await evaluate(`document.querySelector('.featured-piece button[aria-label="Add The Infinite Shore to favourites"]')?.click()`)
const favoriteSaved = await evaluate(`document.querySelector('.featured-piece button[aria-label="Remove The Infinite Shore from favourites"]')?.getAttribute('aria-pressed') === 'true'`)
assert.equal(favoriteSaved, true, 'the exhibit favorite control saves the chosen study')
await evaluate(`document.querySelector('.filter-chip') && [...document.querySelectorAll('.filter-chip')].find((chip) => chip.textContent.trim().startsWith('Favourites'))?.click()`)
const favoriteIds = await visibleGalleryIds()
assert.deepEqual(favoriteIds, ['mandelbrot'], 'the favourites filter keeps the chosen study')
await evaluate(`document.querySelector('.filter-chip')?.click()`)
await evaluate(`document.querySelector('a[href="/exhibits/mandelbrot"]')?.click()`)
await waitFor(`location.pathname === '/exhibits/mandelbrot' && Boolean(document.querySelector('.dock-current'))`, 'opening a study from the collection')
await evaluate(`document.querySelector('button[aria-label="Return to exhibition"]')?.click()`)
await waitFor(`location.pathname === '/' && Boolean(document.querySelector('.recent-section a[href="/exhibits/mandelbrot"]'))`, 'recent-study return path')
const recentVisit = await evaluate(`document.querySelector('.recent-section a[href="/exhibits/mandelbrot"] strong')?.textContent.trim()`)
assert.equal(recentVisit, 'The Infinite Shore', 'recent visits return to the study just explored')

await setViewport(390, 844, true)
await evaluate(`document.querySelector('#collection')?.scrollIntoView({ block: 'start', behavior: 'instant' })`)
await sleep(150)
await evaluate(`document.querySelector('button[aria-label="Search the collection"]')?.click()`)
await waitFor(`Boolean(document.querySelector('.search-panel input'))`, 'phone search input')
const mobileSuggestions = await evaluate(`({
  labels: [...document.querySelectorAll('.search-ideas button')].map((button) => button.textContent.trim()),
  heights: [...document.querySelectorAll('.search-ideas button')].map((button) => button.getBoundingClientRect().height),
  fontSizes: [...document.querySelectorAll('.search-ideas button')].map((button) => Number.parseFloat(getComputedStyle(button).fontSize)),
  placeholderColor: getComputedStyle(document.querySelector('.search-panel input'), '::placeholder').color,
  overflow: document.documentElement.scrollWidth > innerWidth + 1,
  outside: [...document.querySelectorAll('.search-ideas button')].filter((button) => { const rect = button.getBoundingClientRect(); return rect.left < 0 || rect.right > innerWidth }).map((button) => button.textContent.trim()),
})`)
assert.deepEqual(mobileSuggestions.labels.map((label) => normalize(label)), concepts.map(({ term }) => term))
assert.ok(mobileSuggestions.heights.every((height) => height >= 40), 'phone idea suggestions meet the 40 px touch target')
assert.ok(mobileSuggestions.fontSizes.every((size) => size >= 11), 'phone idea labels are at least 11 px')
const mobilePlaceholder = colorChannels(mobileSuggestions.placeholderColor)
assert.ok(mobilePlaceholder.length >= 4 && mobilePlaceholder[0] >= 165 && mobilePlaceholder[1] >= 180 && mobilePlaceholder[2] >= 190 && mobilePlaceholder[3] >= .85, `The phone search prompt is too faint: ${mobileSuggestions.placeholderColor}`)
assert.equal(mobileSuggestions.overflow, false, 'phone idea suggestions do not cause horizontal overflow')
assert.deepEqual(mobileSuggestions.outside, [], 'every phone idea suggestion is inside the viewport')
await capture('collection-ideas-mobile.png')
await evaluate(`document.querySelector('.search-ideas button[aria-pressed="false"]') && [...document.querySelectorAll('.search-ideas button')].find((button) => button.textContent.trim() === 'Fields')?.click()`)
await waitFor(`document.querySelector('.result-count')?.textContent.trim().startsWith(${JSON.stringify(String(matchingIds('fields').length).padStart(2, '0'))})`, 'phone concept filtering')
const mobileFieldResults = await visibleGalleryIds()
assert.deepEqual(mobileFieldResults, matchingIds('fields'), 'phone concept search shows its expected exhibits')
await evaluate(`document.querySelector('button[aria-label="Clear search"]')?.click()`)
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await waitFor(`!document.querySelector('.search-panel')`, 'close phone collection search')
const mobileFilters = await evaluate(`(() => {
  const row = document.querySelector('.filter-row')
  const chips = [...(row?.querySelectorAll('.filter-chip') ?? [])]
  if (!row || !chips.length) return null
  row.scrollLeft = row.scrollWidth
  const rowRect = row.getBoundingClientRect()
  const lastRect = chips.at(-1).getBoundingClientRect()
  const metrics = {
    count: chips.length,
    minimumHeight: Math.min(...chips.map((chip) => chip.getBoundingClientRect().height)),
    minimumFontPx: Math.min(...chips.map((chip) => Number.parseFloat(getComputedStyle(chip).fontSize))),
    scrollable: row.scrollWidth > row.clientWidth,
    lastTargetReachable: lastRect.left >= rowRect.left - 1 && lastRect.right <= rowRect.right + 1,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
  }
  row.scrollLeft = 0
  return metrics
})()`)
assert.ok(mobileFilters && mobileFilters.count >= 8, 'the mobile filter row exposes every collection category and favourites')
assert.ok(mobileFilters.minimumHeight >= 43.9, `Mobile category hit areas are too small: ${JSON.stringify(mobileFilters)}`)
assert.ok(mobileFilters.minimumFontPx >= 11, `Mobile category labels are too small: ${JSON.stringify(mobileFilters)}`)
assert.equal(mobileFilters.scrollable, true, 'the category row communicates a horizontally scrollable collection')
assert.equal(mobileFilters.lastTargetReachable, true, 'the last category can be scrolled fully into view')
assert.ok(mobileFilters.documentWidth <= mobileFilters.viewportWidth + 1, 'mobile category scrolling does not overflow the page')
const swipe = await evaluate(`(() => {
  const row = document.querySelector('.filter-row')
  row.scrollLeft = 0
  const rect = row.getBoundingClientRect()
  return { startX: Math.min(rect.right - 10, innerWidth - 10), endX: rect.left + 10, y: rect.top + rect.height / 2 }
})()`)
assert.ok(swipe.startX - swipe.endX >= 100, `The phone filter row has too little horizontal travel for a swipe: ${JSON.stringify(swipe)}`)
await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: swipe.startX, y: swipe.y, id: 1 }] })
await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: swipe.startX - 50, y: swipe.y, id: 1 }] })
await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: swipe.endX, y: swipe.y, id: 1 }] })
await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(120)
const mobileFilterSwipe = await evaluate(`({ scrollLeft: document.querySelector('.filter-row').scrollLeft, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth })`)
assert.ok(mobileFilterSwipe.scrollLeft > 0, `A real touch swipe did not move the collection filters: ${JSON.stringify(mobileFilterSwipe)}`)
assert.ok(mobileFilterSwipe.documentWidth <= mobileFilterSwipe.viewportWidth + 1, 'touch scrolling stays inside the page viewport')
await setViewport(1440, 900, false)
const relatedChecks = []
let relationshipClick = null
for (const exhibit of exhibits) {
  await evaluate(`(() => {
    const href = ${JSON.stringify(`/exhibits/${exhibit.id}`)}
    const link = document.querySelector(href === '/exhibits/mandelbrot' ? '.featured-art-link[href="' + href + '"]' : '.gallery-grid .card-art-link[href="' + href + '"]')
    link?.click()
  })()`)
  await waitFor(`location.pathname === ${JSON.stringify(`/exhibits/${exhibit.id}`)} && Boolean(document.querySelector('.dock-current'))`, `route to ${exhibit.id}`)
  await evaluate(`document.querySelector('button[aria-label="Toggle experiment information"]')?.click()`)
  await waitFor(`Boolean(document.querySelector('.related-studies a'))`, `related studies for ${exhibit.id}`)
  const related = await evaluate(`[...document.querySelectorAll('.related-studies a')].map((link) => link.getAttribute('href').split('/').at(-1))`)
  assert.deepEqual(related, exhibit.related, `${exhibit.id} shows its curated relationships in order`)
  relatedChecks.push({ exhibit: exhibit.id, related })
  if (!relationshipClick) {
    const target = related[0]
    await evaluate(`document.querySelector('.related-studies a')?.click()`)
    await waitFor(`location.pathname === ${JSON.stringify(`/exhibits/${target}`)}`, `following a related-study link from ${exhibit.id}`)
    relationshipClick = { from: exhibit.id, to: target }
  }
  await evaluate(`document.querySelector('button[aria-label="Return to exhibition"]')?.click()`)
  await waitFor(`location.pathname === '/' && Boolean(document.querySelector('.gallery-grid'))`, `return to collection after ${exhibit.id}`)
}

socket.close()
await mkdir(evidenceRoot, { recursive: true })
const report = {
  browser: 'HeadlessChrome 157, SwiftShader WebGL, desktop and touch-emulated phone',
  concepts: { desktopSuggestions: desktopSuggestions.labels, desktopSuggestionTargets: desktopSuggestions.heights, desktopSuggestionFontPx: desktopSuggestions.fontSizes, desktopSearchPlaceholderColor: desktopSuggestions.placeholderColor, conceptChecks, noResultsRecovery: emptyState, mobileSuggestions: mobileSuggestions.labels, mobileSuggestionTargets: mobileSuggestions.heights, mobileSuggestionFontPx: mobileSuggestions.fontSizes, mobileSearchPlaceholderColor: mobileSuggestions.placeholderColor, mobileOverflow: mobileSuggestions.overflow, mobileFilterTargets: mobileFilters, mobileFilterSwipe, mobileFieldResults },
  existingDiscovery: { favorites: favoriteIds, recentVisit },
  relatedStudies: { exhibitsChecked: relatedChecks.length, checks: relatedChecks, linkFollowed: relationshipClick },
  browserErrors,
}
await writeFile(resolve(evidenceRoot, 'collection-discovery-browser-checks.json'), `${JSON.stringify(report, null, 2)}\n`)
assert.equal(browserErrors.length, 0, `browser errors: ${browserErrors.join('; ')}`)
console.log(`Collection discovery passed: ${conceptChecks.length} concept searches, favourites/recent recovery, ${relatedChecks.length} related-study routes, and phone touch layout.`)
