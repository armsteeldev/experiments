export type PhotonPoint = { x: number; y: number; phi: number; radius: number }
export type PhotonTrace = { impact: number; captured: boolean; outcome: 'captured' | 'escaped' | 'near-critical'; deflection: number | null; points: PhotonPoint[]; closestApproach: number; conservedImpact: number; maxRelativeInvariantError: number }

type State = { u: number; v: number }
const criticalImpact = (mass: number) => 3 * Math.sqrt(3) * mass

function derivative({ u, v }: State, mass: number): State { return { u: v, v: -u + 3 * mass * u * u } }
function rk4(state: State, step: number, mass: number): State {
  const k1 = derivative(state, mass)
  const k2 = derivative({ u: state.u + k1.u * step / 2, v: state.v + k1.v * step / 2 }, mass)
  const k3 = derivative({ u: state.u + k2.u * step / 2, v: state.v + k2.v * step / 2 }, mass)
  const k4 = derivative({ u: state.u + k3.u * step, v: state.v + k3.v * step }, mass)
  return { u: state.u + step * (k1.u + 2 * k2.u + 2 * k3.u + k4.u) / 6, v: state.v + step * (k1.v + 2 * k2.v + 2 * k3.v + k4.v) / 6 }
}

export function traceSchwarzschildPhoton(impact: number, mass = 1, options: { step?: number; radius?: number; maxAngle?: number; maxPoints?: number } = {}): PhotonTrace {
  if (!Number.isFinite(mass) || !Number.isFinite(impact) || !(mass > 0) || !(impact > 0)) throw new RangeError('Mass and impact parameter must be finite and positive')
  const impactRatio = impact / mass
  if (!Number.isFinite(impactRatio) || impactRatio < 1e-6 || impactRatio > 1e6) throw new RangeError('The impact parameter must remain within the numerically supported range 10⁻⁶M–10⁶M')
  const requestedBoundary = options.radius ?? Math.max(180 * mass, impact * 30)
  if (!Number.isFinite(requestedBoundary) || requestedBoundary < 2 * mass) throw new RangeError('Integration radius must be finite and at least 2M')
  const boundary = requestedBoundary
  let state: State = { u: 0, v: 1 / impact }
  let phi = 0, closestApproach = boundary
  const initialInvariant = 1 / (impact * impact)
  let maxRelativeInvariantError = 0
  const stepValue = Number.isFinite(options.step) ? options.step! : 0.006
  const angleValue = Number.isFinite(options.maxAngle) ? options.maxAngle! : 40
  const pointValue = Number.isFinite(options.maxPoints) ? options.maxPoints! : 12000
  const step = Math.max(0.0004, Math.min(0.025, stepValue)), maxAngle = Math.max(step, Math.min(256, angleValue)), maxPoints = Math.max(1, Math.min(100000, Math.floor(pointValue)))
  const points: PhotonPoint[] = [{ x: -boundary, y: impact, phi, radius: boundary }]
  // Do not label a ray captured from its input b alone. It must actually cross
  // the horizon before the integration budget ends.
  let outcome: PhotonTrace['outcome'] = 'near-critical'
  for (let i = 0; i < maxPoints && phi < maxAngle; i++) {
    const before = state, previousPhi = phi, next = rk4(state, step, mass)
    phi += step
    state = next
    if (!Number.isFinite(state.u) || !Number.isFinite(state.v)) break
    const invariant = state.v * state.v + state.u * state.u - 2 * mass * state.u * state.u * state.u
    if (Number.isFinite(invariant)) maxRelativeInvariantError = Math.max(maxRelativeInvariantError, Math.abs(invariant - initialInvariant) / initialInvariant)
    const radius = 1 / Math.max(state.u, 1e-12)
    closestApproach = Math.min(closestApproach, radius)
    if (radius <= boundary * 1.08 && (i % 6 === 0 || radius < 12 * mass)) points.push({ x: -radius * Math.cos(phi), y: radius * Math.sin(phi), phi, radius })
    if (state.u >= 0.5 / mass || radius <= 2 * mass * 1.004) { outcome = 'captured'; break }
    if (state.u <= 0 && state.v < 0) {
      const crossing = before.u / Math.max(1e-18, before.u - state.u)
      phi = previousPhi + step * crossing
      outcome = 'escaped'
      break
    }
  }
  const escaped = outcome === 'escaped' && state.v < 0 && state.u <= 0
  const deflection = escaped ? phi - Math.PI : null
  if (escaped) points.push({ x: boundary, y: boundary * Math.sin(phi), phi, radius: boundary })
  const finalInvariant = state.v * state.v + state.u * state.u - 2 * mass * state.u * state.u * state.u
  const conservedImpact = Number.isFinite(finalInvariant) && finalInvariant > 0 ? 1 / Math.sqrt(finalInvariant) : impact
  return { impact, captured: outcome === 'captured', outcome, deflection, points, closestApproach, conservedImpact, maxRelativeInvariantError }
}

