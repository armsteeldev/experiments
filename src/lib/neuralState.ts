export type SharedNeuralSample = { x: [number, number]; y: 0 | 1 }

/** Keep custom lessons small enough for safe, portable experiment links. */
export const MAX_SHARED_NEURAL_SAMPLES = 128

/**
 * Validate custom training examples as one bounded unit. A malformed lesson is
 * safer to reopen blank than to silently teach a different pattern.
 */
export function restoreNeuralSamples(value: unknown): SharedNeuralSample[] | null {
  if (!Array.isArray(value) || value.length > MAX_SHARED_NEURAL_SAMPLES) return null
  const samples: SharedNeuralSample[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const sample = item as { x?: unknown; y?: unknown }
    if (!Array.isArray(sample.x) || sample.x.length !== 2) return null
    const [x, y] = sample.x
    if (typeof x !== 'number' || !Number.isFinite(x) || x < -1 || x > 1) return null
    if (typeof y !== 'number' || !Number.isFinite(y) || y < -1 || y > 1) return null
    if (sample.y !== 0 && sample.y !== 1) return null
    samples.push({ x: [x, y], y: sample.y })
  }
  return samples
}
