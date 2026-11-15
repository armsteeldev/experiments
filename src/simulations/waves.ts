export type WaveBoundary = 'reflect' | 'absorb'

export type WaveEmitter = {
  x: number
  y: number
  frequency: number
  amplitude: number
  phase: number
  phaseJitter: number
  active: boolean
}

export type WaveState = {
  width: number
  height: number
  current: Float32Array
  previous: Float32Array
  next: Float32Array
  solid: Uint8Array
  emitters: WaveEmitter[]
  time: number
  steps: number
  speed: number
  damping: number
  boundary: WaveBoundary
  dt: number
  rng: number
}

export function createWaveState(width = 288, height = 180): WaveState {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width * height > 600_000) throw new RangeError('Wave grid must be an integer field between 8×8 and 600,000 cells')
  const length = width * height
  return {
    width, height,
    current: new Float32Array(length), previous: new Float32Array(length), next: new Float32Array(length),
    solid: new Uint8Array(length), emitters: [], time: 0, steps: 0,
    speed: 0.72, damping: 0.008, boundary: 'absorb', dt: 0.72, rng: 90817,
  }
}

export function addWaveEmitter(state: WaveState, emitter: WaveEmitter): boolean {
  if (state.emitters.length >= 8) return false
  if (![emitter.x, emitter.y, emitter.frequency, emitter.amplitude, emitter.phase, emitter.phaseJitter].every(Number.isFinite)) return false
  const x = Math.max(1, Math.min(state.width - 2, Math.round(emitter.x))), y = Math.max(1, Math.min(state.height - 2, Math.round(emitter.y)))
  if (state.solid[y * state.width + x]) return false
  state.emitters.push({
    x, y, frequency: Math.max(0.001, Math.min(0.45, emitter.frequency)), amplitude: Math.max(-0.5, Math.min(0.5, emitter.amplitude)),
    phase: ((emitter.phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), phaseJitter: Math.max(0, Math.min(Math.PI, emitter.phaseJitter)), active: Boolean(emitter.active),
  })
  return true
}

export function isWaveStepStable(speed: number, dt: number): boolean {
  return Number.isFinite(speed) && Number.isFinite(dt) && speed >= 0 && dt >= 0 && speed * dt <= 1 / Math.sqrt(2)
}

/** Modal frequency for the leapfrog stencil on a unit-spaced rectangular cavity. */
export function waveModeFrequency(state: WaveState, modeX: number, modeY: number, lengthX: number, lengthY: number): number {
  if (!Number.isInteger(modeX) || !Number.isInteger(modeY) || modeX < 0 || modeY < 0 || modeX + modeY === 0 || !Number.isFinite(lengthX) || !Number.isFinite(lengthY) || lengthX < 2 || lengthY < 2) throw new RangeError('Cavity modes and dimensions must be finite and positive')
  if (!isWaveStepStable(state.speed, state.dt) || state.dt <= 0) throw new RangeError('Cavity modes require a stable, positive time step')
  const horizontal = Math.sin(Math.PI * modeX / (2 * lengthX)), vertical = Math.sin(Math.PI * modeY / (2 * lengthY))
  const loss = Number.isFinite(state.damping) ? Math.max(0, Math.min(0.94, state.damping)) : 0
  const attenuation = 1 - loss
  const cosine = (2 - loss - 4 * (state.speed * state.dt) ** 2 * (horizontal * horizontal + vertical * vertical)) / (2 * Math.sqrt(attenuation))
  if (cosine < -1 || cosine > 1) throw new RangeError('This discrete cavity mode is overdamped and has no oscillation frequency')
  const phasePerStep = Math.acos(cosine)
  return phasePerStep / (2 * Math.PI * state.dt)
}

/** Seed one discrete Neumann standing mode and return its solver-matched drive frequency. */
export function seedWaveMode(state: WaveState, modeX: number, modeY: number, originX: number, originY: number, lengthX: number, lengthY: number, amplitude = 0.24): number {
  const frequency = waveModeFrequency(state, modeX, modeY, lengthX, lengthY)
  if (![originX, originY, amplitude].every(Number.isFinite) || !Number.isInteger(originX) || !Number.isInteger(originY) || originX < 0 || originY < 0 || originX + lengthX > state.width || originY + lengthY > state.height) throw new RangeError('The standing mode must fit within the wave field')
  amplitude = Math.max(-2, Math.min(2, amplitude))
  const phase = 2 * Math.PI * frequency * state.dt, loss = Number.isFinite(state.damping) ? Math.max(0, Math.min(0.94, state.damping)) : 0
  const previousFactor = Math.cos(phase) / Math.sqrt(1 - loss)
  for (let y = 0; y < lengthY; y++) for (let x = 0; x < lengthX; x++) {
    const index = (originY + y) * state.width + originX + x
    if (state.solid[index]) continue
    const shape = Math.cos(Math.PI * modeX * (x + 0.5) / lengthX) * Math.cos(Math.PI * modeY * (y + 0.5) / lengthY)
    state.current[index] = amplitude * shape
    state.previous[index] = amplitude * shape * previousFactor
    state.next[index] = 0
  }
  return frequency
}

export function addWavePulse(state: WaveState, x: number, y: number, amplitude = 1, radius = 2.4): void {
  if (![x, y, amplitude, radius].every(Number.isFinite)) return
  const cx = Math.max(0, Math.min(state.width - 1, Math.round(x))), cy = Math.max(0, Math.min(state.height - 1, Math.round(y)))
  amplitude = Math.max(-2, Math.min(2, amplitude)); radius = Math.max(0.5, Math.min(Math.min(state.width, state.height) * 0.25, radius))
  const r = Math.max(1, Math.ceil(radius))
  for (let py = Math.max(0, cy - r); py <= Math.min(state.height - 1, cy + r); py++) {
    for (let px = Math.max(0, cx - r); px <= Math.min(state.width - 1, cx + r); px++) {
      const d = Math.hypot(px - cx, py - cy)
      if (d > radius || state.solid[py * state.width + px]) continue
      const value = amplitude * Math.exp(-2.2 * d * d / (radius * radius))
      const index = py * state.width + px
      state.current[index] += value
      state.previous[index] += value
    }
  }
}

export function setWaveBarrier(state: WaveState, x0: number, y0: number, x1: number, y1: number, radius = 1.4, blocked = true): void {
  if (![x0, y0, x1, y1, radius].every(Number.isFinite)) return
  x0 = Math.max(0, Math.min(state.width - 1, x0)); x1 = Math.max(0, Math.min(state.width - 1, x1))
  y0 = Math.max(0, Math.min(state.height - 1, y0)); y1 = Math.max(0, Math.min(state.height - 1, y1))
  radius = Math.max(0.5, Math.min(24, radius))
  const distance = Math.hypot(x1 - x0, y1 - y0)
  const count = Math.max(1, Math.min(2 * Math.max(state.width, state.height), Math.ceil(distance * 1.6)))
  for (let i = 0; i <= count; i++) {
    const t = i / count, cx = Math.round(x0 + (x1 - x0) * t), cy = Math.round(y0 + (y1 - y0) * t)
    const r = Math.ceil(radius)
    for (let y = Math.max(0, cy - r); y <= Math.min(state.height - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(state.width - 1, cx + r); x++) {
        if (Math.hypot(x - cx, y - cy) > radius) continue
        const index = y * state.width + x
        state.solid[index] = blocked ? 1 : 0
        if (blocked) state.current[index] = state.previous[index] = state.next[index] = 0
      }
    }
  }
}

export function createDoubleSlitState(width = 288, height = 180): WaveState {
  const state = createWaveState(width, height)
  const wallX = Math.round(width * 0.43)
  const slitA = Math.round(height * 0.39), slitB = Math.round(height * 0.61)
  for (let y = 3; y < height - 3; y++) {
    if (Math.abs(y - slitA) > 7 && Math.abs(y - slitB) > 7) {
      for (let x = wallX - 1; x <= wallX + 1; x++) state.solid[y * width + x] = 1
    }
  }
  state.emitters.push({ x: width * 0.15, y: height * 0.5, frequency: 0.095, amplitude: 0.45, phase: 0, phaseJitter: 0, active: true })
  return state
}

export function stepWave(state: WaveState, iterations = 1): void {
  if (!Number.isInteger(iterations) || iterations < 0 || iterations > 1200) throw new RangeError('Wave advance must be an integer from 0 to 1,200 steps')
  const courant = state.speed * state.dt
  if (!isWaveStepStable(state.speed, state.dt)) throw new RangeError(`Unstable wave step: Courant number ${courant.toFixed(4)} exceeds 1/√2`)
  const { width, height, solid } = state
  const courantSquared = courant * courant
  for (let iteration = 0; iteration < iterations; iteration++) {
    const { current, previous, next } = state
    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        const index = row + x
        if (solid[index]) { next[index] = 0; continue }
        const center = current[index]
        const left = x > 0 && !solid[index - 1] ? current[index - 1] : center
        const right = x + 1 < width && !solid[index + 1] ? current[index + 1] : center
        const up = y > 0 && !solid[index - width] ? current[index - width] : center
        const down = y + 1 < height && !solid[index + width] ? current[index + width] : center
        const laplacian = left + right + up + down - 4 * center
        const edge = Math.min(x, y, width - 1 - x, height - 1 - y)
        const sponge = state.boundary === 'absorb' && edge < 14 ? (14 - edge) * 0.022 : 0
        const loss = Math.min(0.94, state.damping + sponge)
        next[index] = center + (center - previous[index]) * (1 - loss) + courantSquared * laplacian
      }
    }
    state.time += state.dt
    for (const source of state.emitters) {
      if (!source.active) continue
      if (source.phaseJitter > 0) {
        state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0
        source.phase = ((source.phase + (state.rng / 4294967296 - 0.5) * source.phaseJitter + Math.PI) % (2 * Math.PI)) - Math.PI
      }
      const x = Math.round(source.x), y = Math.round(source.y)
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue
      const index = y * width + x
      if (!solid[index]) next[index] += source.amplitude * Math.sin(2 * Math.PI * source.frequency * state.time + source.phase)
    }
    state.previous = current
    state.current = next
    state.next = previous
    state.steps++
  }
}

