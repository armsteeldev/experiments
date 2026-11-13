export type Charge = { id: number; x: number; y: number; q: number }
export type Vector = { x: number; y: number }
export function electricField(charges: readonly Charge[], x: number, y: number, softening = 0.035): Vector {
  let ex = 0, ey = 0
  for (const charge of charges) {
    const dx = x - charge.x, dy = y - charge.y, r2 = dx * dx + dy * dy + softening * softening
    const scale = charge.q / (r2 * Math.sqrt(r2))
    ex += dx * scale; ey += dy * scale
  }
  return { x: ex, y: ey }
}
export function electricPotential(charges: readonly Charge[], x: number, y: number, softening = 0.035) {
  return charges.reduce((sum, charge) => sum + charge.q / Math.sqrt((x - charge.x) ** 2 + (y - charge.y) ** 2 + softening * softening), 0)
}
export function integrateFieldLine(charges: readonly Charge[], start: Vector, direction: 1 | -1 = 1, step = 0.025, limit = 900) {
  const points: Vector[] = [{ ...start }]
  let { x, y } = start
  for (let i = 0; i < limit; i++) {
    const field = electricField(charges, x, y), magnitude = Math.hypot(field.x, field.y)
    if (magnitude < 1e-8) break
    x += direction * field.x / magnitude * step; y += direction * field.y / magnitude * step
    points.push({ x, y })
    if (charges.some((charge) => Math.hypot(x - charge.x, y - charge.y) < 0.055)) break
    if (Math.abs(x) > 8 || Math.abs(y) > 8) break
  }
  return points
}
export function integrateTestParticle(charges: readonly Charge[], start: Vector, velocity: Vector, dt: number, steps: number, particleCharge = 0.12, mass = 1) {
  let x = start.x, y = start.y, vx = velocity.x, vy = velocity.y
  const points: Vector[] = [{ x, y }]
  for (let i = 0; i < steps; i++) {
    const field = electricField(charges, x, y)
    vx += field.x * particleCharge / mass * dt
    vy += field.y * particleCharge / mass * dt
    x += vx * dt; y += vy * dt
    if (!Number.isFinite(x + y + vx + vy) || Math.abs(x) > 8 || Math.abs(y) > 8) break
    points.push({ x, y })
  }
  return points
}
