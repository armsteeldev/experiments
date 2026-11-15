export type FlockingMarkerKind = 'attract' | 'repel' | 'obstacle' | 'food'
export type FlockingMarkerState = { x: number; y: number; kind: FlockingMarkerKind }

export const MAX_FLOCKING_MARKERS = 16

const markerKinds = new Set<FlockingMarkerKind>(['attract', 'repel', 'obstacle', 'food'])
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

/** Marker positions are normalized so a saved arrangement follows the canvas at any viewport size. */
export function restoreFlockingMarkers(value: unknown): FlockingMarkerState[] | null {
  if (!Array.isArray(value) || value.length > MAX_FLOCKING_MARKERS) return null
  const markers: FlockingMarkerState[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.x !== 'number' || !Number.isFinite(item.x) || item.x < 0 || item.x > 1) return null
    if (typeof item.y !== 'number' || !Number.isFinite(item.y) || item.y < 0 || item.y > 1) return null
    if (typeof item.kind !== 'string' || !markerKinds.has(item.kind as FlockingMarkerKind)) return null
    markers.push({ x: item.x, y: item.y, kind: item.kind as FlockingMarkerKind })
  }
  return markers
}
