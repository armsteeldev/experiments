import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptsRoot = path.join(projectRoot, 'scripts')
const tempRoot = os.tmpdir()
const lockPath = path.join(tempRoot, 'armsteel-browser-qa-' + String(process.getuid?.() ?? 'user') + '.lock')
const memoryGiB = 1024 ** 3
const defaultTimeoutMs = 8 * 60 * 1000
const maxTimeoutMs = 10 * 60 * 1000
const startupTimeoutMs = 20 * 1000
const token = String(process.pid) + '-' + Math.random().toString(36).slice(2)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let lockAcquired = false
let profileDir
let previewProcess
let browserProcess
let qaProcess
let cdpPort
let requestedSignal
let resourceFailure
let resolveSignal
const signalPromise = new Promise((resolve) => { resolveSignal = resolve })
let resolveSafetyTrip
const safetyTripPromise = new Promise((resolve) => { resolveSafetyTrip = resolve })
let resourceMonitor

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (requestedSignal) return
    requestedSignal = signal
    resolveSignal(signal)
  })
}

function fail(message) {
  throw new Error(message)
}

function throwIfStopped() {
  if (requestedSignal) throw new Error('Interrupted by ' + requestedSignal)
  if (resourceFailure) throw new Error('Host resource safety limit was crossed: ' + resourceFailure.message)
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown'
  return (bytes / memoryGiB).toFixed(1) + ' GiB'
}

function parseMeminfo(source) {
  const values = new Map()
  for (const line of source.split('\n')) {
    const match = line.match(/^([^:]+):\s+(\d+)\s+kB$/)
    if (match) values.set(match[1], Number(match[2]) * 1024)
  }
  return values
}

