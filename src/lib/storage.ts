const FAVORITES_KEY = 'armsteel:favorites'
const MAX_SHARED_STATE_BYTES = 16 * 1024

let memoryFavorites: string[] | null = null
let recentVisits: string[] = []

function allowedSet(allowedIds?: readonly string[]) {
  return allowedIds ? new Set(allowedIds) : null
}

function sanitizeIds(value: unknown, allowedIds?: readonly string[], limit = 32): string[] {
  if (!Array.isArray(value)) return []
  const allowed = allowedSet(allowedIds)
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !/^[a-z0-9-]{1,40}$/.test(item)) continue
    if (allowed && !allowed.has(item)) continue
    if (!result.includes(item)) result.push(item)
    if (result.length >= limit) break
  }
  return result
}

export function getFavorites(allowedIds?: readonly string[]): string[] {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(FAVORITES_KEY)
  } catch {
    return sanitizeIds(memoryFavorites ?? [], allowedIds, allowedIds?.length ?? 32)
  }
  try {
    const favorites = sanitizeIds(raw ? JSON.parse(raw) : [], allowedIds, allowedIds?.length ?? 32)
    memoryFavorites = favorites
    return favorites
  } catch {
    memoryFavorites = []
    return []
  }
}

function writeFavorites(favorites: string[]) {
  memoryFavorites = favorites
  try { window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)) } catch { /* storage may be blocked or full */ }
}

export function getRecent(allowedIds?: readonly string[]): string[] {
  return sanitizeIds(recentVisits, allowedIds, 6)
}

export function toggleFavorite(id: string, allowedIds?: readonly string[]) {
  if (!sanitizeIds([id], allowedIds, 1).length) return getFavorites(allowedIds)
  const current = getFavorites(allowedIds)
  const next = current.includes(id) ? current.filter((item) => item !== id) : [id, ...current]
  writeFavorites(sanitizeIds(next, allowedIds, allowedIds?.length ?? 32))
  return getFavorites(allowedIds)
}

export function rememberVisit(id: string, allowedIds?: readonly string[]) {
  if (!sanitizeIds([id], allowedIds, 1).length) return getRecent(allowedIds)
  recentVisits = [id, ...recentVisits.filter((item) => item !== id)].slice(0, 6)
  return getRecent(allowedIds)
}

export function decodeState(search: string): Record<string, unknown> | null {
  const encoded = new URLSearchParams(search).get('state')
  if (!encoded || encoded.length > MAX_SHARED_STATE_BYTES * 2) return null
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    if (bytes.byteLength > MAX_SHARED_STATE_BYTES) return null
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value as Record<string, unknown>
  } catch {
    return null
  }
}

export function encodeState(state: Record<string, unknown>) {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(state))
    if (bytes.byteLength > MAX_SHARED_STATE_BYTES) return ''
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch {
    return ''
  }
}