export function weakFieldDeflection(impact: number, mass = 1): number { return 4 * mass / impact }

export type LensingTable = { mass: number; observerDistance: number; sourceRatio: number; criticalImpact: number; impacts: Float32Array; deflections: Float32Array; captured: Uint8Array }
function createLensingTableBuffer(mass: number, maxImpact: number, samples: number) {
  if (!Number.isFinite(mass) || mass <= 0) throw new RangeError('Table mass must be finite and positive')
  if (!Number.isFinite(maxImpact) || maxImpact <= criticalImpact(mass) + 0.008 * mass) throw new RangeError('Maximum impact must extend beyond the capture boundary')
  if (!Number.isFinite(samples) || samples < 2) throw new RangeError('A deflection table needs at least two samples')
  samples = Math.max(2, Math.min(512, Math.floor(samples)))
  const critical = criticalImpact(mass)
  return {
    maxImpact,
    samples,
    table: { mass, observerDistance: 36 * mass, sourceRatio: 0.58, criticalImpact: critical, impacts: new Float32Array(samples), deflections: new Float32Array(samples), captured: new Uint8Array(samples) },
  }
}

function fillLensingTableSample(table: LensingTable, maxImpact: number, index: number) {
  const t = index / (table.impacts.length - 1), { mass, criticalImpact: critical } = table
  // Dense sampling near the capture boundary preserves the rapidly growing strong-field deflection.
  const impact = critical + 0.008 * mass + (maxImpact - critical - 0.008 * mass) * t * t
  const trace = traceSchwarzschildPhoton(impact, mass, { step: 0.009, radius: 110 * mass, maxAngle: 36, maxPoints: 7000 })
  table.impacts[index] = impact
  table.deflections[index] = trace.deflection ?? Math.PI
  table.captured[index] = trace.captured ? 1 : 0
}

export function createLensingTable(mass = 1, maxImpact = 30, samples = 320): LensingTable {
  const input = createLensingTableBuffer(mass, maxImpact, samples)
  for (let index = 0; index < input.samples; index++) fillLensingTableSample(input.table, input.maxImpact, index)
  return input.table
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Worker-friendly table build that lets newer requests cancel between rays. */
export async function createLensingTableCooperative(
  mass = 1,
  maxImpact = 30,
  samples = 320,
  shouldCancel: () => boolean = () => false,
  raysPerYield = 4,
): Promise<LensingTable | null> {
  const input = createLensingTableBuffer(mass, maxImpact, samples)
  const batchSize = Math.max(1, Math.min(32, Math.floor(raysPerYield) || 1))
  for (let index = 0; index < input.samples; index++) {
    if (shouldCancel()) return null
    fillLensingTableSample(input.table, input.maxImpact, index)
    if ((index + 1) % batchSize === 0 && index + 1 < input.samples) {
      await yieldToEventLoop()
      if (shouldCancel()) return null
    }
  }
  return shouldCancel() ? null : input.table
}

export function lookupDeflection(table: LensingTable, impact: number): number | null {
  if (!Number.isFinite(impact) || !table.impacts.length || table.impacts.length !== table.deflections.length) return null
  if (impact < table.criticalImpact) return null
  const { impacts, deflections } = table
  if (impact >= impacts[impacts.length - 1]) return weakFieldDeflection(impact, table.mass)
  let low = 0, high = impacts.length - 1
  while (low + 1 < high) { const middle = (low + high) >> 1; if (impacts[middle] <= impact) low = middle; else high = middle }
  const t = (impact - impacts[low]) / Math.max(1e-9, impacts[high] - impacts[low])
  return deflections[low] * (1 - t) + deflections[high] * t
}

function skyRandom(seed: number) {
  let value = seed >>> 0
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296 }
}

