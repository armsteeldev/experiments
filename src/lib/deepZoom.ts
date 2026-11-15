export type Magnification = { mantissa: number; exponent: number }

export const MIN_MAGNIFICATION: Magnification = { mantissa: 7.2, exponent: -1 }
export const OVERVIEW_MAGNIFICATION: Magnification = { mantissa: 1, exponent: 0 }
export const MAX_MAGNIFICATION: Magnification = { mantissa: 1, exponent: 500 }
const MIN_LOG_MAGNIFICATION = Math.log10(MIN_MAGNIFICATION.mantissa) + MIN_MAGNIFICATION.exponent
const MAX_LOG_MAGNIFICATION = MAX_MAGNIFICATION.exponent
const MAX_COORDINATE_DIGITS = MAX_MAGNIFICATION.exponent + 48

/** Parse both legacy numeric zooms and the scientific zoom format used by the viewer. */
export function magnification(value: unknown): Magnification {
  if (value && typeof value === 'object') {
    const candidate = value as Partial<Magnification>
    if (Number.isFinite(candidate.mantissa) && Number.isSafeInteger(candidate.exponent) && (candidate.mantissa as number) > 0) {
      return importedMagnification(normalizeMagnification(candidate.mantissa as number, candidate.exponent as number))
    }
  }
  const text = String(value ?? '1').trim().toLowerCase()
  if (text.length > 64) return OVERVIEW_MAGNIFICATION
  const match = /^(\+?\d*\.?\d+)(?:e([+-]?\d+))?$/.exec(text)
  if (!match) return OVERVIEW_MAGNIFICATION
  const number = Number(match[1])
  const exponent = Number(match[2] || 0)
  if (!(number > 0) || !Number.isFinite(number) || !Number.isSafeInteger(exponent)) return OVERVIEW_MAGNIFICATION
  const decimalExponent = Math.floor(Math.log10(number)) + exponent
  const mantissa = number / Math.pow(10, Math.floor(Math.log10(number)))
  return importedMagnification(normalizeMagnification(mantissa, decimalExponent))
}

export function normalizeMagnification(mantissa: number, exponent: number): Magnification {
  if (!(mantissa > 0) || !Number.isFinite(mantissa) || !Number.isSafeInteger(exponent)) return OVERVIEW_MAGNIFICATION
  const adjustment = Math.floor(Math.log10(mantissa))
  const normalizedExponent = exponent + adjustment
  if (!Number.isSafeInteger(normalizedExponent)) return OVERVIEW_MAGNIFICATION
  return { mantissa: mantissa / Math.pow(10, adjustment), exponent: normalizedExponent }
}

function importedMagnification(value: Magnification): Magnification {
  const log10 = magnificationLog10(value)
  if (!Number.isFinite(log10) || log10 > MAX_LOG_MAGNIFICATION) return OVERVIEW_MAGNIFICATION
  if (log10 < MIN_LOG_MAGNIFICATION) return MIN_MAGNIFICATION
  return value
}

function boundedInteractiveMagnification(value: Magnification): Magnification {
  const log10 = magnificationLog10(value)
  if (!Number.isFinite(log10) || log10 > MAX_LOG_MAGNIFICATION) return MAX_MAGNIFICATION
  if (log10 < MIN_LOG_MAGNIFICATION) return MIN_MAGNIFICATION
  return value
}

export function multiplyMagnification(value: Magnification, factor: number): Magnification {
  if (!(factor > 0) || !Number.isFinite(factor)) return value
  return boundedInteractiveMagnification(normalizeMagnification(value.mantissa * factor, value.exponent))
}

export function magnificationLog10(value: Magnification) {
  return Math.log10(value.mantissa) + value.exponent
}

export function magnificationFromLog10(log10: number): Magnification {
  if (!Number.isFinite(log10)) return OVERVIEW_MAGNIFICATION
  if (log10 > MAX_LOG_MAGNIFICATION) return MAX_MAGNIFICATION
  if (log10 < MIN_LOG_MAGNIFICATION) return MIN_MAGNIFICATION
  const exponent = Math.floor(log10)
  return boundedInteractiveMagnification(normalizeMagnification(Math.pow(10, log10 - exponent), exponent))
}

export function magnificationAsNumber(value: Magnification) {
  return value.exponent > 308 ? Infinity : value.exponent < -323 ? 0 : value.mantissa * Math.pow(10, value.exponent)
}

export function magnificationRatio(to: Magnification, from: Magnification) {
  const exponent = to.exponent - from.exponent
  if (exponent > 300) return Infinity
  if (exponent < -300) return 0
  return (to.mantissa / from.mantissa) * Math.pow(10, exponent)
}

