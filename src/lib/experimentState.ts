/** Read one bounded numeric setting from a shared or saved experiment state. */
export function boundedStateNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export function boundedStateInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(boundedStateNumber(value, fallback, min, max))
}

export function boundedStateSeed(value: unknown, fallback: number): number {
  return boundedStateInteger(value, fallback, 0, 0xffff_ffff) >>> 0
}

export function stateChoice<const T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === 'string' && choices.includes(value as T) ? value as T : fallback
}