export function waveEnergy(state: WaveState): number {
  let sum = 0, cells = 0
  for (let i = 0; i < state.current.length; i++) {
    if (state.solid[i]) continue
    const velocity = state.current[i] - state.previous[i]
    sum += velocity * velocity
    cells++
  }
  return cells ? sum / cells : 0
}

/** Local continuous-model energy density for the finite-difference field.
 * This is an estimate on the unit-spaced grid; sources and damping mean it is
 * not a conserved discrete invariant. */
export function waveEnergyDensity(state: WaveState, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= state.current.length || state.solid[index]) return 0
  const { width, height, current, previous, solid, speed, dt } = state
  const x = index % width, y = Math.floor(index / width), center = current[index]
  const left = x > 0 && !solid[index - 1] ? current[index - 1] : center
  const right = x + 1 < width && !solid[index + 1] ? current[index + 1] : center
  const up = y > 0 && !solid[index - width] ? current[index - width] : center
  const down = y + 1 < height && !solid[index + width] ? current[index + width] : center
  const inverseDt = Number.isFinite(dt) && dt > 0 ? 1 / dt : 0
  const velocity = (center - previous[index]) * inverseDt
  const gradientX = (right - left) * 0.5, gradientY = (down - up) * 0.5
  return 0.5 * velocity * velocity + 0.5 * speed * speed * (gradientX * gradientX + gradientY * gradientY)
}