export function createLensingSourcePixels(width: number, height: number, seed = 72143): Uint8ClampedArray {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1_200_000) throw new RangeError('Source image dimensions exceed the lensing raster budget')
  const pixels = new Uint8ClampedArray(width * height * 4)
  fillLensingSourceRows(pixels, width, height, 0, height)
  addLensingSourceStars(pixels, width, height, seed)
  return pixels
}

function fillLensingSourceRows(pixels: Uint8ClampedArray, width: number, height: number, startY: number, endY: number) {
  const cx = width * 0.47, cy = height * 0.52
  for (let y = startY; y < endY; y++) for (let x = 0; x < width; x++) {
    const radius = Math.hypot((x - cx) / width, (y - cy) / height)
    const cloud = Math.exp(-radius * radius * 15), index = (y * width + x) * 4
    pixels[index] = Math.round(5 + cloud * 19); pixels[index + 1] = Math.round(8 + cloud * 18); pixels[index + 2] = Math.round(17 + cloud * 36); pixels[index + 3] = 255
  }
}

function addLensingSourceStars(pixels: Uint8ClampedArray, width: number, height: number, seed: number) {
  const random = skyRandom(seed), count = Math.max(240, Math.round(width * height * 0.0018))
  for (let i = 0; i < count; i++) {
    const x = Math.floor(random() * width), y = Math.floor(random() * height), warm = random() > 0.81
    const brightness = 78 + Math.round(random() * 168), radius = random() > 0.95 ? 1 : 0
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const px = x + dx, py = y + dy
      if (px < 0 || py < 0 || px >= width || py >= height) continue
      const index = (py * width + px) * 4, value = radius && (dx || dy) ? Math.round(brightness * 0.22) : brightness
      pixels[index] = Math.max(pixels[index], warm ? value : Math.round(value * 0.78))
      pixels[index + 1] = Math.max(pixels[index + 1], warm ? Math.round(value * 0.88) : Math.round(value * 0.9))
      pixels[index + 2] = Math.max(pixels[index + 2], warm ? Math.round(value * 0.71) : value)
    }
  }
}

/** Main-thread recovery path: preserve the seeded source field while yielding between pixel rows. */
export async function createLensingSourcePixelsCooperative(
  width: number,
  height: number,
  seed = 72143,
  shouldCancel: () => boolean = () => false,
  rowsPerYield = 8,
): Promise<Uint8ClampedArray | null> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1_200_000) throw new RangeError('Source image dimensions exceed the lensing raster budget')
  const pixels = new Uint8ClampedArray(width * height * 4), batchSize = Math.max(1, Math.min(64, Math.floor(rowsPerYield) || 1))
  for (let row = 0; row < height; row += batchSize) {
    if (shouldCancel()) return null
    fillLensingSourceRows(pixels, width, height, row, Math.min(height, row + batchSize))
    if (row + batchSize < height) {
      await yieldToEventLoop()
      if (shouldCancel()) return null
    }
  }
  if (shouldCancel()) return null
  addLensingSourceStars(pixels, width, height, seed)
  return shouldCancel() ? null : pixels
}

function createLensingRasterBuffer(width: number, height: number, distance: number, sourceRatio: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1_200_000) throw new RangeError('Lensing image dimensions exceed the raster budget')
  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(sourceRatio) || sourceRatio < 0 || sourceRatio > 1.5) throw new RangeError('Observer distance and source-plane ratio are outside the model range')
  return { width, height, distance, sourceRatio, source: new Uint8ClampedArray(width * height * 4), output: new Uint8ClampedArray(width * height * 4) }
}

function createLensingRaster(width: number, height: number, distance: number, sourceRatio: number) {
  const raster = createLensingRasterBuffer(width, height, distance, sourceRatio)
  fillLensingSourceRows(raster.source, width, height, 0, height)
  addLensingSourceStars(raster.source, width, height, 72143)
  return raster
}

