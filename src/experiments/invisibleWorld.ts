export type CanvasSize = { width: number; height: number; dpr: number }

export function resizeCanvas(canvas: HTMLCanvasElement, maxDpr = 1.4): CanvasSize {
  const rect = canvas.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)
  const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr))
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
  return { width: rect.width, height: rect.height, dpr }
}

export function normalizedPointer(event: PointerEvent | React.PointerEvent, canvas: HTMLCanvasElement): { x: number; y: number; width: number; height: number } {
  const rect = canvas.getBoundingClientRect()
  return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height, width: rect.width, height: rect.height }
}

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function safeState<T>(value: Record<string, unknown> | null, key: string, fallback: T): T {
  const candidate = value?.[key]
  return candidate === undefined ? fallback : candidate as T
}
