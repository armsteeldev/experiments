export type Vec2 = { x: number; y: number }
export type RaySource = { x: number; y: number; angle: number; spread: number; count: number; wavelength: number }
export type Mirror = { kind: 'mirror'; a: Vec2; b: Vec2 }
export type Prism = { kind: 'prism'; vertices: Vec2[]; index: number; dispersion: number }
export type ThinLens = { kind: 'lens'; center: Vec2; angle: number; focalLength: number; aperture: number }
export type OpticalObject = Mirror | Prism | ThinLens
export type OpticalScene = { width: number; height: number; objects: OpticalObject[]; maxBounces: number }
export type RayEvent = { kind: 'reflection' | 'refraction' | 'total-internal-reflection' | 'thin-lens'; point: Vec2; incidence: number; fromIndex: number; toIndex: number }
export type TracedRay = { points: Vec2[]; events: RayEvent[]; wavelength: number }
export type Hit = { distance: number; point: Vec2; normal: Vec2 }

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k })
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y
const length = (a: Vec2) => Math.hypot(a.x, a.y)
const unit = (a: Vec2): Vec2 => { const m = length(a) || 1; return { x: a.x / m, y: a.y / m } }

export function intersectRaySegment(origin: Vec2, direction: Vec2, a: Vec2, b: Vec2, epsilon = 1e-5): Hit | null {
  const edge = sub(b, a), denominator = direction.x * edge.y - direction.y * edge.x
  if (Math.abs(denominator) < 1e-9) return null
  const offset = sub(a, origin)
  const t = (offset.x * edge.y - offset.y * edge.x) / denominator
  const u = (offset.x * direction.y - offset.y * direction.x) / denominator
  if (t <= epsilon || u < -1e-8 || u > 1 + 1e-8) return null
  const outward = unit({ x: edge.y, y: -edge.x })
  return { distance: t, point: add(origin, scale(direction, t)), normal: outward }
}

export function reflectDirection(direction: Vec2, normal: Vec2): Vec2 {
  return unit(sub(direction, scale(normal, 2 * dot(direction, normal))))
}

export function refractDirection(direction: Vec2, opposingNormal: Vec2, nFrom: number, nTo: number): Vec2 | null {
  const d = unit(direction), n = unit(opposingNormal)
  const cosine = Math.max(0, -dot(d, n)), ratio = nFrom / nTo
  const discriminant = 1 - ratio * ratio * (1 - cosine * cosine)
  if (discriminant < 0) return null
  return unit(add(scale(d, ratio), scale(n, ratio * cosine - Math.sqrt(discriminant))))
}

export function prismIndex(base: number, dispersion: number, wavelengthNm: number): number {
  const wavelength = Math.max(380, Math.min(700, wavelengthNm))
  return base + dispersion * ((550 / wavelength) ** 2 - 1)
}

function intersectLens(origin: Vec2, direction: Vec2, lens: ThinLens, epsilon: number): Hit | null {
  const u = { x: Math.cos(lens.angle), y: Math.sin(lens.angle) }
  const v = { x: -u.y, y: u.x }
  const denominator = dot(direction, u)
  if (Math.abs(denominator) < 1e-7) return null
  const distance = dot(sub(lens.center, origin), u) / denominator
  if (distance <= epsilon) return null
  const point = add(origin, scale(direction, distance))
  if (Math.abs(dot(sub(point, lens.center), v)) > lens.aperture / 2) return null
  return { distance, point, normal: dot(direction, u) < 0 ? u : scale(u, -1) }
}

