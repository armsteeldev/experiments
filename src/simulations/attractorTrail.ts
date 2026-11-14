/** Fixed-size ring storage for a long-lived 3D attractor trajectory. */
export class AttractorTrailBuffer {
  readonly capacity: number
  private readonly xs: Float64Array
  private readonly ys: Float64Array
  private readonly zs: Float64Array
  private start = 0
  length = 0

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity))
    this.xs = new Float64Array(this.capacity)
    this.ys = new Float64Array(this.capacity)
    this.zs = new Float64Array(this.capacity)
  }

  push(x: number, y: number, z: number) {
    const index = (this.start + this.length) % this.capacity
    this.xs[index] = x
    this.ys[index] = y
    this.zs[index] = z
    if (this.length < this.capacity) this.length++
    else this.start = (this.start + 1) % this.capacity
  }

  xAt(index: number) { return this.xs[this.physicalIndex(index)] }
  yAt(index: number) { return this.ys[this.physicalIndex(index)] }
  zAt(index: number) { return this.zs[this.physicalIndex(index)] }

  clear() {
    this.start = 0
    this.length = 0
  }

  private physicalIndex(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) throw new RangeError('Attractor trail index is outside the visible path.')
    return (this.start + index) % this.capacity
  }
}

/** Keep the luminous trail smooth while avoiding redundant work on dense paths. */
export function attractorRenderStride(pointCount: number, pointBudget = 14_000) {
  return Math.max(1, Math.ceil(pointCount / Math.max(1, pointBudget)))
}

/** The curve remains fully detailed while its expensive canvas redraw runs at 30 Hz. */
export const ATTRACTOR_RENDER_INTERVAL_MS = 1000 / 30
export function shouldRenderAttractorFrame(now: number, lastDrawAt: number) {
  return now - lastDrawAt >= ATTRACTOR_RENDER_INTERVAL_MS
}