export function formatMagnification(value: Magnification) {
  const exponent = value.exponent
  if (exponent >= 6 || exponent <= -4) return `${value.mantissa.toFixed(2).replace(/\.?0+$/, '')}e${exponent}`
  const number = magnificationAsNumber(value)
  return number.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function precisionDigits(zoom: Magnification | number | string) {
  const parsed = typeof zoom === 'object' ? normalizeMagnification(zoom.mantissa, zoom.exponent) : magnification(zoom)
  const digits = Math.ceil(magnificationLog10(parsed)) + 48
  if (!Number.isSafeInteger(digits) || digits < 1 || digits > MAX_COORDINATE_DIGITS) throw new RangeError('Magnification exceeds the browser numeric coordinate budget.')
  return digits
}

export function powerOfTen(power: number) {
  if (!Number.isSafeInteger(power) || power < 0) throw new RangeError('Invalid decimal precision request.')
  return 10n ** BigInt(power)
}

export function parseFixed(value: string | number, digits: number) {
  const text = String(value).trim().toLowerCase()
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/.exec(text)
  if (!match || (!match[2] && !match[3])) return 0n
  const negative = match[1] === '-'
  const integer = match[2] || '0'
  const fraction = match[3] || ''
  const exponent = Number(match[4] || 0)
  let coefficient = BigInt((integer + fraction).replace(/^0+(?=\d)/, '') || '0')
  const shift = digits - fraction.length + exponent
  if (shift >= 0) coefficient *= powerOfTen(shift)
  else {
    const divisor = powerOfTen(-shift)
    coefficient = (coefficient + divisor / 2n) / divisor
  }
  return negative ? -coefficient : coefficient
}

export function formatFixed(value: bigint, digits: number) {
  if (value === 0n) return '0'
  const negative = value < 0n
  const absolute = negative ? -value : value
  const padded = absolute.toString().padStart(digits + 1, '0')
  const whole = padded.slice(0, -digits)
  const fraction = padded.slice(-digits).replace(/0+$/, '')
  return (negative ? '-' : '') + whole + (fraction ? '.' + fraction : '')
}

function zoomMantissa(zoom: Magnification) {
  return BigInt(Math.round(zoom.mantissa * 1e15))
}

/** Convert a screen-space displacement into the current fixed-point coordinate scale. */
export function coordinateOffset(deltaCss: number, heightCss: number, zoomValue: Magnification | number | string, digits = precisionDigits(zoomValue)) {
  const zoom = typeof zoomValue === 'object' ? zoomValue : magnification(zoomValue)
  const deltaMicros = BigInt(Math.round(deltaCss * 1e6))
  const heightMicros = BigInt(Math.max(1, Math.round(heightCss * 1e6)))
  const decimalPower = digits + 15 - zoom.exponent
  let numerator = deltaMicros * 4n
  let denominator = heightMicros * zoomMantissa(zoom)
  if (decimalPower >= 0) numerator *= powerOfTen(decimalPower)
  else denominator *= powerOfTen(-decimalPower)
  const half = denominator / 2n
  return numerator < 0n ? -((-numerator + half) / denominator) : (numerator + half) / denominator
}

export function scaleFixed(value: bigint, fromDigits: number, toDigits: number) {
  if (toDigits >= fromDigits) return value * powerOfTen(toDigits - fromDigits)
  const divisor = powerOfTen(fromDigits - toDigits)
  const half = divisor / 2n
  return value < 0n ? -((-value + half) / divisor) : (value + half) / divisor
}

export function fixedToNumber(value: bigint, digits: number) {
  if (value === 0n) return 0
  const negative = value < 0n
  const text = (negative ? -value : value).toString()
  const take = Math.min(16, text.length)
  const leading = Number(text.slice(0, take)) / Math.pow(10, take - 1)
  const magnitude = leading * Math.pow(10, text.length - 1 - digits)
  return negative ? -magnitude : magnitude
}

/** Represent a fixed-point value as mantissa × 2^exponent without underflow. */
export function fixedToBinary(value: bigint, digits: number) {
  if (value === 0n) return { mantissa: 0, exponent: 0 }
  const negative = value < 0n
  const text = (negative ? -value : value).toString()
  const take = Math.min(16, text.length)
  const leading = Number(text.slice(0, take)) / Math.pow(10, take - 1)
  const log2Magnitude = Math.log2(leading) + (text.length - 1 - digits) * Math.log2(10)
  const exponent = Math.floor(log2Magnitude) + 1
  const mantissa = Math.pow(2, log2Magnitude - exponent) * (negative ? -1 : 1)
  return { mantissa, exponent }
}

export function binaryScaleForPixel(zoom: Magnification, height: number) {
  const log2Scale = 2 - Math.log2(Math.max(1, height)) - Math.log2(zoom.mantissa) - zoom.exponent * Math.log2(10)
  const exponent = Math.floor(log2Scale)
  return { mantissa: Math.pow(2, log2Scale - exponent), exponent }
}
