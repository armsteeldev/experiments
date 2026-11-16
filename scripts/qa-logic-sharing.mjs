import './require-browser-qa-supervisor.mjs'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9362)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5217'
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page')
assert.ok(page, `No page target found on CDP port ${port}`)
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const waiting = new Map()
const errors = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && waiting.has(message.id)) {
    const { resolve, reject, method, timeout } = waiting.get(message.id)
    clearTimeout(timeout)
    waiting.delete(message.id)
    if (message.error) reject(new Error(`${method}: ${message.error.message}`))
    else resolve(message.result)
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((item) => item.value ?? item.description ?? '').join(' '))
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) errors.push(`HTTP ${message.params.response.status}: ${message.params.response.url.slice(0, 120)}`)
})

function call(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { waiting.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 30000)
    waiting.set(id, { resolve, reject, method, timeout })
  })
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(expression, label) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate(expression)) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function click(selector) {
  assert.ok(await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true })()`), `Could not click ${selector}`)
}

async function selectValue(selector, value, index = 0) {
  assert.ok(await evaluate(`(() => { const node = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!node) return false; node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('change', { bubbles: true })); return true })()`), `Could not select ${value} in ${selector}[${index}]`)
  await sleep(60)
}

async function clickNode(id) {
  const point = await evaluate(`(() => { const node = [...document.querySelectorAll('.circuit-node.node-input')].find((item) => item.getAttribute('aria-label')?.startsWith(${JSON.stringify(`Switch ${id.toUpperCase()}`)})); if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  assert.ok(point, `Could not locate switch ${id}`)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
}

async function copiedState() {
  await click('button[aria-label="Toggle experiment information"]')
  await waitFor('Boolean(document.querySelector(".info-actions button:last-child"))', 'Logic share action')
  const previous = await evaluate('window.__armsteelCopied || ""')
  await click('.info-actions button:last-child')
  await waitFor(`typeof window.__armsteelCopied === 'string' && window.__armsteelCopied !== ${JSON.stringify(previous)}`, 'fresh Logic share link')
  const link = await evaluate('window.__armsteelCopied')
  return { link, state: JSON.parse(Buffer.from(new URL(link).searchParams.get('state'), 'base64url').toString('utf8')).state }
}

function stateUrl(state) {
  return `${base}/exhibits/logic?state=${Buffer.from(JSON.stringify({ $armsteel: 1, state })).toString('base64url')}`
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
const clipboardOverride = await call('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__armsteelCopied = text } } })` })

await call('Page.navigate', { url: `${base}/exhibits/logic` })
await waitFor(`location.pathname === '/exhibits/logic' && document.querySelectorAll('.circuit-node.node-input').length === 2 && !document.querySelector('.experience-loading')`, 'starter circuit')
await clickNode('a')
await clickNode('b')
await waitFor(`document.querySelector('.circuit-node.node-input[aria-label^="Switch A"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('.circuit-node.node-input[aria-label^="Switch B"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('.circuit-node.node-output .node-bit')?.textContent === '1'`, 'both live switches and a lit AND output')
const starterShare = await copiedState()
assert.ok(starterShare.link.length < 16_000, 'A shared starter circuit fits the URL state budget')
assert.equal(starterShare.state.preset, 'and', 'The active starter circuit remains identified')
assert.deepEqual(starterShare.state.circuit.nodes.filter((node) => node.type === 'input').map((node) => node.value), [true, true], 'Both actual switch values are included')
assert.equal(starterShare.state.circuit.wires.length, 3, 'All three starter connections are included')
assert.ok((await evaluate(`document.querySelector('#saved-experiment-note')?.textContent`)).includes('switch values and build goal'), 'The About panel discloses that the circuit board is shared')
await call('Page.navigate', { url: starterShare.link })
await waitFor(`location.pathname === '/exhibits/logic' && document.querySelector('.circuit-node.node-output .node-bit')?.textContent === '1' && !document.querySelector('.experience-loading')`, 'shared starter result after reload')
assert.equal(await evaluate(`document.querySelector('.circuit-node.node-input[aria-label^="Switch A"]')?.getAttribute('aria-pressed')`), 'true', 'Switch A restores as on')
assert.equal(await evaluate(`document.querySelector('.circuit-node.node-input[aria-label^="Switch B"]')?.getAttribute('aria-pressed')`), 'true', 'Switch B restores as on')

await click('.logic-challenge-menu summary')
await click('.logic-challenge-menu button:last-child')
await waitFor(`document.querySelector('.logic-lesson > span')?.textContent === 'BUILDING GOAL · XOR'`, 'XOR build goal')
assert.equal(await evaluate(`document.querySelector('.logic-challenge-menu')?.open`), false, 'The challenge menu closes after choosing a goal')
await click('button[aria-label="Toggle experiment controls"]')
await waitFor(`document.querySelectorAll('#experiment-controls select').length >= 2`, 'circuit construction controls')
await selectValue('#experiment-controls select', 'xor', 1)
assert.ok(await evaluate(`(() => { const button = [...document.querySelectorAll('#experiment-controls .small-action')].find((item) => item.textContent.trim() === 'Add XOR here'); if (!button) return false; button.click(); return true })()`), 'Could not add the XOR gate')
await waitFor(`document.querySelectorAll('.circuit-node.node-xor').length === 1 && document.querySelectorAll('.circuit-node').length === 4`, 'new XOR component')
await click('.logic-keyboard-wire summary')
await waitFor(`document.querySelectorAll('.logic-keyboard-wire select').length === 3`, 'keyboard wire controls')
const gateId = await evaluate(`document.querySelectorAll('.logic-keyboard-wire select')[1]?.value`)
assert.ok(typeof gateId === 'string' && gateId.startsWith('xor-'), 'The new XOR gate is the selected wire target')
async function connect(from, to, input, wireCount) {
  await selectValue('.logic-keyboard-wire select', from, 0)
  await selectValue('.logic-keyboard-wire select', to, 1)
  const selectorCount = await evaluate(`document.querySelectorAll('.logic-keyboard-wire select').length`)
  if (selectorCount > 2) await selectValue('.logic-keyboard-wire select', String(input), 2)
  else assert.equal(input, 0, 'Single-input targets only accept port zero')
  await click('.logic-keyboard-wire button')
  await waitFor(`document.querySelectorAll('.circuit-wire').length === ${wireCount}`, `${from} → ${to} input ${input}`)
}
await connect('a', gateId, 0, 1)
await connect('b', gateId, 1, 2)
await connect(gateId, 'lamp', 0, 3)
assert.equal(await evaluate(`document.querySelector('.logic-lesson > span')?.textContent`), 'BUILDING GOAL · XOR', 'Editing parts and wires keeps the challenge active')
assert.equal(await evaluate(`document.querySelector('.logic-lesson > strong')?.textContent`), 'The lamp follows the rule for all four switch pairs.', 'The completed circuit satisfies the truth-table goal')
await click('button[aria-label="Toggle experiment controls"]')
const gateStart = await evaluate(`(() => { const gate = document.querySelector('.circuit-node.node-xor'), r = gate.getBoundingClientRect(), match = gate.getAttribute('transform').match(/translate\\(([-0-9.]+) ([-0-9.]+)\\)/); return { x: r.left + r.width / 2, y: r.top + r.height / 2, modelX: Number(match?.[1]) } })()`)
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: gateStart.x, y: gateStart.y, button: 'left', clickCount: 1 })
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gateStart.x + 24, y: gateStart.y, button: 'left', buttons: 1 })
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gateStart.x + 24, y: gateStart.y, button: 'left', clickCount: 1 })
await waitFor(`Number(document.querySelector('.circuit-node.node-xor')?.getAttribute('transform').match(/translate\\(([-0-9.]+) ([-0-9.]+)\\)/)?.[1]) !== ${gateStart.modelX}`, 'gate movement')
assert.equal(await evaluate(`document.querySelector('.logic-lesson > span')?.textContent`), 'BUILDING GOAL · XOR', 'Moving a gate also keeps the challenge active')
assert.equal(await evaluate(`document.querySelector('.logic-lesson > strong')?.textContent`), 'The lamp follows the rule for all four switch pairs.', 'The moved circuit still passes all four input pairs')
const customCapture = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await mkdir('docs/renaissance/evidence', { recursive: true })
await writeFile('docs/renaissance/evidence/logic-custom-circuit.png', Buffer.from(customCapture.data, 'base64'))
const customShare = await copiedState()
assert.ok(customShare.link.length < 16_000, 'A custom circuit stays within the URL state budget')
assert.equal(customShare.state.preset, 'custom', 'A user-built circuit is shared as custom')
assert.equal(customShare.state.circuit.nodes.length, 4, 'The four actual circuit parts are included')
assert.equal(customShare.state.circuit.wires.length, 3, 'All three user-created wires are included')
assert.equal(customShare.state.circuit.goal, 'xor', 'The active XOR goal is included')
await call('Page.navigate', { url: customShare.link })
await waitFor(`location.pathname === '/exhibits/logic' && document.querySelectorAll('.circuit-node').length === 4 && document.querySelector('.circuit-node.node-output .node-bit')?.textContent === '0' && !document.querySelector('.experience-loading')`, 'custom XOR circuit after shared-link reload')
assert.equal(await evaluate(`document.querySelectorAll('.circuit-wire').length`), 3, 'Custom connections render again after reload')
assert.equal(await evaluate(`document.querySelector('.logic-lesson > span')?.textContent`), 'BUILDING GOAL · XOR', 'The build goal renders again after reload')
assert.equal(await evaluate(`document.querySelector('.logic-lesson > strong')?.textContent`), 'The lamp follows the rule for all four switch pairs.', 'The restored circuit still satisfies the truth-table goal')
const customReplay = await copiedState()
assert.deepEqual(customReplay.state.circuit, customShare.state.circuit, 'The custom circuit is still exact after share-link reload')

