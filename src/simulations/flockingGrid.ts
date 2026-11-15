/** Start of the unique wrapped cell window used by a toroidal neighbour search. */
export function wrappedCellStart(cellIndex: number, cellCount: number, reach: number): number {
  return ((cellIndex - reach) % cellCount + cellCount) % cellCount
}

/** A wrapped grid may be narrower than the requested neighbourhood diameter. */
export function wrappedCellSpan(cellCount: number, reach: number): number {
  return Math.min(cellCount, reach * 2 + 1)
}

/** Scale a steering vector into its force/speed limit without allocating a tuple. */
export function limitedVectorScale(x: number, y: number, maximumLength: number): number {
  const length = Math.hypot(x, y)
  return length > maximumLength ? maximumLength / length : 1
}

export type ToroidalPoint = { x: number; y: number }

/** Find the closest point using the flock's wrapped world without allocating distance records. */
export function nearestToroidalPoint<T extends ToroidalPoint>(points: readonly T[], x: number, y: number, width: number, height: number, maximumDistance: number): T | null {
  let nearest: T | null = null
  const maximumDistance2 = maximumDistance * maximumDistance
  let nearestDistance2 = Infinity
  for (const point of points) {
    let dx = point.x - x, dy = point.y - y
    if (dx > width / 2) dx -= width; else if (dx < -width / 2) dx += width
    if (dy > height / 2) dy -= height; else if (dy < -height / 2) dy += height
    const distance2 = dx * dx + dy * dy
    if (distance2 <= maximumDistance2 && distance2 < nearestDistance2) { nearestDistance2 = distance2; nearest = point }
  }
  return nearest
}
