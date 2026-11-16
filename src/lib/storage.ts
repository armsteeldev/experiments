const FAVORITES_KEY = 'armsteel:favorites'
const SAVED_EXPERIMENTS_KEY = 'armsteel:saved-scenes'
const SHARED_STATE_MARKER = '$armsteel'
const SHARED_STATE_VERSION = 1
const NOTEBOOK_MARKER = '$armsteelNotebook'
const NOTEBOOK_VERSION = 1
const MAX_SHARED_STATE_BYTES = 16 * 1024
const MAX_SAVED_EXPERIMENTS = 12
const MAX_SAVED_EXPERIMENTS_BYTES = 128 * 1024
export const MAX_NOTEBOOK_FILE_BYTES = MAX_SAVED_EXPERIMENTS_BYTES * 2

export type SavedExperiment = {
  id: string
  exhibitId: string
  name: string
  savedAt: string
  state: Record<string, unknown>
}

let memoryFavorites: string[] | null = null
let memorySavedExperiments: SavedExperiment[] | null = null
let savedExperimentsVolatile = false
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
    const record = value as Record<string, unknown>
    if (Object.hasOwn(record, SHARED_STATE_MARKER)) {
      if (record[SHARED_STATE_MARKER] !== SHARED_STATE_VERSION || !isStateRecord(record.state)) return null
      return record.state as Record<string, unknown>
    }
    return isStateRecord(record) ? record : null
  } catch {
    return null
  }
}

export function encodeState(state: Record<string, unknown>) {
  try {
    if (!isStateRecord(state)) return ''
    const bytes = new TextEncoder().encode(JSON.stringify({ [SHARED_STATE_MARKER]: SHARED_STATE_VERSION, state }))
    if (bytes.byteLength > MAX_SHARED_STATE_BYTES) return ''
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch {
    return ''
  }
}

function isStateRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && isSerializableValue(value))
}

function isSerializableValue(value: unknown, depth = 0, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'string') return value.length <= MAX_SHARED_STATE_BYTES
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || depth > 10 || seen.has(value)) return false
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.length <= 8192 && value.every((item) => isSerializableValue(item, depth + 1, seen))
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.length <= 256 && entries.every(([key, item]) =>
      key.length <= 80 && key !== '__proto__' && key !== 'prototype' && key !== 'constructor' && isSerializableValue(item, depth + 1, seen))
  } catch {
    return false
  } finally {
    seen.delete(value)
  }
}

function serializeState(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isSerializableValue(value)) return null
  const encoded = encodeState(value as Record<string, unknown>)
  return encoded ? decodeState(`?state=${encoded}`) : null
}

function cleanSavedName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64) : ''
}

function serializedSize(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength } catch { return Infinity }
}

function sanitizeSavedExperiments(value: unknown, allowedIds?: readonly string[]): SavedExperiment[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const root = value as { version?: unknown; experiments?: unknown }
  if (root.version !== 1 || !Array.isArray(root.experiments)) return []
  const result: SavedExperiment[] = []
  const seen = new Set<string>()
  for (const entry of root.experiments.slice(0, MAX_SAVED_EXPERIMENTS * 4)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const candidate = entry as Partial<SavedExperiment>
    if (typeof candidate.id !== 'string' || !/^scene-[a-z0-9-]{6,90}$/.test(candidate.id) || seen.has(candidate.id)) continue
    if (typeof candidate.exhibitId !== 'string' || !sanitizeIds([candidate.exhibitId], allowedIds, 1).length) continue
    const name = cleanSavedName(candidate.name)
    if (!name || typeof candidate.savedAt !== 'string' || candidate.savedAt.length > 40 || !Number.isFinite(Date.parse(candidate.savedAt))) continue
    const state = serializeState(candidate.state)
    if (!state || !Object.keys(state).length) continue
    const saved = { id: candidate.id, exhibitId: candidate.exhibitId, name, savedAt: candidate.savedAt, state }
    const next = [...result, saved]
    if (next.length > MAX_SAVED_EXPERIMENTS || serializedSize({ version: 1, experiments: next }) > MAX_SAVED_EXPERIMENTS_BYTES) continue
    result.push(saved)
    seen.add(saved.id)
  }
  return result
}

function readSavedExperiments(allowedIds?: readonly string[]): SavedExperiment[] {
  let raw: string | null
  const memory = () => sanitizeSavedExperiments({ version: 1, experiments: memorySavedExperiments ?? [] }, allowedIds)
  try { raw = window.localStorage.getItem(SAVED_EXPERIMENTS_KEY) } catch {
    return memory()
  }
  if (!raw) return savedExperimentsVolatile ? memory() : []
  if (raw.length > MAX_SAVED_EXPERIMENTS_BYTES || new TextEncoder().encode(raw).byteLength > MAX_SAVED_EXPERIMENTS_BYTES) return savedExperimentsVolatile ? memory() : []
  try {
    const stored = sanitizeSavedExperiments(JSON.parse(raw), allowedIds)
    return savedExperimentsVolatile
      ? sanitizeSavedExperiments({ version: 1, experiments: [...(memorySavedExperiments ?? []), ...stored] }, allowedIds)
      : stored
  } catch { return savedExperimentsVolatile ? memory() : [] }
}

