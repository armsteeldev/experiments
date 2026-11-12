const readList = (key: string): string[] => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

export const getFavorites = () => readList('armsteel:favorites')
export const getRecent = () => readList('armsteel:recent')

export function toggleFavorite(id: string) {
  const current = getFavorites()
  const next = current.includes(id) ? current.filter((item) => item !== id) : [id, ...current]
  localStorage.setItem('armsteel:favorites', JSON.stringify(next))
  return next
}

export function rememberVisit(id: string) {
  const next = [id, ...getRecent().filter((item) => item !== id)].slice(0, 6)
  localStorage.setItem('armsteel:recent', JSON.stringify(next))
  return next
}

export function decodeState(search: string): Record<string, unknown> | null {
  const encoded = new URLSearchParams(search).get('state')
  if (!encoded) return null
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(atob(normalized))))
  } catch { return null }
}

export function encodeState(state: Record<string, unknown>) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(state))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
