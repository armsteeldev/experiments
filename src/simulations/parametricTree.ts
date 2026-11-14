import type { FernGeometry, FernPoint, FernSegment } from './fern'

/** A seeded, recursive broadleaf tree. This is parametric growth, not an L-system. */
export function generateParametricTree(iterations: number, randomness: number, seed: number, branchAngle = 52): FernGeometry {
  const wind = Math.max(0, Math.min(0.65, randomness))
  const spread = Math.max(0.16, Math.min(1.2, branchAngle * Math.PI / 180 * 0.78))
  const maxDepth = Math.max(1, Math.min(8, Math.floor(iterations)))
  let state = seed >>> 0
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 }
  const segments: FernSegment[] = []
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  const include = (p: FernPoint) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y) }
  const cubic = (p0: FernPoint, p1: FernPoint, p2: FernPoint, p3: FernPoint, t: number): FernPoint => {
    const u = 1 - t
    return {
      x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
      y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
    }
  }
  const grow = (origin: FernPoint, heading: number, length: number, depth: number, mainStem: boolean) => {
    const sway = (random() - 0.5) * wind * 0.74 + (mainStem ? 0 : (random() - 0.5) * 0.12)
    const normalX = -Math.sin(heading), normalY = Math.cos(heading)
    const end: FernPoint = { x: origin.x + Math.cos(heading) * length + normalX * sway * length, y: origin.y + Math.sin(heading) * length + normalY * sway * length }
    const c1: FernPoint = { x: origin.x + Math.cos(heading) * length * 0.34, y: origin.y + Math.sin(heading) * length * 0.34 }
    const c2: FernPoint = { x: origin.x + Math.cos(heading) * length * 0.72 + normalX * sway * length * 0.56, y: origin.y + Math.sin(heading) * length * 0.72 + normalY * sway * length * 0.56 }
    const steps = depth < 2 ? 5 : 4
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps, tm = (t0 + t1) / 2
      const from = cubic(origin, c1, c2, end, t0), middle = cubic(origin, c1, c2, end, tm), to = cubic(origin, c1, c2, end, t1)
      segments.push({ x1: from.x, y1: from.y, cx: middle.x * 2 - (from.x + to.x) * 0.5, cy: middle.y * 2 - (from.y + to.y) * 0.5, x2: to.x, y2: to.y, depth, order: segments.length })
      include(from); include(to)
    }
    if (depth >= maxDepth) return
    const splitT = mainStem ? 0.66 : 0.58
    const split = cubic(origin, c1, c2, end, splitT)
    const before = cubic(origin, c1, c2, end, splitT - 0.015), after = cubic(origin, c1, c2, end, splitT + 0.015)
    const tangent = Math.atan2(after.y - before.y, after.x - before.x)
    const divergence = spread * (0.86 + random() * 0.25) * (depth < 2 ? 1 : 0.9)
    const childLength = length * (0.61 + random() * 0.035)
    grow(split, tangent - divergence, childLength, depth + 1, false)
    grow(split, tangent + divergence, childLength * (0.96 + random() * 0.07), depth + 1, false)
    if (depth < 3 || random() > 0.12) {
      const crown = cubic(origin, c1, c2, end, 0.9)
      grow(crown, Math.atan2(end.y - origin.y, end.x - origin.x) + sway * 0.12, length * 0.67, depth + 1, mainStem)
    }
  }
  grow({ x: 0, y: 0 }, -Math.PI / 2, 1.34, 0, true)
  if (!Number.isFinite(minX)) return { segments: [], bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 }, maxDepth: 1 }
  return { segments, bounds: { minX, maxX, minY, maxY }, maxDepth }
}
