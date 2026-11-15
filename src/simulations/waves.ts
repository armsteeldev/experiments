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

export function createWaveState(width = 192, height = 120): WaveState {
  const length = width * height
  return {
    width, height,
    current: new Float32Array(length), previous: new Float32Array(length), next: new Float32Array(length),
    solid: new Uint8Array(length), emitters: [], time: 0, steps: 0,
    speed: 0.72, damping: 0.008, boundary: 'absorb', dt: 0.72, rng: 90817,
  }
}

export function isWaveStepStable(speed: number, dt: number): boolean {
  return Number.isFinite(speed) && Number.isFinite(dt) && speed >= 0 && dt >= 0 && speed * dt <= 1 / Math.sqrt(2)
}

export function addWavePulse(state: WaveState, x: number, y: number, amplitude = 1, radius = 2.4): void {
  const cx = Math.round(x), cy = Math.round(y), r = Math.max(1, Math.ceil(radius))
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
  const distance = Math.hypot(x1 - x0, y1 - y0)
  const count = Math.max(1, Math.ceil(distance * 1.6))
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

export function createDoubleSlitState(width = 192, height = 120): WaveState {
  const state = createWaveState(width, height)
  const wallX = Math.round(width * 0.43)
  const slitA = Math.round(height * 0.39), slitB = Math.round(height * 0.61)
  for (let y = 3; y < height - 3; y++) {
    if (Math.abs(y - slitA) > 3 && Math.abs(y - slitB) > 3) {
      for (let x = wallX - 1; x <= wallX + 1; x++) state.solid[y * width + x] = 1
    }
  }
  state.emitters.push({ x: width * 0.15, y: height * 0.5, frequency: 0.095, amplitude: 0.23, phase: 0, phaseJitter: 0, active: true })
  return state
}

export function stepWave(state: WaveState, iterations = 1): void {
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