function rasterizeLensingRows(table: LensingTable, raster: ReturnType<typeof createLensingRaster>, startY: number, endY: number) {
  const { width, height, distance, sourceRatio, source, output } = raster
  const cx = (width - 1) * 0.5, cy = (height - 1) * 0.5, focal = height * 1.27, capture = table.criticalImpact
  for (let y = startY; y < endY; y++) for (let x = 0; x < width; x++) {
    const dx = x - cx, dy = y - cy, radius = Math.hypot(dx, dy), theta = Math.atan(radius / focal), impact = distance * Math.tan(theta), index = (y * width + x) * 4
    if (impact < capture) {
      const edge = Math.max(0, Math.min(1, (impact - capture + 0.05) / 0.05))
      output[index] = Math.round(2 + edge * 12); output[index + 1] = Math.round(4 + edge * 19); output[index + 2] = Math.round(10 + edge * 32); output[index + 3] = 255
      continue
    }
    const deflection = lookupDeflection(table, impact) ?? 0
    // Select the nearest winding branch of the thin-lens equation. The ray
    // bending itself comes from the integrated Schwarzschild deflection table.
    const winding = deflection - Math.round(deflection / (2 * Math.PI)) * 2 * Math.PI
    const mappedRadius = (theta - sourceRatio * winding) * focal, ux = radius > 1e-6 ? dx / radius : 0, uy = radius > 1e-6 ? dy / radius : 0
    const sx = cx + mappedRadius * ux, sy = cy + mappedRadius * uy
    // Out-of-frame source coordinates use the undistorted source pixel. Modulo
    // wrapping would invent stars by joining the opposite edges of the sky.
    const x0 = sx >= 0 && sx <= width - 1 ? Math.floor(sx) : x, y0 = sy >= 0 && sy <= height - 1 ? Math.floor(sy) : y
    const x1 = sx >= 0 && sx <= width - 1 ? Math.min(width - 1, x0 + 1) : x, y1 = sy >= 0 && sy <= height - 1 ? Math.min(height - 1, y0 + 1) : y
    const tx = sx >= 0 && sx <= width - 1 ? sx - x0 : 0, ty = sy >= 0 && sy <= height - 1 ? sy - y0 : 0
    const i00 = (y0 * width + x0) * 4, i10 = (y0 * width + x1) * 4, i01 = (y1 * width + x0) * 4, i11 = (y1 * width + x1) * 4
    const shade = Math.min(1.18, 0.82 + Math.min(0.36, Math.abs(winding) * 0.05))
    for (let channel = 0; channel < 3; channel++) {
      const top = source[i00 + channel] * (1 - tx) + source[i10 + channel] * tx
      const bottom = source[i01 + channel] * (1 - tx) + source[i11 + channel] * tx
      output[index + channel] = Math.min(255, Math.round((top * (1 - ty) + bottom * ty) * shade))
    }
    output[index + 3] = 255
  }
}

export function rasterizeLensedSky(table: LensingTable, width: number, height: number, distance: number, sourceRatio: number): Uint8ClampedArray {
  const raster = createLensingRaster(width, height, distance, sourceRatio)
  rasterizeLensingRows(table, raster, 0, height)
  return raster.output
}

/** Worker-friendly image projection that can stop between row batches. */
export async function rasterizeLensedSkyCooperative(
  table: LensingTable,
  width: number,
  height: number,
  distance: number,
  sourceRatio: number,
  shouldCancel: () => boolean = () => false,
  rowsPerYield = 8,
): Promise<Uint8ClampedArray | null> {
  const raster = createLensingRasterBuffer(width, height, distance, sourceRatio)
  const source = await createLensingSourcePixelsCooperative(width, height, 72143, shouldCancel, rowsPerYield)
  if (!source || shouldCancel()) return null
  raster.source = source
  const batchSize = Math.max(1, Math.min(64, Math.floor(rowsPerYield) || 1))
  for (let row = 0; row < height; row += batchSize) {
    if (shouldCancel()) return null
    rasterizeLensingRows(table, raster, row, Math.min(height, row + batchSize))
    if (row + batchSize < height) {
      await yieldToEventLoop()
      if (shouldCancel()) return null
    }
  }
  return shouldCancel() ? null : raster.output
}