type SurfaceHit = { object: OpticalObject; hit: Hit; edge?: number }
function nearestSurface(origin: Vec2, direction: Vec2, scene: OpticalScene, epsilon: number): SurfaceHit | null {
  let nearest: SurfaceHit | null = null
  for (const object of scene.objects) {
    const candidates: SurfaceHit[] = []
    if (object.kind === 'mirror') {
      const hit = intersectRaySegment(origin, direction, object.a, object.b, epsilon)
      if (hit) candidates.push({ object, hit })
    } else if (object.kind === 'prism') {
      for (let edge = 0; edge < object.vertices.length; edge++) {
        const hit = intersectRaySegment(origin, direction, object.vertices[edge], object.vertices[(edge + 1) % object.vertices.length], epsilon)
        if (hit) candidates.push({ object, hit, edge })
      }
    } else {
      const hit = intersectLens(origin, direction, object, epsilon)
      if (hit) candidates.push({ object, hit })
    }
    for (const candidate of candidates) if (!nearest || candidate.hit.distance < nearest.hit.distance) nearest = candidate
  }
  return nearest
}

export function traceOptics(scene: OpticalScene, source: RaySource): TracedRay[] {
  const rays: TracedRay[] = []
  const count = Math.max(1, Math.min(160, source.count))
  const epsilon = Math.max(0.004, Math.min(scene.width, scene.height) * 0.00018)
  for (let i = 0; i < count; i++) {
    const fraction = count === 1 ? 0.5 : i / (count - 1)
    let origin = { x: source.x, y: source.y }
    let direction = { x: Math.cos(source.angle + (fraction - 0.5) * source.spread), y: Math.sin(source.angle + (fraction - 0.5) * source.spread) }
    const ray: TracedRay = { points: [{ ...origin }], events: [], wavelength: source.wavelength }
    for (let bounce = 0; bounce < scene.maxBounces; bounce++) {
      const nearest = nearestSurface(origin, direction, scene, epsilon)
      if (!nearest) {
        const far = Math.max(scene.width, scene.height) * 1.8
        ray.points.push(add(origin, scale(direction, far)))
        break
      }
      const { object, hit } = nearest
      ray.points.push(hit.point)
      if (object.kind === 'mirror') {
        ray.events.push({ kind: 'reflection', point: hit.point, incidence: Math.acos(Math.min(1, Math.abs(dot(direction, hit.normal)))), fromIndex: 1, toIndex: 1 })
        direction = reflectDirection(direction, hit.normal)
      } else if (object.kind === 'lens') {
        const axis = { x: Math.cos(object.angle), y: Math.sin(object.angle) }
        const transverse = { x: -axis.y, y: axis.x }
        const side = dot(direction, axis) >= 0 ? 1 : -1
        const axial = Math.max(0.08, Math.abs(dot(direction, axis)))
        const height = dot(sub(hit.point, object.center), transverse)
        const slope = dot(direction, transverse) / axial - height / Math.max(0.05, object.focalLength)
        direction = unit(add(scale(axis, side), scale(transverse, slope)))
        ray.events.push({ kind: 'thin-lens', point: hit.point, incidence: Math.atan2(height, Math.max(0.05, Math.abs(object.focalLength))), fromIndex: 1, toIndex: 1 })
      } else {
        const incidentAngle = Math.acos(Math.min(1, Math.abs(dot(direction, hit.normal))))
        const entering = dot(direction, hit.normal) < 0
        const opposingNormal = entering ? hit.normal : scale(hit.normal, -1)
        const fromIndex = entering ? 1 : prismIndex(object.index, object.dispersion, source.wavelength)
        const toIndex = entering ? prismIndex(object.index, object.dispersion, source.wavelength) : 1
        const refracted = refractDirection(direction, opposingNormal, fromIndex, toIndex)
        const kind = refracted ? 'refraction' : 'total-internal-reflection'
        direction = refracted ?? reflectDirection(direction, hit.normal)
        ray.events.push({ kind, point: hit.point, incidence: incidentAngle, fromIndex, toIndex })
      }
      origin = add(hit.point, scale(direction, epsilon))
      if (origin.x < -scene.width || origin.x > 2 * scene.width || origin.y < -scene.height || origin.y > 2 * scene.height) {
        ray.points.push(origin)
        break
      }
    }
    rays.push(ray)
  }
  return rays
}

export const vector = { add, sub, scale, dot, length, unit }
