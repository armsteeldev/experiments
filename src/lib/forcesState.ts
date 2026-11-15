import type { Charge } from '../simulations/electric'

export type ForceCharge = Pick<Charge, 'x' | 'y' | 'q'>
export type ForcesView = { x: number; y: number; zoom: number }
export type ForcesSnapshot = { charges: ForceCharge[]; view: ForcesView }

export const MAX_FORCE_CHARGES = 16
export const MIN_FORCES_ZOOM = 5.4 / 14
export const MAX_FORCES_ZOOM = 5.4 * 1.4
const MAX_WORLD_COORDINATE = 1000

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

export function restoreForcesView(value: unknown): ForcesView | null {
  if (!isRecord(value)) return null
  const { x, y, zoom } = value
  if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > MAX_WORLD_COORDINATE) return null
  if (typeof y !== 'number' || !Number.isFinite(y) || Math.abs(y) > MAX_WORLD_COORDINATE) return null
  if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < MIN_FORCES_ZOOM || zoom > MAX_FORCES_ZOOM) return null
  return { x, y, zoom }
}

/** Validate edited source charges and camera framing before they reach the field renderer. */
export function restoreForcesSnapshot(chargesValue: unknown, viewValue: unknown): ForcesSnapshot | null {
  const view = restoreForcesView(viewValue)
  if (!Array.isArray(chargesValue) || chargesValue.length > MAX_FORCE_CHARGES || !view) return null

  const charges: ForceCharge[] = []
  for (const value of chargesValue) {
    if (!isRecord(value) || typeof value.x !== 'number' || !Number.isFinite(value.x) || Math.abs(value.x) > MAX_WORLD_COORDINATE) return null
    if (typeof value.y !== 'number' || !Number.isFinite(value.y) || Math.abs(value.y) > MAX_WORLD_COORDINATE) return null
    if (typeof value.q !== 'number' || !Number.isFinite(value.q) || Math.abs(value.q) < 0.1 || Math.abs(value.q) > 2) return null
    charges.push({ x: value.x, y: value.y, q: value.q })
  }
  return { charges, view }
}
