export type Harmonic = { multiple: number; amplitude: number; phase: number }
export type SignalParameters = { frequency: number; harmonics: Harmonic[]; samples?: number }

export function synthesizeSignal({ frequency, harmonics, samples = 2048 }: SignalParameters): Float32Array {
  const count = Math.max(16, Math.min(16384, 2 ** Math.ceil(Math.log2(samples))))
  const result = new Float32Array(count)
  const fundamental = Math.max(1, Math.min(1600, frequency)), periodSeconds = 1 / fundamental, sampleRate = count / periodSeconds
  for (let i = 0; i < count; i++) {
    const phase = 2 * Math.PI * fundamental * (i / sampleRate)
    let value = 0
    for (const partial of harmonics) value += Math.max(0, Math.min(1, partial.amplitude)) * Math.sin(partial.multiple * phase + partial.phase)
    result[i] = value
  }
  // These samples represent one fundamental period; the oscillator supplies the actual frequency.
  return result
}

export function radix2FFT(realInput: Float32Array | number[]): { real: Float64Array; imaginary: Float64Array } {
  const n = realInput.length
  if (n < 2 || (n & (n - 1)) !== 0) throw new RangeError('FFT length must be a power of two greater than one')
  const real = new Float64Array(n), imaginary = new Float64Array(n)
  for (let i = 0; i < n; i++) real[i] = realInput[i]
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]] }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, angle = -2 * Math.PI / size
    for (let start = 0; start < n; start += size) {
      for (let j = 0; j < half; j++) {
        const wr = Math.cos(angle * j), wi = Math.sin(angle * j), even = start + j, odd = even + half
        const tr = wr * real[odd] - wi * imaginary[odd], ti = wr * imaginary[odd] + wi * real[odd]
        real[odd] = real[even] - tr; imaginary[odd] = imaginary[even] - ti
        real[even] += tr; imaginary[even] += ti
      }
    }
  }
  return { real, imaginary }
}

export function signalSpectrum(samples: Float32Array): Float32Array {
  const { real, imaginary } = radix2FFT(samples)
  const result = new Float32Array(samples.length / 2)
  for (let i = 0; i < result.length; i++) result[i] = 2 * Math.hypot(real[i], imaginary[i]) / samples.length
  return result
}

export function harmonicsToPeriodicWaveCoefficients(harmonics: Harmonic[], maxHarmonics = 64): { real: Float32Array; imaginary: Float32Array } {
  const size = Math.max(2, Math.min(256, maxHarmonics))
  const real = new Float32Array(size), imaginary = new Float32Array(size)
  for (const partial of harmonics) {
    if (partial.multiple < 1 || partial.multiple >= size) continue
    // Web Audio's cosine and sine coefficients encode the same phase as A·sin(nωt + φ).
    real[partial.multiple] = partial.amplitude * Math.sin(partial.phase)
    imaginary[partial.multiple] = partial.amplitude * Math.cos(partial.phase)
  }
  return { real, imaginary }
}

export function addHarmonic(harmonics: Harmonic[], multiple: number): Harmonic[] {
  if (harmonics.some((part) => part.multiple === multiple)) return harmonics.filter((part) => part.multiple !== multiple)
  return [...harmonics, { multiple, amplitude: 0.34 / Math.sqrt(multiple), phase: 0 }].sort((a, b) => a.multiple - b.multiple)
}

export function lowpassTransfer(frequencyHz: number, cutoffHz: number, sampleRate = 44100, q = Math.SQRT1_2): { real: number; imaginary: number } {
  const cutoff = Math.max(10, Math.min(sampleRate * 0.45, cutoffHz))
  const omega = 2 * Math.PI * cutoff / sampleRate, cosine = Math.cos(omega), alpha = Math.sin(omega) / (2 * q)
  const b0 = (1 - cosine) / 2, b1 = 1 - cosine, b2 = b0, a0 = 1 + alpha, a1 = -2 * cosine, a2 = 1 - alpha
  const w = 2 * Math.PI * Math.max(0, frequencyHz) / sampleRate
  const nr = b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w), ni = -b1 * Math.sin(w) - b2 * Math.sin(2 * w)
  const dr = a0 + a1 * Math.cos(w) + a2 * Math.cos(2 * w), di = -a1 * Math.sin(w) - a2 * Math.sin(2 * w)
  const denominator = Math.max(1e-24, dr * dr + di * di)
  return { real: (nr * dr + ni * di) / denominator, imaginary: (ni * dr - nr * di) / denominator }
}

export function lowpassMagnitude(frequencyHz: number, cutoffHz: number, sampleRate = 44100, q = Math.SQRT1_2): number {
  const transfer = lowpassTransfer(frequencyHz, cutoffHz, sampleRate, q)
  return Math.hypot(transfer.real, transfer.imaginary)
}

export function applyLowpassResponse(harmonics: Harmonic[], fundamental: number, cutoffHz: number, sampleRate = 44100): Harmonic[] {
  return harmonics.map((part) => {
    const transfer = lowpassTransfer(fundamental * part.multiple, cutoffHz, sampleRate)
    return { ...part, amplitude: part.amplitude * Math.hypot(transfer.real, transfer.imaginary), phase: part.phase + Math.atan2(transfer.imaginary, transfer.real) }
  })
}
