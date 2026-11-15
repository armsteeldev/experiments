export const AUTOMATA_WIDTH = 180
export const AUTOMATA_HEIGHT = 112
export const AUTOMATA_CELL_COUNT = AUTOMATA_WIDTH * AUTOMATA_HEIGHT
const AUTOMATA_1BIT_LENGTH = Math.ceil(AUTOMATA_CELL_COUNT / 8)
const AUTOMATA_2BIT_LENGTH = Math.ceil(AUTOMATA_CELL_COUNT / 4)
const MAX_SPARSE_BYTES = AUTOMATA_2BIT_LENGTH

const toBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const fromBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

/** Pack the 180 × 112 cellular state without serializing simulation history. */
export function encodeAutomataCells(cells: Uint8Array): string | null {
  if (cells.length !== AUTOMATA_CELL_COUNT) return null
  let hasRefractory = false
  for (const value of cells) {
    if (value > 2) return null
    if (value === 2) hasRefractory = true
  }

  const sparse: number[] = []
  let previous = -1
  for (let index = 0; index < cells.length; index++) {
    const value = cells[index]
    if (!value) continue
    let gap = index - previous - 1
    while (gap >= 0x80) {
      sparse.push((gap & 0x7f) | 0x80)
      gap >>>= 7
    }
    sparse.push(gap, value)
    previous = index
  }
  const sparseBytes = Uint8Array.from(sparse)
  const bitmapLength = hasRefractory ? AUTOMATA_2BIT_LENGTH : AUTOMATA_1BIT_LENGTH
  if (sparseBytes.length <= MAX_SPARSE_BYTES && sparseBytes.length < bitmapLength) return `s:${toBase64Url(sparseBytes)}`

  if (hasRefractory) {
    const bytes = new Uint8Array(AUTOMATA_2BIT_LENGTH)
    for (let index = 0; index < cells.length; index++) bytes[index >> 2] |= cells[index] << ((index & 3) * 2)
    return `b2:${toBase64Url(bytes)}`
  }

  const bytes = new Uint8Array(AUTOMATA_1BIT_LENGTH)
  for (let index = 0; index < cells.length; index++) if (cells[index] === 1) bytes[index >> 3] |= 1 << (index & 7)
  return `b1:${toBase64Url(bytes)}`
}

/** Accept only the exact-size, versioned packed board format emitted above. */
export function decodeAutomataCells(value: unknown): Uint8Array | null {
  if (typeof value !== 'string') return null
  const version = value.startsWith('s:') ? 's:' : value.slice(0, 3)
  if (version === 's:') {
    const data = value.slice(2)
    if (data.length > Math.ceil(MAX_SPARSE_BYTES / 3) * 4 || (data && !/^[A-Za-z0-9_-]+$/.test(data))) return null
    try {
      const bytes = fromBase64Url(data)
      if (bytes.length > MAX_SPARSE_BYTES) return null
      const cells = new Uint8Array(AUTOMATA_CELL_COUNT)
      let cursor = 0
      let previous = -1
      while (cursor < bytes.length) {
        let gap = 0
        let shift = 0
        let byte: number
        do {
          if (cursor >= bytes.length || shift > 14) return null
          byte = bytes[cursor++]
          gap |= (byte & 0x7f) << shift
          shift += 7
        } while (byte & 0x80)
        if (cursor >= bytes.length) return null
        const index = previous + 1 + gap
        const state = bytes[cursor++]
        if (index >= cells.length || state < 1 || state > 2) return null
        cells[index] = state
        previous = index
      }
      return cells
    } catch {
      return null
    }
  }
  const expectedLength = version === 'b1:' ? AUTOMATA_1BIT_LENGTH : version === 'b2:' ? AUTOMATA_2BIT_LENGTH : 0
  const data = value.slice(3)
  const expectedEncodedLength = Math.ceil(expectedLength / 3) * 4
  if (!expectedLength || data.length !== expectedEncodedLength || !/^[A-Za-z0-9_-]+$/.test(data)) return null

  try {
    const bytes = fromBase64Url(data)
    if (bytes.length !== expectedLength) return null
    const cells = new Uint8Array(AUTOMATA_CELL_COUNT)
    for (let index = 0; index < cells.length; index++) {
      if (version === 'b1:') cells[index] = bytes[index >> 3] >> (index & 7) & 1
      else {
        const state = bytes[index >> 2] >> ((index & 3) * 2) & 3
        if (state > 2) return null
        cells[index] = state
      }
    }
    return cells
  } catch {
    return null
  }
}