export function getSavedExperiments(allowedIds?: readonly string[]): SavedExperiment[] {
  const experiments = readSavedExperiments(allowedIds)
  memorySavedExperiments = experiments
  return experiments
}

function writeSavedExperiments(experiments: SavedExperiment[]): boolean {
  const record = { version: 1, experiments }
  if (serializedSize(record) > MAX_SAVED_EXPERIMENTS_BYTES) return false
  memorySavedExperiments = experiments
  try {
    window.localStorage.setItem(SAVED_EXPERIMENTS_KEY, JSON.stringify(record))
    savedExperimentsVolatile = false
    return true
  } catch {
    savedExperimentsVolatile = true
    return false
  }
}

function newSavedExperimentId(): string {
  return `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function exportSavedExperimentNotebook(allowedIds?: readonly string[]): string | null {
  const experiments = getSavedExperiments(allowedIds)
  if (!experiments.length) return null
  try {
    return JSON.stringify({ [NOTEBOOK_MARKER]: NOTEBOOK_VERSION, exportedAt: new Date().toISOString(), experiments }, null, 2)
  } catch {
    return null
  }
}

function sameSavedSetup(left: SavedExperiment, right: SavedExperiment): boolean {
  return left.exhibitId === right.exhibitId && left.name === right.name && JSON.stringify(left.state) === JSON.stringify(right.state)
}

export function importSavedExperimentNotebook(value: unknown, allowedIds?: readonly string[]) {
  const current = getSavedExperiments(allowedIds)
  let serialized: string
  try { serialized = JSON.stringify(value) } catch {
    return { status: 'invalid' as const, importedCount: 0, skippedCount: 0, experiments: current }
  }
  if (!serialized || new TextEncoder().encode(serialized).byteLength > MAX_NOTEBOOK_FILE_BYTES || !value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'invalid' as const, importedCount: 0, skippedCount: 0, experiments: current }
  }
  const archive = value as { [NOTEBOOK_MARKER]?: unknown; exportedAt?: unknown; experiments?: unknown }
  if (archive[NOTEBOOK_MARKER] !== NOTEBOOK_VERSION || typeof archive.exportedAt !== 'string' || !Number.isFinite(Date.parse(archive.exportedAt)) || !Array.isArray(archive.experiments) || archive.experiments.length > MAX_SAVED_EXPERIMENTS * 4) {
    return { status: 'invalid' as const, importedCount: 0, skippedCount: 0, experiments: current }
  }

  const candidates = sanitizeSavedExperiments({ version: 1, experiments: archive.experiments }, allowedIds)
  let skippedCount = archive.experiments.length - candidates.length
  const additions: SavedExperiment[] = []
  const ids = new Set(current.map((item) => item.id))
  for (const candidate of candidates) {
    const collision = [...current, ...additions].find((item) => item.id === candidate.id)
    if (collision && sameSavedSetup(collision, candidate)) {
      skippedCount++
      continue
    }
    let imported = candidate
    if (collision || ids.has(imported.id)) imported = { ...candidate, id: newSavedExperimentId() }
    while (ids.has(imported.id)) imported = { ...candidate, id: newSavedExperimentId() }

    const proposed = [...additions, imported, ...current]
    if (proposed.length > MAX_SAVED_EXPERIMENTS || serializedSize({ version: 1, experiments: proposed }) > MAX_SAVED_EXPERIMENTS_BYTES) {
      skippedCount++
      continue
    }
    additions.push(imported)
    ids.add(imported.id)
  }

  if (!additions.length) return { status: 'no-new' as const, importedCount: 0, skippedCount, experiments: current }
  const next = [...additions, ...current]
  const status = writeSavedExperiments(next) ? 'imported' as const : 'memory-only' as const
  return { status, importedCount: additions.length, skippedCount, experiments: next }
}

export function saveExperimentState(exhibitId: string, nameValue: string, stateValue: unknown, allowedIds?: readonly string[]) {
  const current = getSavedExperiments(allowedIds)
  const name = cleanSavedName(nameValue)
  const state = serializeState(stateValue)
  if (!sanitizeIds([exhibitId], allowedIds, 1).length || !name || !state || !Object.keys(state).length) {
    return { status: 'invalid' as const, experiments: current }
  }
  if (current.length >= MAX_SAVED_EXPERIMENTS) return { status: 'full' as const, experiments: current }
  const snapshot: SavedExperiment = {
    id: newSavedExperimentId(),
    exhibitId,
    name,
    savedAt: new Date().toISOString(),
    state,
  }
  const next = [snapshot, ...current]
  if (serializedSize({ version: 1, experiments: next }) > MAX_SAVED_EXPERIMENTS_BYTES) {
    return { status: 'too-large' as const, experiments: current }
  }
  return { status: writeSavedExperiments(next) ? 'saved' as const : 'memory-only' as const, experiments: next }
}

export function removeSavedExperiment(id: string, allowedIds?: readonly string[]) {
  const next = getSavedExperiments(allowedIds).filter((item) => item.id !== id)
  return { persisted: writeSavedExperiments(next), experiments: next }
}