function pressureAvg10(source, key = 'some') {
  const line = source.split('\n').find((entry) => entry.startsWith(key + ' '))
  const match = line?.match(/\bavg10=(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : null
}

async function readCpuTemperature() {
  const root = '/sys/class/hwmon'
  const devices = await readdir(root).catch(() => [])
  const readings = []
  for (const device of devices) {
    const base = path.join(root, device)
    const name = await readFile(path.join(base, 'name'), 'utf8').catch(() => '')
    if (!/coretemp|k10temp|zenpower/i.test(name)) continue
    const files = await readdir(base).catch(() => [])
    for (const file of files.filter((entry) => /^temp\d+_input$/.test(entry))) {
      const raw = Number(await readFile(path.join(base, file), 'utf8').catch(() => 'NaN'))
      if (!Number.isFinite(raw)) continue
      const label = await readFile(path.join(base, file.replace('_input', '_label')), 'utf8').catch(() => file)
      readings.push({ label: label.trim(), celsius: raw / 1000 })
    }
  }
  return readings.length ? readings.reduce((hottest, entry) => entry.celsius > hottest.celsius ? entry : hottest) : null
}

async function checkHostHealth(log = true) {
  const [meminfoSource, loadSource, cpuPressureSource, memoryPressureSource, temperature] = await Promise.all([
    readFile('/proc/meminfo', 'utf8'),
    readFile('/proc/loadavg', 'utf8'),
    readFile('/proc/pressure/cpu', 'utf8').catch(() => ''),
    readFile('/proc/pressure/memory', 'utf8').catch(() => ''),
    readCpuTemperature(),
  ])
  const meminfo = parseMeminfo(meminfoSource)
  const load1 = Number(loadSource.split(/\s+/)[0])
  const available = meminfo.get('MemAvailable') ?? 0
  const total = meminfo.get('MemTotal') ?? 0
  const swapFree = meminfo.get('SwapFree') ?? 0
  const swapTotal = meminfo.get('SwapTotal') ?? 0
  const cpuCount = os.cpus().length || 1
  const cpuPressure = pressureAvg10(cpuPressureSource)
  const memoryFullPressure = pressureAvg10(memoryPressureSource, 'full')

  if (log) {
    console.log(
      '[qa supervisor] host preflight: load1=' + load1.toFixed(2) + '/' + cpuCount +
      ' CPUs; MemAvailable=' + formatBytes(available) +
      '; SwapFree=' + formatBytes(swapFree) +
      '; CPU PSI avg10=' + (cpuPressure === null ? 'unknown' : cpuPressure.toFixed(1) + '%') +
      '; memory-full PSI avg10=' + (memoryFullPressure === null ? 'unknown' : memoryFullPressure.toFixed(1) + '%') +
      '; hottest CPU=' + (temperature ? temperature.celsius.toFixed(1) + '°C (' + temperature.label + ')' : 'unavailable'),
    )
  }

  const limits = []
  const minimumMemory = Math.max(2 * memoryGiB, Math.ceil(total * 0.2))
  if (available < minimumMemory) limits.push('available RAM is below ' + formatBytes(minimumMemory))
  if (swapTotal > 0) {
    const minimumSwapFree = Math.min(512 * 1024 ** 2, Math.max(64 * 1024 ** 2, Math.ceil(swapTotal * 0.1)))
    if (swapFree < minimumSwapFree) limits.push('free swap is below ' + formatBytes(minimumSwapFree))
  }
  if (load1 > Math.max(4, cpuCount * 1.5)) limits.push('1-minute system load is too high for the available CPUs')
  if (cpuPressure !== null && cpuPressure > 25) limits.push('CPU pressure has been high in the last 10 seconds')
  if (memoryFullPressure !== null && memoryFullPressure > 1) limits.push('memory pressure has been high in the last 10 seconds')
  if (temperature && temperature.celsius >= 85) limits.push('CPU temperature is at or above 85°C')
  if (limits.length) fail('Refusing to start browser QA: ' + limits.join('; ') + '. Wait for the machine to recover before retrying.')
}

async function readProcessStartTicks(pid) {
  const source = await readFile('/proc/' + pid + '/stat', 'utf8').catch(() => '')
  const end = source.lastIndexOf(')')
  if (end < 0) return null
  const fields = source.slice(end + 2).trim().split(/\s+/)
  return fields[19] ?? null
}

async function lockOwner() {
  try {
    return JSON.parse(await readFile(path.join(lockPath, 'owner.json'), 'utf8'))
  } catch {
    return null
  }
}

async function lockOwnerIsAlive(owner) {
  if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0) return false
  try {
    process.kill(owner.pid, 0)
  } catch (error) {
    if (error.code === 'EPERM') return true
    if (error.code === 'ESRCH') return false
    return true
  }
  const ticks = await readProcessStartTicks(owner.pid)
  if (ticks === null) return process.platform !== 'linux'
  return owner.startTicks === ticks
}

async function acquireLock() {
  try {
    await mkdir(lockPath)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const owner = await lockOwner()
    if (await lockOwnerIsAlive(owner)) {
      fail('Another Armsteel browser QA run owns the lock (PID ' + owner.pid + ').')
    }
    fail('A stale or incomplete Armsteel QA lock exists. Inspect the recorded Chromium/Vite processes before removing ' + lockPath + '.')
  }
  await writeFile(path.join(lockPath, 'owner.json'), JSON.stringify({
    pid: process.pid,
    startTicks: await readProcessStartTicks(process.pid),
    token,
    startedAt: new Date().toISOString(),
  }))
  lockAcquired = true
}

async function releaseLock() {
  if (!lockAcquired) return
  const owner = await lockOwner()
  if (owner?.token === token) await rm(lockPath, { recursive: true, force: true })
  lockAcquired = false
}

async function reservePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

function childHasExited(child) {
  return !child || child.pid == null || child.exitCode !== null || child.signalCode !== null
}

function waitForChild(child, ms) {
  if (childHasExited(child)) return Promise.resolve(true)
  return Promise.race([
    new Promise((resolve) => child.once('close', () => resolve(true))),
    sleep(ms).then(() => false),
  ])
}

async function waitForOwnedRecords(role, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if ((await processSnapshot(role)).size === 0) return true
    await sleep(250)
  }
  return (await processSnapshot(role)).size === 0
}

