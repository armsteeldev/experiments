import { coordinateOffset, fixedToBinary, fixedToNumber, parseFixed, precisionDigits } from '../lib/deepZoom'
import type { Magnification } from '../lib/deepZoom'

type Tile = { x: number; y: number; width: number; height: number; slot: number; level?: number }
type Request = {
  id: number
  generation: number
  action: 'prepare'
  tileKey: string
  x: string
  y: string
  zoom: Magnification
  width: number
  height: number
  tile: Tile
  iterations: number
  mode: 'mandelbrot' | 'julia'
  palette: string
  target: 'gpu' | 'cpu'
  juliaX?: string
  juliaY?: string
}
type Cancel = { action: 'cancel'; generation: number }
type Message = Request | Cancel
type Response = {
  id: number
  generation: number
  tileKey: string
  tile: Tile
  kind: 'reference' | 'cpu-tile' | 'cancelled' | 'error'
  reference?: ArrayBuffer
  referenceExponents?: ArrayBuffer
  pixels?: ArrayBuffer
  referenceMs?: number
  renderMs?: number
  message?: string
}
type Scope = { onmessage: ((event: MessageEvent<Message>) => void) | null; postMessage: (message: Response, transfer?: Transferable[]) => void }
type Orbit = { values: Float32Array; exponents: Int32Array; length: number; complete: boolean }

const scope = self as unknown as Scope
let activeGeneration = 0
const paletteStops: Record<string, number[][]> = {
  abyss: [[4, 8, 19], [10, 37, 67], [23, 105, 137], [91, 207, 190], [248, 213, 160]],
  mineral: [[10, 12, 24], [54, 54, 90], [132, 82, 103], [225, 144, 98], [247, 220, 166]],
  twilight: [[8, 10, 27], [42, 47, 96], [83, 131, 174], [203, 155, 191], [247, 221, 203]],
  ice: [[5, 14, 26], [20, 60, 104], [54, 147, 191], [154, 218, 218], [241, 248, 226]],
  ember: [[7, 5, 20], [57, 18, 78], [168, 46, 106], [250, 124, 67], [255, 222, 135]],
}

function scaledComponent(mantissa: number, exponent: number, targetExponent: number) {
  const shift = exponent - targetExponent
  return shift < -1074 ? 0 : mantissa * Math.pow(2, shift)
}
function magnitudeSquared(x: number, y: number) { return x * x + y * y }

function colorAt(mu: number, _z2: number, paletteName: string, inside: boolean) {
  if (inside) return 0x010205
  const stops = paletteStops[paletteName] || paletteStops.abyss
  const phase = Math.max(0, mu) * 0.034 + 0.012
  const cycle = phase - Math.floor(phase)
  const scaled = cycle * (stops.length - 1)
  const segment = Math.min(stops.length - 2, Math.floor(scaled))
  const t0 = scaled - segment
  const t = t0 * t0 * (3 - 2 * t0)
  // Keep this map identical on perturbation, exact repair and GPU paths.
  // Derivative lighting is deliberately omitted because the fast perturbation
  // path does not carry a derivative orbit; shading only repaired pixels made
  // tile-shaped seams visible.
  const r = Math.round(stops[segment][0] * (1 - t) + stops[segment + 1][0] * t)
  const g = Math.round(stops[segment][1] * (1 - t) + stops[segment + 1][1] * t)
  const b = Math.round(stops[segment][2] * (1 - t) + stops[segment + 1][2] * t)
  return (r << 16) | (g << 8) | b
}