await call('Page.reload')
await waitFor(`location.pathname === '/exhibits/logic' && document.querySelectorAll('.circuit-node').length === 4 && !document.querySelector('.experience-loading')`, 'custom circuit after a full browser reload')
await click('button[aria-label="Toggle experiment controls"]')
await waitFor(`document.querySelectorAll('#experiment-controls select').length >= 2`, 'construction tools after full reload')
await selectValue('#experiment-controls select', 'xor', 1)
assert.ok(await evaluate(`(() => { const button = [...document.querySelectorAll('#experiment-controls .small-action')].find((item) => item.textContent.trim() === 'Add XOR here'); if (!button) return false; button.click(); return true })()`), 'Could not add a component to the restored circuit')
await waitFor(`document.querySelectorAll('.circuit-node').length === 5`, 'additional component after full reload')
assert.ok((await evaluate(`document.querySelector('.logic-bench-head p')?.textContent`)).includes('when the switches are different'), 'Adding after reload keeps the existing goal visible in the workbench header')
const appendedCircuit = await copiedState()
assert.equal(appendedCircuit.state.circuit.nodes.length, 5, 'The additional component remains in share state')
assert.equal(new Set(appendedCircuit.state.circuit.nodes.map((node) => node.id)).size, 5, 'New component IDs remain unique after a full reload')
assert.equal(appendedCircuit.state.circuit.goal, 'xor', 'The active goal stays in the shared state after adding a part')