async function processSnapshot(role) {
  const entries = await readdir('/proc').catch(() => [])
  const records = new Map()
  const processIds = entries.filter((entry) => /^\d+$/.test(entry))
  for (let offset = 0; offset < processIds.length; offset += 32) {
    await Promise.all(processIds.slice(offset, offset + 32).map(async (entry) => {
      const pid = Number(entry)
      const [source, environment] = await Promise.all([
        readFile('/proc/' + pid + '/stat', 'utf8').catch(() => ''),
        readFile('/proc/' + pid + '/environ', 'utf8').catch(() => ''),
      ])
      const end = source.lastIndexOf(')')
      if (end < 0) return
      const fields = source.slice(end + 2).trim().split(/\s+/)
      const ppid = Number(fields[1])
      const startTicks = fields[19]
      if (!Number.isInteger(ppid) || !startTicks) return
      if (!environment.split('\0').includes('ARMSTEEL_QA_PROCESS_OWNER=' + token + ':' + role)) return
      records.set(pid, { pid, ppid, startTicks })
    }))
  }
  return records
}

async function signalOwnedRecords(records, signal) {
  for (const record of records) {
    if (await readProcessStartTicks(record.pid) !== record.startTicks) continue
    try {
      process.kill(record.pid, signal)
    } catch (error) {
      if (error.code !== 'ESRCH') console.error('[qa supervisor] could not signal owned PID ' + record.pid + ': ' + error.message)
    }
  }
}

async function terminateTree(child, label, role) {
  if (!child || child.pid == null) return true
  const records = await processSnapshot(role)
  if (records.size === 0) return true
  await signalOwnedRecords([...records.values()], 'SIGTERM')
  if (await waitForOwnedRecords(role, 3_000)) return true
  await signalOwnedRecords([...(await processSnapshot(role)).values()], 'SIGKILL')
  if (!(await waitForOwnedRecords(role, 2_000))) {
    console.error('[qa supervisor] ' + label + ' owned processes did not report exit after SIGKILL (root PID ' + child.pid + ', role ' + role + ').')
    return false
  }
  return true
}

async function waitForHttp(url, child, label) {
  const deadline = Date.now() + startupTimeoutMs
  while (Date.now() < deadline) {
    throwIfStopped()
    if (childHasExited(child)) fail(label + ' exited before it became ready.')
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) })
      if (response.ok) return
    } catch {
      // The owned server is still starting; retry within the fixed startup deadline.
    }
    await sleep(200)
  }
  fail(label + ' did not become ready within ' + (startupTimeoutMs / 1000) + ' seconds.')
}

function watchChild(child, label) {
  child.once('error', (error) => {
    console.error('[qa supervisor] could not start ' + label + ': ' + error.message)
  })
  return child
}

function startResourceMonitor() {
  resourceMonitor = setInterval(async () => {
    try {
      await checkHostHealth(false)
    } catch (error) {
      resourceFailure = error
      clearInterval(resourceMonitor)
      resourceMonitor = null
      resolveSafetyTrip(error)
    }
  }, 15_000)
}

async function waitForCdpPort(profileDir, child) {
  const activePortFile = path.join(profileDir, 'DevToolsActivePort')
  const deadline = Date.now() + startupTimeoutMs
  while (Date.now() < deadline) {
    throwIfStopped()
    if (childHasExited(child)) fail('Chromium exited before the CDP endpoint became ready.')
    const value = await readFile(activePortFile, 'utf8').catch(() => '')
    const port = Number(value.split(/\r?\n/)[0])
    if (Number.isInteger(port) && port > 0 && port < 65536) return port
    await sleep(200)
  }
  fail('Chromium did not publish its isolated CDP endpoint within ' + (startupTimeoutMs / 1000) + ' seconds.')
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && existsSync(candidate)) return candidate
    if (!path.isAbsolute(candidate)) {
      const paths = (process.env.PATH ?? '').split(path.delimiter)
      for (const directory of paths) {
        const fullPath = path.join(directory, candidate)
        if (existsSync(fullPath)) return fullPath
      }
    }
  }
  fail('Could not find Chromium. Set CHROME_BIN to an installed Chromium/Chrome executable.')
}

