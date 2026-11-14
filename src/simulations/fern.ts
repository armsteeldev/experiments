export type FernPoint = { x: number; y: number }
export type FernSegment = {
  x1: number
  y1: number
  cx: number
  cy: number
  x2: number
  y2: number
  depth: number
  order: number
  leafSize?: number
}
export type FernGeometry = {
  segments: FernSegment[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  maxDepth: number
}

/** Build a seeded cluster of fern fronds, pinnae, and paired leaflets. */
export function generateFernGeometry(iterations: number, randomness: number, seed: number, branchAngle = 28): FernGeometry {
  const detail = Math.max(1, Math.min(8, Math.floor(iterations)))
  const wind = Math.max(0, Math.min(0.65, randomness))
  const fanSpread = Math.max(0.55, Math.min(1.75, branchAngle / 28))
  let randomState = seed >>> 0
  const random = () => { randomState = (randomState * 1664525 + 1013904223) >>> 0; return randomState / 4294967296 }
  const segments: FernSegment[] = []
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  const add = (from: FernPoint, to: FernPoint, depth: number, leafSize?: number) => {
    const dx = to.x - from.x, dy = to.y - from.y
    const length = Math.hypot(dx, dy) || 1
    const bend = (random() - 0.5) * wind * length * (leafSize ? 0.24 : 0.08)
    segments.push({
      x1: from.x, y1: from.y,
      cx: (from.x + to.x) / 2 - dy / length * bend,
      cy: (from.y + to.y) / 2 + dx / length * bend,
      x2: to.x, y2: to.y, depth, order: segments.length, leafSize,
    })
    minX = Math.min(minX, from.x, to.x, to.x - (leafSize || 0))
    maxX = Math.max(maxX, from.x, to.x, to.x + (leafSize || 0))
    minY = Math.min(minY, from.y, to.y, to.y - (leafSize || 0))
    maxY = Math.max(maxY, from.y, to.y, to.y + (leafSize || 0))
  }
  const curvePoint = (p0: FernPoint, p1: FernPoint, p2: FernPoint, p3: FernPoint, t: number): FernPoint => {
    const u = 1 - t
    return {
      x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
      y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
    }
  }
  const fronds = [
    { lean: -0.88, length: 70, offset: -7, baseY: 5 },
    { lean: -0.66, length: 84, offset: -5, baseY: 2 },
    { lean: -0.42, length: 99, offset: -3, baseY: 1 },
    { lean: -0.16, length: 111, offset: -1, baseY: 0 },
    { lean: 0.12, length: 108, offset: 1, baseY: 0 },
    { lean: 0.43, length: 96, offset: 3, baseY: 2 },
    { lean: 0.77, length: 78, offset: 6, baseY: 5 },
  ].map((frond) => {
    const lean = frond.lean * fanSpread + (random() - 0.5) * (0.28 + wind * 0.75)
    const length = frond.length * (0.93 + random() * 0.14)
    const offset = frond.offset + (random() - 0.5) * (0.8 + wind * 2)
    const baseY = frond.baseY + (random() - 0.5) * wind * 5
    const tip = { x: offset + lean * length * 0.48, y: baseY - length }
    return {
      ...frond,
      length,
      pointAt: (t: number): FernPoint => ({
        x: offset + (tip.x - offset) * t + Math.sin(t * Math.PI) * lean * length * (0.07 + wind * 0.025),
        y: baseY + (tip.y - baseY) * t + Math.sin(t * Math.PI) * (frond.lean > 0 ? 1 : -1) * length * 0.012,
      }),
    }
  })
  const stemSteps = 26 + detail * 5
  const pinnaRows = 10 + detail
  const leafletRows = 4 + detail
  const pinnaAt = (frond: typeof fronds[number], t: number, side: number) => {
    const base = frond.pointAt(t)
    const before = frond.pointAt(Math.max(0, t - 0.01)), after = frond.pointAt(Math.min(1, t + 0.01))
    const axis = Math.atan2(after.y - before.y, after.x - before.x)
    const sideAngle = 1.12 + (Math.max(8, Math.min(112, branchAngle)) - 28) * 0.009
    const heading = axis + side * sideAngle + (random() - 0.5) * wind * 0.48
    const profile = Math.pow(Math.max(0, Math.sin(Math.PI * (t - 0.1) / 0.82)), 0.78)
    const length = frond.length * (0.18 + wind * 0.04) * profile * (0.88 + random() * 0.24)
    const target = axis + (random() - 0.5) * wind * 0.22
    const tip = { x: base.x + Math.cos((heading + target) / 2) * length, y: base.y + Math.sin((heading + target) / 2) * length }
    const c1 = { x: base.x + Math.cos(heading) * length * 0.48, y: base.y + Math.sin(heading) * length * 0.48 }
    const c2 = { x: tip.x - Math.cos(target) * length * 0.3, y: tip.y - Math.sin(target) * length * 0.3 }
    const samples = 5
    for (let i = 0; i < samples; i++) add(curvePoint(base, c1, c2, tip, i / samples), curvePoint(base, c1, c2, tip, (i + 1) / samples), 1)
    for (let row = 0; row < leafletRows; row++) {
      const along = 0.2 + row / Math.max(1, leafletRows - 1) * 0.68
      const origin = curvePoint(base, c1, c2, tip, along)
      const tangentBefore = curvePoint(base, c1, c2, tip, Math.max(0, along - 0.015))
      const tangentAfter = curvePoint(base, c1, c2, tip, Math.min(1, along + 0.015))
      const pinnaAxis = Math.atan2(tangentAfter.y - tangentBefore.y, tangentAfter.x - tangentBefore.x)
      for (const lobeSide of [-1, 1]) {
        const lobeAngle = pinnaAxis + lobeSide * (0.82 + random() * 0.2 + (random() - 0.5) * wind * 0.4)
        const lobeLength = length * 0.23 * (1 - along * 0.22) * (0.84 + random() * 0.32)
        const middle = { x: origin.x + Math.cos(lobeAngle - lobeSide * 0.12) * lobeLength * 0.62, y: origin.y + Math.sin(lobeAngle - lobeSide * 0.12) * lobeLength * 0.62 }
        const end = { x: middle.x + Math.cos(lobeAngle + lobeSide * 0.2) * lobeLength * 0.38, y: middle.y + Math.sin(lobeAngle + lobeSide * 0.2) * lobeLength * 0.38 }
        add(origin, middle, 2)
        add(middle, end, 2, Math.max(0.16, lobeLength * 0.55))
      }
    }
  }
  for (let step = 0; step < stemSteps; step++) {
    const t0 = step / stemSteps, t1 = (step + 1) / stemSteps
    for (const frond of fronds) add(frond.pointAt(t0), frond.pointAt(t1), 0)
    const previousRow = Math.floor(t0 * pinnaRows)
    const row = Math.floor(t1 * pinnaRows)
    if (row <= previousRow || row < 1 || row > pinnaRows) continue
    const t = 0.12 + row / pinnaRows * 0.76
    for (const frond of fronds) {
      pinnaAt(frond, t, -1)
      pinnaAt(frond, t, 1)
    }
  }
  return { segments, bounds: { minX, maxX, minY, maxY }, maxDepth: 3 }
}
