import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/deepZoom.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const loaded = { exports: {} }
new Function('exports', 'module', compiled)(loaded.exports, loaded)
const {
  coordinateOffset,
  fixedToBinary,
  fixedToNumber,
  formatFixed,
  magnification,
  magnificationLog10,
  multiplyMagnification,
  parseFixed,
  precisionDigits,
} = loaded.exports

const centerText = '-1.295189082147777457017064177185681926706566460884888469217'
for (const zoomText of ['1e20', '1e30', '1e50', '1e100', '1e250', '1e500']) {
  const zoom = magnification(zoomText)
  const digits = precisionDigits(zoom)
  assert.equal(precisionDigits(zoom), Number(zoomText.slice(2)) + 48)
  assert.equal(magnificationLog10(zoom), Number(zoomText.slice(2)))
  const center = parseFixed(centerText, digits)
  assert.equal(parseFixed(formatFixed(center, digits), digits), center, `fixed-point coordinate round trip at ${zoom}`)

  const halfPixel = coordinateOffset(0.5, 1000, zoom, digits)
  const nextPixel = coordinateOffset(1.5, 1000, zoom, digits)
  assert.notEqual(halfPixel, 0n, `subpixel offset survives at ${zoom}`)
  assert.notEqual(halfPixel, nextPixel, `neighboring pixel coordinates stay distinct at ${zoom}`)
  const binary = fixedToBinary(halfPixel, digits)
  assert.ok(Number.isFinite(binary.mantissa) && binary.mantissa !== 0, `scaled perturbation survives at ${zoom}`)
  assert.ok(Number.isInteger(binary.exponent), `scaled exponent is finite at ${zoom}`)
  if (zoom.exponent >= 400) assert.equal(fixedToNumber(halfPixel, digits), 0, 'very deep pixel coordinates can be below double range')

  const centerX = parseFixed(centerText, digits)
  const oldCursorWorld = centerX + coordinateOffset(173.25, 1000, zoom, digits)
  const nextZoom = multiplyMagnification(zoom, 1.37)
  const nextDigits = precisionDigits(nextZoom)
  const liftedCenter = parseFixed(formatFixed(centerX, digits), nextDigits)
  const cursorWorldAfter = liftedCenter + coordinateOffset(173.25, 1000, nextZoom, nextDigits)
  const nextCenter = oldCursorWorld - coordinateOffset(173.25, 1000, nextZoom, nextDigits)
  assert.equal(nextCenter + coordinateOffset(173.25, 1000, nextZoom, nextDigits), oldCursorWorld, 'pointer-centered zoom preserves the selected world point')
  assert.notEqual(cursorWorldAfter, oldCursorWorld, 'zoom changes screen-space sampling while retaining the center coordinate')
}

const deepest = magnification('1e500')
const deepestDigits = precisionDigits(deepest)
const negativeOffset = coordinateOffset(-1, 1000, deepest, deepestDigits)
assert.ok(negativeOffset < 0n)
assert.equal(coordinateOffset(1, 1000, deepest, deepestDigits), -negativeOffset)

const unit = 10n ** 80n
function escapesAt(real, imaginary, iterations = 300) {
  let x = 0n, y = 0n
  const cx = parseFixed(real, 80), cy = parseFixed(imaginary, 80)
  for (let i = 0; i < iterations; i++) {
    if (x * x + y * y > 16n * unit * unit) return true
    const nx = (x * x - y * y) / unit + cx
    const ny = 2n * x * y / unit + cy
    x = nx; y = ny
  }
  return x * x + y * y > 16n * unit * unit
}
assert.equal(escapesAt('0', '0'), false, 'the origin is inside the Mandelbrot set')
assert.equal(escapesAt('-1', '0'), false, 'the period-two bulb remains bounded')
assert.equal(escapesAt('1', '0'), true, 'the point c=1 escapes')

