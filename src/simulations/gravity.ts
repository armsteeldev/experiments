export type GravityBody = { id: number; x: number; y: number; vx: number; vy: number; mass: number; color: string; trail?: { x: number; y: number }[] }
export type CollisionMode = 'merge' | 'bounce' | 'pass'

export function gravityAcceleration(bodies: readonly GravityBody[], gravity = 1, softening = 0.045) {
  return bodies.map((body, i) => {
    let ax = 0, ay = 0
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue
      const other = bodies[j], dx = other.x - body.x, dy = other.y - body.y
      const r2 = dx * dx + dy * dy + softening * softening
      const scale = gravity * other.mass / (r2 * Math.sqrt(r2))
      ax += dx * scale; ay += dy * scale
    }
    return { ax, ay }
  })
}

export function bodyRadius(body: GravityBody) { return Math.max(0.035, Math.cbrt(Math.max(body.mass, 0.001)) * 0.036) }

/** Pick the nearest body center inside a forgiving screen-space interaction disk. */
export function pickGravityBodyAtWorld(bodies: readonly GravityBody[], x: number, y: number, pixelsPerUnit: number, minimumHitPixels = 20) {
  const scale = Math.max(1, pixelsPerUnit)
  let best: { body: GravityBody; distance: number } | null = null
  for (const body of bodies) {
    const distance = Math.hypot(body.x - x, body.y - y) * scale
    const hitRadius = Math.max(minimumHitPixels, bodyRadius(body) * scale + 8)
    if (distance <= hitRadius && (!best || distance < best.distance || (distance === best.distance && body.mass < best.body.mass))) best = { body, distance }
  }
  return best?.body ?? null
}

export type GravityPointerSample = { x: number; y: number; time: number }

/** Estimate a throw from recent world-space motion; null means preserve momentum. */
export function estimateGravityThrowVelocity(samples: readonly GravityPointerSample[], maxSpeed = 28): { vx: number; vy: number } | null {
  if (samples.length < 2) return null
  const latest = samples[samples.length - 1].time
  const recent = samples.filter((sample) => latest - sample.time <= 180)
  if (recent.length < 2 || recent[recent.length - 1].time - recent[0].time < 45) return null
  const origin = recent[0].time
  let meanT = 0, meanX = 0, meanY = 0
  for (const sample of recent) { meanT += (sample.time - origin) / 1000; meanX += sample.x; meanY += sample.y }
  meanT /= recent.length; meanX /= recent.length; meanY /= recent.length
  let covarianceX = 0, covarianceY = 0, variance = 0
  for (const sample of recent) {
    const t = (sample.time - origin) / 1000 - meanT
    covarianceX += t * (sample.x - meanX); covarianceY += t * (sample.y - meanY); variance += t * t
  }
  if (variance < 1e-8) return null
  let vx = covarianceX / variance, vy = covarianceY / variance
  const speed = Math.hypot(vx, vy)
  if (!Number.isFinite(speed) || speed < 0.75) return null
  if (speed > maxSpeed) { const factor = maxSpeed / speed; vx *= factor; vy *= factor }
  return { vx, vy }
}

/** Velocity that places a light body on a prograde circular orbit around one source. */
export function circularOrbitVelocity(source: GravityBody, x: number, y: number, gravity = 1, softening = 0.045) {
  const dx = x - source.x, dy = y - source.y, r2 = dx * dx + dy * dy
  if (r2 < 1e-12) return { vx: source.vx, vy: source.vy }
  const speed = Math.sqrt(Math.max(0, gravity * source.mass * r2 / Math.pow(r2 + softening * softening, 1.5)))
  const distance = Math.sqrt(r2)
  return { vx: source.vx - dy / distance * speed, vy: source.vy + dx / distance * speed }
}

function resolveCollisions(bodies: GravityBody[], mode: CollisionMode, fixedBodyId?: number) {
  if (mode === 'pass') return
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j], dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy)
    if (a.id === fixedBodyId || b.id === fixedBodyId) continue
    const minimum = bodyRadius(a) + bodyRadius(b)
    if (distance >= minimum) continue
    // Bodies can be dropped at precisely the same point. Use a deterministic
    // separation axis for bounce response instead of leaving that overlap stuck.
    const nx = distance > 1e-9 ? dx / distance : ((a.id + b.id) % 2 === 0 ? 1 : 0)
    const ny = distance > 1e-9 ? dy / distance : ((a.id + b.id) % 2 === 0 ? 0 : 1)
    if (mode === 'merge') {
      const mass = a.mass + b.mass
      a.x = (a.x * a.mass + b.x * b.mass) / mass; a.y = (a.y * a.mass + b.y * b.mass) / mass
      a.vx = (a.vx * a.mass + b.vx * b.mass) / mass; a.vy = (a.vy * a.mass + b.vy * b.mass) / mass
      a.mass = mass
      // Trail histories belong to two different bodies; joining them draws a
      // false straight connector across the screen. Start a clean merged path.
      a.trail = []
      bodies.splice(j, 1); j--
      continue
    }
    const overlap = minimum - distance
    a.x -= nx * overlap * b.mass / (a.mass + b.mass); a.y -= ny * overlap * b.mass / (a.mass + b.mass)
    b.x += nx * overlap * a.mass / (a.mass + b.mass); b.y += ny * overlap * a.mass / (a.mass + b.mass)
    const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
    if (relative < 0) {
      const impulse = -2 * relative / (1 / a.mass + 1 / b.mass)
      a.vx -= impulse * nx / a.mass; a.vy -= impulse * ny / a.mass
      b.vx += impulse * nx / b.mass; b.vy += impulse * ny / b.mass
    }
  }
}

/** Velocity-Verlet step; units are intentionally dimensionless for stable interactive scenes. */
export function integrateGravity(bodies: GravityBody[], dt: number, gravity = 1, collision: CollisionMode = 'merge', fixedBodyId?: number) {
  if (!(dt > 0) || !Number.isFinite(dt)) return bodies
  const before = gravityAcceleration(bodies, gravity)
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i], a = before[i]
    if (body.id === fixedBodyId) continue
    body.x += body.vx * dt + 0.5 * a.ax * dt * dt
    body.y += body.vy * dt + 0.5 * a.ay * dt * dt
    body.vx += 0.5 * a.ax * dt; body.vy += 0.5 * a.ay * dt
  }
  const after = gravityAcceleration(bodies, gravity)
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].id === fixedBodyId) continue
    bodies[i].vx += 0.5 * after[i].ax * dt
    bodies[i].vy += 0.5 * after[i].ay * dt
  }
  resolveCollisions(bodies, collision, fixedBodyId)
  return bodies
}

export function gravityEnergy(bodies: readonly GravityBody[], gravity = 1) {
  let energy = 0
  for (const body of bodies) energy += 0.5 * body.mass * (body.vx * body.vx + body.vy * body.vy)
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j]
    energy -= gravity * a.mass * b.mass / Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + 0.045 ** 2)
  }
  return energy
}
