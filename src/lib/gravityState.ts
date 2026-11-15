import type { GravityBody } from '../simulations/gravity'

export type GravityBodyState = Pick<GravityBody, 'id' | 'x' | 'y' | 'vx' | 'vy' | 'mass' | 'color'>
export type GravityView = { x: number; y: number; zoom: number }
export type GravitySnapshot = { bodies: GravityBodyState[]; view: GravityView }

export const MAX_GRAVITY_BODIES = 32
const MAX_POSITION = 1_000_000
const MAX_VIEW_ZOOM = 100

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const finiteWithin = (value: unknown, limit: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit

export function restoreGravityView(value: unknown): GravityView | null {
  if (!isRecord(value) || !finiteWithin(value.x, MAX_POSITION) || !finiteWithin(value.y, MAX_POSITION)) return null
  if (typeof value.zoom !== 'number' || !Number.isFinite(value.zoom) || value.zoom < 0.01 || value.zoom > MAX_VIEW_ZOOM) return null
  return { x: value.x, y: value.y, zoom: value.zoom }
}

/** Validate a finite starting scene before any imported values reach the N-body integrator. */
export function restoreGravitySnapshot(bodiesValue: unknown, viewValue: unknown): GravitySnapshot | null {
  if (!Array.isArray(bodiesValue) || bodiesValue.length > MAX_GRAVITY_BODIES) return null
  const view = restoreGravityView(viewValue)
  if (!view) return null
  const ids = new Set<number>()
  const bodies: GravityBodyState[] = []
  for (const value of bodiesValue) {
    if (!isRecord(value) || !Number.isSafeInteger(value.id) || (value.id as number) < 1 || (value.id as number) > 1_000_000 || ids.has(value.id as number)) return null
    if (!finiteWithin(value.x, MAX_POSITION) || !finiteWithin(value.y, MAX_POSITION)) return null
    if (!finiteWithin(value.vx, 35) || !finiteWithin(value.vy, 35)) return null
    if (typeof value.mass !== 'number' || !Number.isFinite(value.mass) || value.mass < 0.05 || value.mass > 1200) return null
    if (typeof value.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.color)) return null
    ids.add(value.id as number)
    bodies.push({ id: value.id as number, x: value.x, y: value.y, vx: value.vx, vy: value.vy, mass: value.mass, color: value.color })
  }
  return { bodies, view }
}

export function nextGravityBodyId(bodies: readonly Pick<GravityBody, 'id'>[], preferred = 20): number {
  const ids = new Set(bodies.map((body) => body.id))
  let candidate = Number.isSafeInteger(preferred) && preferred > 0 && preferred <= 1_000_000 ? preferred : 1
  while (ids.has(candidate)) candidate = candidate === 1_000_000 ? 1 : candidate + 1
  return candidate
}