async function closeBrowser(port) {
  if (!port) return false
  let socket
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/json/version', { signal: AbortSignal.timeout(1_000) })
    const version = await response.json()
    if (typeof version.webSocketDebuggerUrl !== 'string') return false
    socket = new WebSocket(version.webSocketDebuggerUrl)
    await Promise.race([
      new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true })
        socket.addEventListener('error', () => reject(new Error('CDP WebSocket connection failed')), { once: true })
      }),
      sleep(1_500).then(() => { throw new Error('CDP WebSocket connection timed out') }),
    ])
    const closed = new Promise((resolve) => socket.addEventListener('close', () => resolve(true), { once: true }))
    socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
    return await Promise.race([closed, sleep(4_000).then(() => false)])
  } catch {
    return false
  } finally {
    try { socket?.close() } catch { /* Already closed by Chromium. */ }
  }
}

async function cleanup() {
  let cleanupSafe = true
  if (qaProcess) {
    cleanupSafe = await terminateTree(qaProcess, 'browser QA script', 'script') && cleanupSafe
  }
  if (browserProcess) {
    const graceful = await closeBrowser(cdpPort)
    if (graceful) await waitForChild(browserProcess, 3_000)
    cleanupSafe = await terminateTree(browserProcess, 'Chromium', 'chromium') && cleanupSafe
  }
  if (previewProcess) {
    cleanupSafe = await terminateTree(previewProcess, 'Vite preview', 'preview') && cleanupSafe
  }
  if (!cleanupSafe) {
    console.error('[qa supervisor] retaining the lock and temporary profile because an owned process did not exit; inspect before another QA run.')
    return
  }
  if (profileDir && path.dirname(path.resolve(profileDir)) === path.resolve(tempRoot) &&
      path.basename(profileDir).startsWith('armsteel-renaissance-qa-')) {
    await rm(profileDir, { recursive: true, force: true }).catch((error) => {
      console.error('[qa supervisor] could not remove its temporary Chromium profile: ' + error.message)
    })
  }
  await releaseLock().catch((error) => console.error('[qa supervisor] could not release its lock: ' + error.message))
}