const malformed = structuredClone(customShare.state)
malformed.circuit.nodes[1].id = 'a'
await call('Page.navigate', { url: stateUrl(malformed) })
await waitFor(`location.pathname === '/exhibits/logic' && document.querySelector('.circuit-node.node-and') && !document.querySelector('.experience-loading')`, 'safe starter after malformed board recovery')
assert.equal(await evaluate(`document.querySelectorAll('.circuit-node.node-xor').length`), 0, 'A duplicate-ID custom board is discarded as a whole')
assert.equal(await evaluate(`Boolean(document.querySelector('.experience-error'))`), false, 'Malformed circuit state does not enter the error boundary')
assert.deepEqual(errors, [], `Logic state browser errors occurred: ${errors.join('; ')}`)

const evidence = {
  browser: 'HeadlessChrome 157, 1440×900, SwiftShader/Vulkan',
  realSwitchInteraction: { bothInputsTurnedOn: true, andOutputLit: true, shareReloadPreservedResult: true },
  customCircuit: { builtThroughWorkbench: true, nodes: 4, wires: 3, goal: 'xor', passesAllFourInputPairs: true, shareReloadStateExact: true, uniqueIdsAfterFullReload: true },
  malformedRecovery: { duplicateIdFallsBackToStarter: true, errorBoundary: false },
  browserErrors: errors,
}
await writeFile('docs/renaissance/evidence/logic-circuit-browser-checks.json', `${JSON.stringify(evidence, null, 2)}\n`)
await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: clipboardOverride.identifier })
socket.close()
console.log(JSON.stringify(evidence, null, 2))