async function makeReference(cx: bigint, cy: bigint, constantX: bigint, constantY: bigint, digits: number, iterations: number, julia: boolean, current: () => boolean = () => true): Promise<Orbit | null> {
  const unit = 10n ** BigInt(digits)
  const bailoutSquared = 16n * unit * unit
  const values = new Float32Array((iterations + 1) * 4)
  const exponents = new Int32Array(iterations + 1)
  let x = julia ? cx : 0n, y = julia ? cy : 0n, complete = true
  let length = 0
  for (let i = 0; i <= iterations; i++) {
    if ((i & 127) === 0) {
      if (!current()) return null
      if (i !== 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    const bx = fixedToBinary(x, digits), by = fixedToBinary(y, digits)
    const commonExponent = Math.max(bx.mantissa ? bx.exponent : -Infinity, by.mantissa ? by.exponent : -Infinity)
    const exponent = Number.isFinite(commonExponent) ? commonExponent : 0
    const xMantissa = bx.mantissa ? scaledComponent(bx.mantissa, bx.exponent, exponent) : 0
    const yMantissa = by.mantissa ? scaledComponent(by.mantissa, by.exponent, exponent) : 0
    const xHigh = Math.fround(xMantissa), yHigh = Math.fround(yMantissa)
    const xLow = Math.fround(xMantissa - xHigh), yLow = Math.fround(yMantissa - yHigh)
    const at = i * 4
    values[at] = xHigh; values[at + 1] = yHigh; values[at + 2] = xLow; values[at + 3] = yLow
    exponents[i] = exponent
    length++
    if (x * x + y * y > bailoutSquared) { complete = false; break }
    if (i === iterations) break
    const nextX = (x * x - y * y) / unit + constantX
    const nextY = 2n * x * y / unit + constantY
    x = nextX
    y = nextY
  }
  return { values: values.slice(0, length * 4), exponents: exponents.slice(0, length), length, complete }
}

function precisePixel(startX: bigint, startY: bigint, constantX: bigint, constantY: bigint, julia: boolean, unit: bigint, digits: number, maxIterations: number, palette: string) {
  const bailoutSquared = 16n * unit * unit
  let x = julia ? startX : 0n, y = julia ? startY : 0n, dx = 0, dy = 0
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (x * x + y * y > bailoutSquared) {
      const zx = fixedToNumber(x, digits), zy = fixedToNumber(y, digits)
      const mag2 = magnitudeSquared(zx, zy)
      const smooth = iteration + 2 - Math.log2(Math.max(1e-16, Math.log2(Math.max(1.00000001, mag2))))
      return colorAt(smooth, mag2, palette, false)
    }
    const zx = fixedToNumber(x, digits), zy = fixedToNumber(y, digits)
    const ndx = 2 * (zx * dx - zy * dy) + (julia ? 0 : 1)
    const ndy = 2 * (zx * dy + zy * dx)
    dx = ndx
    dy = ndy
    const nextX = (x * x - y * y) / unit + constantX
    const nextY = 2n * x * y / unit + constantY
    x = nextX
    y = nextY
    if (x * x + y * y > bailoutSquared) {
      const ex = fixedToNumber(x, digits), ey = fixedToNumber(y, digits)
      const escaped2 = magnitudeSquared(ex, ey)
      const smooth = iteration + 3 - Math.log2(Math.max(1e-16, Math.log2(Math.max(1.00000001, escaped2))))
      return colorAt(smooth, escaped2, palette, false)
    }
  }
  return colorAt(0, 0, palette, true)
}

function repairPixel(ox: bigint, oy: bigint, cx: bigint, cy: bigint, constantX: bigint, constantY: bigint, julia: boolean, unit: bigint, digits: number, maxIterations: number, palette: string) {
  if (julia) return precisePixel(cx + ox, cy + oy, constantX, constantY, true, unit, digits, maxIterations, palette)
  return precisePixel(0n, 0n, constantX + ox, constantY + oy, false, unit, digits, maxIterations, palette)
}

function perturbedPixelScaled(
  ox: bigint, oy: bigint, pixelMantissaX: number, pixelExponentX: number, pixelMantissaY: number, pixelExponentY: number,
  cx: bigint, cy: bigint, constantX: bigint, constantY: bigint, digits: number, unit: bigint,
  orbit: Orbit, maxIterations: number, palette: string, julia: boolean,
) {
  const dcxMantissa = julia ? 0 : pixelMantissaX
  const dcxExponent = julia ? 0 : pixelExponentX
  const dcyMantissa = julia ? 0 : pixelMantissaY
  const dcyExponent = julia ? 0 : pixelExponentY
  pixelExponentX = pixelMantissaX ? pixelExponentX : -Infinity
  pixelExponentY = pixelMantissaY ? pixelExponentY : -Infinity
  let dx = 0, dy = 0, deltaExponent = 0
  if (julia && Number.isFinite(Math.max(pixelExponentX, pixelExponentY))) {
    deltaExponent = Math.max(pixelExponentX, pixelExponentY)
    dx = scaledComponent(pixelMantissaX, pixelExponentX, deltaExponent)
    dy = scaledComponent(pixelMantissaY, pixelExponentY, deltaExponent)
    const largest = Math.max(Math.abs(dx), Math.abs(dy))
    if (largest) {
      const shift = Math.floor(Math.log2(largest)) + 1
      dx *= Math.pow(2, -shift); dy *= Math.pow(2, -shift); deltaExponent += shift
    }
  }
  const threshold = 1e-6
  for (let n = 0; n < maxIterations; n++) {
    if (n >= orbit.length) return repairPixel(ox, oy, cx, cy, constantX, constantY, julia, unit, digits, maxIterations, palette)
    const offset = n * 4
    const rx = orbit.values[offset] + orbit.values[offset + 2]
    const ry = orbit.values[offset + 1] + orbit.values[offset + 3]
    const refExponent = orbit.exponents[n]
    const commonExponent = Math.max(refExponent, deltaExponent)
    const refScale = scaledComponent(1, refExponent, commonExponent)
    const deltaScale = scaledComponent(1, deltaExponent, commonExponent)
    const refX = rx * refScale, refY = ry * refScale
    const zNormX = refX + dx * deltaScale, zNormY = refY + dy * deltaScale
    const normMagnitudeSquared = magnitudeSquared(zNormX, zNormY)
    if (normMagnitudeSquared > 0) {
      const log2MagnitudeSquared = Math.log2(normMagnitudeSquared) + 2 * commonExponent
      if (log2MagnitudeSquared > 4) {
        const smooth = n + 1 - Math.log2(Math.max(1e-16, 0.5 * log2MagnitudeSquared))
        return colorAt(smooth, Math.pow(2, Math.min(30, log2MagnitudeSquared)), palette, false)
      }
    }
    if (magnitudeSquared(refX, refY) > 0 && normMagnitudeSquared < threshold * magnitudeSquared(refX, refY)) {
      return repairPixel(ox, oy, cx, cy, constantX, constantY, julia, unit, digits, maxIterations, palette)
    }
    const linearX = 2 * (rx * dx - ry * dy)
    const linearY = 2 * (rx * dy + ry * dx)
    const quadraticX = dx * dx - dy * dy
    const quadraticY = 2 * dx * dy
    const nextExponent = Math.max(
      linearX || linearY ? refExponent + deltaExponent : -Infinity,
      quadraticX || quadraticY ? 2 * deltaExponent : -Infinity,
      dcxMantissa ? dcxExponent : -Infinity,
      dcyMantissa ? dcyExponent : -Infinity,
    )
    if (!Number.isFinite(nextExponent)) { dx = 0; dy = 0; deltaExponent = 0; continue }
    const linearShift = refExponent + deltaExponent - nextExponent
    const quadraticShift = 2 * deltaExponent - nextExponent
    const dxShift = dcxExponent - nextExponent
    const dyShift = dcyExponent - nextExponent
    const linearScale = linearShift < -1074 ? 0 : Math.pow(2, linearShift)
    const quadraticScale = quadraticShift < -1074 ? 0 : Math.pow(2, quadraticShift)
    const dxScale = dxShift < -1074 ? 0 : Math.pow(2, dxShift)
    const dyScale = dyShift < -1074 ? 0 : Math.pow(2, dyShift)
    let nextDx = linearX * linearScale + quadraticX * quadraticScale + dcxMantissa * dxScale
    let nextDy = linearY * linearScale + quadraticY * quadraticScale + dcyMantissa * dyScale
    const largest = Math.max(Math.abs(nextDx), Math.abs(nextDy))
    if (largest >= 256 || (largest > 0 && largest < 1 / 256)) {
      const shift = Math.floor(Math.log2(largest)) + 1
      nextDx *= Math.pow(2, -shift); nextDy *= Math.pow(2, -shift)
      deltaExponent = nextExponent + shift
    } else deltaExponent = nextExponent
    dx = nextDx; dy = nextDy
  }
  if (!orbit.complete) return repairPixel(ox, oy, cx, cy, constantX, constantY, julia, unit, digits, maxIterations, palette)
  return colorAt(0, 0, palette, true)
}

function sendError(request: Request, error: unknown) {
  scope.postMessage({ id: request.id, generation: request.generation, tileKey: request.tileKey, tile: request.tile, kind: 'error', message: error instanceof Error ? error.message : 'Tile calculation failed.' })
}

async function prepare(request: Request) {
  activeGeneration = request.generation
  try {
    const start = performance.now()
    const digits = precisionDigits(request.zoom)
    const unit = 10n ** BigInt(digits)
    const centerX = parseFixed(request.x, digits)
    const centerY = parseFixed(request.y, digits)
    const anchorScreenX = request.tile.x + request.tile.width * 0.5 - request.width * 0.5
    const anchorScreenY = request.height * 0.5 - request.tile.y - request.tile.height * 0.5
    const anchorX = centerX + coordinateOffset(anchorScreenX, request.height, request.zoom, digits)
    const anchorY = centerY + coordinateOffset(anchorScreenY, request.height, request.zoom, digits)
    const julia = request.mode === 'julia'
    const constantX = julia ? parseFixed(request.juliaX || '-0.745', digits) : anchorX
    const constantY = julia ? parseFixed(request.juliaY || '0.186', digits) : anchorY
    const orbit = await makeReference(anchorX, anchorY, constantX, constantY, digits, request.iterations, julia, () => request.generation === activeGeneration)
    if (!orbit) {
      scope.postMessage({ id: request.id, generation: request.generation, tileKey: request.tileKey, tile: request.tile, kind: 'cancelled' })
      return
    }
    const referenceMs = performance.now() - start
    if (request.target === 'gpu') {
      const response: Response = {
        id: request.id, generation: request.generation, tileKey: request.tileKey, tile: request.tile, kind: 'reference',
        reference: orbit.values.buffer, referenceExponents: orbit.exponents.buffer, referenceMs,
      }
      scope.postMessage(response, [orbit.values.buffer, orbit.exponents.buffer])
      return
    }
    const pixels = new Uint8ClampedArray(request.tile.width * request.tile.height * 4)
    const xOffsets = Array.from({ length: request.tile.width }, (_, x) => coordinateOffset(x + 0.5 - request.tile.width * 0.5, request.height, request.zoom, digits))
    const binaryX = xOffsets.map((value) => fixedToBinary(value, digits))
    const renderStart = performance.now()
    let row = 0
    const renderRows = () => {
      if (request.generation !== activeGeneration) {
        scope.postMessage({ id: request.id, generation: request.generation, tileKey: request.tileKey, tile: request.tile, kind: 'cancelled' })
        return
      }
      // Yield often enough for a cancellation message, but avoid a task switch
      // for every pair of rows on every 32-pixel tile.
      const end = Math.min(request.tile.height, row + 4)
      for (; row < end; row++) {
        const screenY = -(row + 0.5 - request.tile.height * 0.5)
        const offsetY = coordinateOffset(screenY, request.height, request.zoom, digits)
        const binaryY = fixedToBinary(offsetY, digits)
        for (let x = 0; x < request.tile.width; x++) {
          const result = perturbedPixelScaled(xOffsets[x], offsetY, binaryX[x].mantissa, binaryX[x].exponent, binaryY.mantissa, binaryY.exponent,
            anchorX, anchorY, constantX, constantY, digits, unit, orbit, request.iterations, request.palette, julia)
          const at = (row * request.tile.width + x) * 4
          pixels[at] = result >>> 16
          pixels[at + 1] = result >>> 8 & 255
          pixels[at + 2] = result & 255
          pixels[at + 3] = 255
        }
      }
      if (row < request.tile.height) { setTimeout(renderRows, 0); return }
      const response: Response = {
        id: request.id, generation: request.generation, tileKey: request.tileKey, tile: request.tile, kind: 'cpu-tile',
        pixels: pixels.buffer, referenceMs, renderMs: performance.now() - renderStart,
      }
      scope.postMessage(response, [pixels.buffer])
    }
    renderRows()
  } catch (error) { sendError(request, error) }
}

scope.onmessage = (event: MessageEvent<Message>) => {
  const request = event.data
  if (request.action === 'cancel') { activeGeneration = request.generation; return }
  activeGeneration = request.generation
  void prepare(request)
}