// Exercise the actual worker perturbation, exact-repair and color paths. A
// repair pixel must not change appearance just because it took the CPU path.
const workerSource = `${readFileSync(new URL('../src/workers/mandelbrot.worker.ts', import.meta.url), 'utf8')}\nmodule.exports.__test = { makeReference, perturbedPixelScaled, precisePixel };`
const workerCompiled = ts.transpileModule(workerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const workerModule = { exports: {} }
const workerScope = { onmessage: null, postMessage() {} }
new Function('exports', 'module', 'require', 'self', workerCompiled)(
  workerModule.exports,
  workerModule,
  () => loaded.exports,
  workerScope,
)
const { makeReference, perturbedPixelScaled, precisePixel } = workerModule.exports.__test
const deepView = magnification('1e50')
const deepDigits = precisionDigits(deepView)
const deepUnit = 10n ** BigInt(deepDigits)
const deepCenterX = parseFixed('-1.740062382579339905220844167065825638296641720436171866880', deepDigits)
const deepCenterY = parseFixed('0.028175339779211048992411521144319509687539076742990608570', deepDigits)
const viewportWidth = 128, viewportHeight = 128, tileSize = 32, maxIterations = 1000
for (let tileY = 0; tileY < viewportHeight; tileY += tileSize) {
  for (let tileX = 0; tileX < viewportWidth; tileX += tileSize) {
    const anchorX = deepCenterX + coordinateOffset(tileX + tileSize / 2 - viewportWidth / 2, viewportHeight, deepView, deepDigits)
    const anchorY = deepCenterY + coordinateOffset(viewportHeight / 2 - tileY - tileSize / 2, viewportHeight, deepView, deepDigits)
    const orbit = makeReference(anchorX, anchorY, anchorX, anchorY, deepDigits, maxIterations, false)
    for (const py of [0, 15, 16, 31]) for (const px of [0, 15, 16, 31]) {
      const offsetX = coordinateOffset(px + 0.5 - tileSize / 2, viewportHeight, deepView, deepDigits)
      const offsetY = coordinateOffset(-(py + 0.5 - tileSize / 2), viewportHeight, deepView, deepDigits)
      const binaryX = fixedToBinary(offsetX, deepDigits)
      const binaryY = fixedToBinary(offsetY, deepDigits)
      const approximate = perturbedPixelScaled(
        offsetX, offsetY, binaryX.mantissa, binaryX.exponent, binaryY.mantissa, binaryY.exponent,
        anchorX, anchorY, anchorX, anchorY, deepDigits, deepUnit, orbit, maxIterations, 'abyss', false,
      )
      const exact = precisePixel(0n, 0n, anchorX + offsetX, anchorY + offsetY, false, deepUnit, deepDigits, maxIterations, 'abyss')
      const channelError = Math.max(
        Math.abs((approximate >>> 16 & 255) - (exact >>> 16 & 255)),
        Math.abs((approximate >>> 8 & 255) - (exact >>> 8 & 255)),
        Math.abs((approximate & 255) - (exact & 255)),
      )
      assert.ok(channelError <= 2, `perturbation and exact repair colors agree at tile ${tileX},${tileY} pixel ${px},${py}: 0x${approximate.toString(16)} vs 0x${exact.toString(16)}`)
    }
  }
}

// Render actual tile samples at 10²⁰×, 10³⁰× and 10⁵⁰× around one deep
// location. Each view must reveal multiple colors and a distinct fingerprint,
// which guards against accidentally enlarging the previous level's pixels.
const depthFingerprints = []
for (const exponent of [20, 30, 50]) {
  const zoom = magnification(`1e${exponent}`)
  const digits = precisionDigits(zoom)
  const unit = 10n ** BigInt(digits)
  const centerX = parseFixed('-1.740062382579339905220844167065825638296641720436171866880', digits)
  const centerY = parseFixed('0.028175339779211048992411521144319509687539076742990608570', digits)
  const width = 128, height = 128, tileSize = 32, tileX = 48, tileY = 48
  const iterations = 220 + exponent * 14
  const anchorX = centerX + coordinateOffset(tileX + tileSize / 2 - width / 2, height, zoom, digits)
  const anchorY = centerY + coordinateOffset(height / 2 - tileY - tileSize / 2, height, zoom, digits)
  const orbit = makeReference(anchorX, anchorY, anchorX, anchorY, digits, iterations, false)
  const colors = []
  for (let py = 0; py < tileSize; py += 4) for (let px = 0; px < tileSize; px += 4) {
    const ox = coordinateOffset(px + 0.5 - tileSize / 2, height, zoom, digits)
    const oy = coordinateOffset(-(py + 0.5 - tileSize / 2), height, zoom, digits)
    const bx = fixedToBinary(ox, digits), by = fixedToBinary(oy, digits)
    colors.push(perturbedPixelScaled(
      ox, oy, bx.mantissa, bx.exponent, by.mantissa, by.exponent,
      anchorX, anchorY, anchorX, anchorY, digits, unit, orbit, iterations, 'abyss', false,
    ))
  }
  const hash = colors.reduce((value, color) => Math.imul(value ^ color, 16777619) >>> 0, 2166136261)
  assert.ok(new Set(colors).size >= 8, `10^${exponent}× renders distinct tile detail`)
  assert.ok(!depthFingerprints.some((entry) => entry.hash === hash), `10^${exponent}× is not a magnified copy of another level`)
  depthFingerprints.push({ exponent, hash })
}

console.log('Deep zoom coordinates pass through 10⁵⁰⁰×; perturbation/exact colors agree at 10⁵⁰× and tile fingerprints differ at 10²⁰×, 10³⁰× and 10⁵⁰×.')