async function run() {
  const requestedScript = process.argv[2]
  if (!requestedScript || !/^qa-[a-z0-9-]+\.mjs$/i.test(path.basename(requestedScript))) {
    fail('Usage: node scripts/run-browser-qa.mjs scripts/qa-<name>.mjs')
  }
  const scriptPath = path.resolve(projectRoot, requestedScript)
  if (!scriptPath.startsWith(scriptsRoot + path.sep) || !existsSync(scriptPath)) {
    fail('The requested browser QA script must be an existing qa-*.mjs file inside scripts/.')
  }
  if (!existsSync(path.join(projectRoot, 'dist', 'index.html'))) {
    fail('The production preview is missing dist/index.html. Build it separately after the machine is healthy; QA does not build implicitly.')
  }
  const requestedTimeout = Number(process.env.ARMSTEEL_QA_TIMEOUT_MS ?? defaultTimeoutMs)
  if (!Number.isInteger(requestedTimeout) || requestedTimeout < 30_000) {
    fail('ARMSTEEL_QA_TIMEOUT_MS must be an integer of at least 30000 milliseconds.')
  }
  const timeoutMs = Math.min(requestedTimeout, maxTimeoutMs)
  const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(viteCli)) fail('Vite is not installed in this worktree. Install its project dependencies before browser QA.')
  const chrome = await findChrome()

  await acquireLock()
  await checkHostHealth()
  startResourceMonitor()

  const previewPort = await reservePort()
  throwIfStopped()
  previewProcess = watchChild(spawn(process.execPath, [
    viteCli, 'preview', '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort',
  ], {
    cwd: projectRoot,
    env: { ...process.env, ARMSTEEL_QA_PROCESS_OWNER: token + ':preview' },
    stdio: ['ignore', 'inherit', 'inherit'],
  }), 'Vite preview')
  await waitForHttp('http://127.0.0.1:' + previewPort + '/', previewProcess, 'Vite preview')

  profileDir = await mkdtemp(path.join(tempRoot, 'armsteel-renaissance-qa-'))
  throwIfStopped()
  browserProcess = watchChild(spawn(chrome, [
    '--headless=new',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    '--user-data-dir=' + profileDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--window-size=1280,800',
    'about:blank',
  ], {
    cwd: projectRoot,
    env: { ...process.env, ARMSTEEL_QA_PROCESS_OWNER: token + ':chromium' },
    stdio: ['ignore', 'ignore', 'inherit'],
  }), 'Chromium')
  cdpPort = await waitForCdpPort(profileDir, browserProcess)
  await waitForHttp('http://127.0.0.1:' + cdpPort + '/json/version', browserProcess, 'Chromium CDP endpoint')
  throwIfStopped()

  const childEnv = {
    ...process.env,
    ARMSTEEL_CDP_PORT: String(cdpPort),
    ARMSTEEL_PREVIEW_URL: 'http://127.0.0.1:' + previewPort,
    ARMSTEEL_QA_PROCESS_OWNER: token + ':script',
    ARMSTEEL_QA_SUPERVISOR_PID: String(process.pid),
  }
  delete childEnv.ARMSTEEL_QA_TIMEOUT_MS
  qaProcess = watchChild(spawn(process.execPath, [scriptPath], {
    cwd: projectRoot,
    env: childEnv,
    stdio: 'inherit',
  }), 'browser QA script')
  console.log('[qa supervisor] running ' + path.basename(scriptPath) + ' with one owned headless browser; timeout=' + Math.round(timeoutMs / 1000) + 's.')

  const exitPromise = new Promise((resolve, reject) => {
    qaProcess.once('error', reject)
    qaProcess.once('close', (code, signal) => resolve({ code, signal }))
  })
  let timer
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timeout: true }), timeoutMs)
  })
  const result = await Promise.race([
    exitPromise,
    timeoutPromise,
    signalPromise.then((signal) => ({ interrupted: signal })),
    safetyTripPromise.then((error) => ({ resourceFailure: error })),
  ]).finally(() => clearTimeout(timer))

  if (result.resourceFailure) {
    const stopped = await terminateTree(qaProcess, 'resource-limit-stopped browser QA script', 'script')
    if (stopped) qaProcess = null
    fail('Browser QA stopped because host pressure crossed its safety limit: ' + result.resourceFailure.message)
  }
  if (result.timeout) {
    const stopped = await terminateTree(qaProcess, 'timed-out browser QA script', 'script')
    if (stopped) qaProcess = null
    fail('Browser QA exceeded its ' + Math.round(timeoutMs / 1000) + ' second hard timeout. No automatic retry was attempted.')
  }
  if (result.interrupted) {
    const stopped = await terminateTree(qaProcess, 'interrupted browser QA script', 'script')
    if (stopped) qaProcess = null
    fail('Browser QA was interrupted by ' + result.interrupted + '.')
  }
  if (result.code !== 0) fail('Browser QA exited with code ' + result.code + (result.signal ? ' after ' + result.signal : '') + '.')
  console.log('[qa supervisor] browser QA completed successfully; closing owned Chromium and preview.')
}

let exitCode = 0
try {
  await run()
} catch (error) {
  console.error('[qa supervisor] ' + (error?.stack ?? error))
  exitCode = requestedSignal ? 128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 }[requestedSignal] ?? 1) : 1
} finally {
  if (resourceMonitor) clearInterval(resourceMonitor)
  await cleanup()
}
process.exitCode = exitCode
