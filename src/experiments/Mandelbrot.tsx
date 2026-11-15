import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { ExperimentControls } from '../types'
import { ControlPanel, RangeControl, SelectControl, Segmented } from '../components/Controls'
import {
  binaryScaleForPixel, coordinateOffset, fixedToBinary, formatFixed, formatMagnification,
  magnification, magnificationAsNumber, magnificationFromLog10, magnificationLog10, magnificationRatio,
  multiplyMagnification, parseFixed, precisionDigits,
} from '../lib/deepZoom'
import type { Magnification } from '../lib/deepZoom'
import { acquireMandelbrotGpuRenderer } from '../lib/mandelbrotGpu'
import { useDiscoveryHint } from '../lib/useDiscoveryHint'
import type { GpuTile, MandelbrotGpuRenderer, PreviewWarp } from '../lib/mandelbrotGpu'

type View = { x: string; y: string; zoom: Magnification }
type Raster = { width: number; height: number }
type Tile = { x: number; y: number; width: number; height: number; slot: number; level: number }
type Drag = { mode: 'pan' | 'pinch'; x: number; y: number; view: View; distance?: number; centerX?: number; centerY?: number }
type TileRequest = {
  id: number
  generation: number
  action: 'prepare'
  tileKey: string
  x: string
  y: string
  zoom: Magnification
  width: number
  height: number
  tile: Tile
  iterations: number
  mode: 'mandelbrot' | 'julia'
  palette: string
  target: 'gpu' | 'cpu'
  juliaX?: string
  juliaY?: string
}
type WorkerResponse = {
  id: number
  generation: number
  tileKey: string
  tile: Tile
  kind: 'reference' | 'cpu-tile' | 'cancelled' | 'error'
  reference?: ArrayBuffer
  referenceExponents?: ArrayBuffer
  pixels?: ArrayBuffer
  referenceMs?: number
  renderMs?: number
  message?: string
}
type WorkerSlot = { worker: Worker; busy: boolean; requestId?: number }
type RefEntry = { values: Float32Array; exponents: Int32Array; bytes: number; used: number }
type PixelEntry = { pixels: Uint8ClampedArray; bytes: number; used: number }
type Metrics = {
  generation: number
  backend: string
  partial: boolean
  startedAt: number
  cameraResponseMs: number | null
  firstTileMs: number | null
  fullRenderMs: number | null
  tilesTotal: number
  tilesComplete: number
  workerReferenceMs: number
  cpuRenderMs: number
  gpuUploadMs: number
  gpuCompletionMs: number
  cacheHits: number
  glitchRepairs: number
}
type GpuQueueItem = { request: TileRequest; tile: GpuTile }

// Frame the cardioid and its circular bulbs as a composed opening view while
// keeping every published cartography preset independent of this default.
const defaults: View = { x: '-0.5', y: '0', zoom: magnification(1.28) }
const presets: Record<string, View> = {
  overview: defaults,
  seahorse: { x: '-0.743643887037159', y: '0.131825904205312', zoom: magnification(180) },
  spiral: { x: '0.28443', y: '-0.01273', zoom: magnification(1000) },
  mini: { x: '-1.768778833', y: '0.001738996', zoom: magnification(850) },
  filament: { x: '-0.748986', y: '0.055768', zoom: magnification(4000) },
  antenna: { x: '-2', y: '0', zoom: magnification(10000) },
  deep: { x: '-1.740062382579339905220844167065825638296641720436171866880', y: '0.028175339779211048992411521144319509687539076742990608570', zoom: magnification('1e50') },
}

const vertexShader = [
  '#version 300 es',
  'const vec2 p[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));',
  'void main(){gl_Position=vec4(p[gl_VertexID],0.,1.);}',
].join('\n')

const fragmentShader = [
  '#version 300 es',
  'precision highp float;',
  'out vec4 outColor;',
  'uniform vec2 uResolution;',
  'uniform vec2 uCenter;',
  'uniform float uZoom;',
  'uniform int uIterations;',
  'uniform int uPalette;',
  'uniform int uJulia;',
  'uniform vec2 uJuliaC;',
  'vec3 ramp(float t,vec3 a,vec3 b,vec3 c,vec3 d,vec3 e){',
  '  float x=clamp(t,0.0,0.9999)*4.0;',
  '  float f=fract(x); f=f*f*(3.0-2.0*f);',
  '  if(x<1.0)return mix(a,b,f); if(x<2.0)return mix(b,c,f); if(x<3.0)return mix(c,d,f); return mix(d,e,f);',
  '}',
  'vec3 palette(float t) {',
  '  if (uPalette == 1) return ramp(t,vec3(.039,.047,.09),vec3(.21,.21,.35),vec3(.52,.32,.40),vec3(.88,.56,.38),vec3(.97,.86,.65));',
  '  if (uPalette == 2) return ramp(t,vec3(.031,.039,.106),vec3(.16,.18,.38),vec3(.33,.51,.68),vec3(.8,.61,.75),vec3(.97,.87,.8));',
  '  if (uPalette == 3) return ramp(t,vec3(.02,.055,.102),vec3(.08,.24,.41),vec3(.21,.58,.75),vec3(.6,.85,.85),vec3(.95,.97,.89));',
  '  if (uPalette == 4) return ramp(t,vec3(.027,.019,.063),vec3(.22,.07,.30),vec3(.66,.18,.42),vec3(.98,.49,.29),vec3(.99,.84,.52));',
  '  return ramp(t,vec3(.016,.031,.075),vec3(.039,.145,.263),vec3(.09,.41,.537),vec3(.357,.812,.745),vec3(.973,.835,.627));',
  '}',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy / uResolution;',
  '  vec2 offset = vec2((uv.x-0.5)*4.0*uResolution.x/uResolution.y, (uv.y-0.5)*4.0) / uZoom;',
  '  vec2 c = uCenter + offset;',
  '  vec2 z = uJulia == 1 ? c : vec2(0.0);',
  '  if (uJulia == 1) c = uJuliaC;',
  '  vec2 derivative = uJulia == 1 ? vec2(1.0,0.0) : vec2(0.0);',
  '  float radius2 = 0.0;',
  '  int iteration = 0;',
  '  for (int n=0; n<2600; n++) {',
  '    radius2 = dot(z,z);',
  '    if (n >= uIterations || radius2 > 256.0) break;',
  '    derivative = 2.0 * vec2(z.x*derivative.x-z.y*derivative.y, z.x*derivative.y+z.y*derivative.x) + vec2(uJulia == 1 ? 0.0 : 1.0,0.0);',
  '    z = vec2(z.x*z.x-z.y*z.y, 2.0*z.x*z.y) + c;',
  '    iteration++;',
  '  }',
  '  if (iteration >= uIterations && radius2 <= 256.0) { outColor = vec4(0.012,0.018,0.033,1.0); return; }',
  '  float smoothI = float(iteration) + 1.0 - log2(max(1e-7, log2(max(radius2,1.00001))));',
  '  float distanceEstimate = 0.5 * sqrt(max(radius2,1.0)) * log(max(sqrt(radius2),1.00001)) / max(length(derivative),1e-5);',
  '  float relief = 0.84 + 0.16 * clamp(0.5 + 0.5*cos(log(max(distanceEstimate,1e-7))*0.75),0.0,1.0);',
  '  outColor = vec4(palette(fract(max(smoothI,0.0)*0.048+0.018)) * relief * 0.94,1.0);',
  '}',
].join('\n')

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not allocate shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader compilation failed')
  return shader
}

function importedView(state: Record<string, unknown> | null): View {
  const shared = state?.view as Partial<View> | undefined
  return {
    x: typeof shared?.x === 'string' || typeof shared?.x === 'number' ? String(shared.x) : defaults.x,
    y: typeof shared?.y === 'string' || typeof shared?.y === 'number' ? String(shared.y) : defaults.y,
    zoom: magnification(shared?.zoom),
  }
}

function formatCoordinate(value: string) { return value.length > 24 ? value.slice(0, 11) + '…' + value.slice(-9) : value }
function deepView(view: View) { return magnificationLog10(view.zoom) >= 4 }

function pixelDisplacement(value: bigint, digits: number, zoom: Magnification, height: number) {
  if (!value) return 0
  const binary = fixedToBinary(value, digits)
  const scaleLog2 = magnificationLog10(zoom) * Math.LOG2E * Math.LN10 + Math.log2(Math.max(1, height) / 4)
  const exponent = binary.exponent + scaleLog2
  if (exponent > 1023) return Math.sign(binary.mantissa) * Infinity
  if (exponent < -1074) return 0
  return binary.mantissa * Math.pow(2, exponent)
}

function previewTransform(from: View, to: View, height: number): PreviewWarp {
  const scale = magnificationRatio(to.zoom, from.zoom)
  if (!Number.isFinite(scale) || scale < 1e-6 || scale > 1e6) return { scale: 0, x: 0, y: 0 }
  try {
    const digits = precisionDigits(magnificationLog10(from.zoom) >= magnificationLog10(to.zoom) ? from.zoom : to.zoom)
    const fromX = parseFixed(from.x, digits), fromY = parseFixed(from.y, digits)
    const toX = parseFixed(to.x, digits), toY = parseFixed(to.y, digits)
    const x = pixelDisplacement(fromX - toX, digits, to.zoom, height)
    const y = pixelDisplacement(toY - fromY, digits, to.zoom, height)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { scale: 0, x: 0, y: 0 }
    return { scale, x, y }
  } catch { return { scale: 0, x: 0, y: 0 } }
}

function iterationsAtZoom(userIterations: number, zoom: Magnification) {
  return Math.max(userIterations, 220 + Math.ceil(Math.max(0, magnificationLog10(zoom)) * 14))
}

function tileKey(view: View, raster: Raster, mode: string, iterations: number, tile: Tile, palette = '') {
  return [view.x, view.y, view.zoom.mantissa.toPrecision(15), view.zoom.exponent, raster.width, raster.height, mode, iterations, tile.x, tile.y, tile.width, tile.height, palette].join('|')
}

function tilesFor(width: number, height: number, tileSize: number, focusX: number, focusY: number) {
  const columns = Math.ceil(width / tileSize)
  const tiles: Tile[] = []
  for (let y = 0; y < height; y += tileSize) for (let x = 0; x < width; x += tileSize) {
    const w = Math.min(tileSize, width - x), h = Math.min(tileSize, height - y)
    tiles.push({ x, y, width: w, height: h, slot: Math.floor(y / tileSize) * columns + Math.floor(x / tileSize), level: 0 })
  }
  return tiles.sort((a, b) => {
    const da = Math.hypot(a.x + a.width / 2 - focusX, a.y + a.height / 2 - focusY)
    const db = Math.hypot(b.x + b.width / 2 - focusX, b.y + b.height / 2 - focusY)
    return da - db
  })
}

function splitTile(tile: Tile): Tile[] {
  if (tile.width <= 1 && tile.height <= 1) return []
  const left = Math.max(1, Math.floor(tile.width / 2)), top = Math.max(1, Math.floor(tile.height / 2))
  const pieces: Tile[] = []
  for (const [oy, h] of [[0, top], [top, tile.height - top]] as [number, number][]) {
    for (const [ox, w] of [[0, left], [left, tile.width - left]] as [number, number][]) {
      if (w > 0 && h > 0) pieces.push({ x: tile.x + ox, y: tile.y + oy, width: w, height: h, slot: tile.slot, level: tile.level + 1 })
    }
  }
  return pieces
}

function normalizeViewCoordinate(x: string, y: string, zoom: Magnification) {
  const digits = precisionDigits(zoom)
  return { x: formatFixed(parseFixed(x, digits), digits), y: formatFixed(parseFixed(y, digits), digits), zoom }
}

function surfaceRect(canvas: HTMLCanvasElement) {
  return canvas.parentElement?.getBoundingClientRect() || canvas.getBoundingClientRect()
}

export default function Mandelbrot({ controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const hint = useDiscoveryHint('mandelbrot')
  const fastCanvasRef = useRef<HTMLCanvasElement>(null)
  const gpuCanvasRef = useRef<HTMLCanvasElement>(null)
  const cpuCanvasRef = useRef<HTMLCanvasElement>(null)
  const repairCanvasRef = useRef<HTMLCanvasElement>(null)
  const fastDraw = useRef<() => void>(() => {})
  const gpuRendererRef = useRef<MandelbrotGpuRenderer | null>(null)
  const workerSlotsRef = useRef<WorkerSlot[]>([])
  const workerRequestsRef = useRef(new Map<number, TileRequest>())
  const pendingRequestsRef = useRef<TileRequest[]>([])
  const currentGenerationRef = useRef(0)
  const nextRequestIdRef = useRef(0)
  const pumpWorkersRef = useRef<() => void>(() => {})
  const handleWorkerRef = useRef<(slot: WorkerSlot, response: WorkerResponse) => void>(() => {})
  const queueGpuRef = useRef<(request: TileRequest, reference: RefEntry) => void>(() => {})
  const flushGpuRef = useRef<() => void>(() => {})
  const gpuBatchRef = useRef<GpuQueueItem[]>([])
  const gpuBatchTimerRef = useRef<number | null>(null)
  const gpuFlushingRef = useRef(false)
  const scheduleRenderRef = useRef<(force?: boolean) => void>(() => {})
  const idleTimerRef = useRef<number | null>(null)
  const throttleTimerRef = useRef<number | null>(null)
  const transitionFrameRef = useRef<number | null>(null)
  const cameraMeasureFrameRef = useRef<number | null>(null)
  const measuredGestureRef = useRef<number | null>(null)
  const transitionActiveRef = useRef(false)
  const lastScheduleAtRef = useRef(0)
  const sourceRef = useRef<'fast' | 'gpu' | 'cpu' | 'none'>('none')
  const renderedViewRef = useRef<View | null>(null)
  const viewRef = useRef<View>(stateFromUrl?.view ? importedView(stateFromUrl) : { ...defaults })
  const cpuBaseViewRef = useRef<View | null>(null)
  const tileLayerViewRef = useRef<View | null>(null)
  const drag = useRef<Drag | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const focusRef = useRef({ x: 0, y: 0 })
  const navigationInputAtRef = useRef<number | null>(null)
  const cameraResponseMsRef = useRef<number | null>(null)
  const referenceCacheRef = useRef(new Map<string, RefEntry>())
  const referenceCacheBytesRef = useRef(0)
  const cpuTileCacheRef = useRef(new Map<string, PixelEntry>())
  const cpuTileCacheBytesRef = useRef(0)
  const currentCpuTilesRef = useRef<TileRequest[]>([])
  const completedSlotsRef = useRef(new Set<number>())
  const repairPendingRef = useRef(new Map<number, number>())
  const metricRef = useRef<Metrics>({ generation: 0, backend: 'initializing', partial: false, startedAt: 0, cameraResponseMs: null, firstTileMs: null, fullRenderMs: null, tilesTotal: 0, tilesComplete: 0, workerReferenceMs: 0, cpuRenderMs: 0, gpuUploadMs: 0, gpuCompletionMs: 0, cacheHits: 0, glitchRepairs: 0 })

  const [view, setView] = useState<View>(() => stateFromUrl?.view ? importedView(stateFromUrl) : { ...defaults })
  const [iterations, setIterations] = useState(() => Math.max(160, Math.min(4000, Number(stateFromUrl?.iterations) || 680)))
  const [palette, setPalette] = useState(() => typeof stateFromUrl?.palette === 'string' ? stateFromUrl.palette : 'abyss')
  const [mode, setMode] = useState<'mandelbrot' | 'julia'>(() => stateFromUrl?.mode === 'julia' ? 'julia' : 'mandelbrot')
  const [preset, setPreset] = useState(() => {
    const imported = stateFromUrl?.view ? importedView(stateFromUrl) : defaults
    const found = Object.entries(presets).find(([, candidate]) => candidate.x === imported.x && candidate.y === imported.y && candidate.zoom.mantissa === imported.zoom.mantissa && candidate.zoom.exponent === imported.zoom.exponent)
    return found?.[0] || (stateFromUrl?.view ? 'custom' : 'overview')
  })
  const [raster, setRaster] = useState<Raster>({ width: 1, height: 1 })
  const [fastSupported, setFastSupported] = useState(true)
  const [gpuReady, setGpuReady] = useState(false)
  const [workersReady, setWorkersReady] = useState(false)
  const [renderStatus, setRenderStatus] = useState('')
  const config = useRef({ view, iterations, palette, mode })
  config.current = { view, iterations, palette, mode }
  const rasterRef = useRef(raster)
  rasterRef.current = raster
  viewRef.current = view
  const deepActive = deepView(view) || !fastSupported
  const paletteIndex = ({ abyss: 0, mineral: 1, twilight: 2, ice: 3, ember: 4 } as Record<string, number>)[palette] ?? 0
  const tilePreviewRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => { onShareState({ view, iterations, palette, mode }) }, [view, iterations, palette, mode, onShareState])

  const cacheReference = (key: string, values: Float32Array, exponents: Int32Array) => {
    const bytes = values.byteLength + exponents.byteLength
    if (bytes > 32 * 1024 * 1024) return
    const old = referenceCacheRef.current.get(key)
    if (old) { referenceCacheBytesRef.current -= old.bytes; referenceCacheRef.current.delete(key) }
    while (referenceCacheBytesRef.current + bytes > 32 * 1024 * 1024 && referenceCacheRef.current.size) {
      const oldest = [...referenceCacheRef.current.entries()].reduce((a, b) => a[1].used < b[1].used ? a : b)
      referenceCacheBytesRef.current -= oldest[1].bytes
      referenceCacheRef.current.delete(oldest[0])
    }
    referenceCacheRef.current.set(key, { values, exponents, bytes, used: performance.now() })
    referenceCacheBytesRef.current += bytes
  }
  const cachedReference = (key: string) => {
    const cached = referenceCacheRef.current.get(key)
    if (cached) cached.used = performance.now()
    return cached
  }
  const cacheCpuTile = (key: string, pixels: Uint8ClampedArray) => {
    const bytes = pixels.byteLength
    if (bytes > 16 * 1024 * 1024) return
    const old = cpuTileCacheRef.current.get(key)
    if (old) { cpuTileCacheBytesRef.current -= old.bytes; cpuTileCacheRef.current.delete(key) }
    while (cpuTileCacheBytesRef.current + bytes > 16 * 1024 * 1024 && cpuTileCacheRef.current.size) {
      const oldest = [...cpuTileCacheRef.current.entries()].reduce((a, b) => a[1].used < b[1].used ? a : b)
      cpuTileCacheBytesRef.current -= oldest[1].bytes
      cpuTileCacheRef.current.delete(oldest[0])
    }
    cpuTileCacheRef.current.set(key, { pixels, bytes, used: performance.now() })
    cpuTileCacheBytesRef.current += bytes
  }

  const setCanvasWarp = (canvas: HTMLCanvasElement | null, from: View | null, to: View) => {
    if (!canvas || !from) return false
    const warp = previewTransform(from, to, canvas.height)
    if (!warp.scale) { canvas.style.transform = ''; return false }
    const scaleX = canvas.clientWidth / Math.max(1, canvas.width)
    const scaleY = canvas.clientHeight / Math.max(1, canvas.height)
    canvas.style.transformOrigin = 'center center'
    canvas.style.transform = `translate3d(${warp.x * scaleX}px, ${warp.y * scaleY}px, 0) scale(${warp.scale})`
    return true
  }

  const drawCpuTile = (request: TileRequest, pixels: Uint8ClampedArray, repair: boolean) => {
    const base = cpuCanvasRef.current
    const layer = repairCanvasRef.current
    const requestView = { x: request.x, y: request.y, zoom: request.zoom }
    if (!base || !layer || request.width !== base.width || request.height !== base.height) return
    if (request.generation !== currentGenerationRef.current && (request.mode !== config.current.mode || request.palette !== config.current.palette)) return
    let tileCanvas = tilePreviewRef.current
    if (!tileCanvas) { tileCanvas = document.createElement('canvas'); tilePreviewRef.current = tileCanvas }
    if (tileCanvas.width !== request.tile.width || tileCanvas.height !== request.tile.height) {
      tileCanvas.width = request.tile.width
      tileCanvas.height = request.tile.height
    }
    const tileContext = tileCanvas.getContext('2d', { alpha: false })
    const context = layer.getContext('2d', { alpha: true })
    if (!tileContext || !context) return
    if (!tileLayerViewRef.current) {
      tileLayerViewRef.current = { ...viewRef.current }
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, layer.width, layer.height)
    }
    tileContext.putImageData(new ImageData(pixels, request.tile.width, request.tile.height), 0, 0)
    let layerView = tileLayerViewRef.current
    let warp = previewTransform(requestView, layerView, layer.height)
    if ((!warp.scale || warp.scale < 0.25 || warp.scale > 4) && request.generation === currentGenerationRef.current) {
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, layer.width, layer.height)
      layerView = { ...viewRef.current }
      tileLayerViewRef.current = layerView
      warp = previewTransform(requestView, layerView, layer.height)
    }
    if (!warp.scale) return
    const cx = layer.width / 2, cy = layer.height / 2
    context.save()
    context.setTransform(warp.scale, 0, 0, warp.scale, cx * (1 - warp.scale) + warp.x, cy * (1 - warp.scale) + warp.y)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(tileCanvas, request.tile.x, request.tile.y)
    context.restore()
    setCanvasWarp(layer, layerView, viewRef.current)
    if (repair && gpuRendererRef.current) sourceRef.current = 'gpu'
    else if (!gpuRendererRef.current) sourceRef.current = 'cpu'
  }

  const promoteCpuTiles = () => {
    const base = cpuCanvasRef.current
    const layer = repairCanvasRef.current
    if (!base || !layer) return
    const context = base.getContext('2d', { alpha: false })
    if (!context) return
    const current = viewRef.current
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.fillStyle = '#06101a'
    context.fillRect(0, 0, base.width, base.height)
    // Reassemble the finished frame from the exact tile cache. This avoids
    // any dependence on a preview canvas that may have been cleared or
    // reprojected while a render generation was in flight.
    const imageData = currentCpuTilesRef.current
    for (const request of imageData) {
      const entry = cpuTileCacheRef.current.get(request.tileKey)
      if (!entry) continue
      context.putImageData(new ImageData(entry.pixels, request.tile.width, request.tile.height), request.tile.x, request.tile.y)
    }
    base.style.transform = ''
    layer.style.transform = ''
    layer.getContext('2d')?.clearRect(0, 0, layer.width, layer.height)
    cpuBaseViewRef.current = { ...current }
    tileLayerViewRef.current = null
    renderedViewRef.current = { ...current }
    sourceRef.current = 'cpu'
  }

  const completeTile = (request: TileRequest) => {
    const slot = request.tile.slot
    if (request.tile.level === 0) completedSlotsRef.current.add(slot)
    else {
      const remaining = (repairPendingRef.current.get(slot) || 0) - 1
      if (remaining <= 0) { repairPendingRef.current.delete(slot); completedSlotsRef.current.add(slot) }
      else repairPendingRef.current.set(slot, remaining)
    }
    const metrics = metricRef.current
    if (metrics.generation === request.generation) {
      metrics.firstTileMs ??= performance.now() - metrics.startedAt
      metrics.tilesComplete = completedSlotsRef.current.size
      const total = Math.max(1, metrics.tilesTotal)
      const percent = metrics.tilesComplete >= total ? 100 : Math.max(1, Math.floor(metrics.tilesComplete * 100 / total))
      if (metrics.tilesComplete >= total) {
        if (!metrics.partial) {
          if (metrics.backend === 'cpu') promoteCpuTiles()
          metrics.fullRenderMs ??= performance.now() - metrics.startedAt
        }
        setRenderStatus('')
      } else setRenderStatus(`${metrics.backend.toUpperCase()} · ${percent}%`)
      publishMetrics()
    }
  }

  function publishMetrics() {
    if (!import.meta.env.DEV) return
    const target = window as unknown as { __ARMSTEEL_MANDELBROT__?: Record<string, unknown> }
    target.__ARMSTEEL_MANDELBROT__ = {
      ...metricRef.current,
      referenceCacheBytes: referenceCacheBytesRef.current,
      cpuTileCacheBytes: cpuTileCacheBytesRef.current,
      gpuTileCacheBytes: gpuRendererRef.current?.tileCacheBytes || 0,
      zoom: { ...viewRef.current.zoom },
      center: { x: viewRef.current.x, y: viewRef.current.y },
    }
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const target = window as unknown as { __ARMSTEEL_MANDELBROT__?: Record<string, unknown> }
    return () => { delete target.__ARMSTEEL_MANDELBROT__ }
  }, [])

  queueGpuRef.current = (request, reference) => {
    const scale = binaryScaleForPixel(request.zoom, request.height)
    const tile: GpuTile = {
      cacheKey: request.tileKey,
      slot: request.tile.slot,
      x: request.tile.x,
      y: request.tile.y,
      width: request.tile.width,
      height: request.tile.height,
      reference: reference.values,
      referenceExponents: reference.exponents,
      scaleMantissa: scale.mantissa,
      scaleExponent: scale.exponent,
      iterations: request.iterations,
      mode: request.mode,
    }
    gpuBatchRef.current.push({ request, tile })
    if (gpuBatchTimerRef.current === null) gpuBatchTimerRef.current = window.setTimeout(() => flushGpuRef.current(), 0)
  }

  flushGpuRef.current = async () => {
    if (gpuFlushingRef.current) return
    if (gpuBatchTimerRef.current !== null) { window.clearTimeout(gpuBatchTimerRef.current); gpuBatchTimerRef.current = null }
    const renderer = gpuRendererRef.current
    if (!renderer || !gpuBatchRef.current.length) return
    const items = gpuBatchRef.current.splice(0, 4)
    const current = items.filter((item) => item.request.generation === currentGenerationRef.current)
    if (!current.length) { if (gpuBatchRef.current.length) gpuBatchTimerRef.current = window.setTimeout(() => flushGpuRef.current(), 0); return }
    gpuFlushingRef.current = true
    try {
      const stats = await renderer.renderBatch(current.map((item) => item.tile))
      for (const index of stats.glitchIndices) {
        const item = current[index]
        const request = item.request
        if (request.generation !== currentGenerationRef.current) continue
        metricRef.current.glitchRepairs++
        const children = splitTile(request.tile)
        if (!repairPendingRef.current.has(request.tile.slot)) repairPendingRef.current.set(request.tile.slot, 1)
        if (!children.length) {
          const exactRepair = { ...request, id: ++nextRequestIdRef.current, tile: request.tile, tileKey: tileKey(request, { width: request.width, height: request.height }, request.mode, request.iterations, request.tile, request.palette), target: 'cpu' as const }
          repairPendingRef.current.set(request.tile.slot, (repairPendingRef.current.get(request.tile.slot) || 1))
          pendingRequestsRef.current.push(exactRepair)
          continue
        }
        repairPendingRef.current.set(request.tile.slot, (repairPendingRef.current.get(request.tile.slot) || 1) - 1 + children.length)
        for (const child of children) {
          const childKey = tileKey(request, { width: request.width, height: request.height }, request.mode, request.iterations, child)
          const childRequest: TileRequest = { ...request, id: ++nextRequestIdRef.current, tile: child, tileKey: childKey }
          const cached = cachedReference(childKey)
          if (cached) queueGpuRef.current(childRequest, cached)
          else pendingRequestsRef.current.push(childRequest)
        }
      }
      const glitchSet = new Set(stats.glitchIndices)
      current.forEach((item, index) => {
        if (glitchSet.has(index)) return
        completeTile(item.request)
      })
      const metrics = metricRef.current
      if (metrics.generation === currentGenerationRef.current) {
        metrics.gpuUploadMs += stats.uploadMs
        metrics.gpuCompletionMs += stats.completionMs
        if (metrics.firstTileMs === null) metrics.firstTileMs = performance.now() - metrics.startedAt
        publishMetrics()
      }
      sourceRef.current = 'gpu'
    } catch (error) {
      const lost = gpuRendererRef.current
      gpuRendererRef.current = null
      lost?.destroy()
      setGpuReady(false)
      setRenderStatus(error instanceof Error ? 'GPU unavailable · switching to CPU tiles' : 'Switching to CPU tiles')
    } finally {
      gpuFlushingRef.current = false
      if (pendingRequestsRef.current.length) pumpWorkersRef.current()
      if (gpuBatchRef.current.length) gpuBatchTimerRef.current = window.setTimeout(() => flushGpuRef.current(), 0)
    }
  }

  pumpWorkersRef.current = () => {
    const slots = workerSlotsRef.current
    if (!slots.length) return
    // During active navigation, leave CPU headroom for camera transforms and
    // input. Restore the full worker pool as soon as the gesture settles.
    const navigating = transitionActiveRef.current || navigationInputAtRef.current !== null
    const activeSlots = navigating ? Math.max(1, Math.ceil(slots.length / 2)) : slots.length
    for (const slot of slots.slice(0, activeSlots)) {
      if (slot.busy) continue
      const index = pendingRequestsRef.current.findIndex((request) => request.generation === currentGenerationRef.current)
      if (index < 0) break
      const request = pendingRequestsRef.current.splice(index, 1)[0]
      slot.busy = true
      slot.requestId = request.id
      workerRequestsRef.current.set(request.id, request)
      slot.worker.postMessage(request)
    }
  }

  handleWorkerRef.current = (slot, response) => {
    slot.busy = false
    slot.requestId = undefined
    const request = workerRequestsRef.current.get(response.id)
    workerRequestsRef.current.delete(response.id)
    if (response.kind === 'error') {
      if (response.generation === currentGenerationRef.current) setRenderStatus(response.message || 'A fractal tile could not be calculated.')
      pumpWorkersRef.current()
      return
    }
    if (response.kind === 'cancelled' || !request) { pumpWorkersRef.current(); return }
    if (response.kind === 'reference' && response.reference && response.referenceExponents) {
      const values = new Float32Array(response.reference)
      const exponents = new Int32Array(response.referenceExponents)
      cacheReference(request.tileKey, values, exponents)
      if (response.generation === currentGenerationRef.current && gpuRendererRef.current) {
        metricRef.current.workerReferenceMs += response.referenceMs || 0
        queueGpuRef.current(request, { values, exponents, bytes: values.byteLength + exponents.byteLength, used: performance.now() })
      }
    } else if (response.kind === 'cpu-tile' && response.pixels) {
      const pixels = new Uint8ClampedArray(response.pixels)
      if (request.target === 'cpu') cacheCpuTile(request.tileKey, pixels)
      if (response.generation === currentGenerationRef.current) {
        metricRef.current.cpuRenderMs += response.renderMs || 0
        if (metricRef.current.firstTileMs === null) metricRef.current.firstTileMs = performance.now() - metricRef.current.startedAt
        const isRepair = request.tile.level > 0 && !!gpuRendererRef.current
        drawCpuTile(request, pixels, isRepair)
        completeTile(request)
        publishMetrics()
      } else if (!gpuRendererRef.current) {
        drawCpuTile(request, pixels, false)
      }
    }
    pumpWorkersRef.current()
  }

  useEffect(() => {
    const slots: WorkerSlot[] = []
    // Deep tile work is BigInt-heavy. Two workers keep useful throughput
    // without consuming every core while the camera and the rest of the page are live.
    const count = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 4) - 1))
    try {
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('../workers/mandelbrot.worker.ts', import.meta.url), { type: 'module' })
        const slot: WorkerSlot = { worker, busy: false }
        worker.onmessage = (event: MessageEvent<WorkerResponse>) => handleWorkerRef.current(slot, event.data)
        worker.onerror = () => {
          const failed = workerRequestsRef.current.get(slot.requestId || -1)
          if (failed?.generation === currentGenerationRef.current) pendingRequestsRef.current.unshift(failed)
          if (slot.requestId) workerRequestsRef.current.delete(slot.requestId)
          slot.busy = false; slot.requestId = undefined
          worker.terminate()
          workerSlotsRef.current = workerSlotsRef.current.filter((candidate) => candidate !== slot)
          setRenderStatus(workerSlotsRef.current.length ? 'A rendering worker stopped · continuing with remaining capacity' : 'Rendering workers stopped · reset the view to retry')
          pumpWorkersRef.current()
        }
        slots.push(slot)
      }
      workerSlotsRef.current = slots
      setWorkersReady(true)
    } catch {
      for (const slot of slots) slot.worker.terminate()
      workerSlotsRef.current = []
      setWorkersReady(false)
      setRenderStatus('Background rendering is unavailable in this browser.')
    }
    return () => {
      for (const slot of slots) slot.worker.terminate()
      workerSlotsRef.current = []
      workerRequestsRef.current.clear()
      pendingRequestsRef.current = []
    }
  }, [])

  useEffect(() => {
    let canceled = false
    const canvas = gpuCanvasRef.current
    if (!canvas) return
    let lease: ReturnType<typeof acquireMandelbrotGpuRenderer> | null = null
    // Deferring acquisition by one task lets React StrictMode's development
    // setup/cleanup probe cancel before allocating a GPUDevice or configuring
    // the canvas. Otherwise two adapters can race for the same canvas context.
    const initTimer = window.setTimeout(() => {
      lease = acquireMandelbrotGpuRenderer(canvas, () => {
        if (canceled) return
        gpuRendererRef.current = null
        lease?.release()
        setGpuReady(false)
        setRenderStatus('Graphics device lost · switching to CPU tiles')
      })
      void lease.promise.then((renderer) => {
        if (canceled) return
        const currentRaster = rasterRef.current
        if (currentRaster.width > 1 && currentRaster.height > 1) renderer.resize(currentRaster.width, currentRaster.height)
        gpuRendererRef.current = renderer
        setGpuReady(true)
      }).catch((error) => {
        if (canceled) return
        gpuRendererRef.current = null
        setGpuReady(false)
        setRenderStatus(error instanceof Error ? 'CPU progressive renderer · WebGPU unavailable' : 'CPU progressive renderer')
      })
    }, 0)
    return () => {
      canceled = true
      window.clearTimeout(initTimer)
      lease?.release()
      gpuRendererRef.current = null
    }
  }, [])

  useEffect(() => {
    const canvas = fastCanvasRef.current
    if (!canvas) return
    let gl: WebGL2RenderingContext | null = null
    let program: WebGLProgram | null = null
    let vertex: WebGLShader | null = null
    let fragment: WebGLShader | null = null
    let locations: Record<string, WebGLUniformLocation | null> = {}
    try {
      gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' })
      if (!gl) throw new Error('WebGL 2 unavailable')
      const activeGl = gl
      vertex = compile(gl, gl.VERTEX_SHADER, vertexShader)
      fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentShader)
      const created = gl.createProgram()
      if (!created) throw new Error('Could not create a fractal program')
      program = created
      gl.attachShader(created, vertex)
      gl.attachShader(created, fragment)
      gl.linkProgram(created)
      if (!gl.getProgramParameter(created, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(created) || 'Could not link the fractal shader')
      locations = Object.fromEntries(['uResolution', 'uCenter', 'uZoom', 'uIterations', 'uPalette', 'uJulia', 'uJuliaC'].map((name) => [name, activeGl.getUniformLocation(created, name)]))
      setFastSupported(true)
    } catch {
      setFastSupported(false)
    }
    const draw = () => {
      const state = config.current
      if (!gl || !program || !canvas.width || !canvas.height || deepView(state.view)) return
      gl.useProgram(program)
      gl.uniform2f(locations.uResolution, canvas.width, canvas.height)
      gl.uniform2f(locations.uCenter, Number(state.view.x), Number(state.view.y))
      gl.uniform1f(locations.uZoom, magnificationAsNumber(state.view.zoom))
      gl.uniform1i(locations.uIterations, state.iterations)
      gl.uniform1i(locations.uPalette, ({ abyss: 0, mineral: 1, twilight: 2, ice: 3, ember: 4 } as Record<string, number>)[state.palette] ?? 0)
      gl.uniform1i(locations.uJulia, state.mode === 'julia' ? 1 : 0)
      gl.uniform2f(locations.uJuliaC, -0.745, 0.186)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      canvas.style.transform = ''
      sourceRef.current = 'fast'
      renderedViewRef.current = { ...state.view }
    }
    fastDraw.current = draw
    const resize = () => {
      const rect = surfaceRect(canvas)
      if (!rect.width || !rect.height) return
      const density = Math.min(devicePixelRatio || 1, 2, Math.sqrt(2_600_000 / (rect.width * rect.height)))
      const width = Math.max(1, Math.floor(rect.width * density))
      const height = Math.max(1, Math.floor(rect.height * density))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      let resetCpuLayers = false
      for (const target of [cpuCanvasRef.current, repairCanvasRef.current]) if (target && (target.width !== width || target.height !== height)) { target.width = width; target.height = height; resetCpuLayers = true }
      if (resetCpuLayers) {
        cpuBaseViewRef.current = null
        tileLayerViewRef.current = null
        if (cpuCanvasRef.current) cpuCanvasRef.current.style.transform = ''
        if (repairCanvasRef.current) repairCanvasRef.current.style.transform = ''
      }
      if (gpuRendererRef.current && (gpuCanvasRef.current?.width !== width || gpuCanvasRef.current?.height !== height)) gpuRendererRef.current.resize(width, height)
      else if (gpuCanvasRef.current && !gpuRendererRef.current && (gpuCanvasRef.current.width !== width || gpuCanvasRef.current.height !== height)) { gpuCanvasRef.current.width = width; gpuCanvasRef.current.height = height }
      gl?.viewport(0, 0, width, height)
      setRaster((old) => old.width === width && old.height === height ? old : { width, height })
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    return () => {
      observer.disconnect()
      fastDraw.current = () => {}
      if (gl && program) gl.deleteProgram(program)
      if (gl && vertex) gl.deleteShader(vertex)
      if (gl && fragment) gl.deleteShader(fragment)
    }
  }, [])

  useEffect(() => {
    if (gpuReady && gpuRendererRef.current && raster.width > 1 && raster.height > 1 && (gpuCanvasRef.current?.width !== raster.width || gpuCanvasRef.current?.height !== raster.height)) {
      gpuRendererRef.current.resize(raster.width, raster.height)
    }
  }, [gpuReady, raster])

  const scheduleRender = (force = false) => {
    if (!workersReady || !raster.width || !raster.height || !deepView(config.current.view) && fastSupported) return
    const now = performance.now()
    if (!force && now - lastScheduleAtRef.current < 84) {
      if (throttleTimerRef.current !== null) window.clearTimeout(throttleTimerRef.current)
      throttleTimerRef.current = window.setTimeout(() => {
        throttleTimerRef.current = null
        scheduleRenderRef.current(true)
      }, Math.max(0, 84 - (now - lastScheduleAtRef.current)))
      return
    }
    if (throttleTimerRef.current !== null) { window.clearTimeout(throttleTimerRef.current); throttleTimerRef.current = null }
    const generation = ++currentGenerationRef.current
    pendingRequestsRef.current = []
    gpuBatchRef.current = []
    const active = config.current
    const target = gpuRendererRef.current ? 'gpu' : 'cpu'
    // Stop obsolete work on each new camera generation. Reference generation
    // and CPU tile rows yield cooperatively, so rapid input frees a worker
    // promptly instead of accumulating expensive stale renders.
    for (const slot of workerSlotsRef.current) slot.worker.postMessage({ action: 'cancel', generation })
    lastScheduleAtRef.current = now
    const iterationsAtView = iterationsAtZoom(active.iterations, active.view.zoom)
    const tileSize = target === 'gpu' ? gpuRendererRef.current?.getTileSize() || 64 : 32
    const focus = focusRef.current
    const scaledFocusX = focus.x || raster.width / 2
    const scaledFocusY = focus.y || raster.height / 2
    const motionBatch = transitionActiveRef.current || navigationInputAtRef.current !== null
    const prioritizedTiles = tilesFor(raster.width, raster.height, tileSize, scaledFocusX, scaledFocusY)
    // Keep the camera responsive during wheel, drag and preset motion. Render
    // a cursor-centred patch at each scheduling beat, then fill the viewport
    // once the gesture settles; stale completed tiles remain cached/reusable.
    const tiles = motionBatch ? prioritizedTiles.slice(0, 20) : prioritizedTiles
    currentCpuTilesRef.current = []
    completedSlotsRef.current = new Set()
    repairPendingRef.current.clear()
    const metric: Metrics = {
      generation,
      backend: target === 'gpu' ? 'webgpu' : 'cpu',
      partial: motionBatch,
      startedAt: now,
      cameraResponseMs: cameraResponseMsRef.current,
      firstTileMs: null,
      fullRenderMs: null,
      tilesTotal: tiles.length,
      tilesComplete: 0,
      workerReferenceMs: 0,
      cpuRenderMs: 0,
      gpuUploadMs: 0,
      gpuCompletionMs: 0,
      cacheHits: 0,
      glitchRepairs: 0,
    }
    metricRef.current = metric
    setRenderStatus(`${metric.backend.toUpperCase()} · 0%`)
    publishMetrics()
    const restoreItems: { cacheKey: string; tile: Tile }[] = []
    for (const tile of tiles) {
      const key = tileKey(active.view, raster, active.mode, iterationsAtView, tile, target === 'cpu' ? active.palette : '')
      const request: TileRequest = {
        id: ++nextRequestIdRef.current,
        generation,
        action: 'prepare',
        tileKey: key,
        x: active.view.x,
        y: active.view.y,
        zoom: active.view.zoom,
        width: raster.width,
        height: raster.height,
        tile,
        iterations: iterationsAtView,
        mode: active.mode,
        palette: active.palette,
        target,
      }
      if (target === 'cpu') currentCpuTilesRef.current.push(request)
      if (target === 'gpu') {
        if (gpuRendererRef.current?.hasCachedTile(key)) {
          restoreItems.push({ cacheKey: key, tile })
          metric.cacheHits++
          completeTile(request)
        } else {
          const reference = cachedReference(key)
          if (reference) { metric.cacheHits++; queueGpuRef.current(request, reference) }
          else pendingRequestsRef.current.push(request)
        }
      } else {
        const cached = cpuTileCacheRef.current.get(key)
        if (cached) {
          cached.used = now
          metric.cacheHits++
          drawCpuTile(request, cached.pixels, false)
          completeTile(request)
        } else pendingRequestsRef.current.push(request)
      }
    }
    gpuRendererRef.current?.restoreCachedTiles(restoreItems)
    if (metric.tilesComplete >= metric.tilesTotal) setRenderStatus('')
    pumpWorkersRef.current()
    if (gpuBatchRef.current.length && gpuBatchTimerRef.current === null) gpuBatchTimerRef.current = window.setTimeout(() => flushGpuRef.current(), 0)
  }
  scheduleRenderRef.current = scheduleRender

  const paintCpuPreview = (next: View) => {
    const canvas = cpuCanvasRef.current
    const context = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !context) return
    const from = renderedViewRef.current
    if (sourceRef.current !== 'cpu' || !cpuBaseViewRef.current) {
      let source: HTMLCanvasElement | null = null
      if (sourceRef.current === 'fast') source = fastCanvasRef.current
      else if (sourceRef.current === 'gpu') source = gpuCanvasRef.current
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.fillStyle = '#06101a'
      context.fillRect(0, 0, canvas.width, canvas.height)
      if (source && from) {
        try { context.drawImage(source, 0, 0, canvas.width, canvas.height) } catch { /* A lost GPU surface has no readable preview. */ }
      }
      cpuBaseViewRef.current = from ? { ...from } : { ...next }
      const layerContext = repairCanvasRef.current?.getContext('2d')
      layerContext?.clearRect(0, 0, canvas.width, canvas.height)
      tileLayerViewRef.current = null
    }
    if (!setCanvasWarp(canvas, cpuBaseViewRef.current, next)) {
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.fillStyle = '#06101a'
      context.fillRect(0, 0, canvas.width, canvas.height)
      cpuBaseViewRef.current = { ...next }
      const layerContext = repairCanvasRef.current?.getContext('2d')
      layerContext?.clearRect(0, 0, canvas.width, canvas.height)
      tileLayerViewRef.current = null
    } else if (tileLayerViewRef.current) {
      const layerWarp = previewTransform(tileLayerViewRef.current, next, canvas.height)
      if (!layerWarp.scale || layerWarp.scale < 0.25 || layerWarp.scale > 4) {
        repairCanvasRef.current?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
        if (repairCanvasRef.current) repairCanvasRef.current.style.transform = ''
        tileLayerViewRef.current = null
      } else setCanvasWarp(repairCanvasRef.current, tileLayerViewRef.current, next)
    }
    renderedViewRef.current = { ...next }
    sourceRef.current = 'cpu'
  }

  const reprojectFastPreview = (next: View) => {
    const canvas = fastCanvasRef.current
    const from = renderedViewRef.current
    if (!canvas || !from || sourceRef.current !== 'fast') return false
    const warp = previewTransform(from, next, canvas.height)
    if (!warp.scale) return false
    const scaleX = canvas.clientWidth / Math.max(1, canvas.width)
    const scaleY = canvas.clientHeight / Math.max(1, canvas.height)
    canvas.style.transformOrigin = 'center center'
    canvas.style.transform = `translate3d(${warp.x * scaleX}px, ${warp.y * scaleY}px, 0) scale(${warp.scale})`
    return true
  }

  useLayoutEffect(() => {
    if (deepActive) {
      const previous = renderedViewRef.current
      const warp = previous ? previewTransform(previous, view, raster.height) : { scale: 0, x: 0, y: 0 }
      if (gpuRendererRef.current) {
        let source: HTMLCanvasElement | undefined
        if (sourceRef.current === 'fast') source = fastCanvasRef.current || undefined
        else if (sourceRef.current === 'cpu') source = cpuCanvasRef.current || undefined
        gpuRendererRef.current.moveCamera(warp, source)
        repairCanvasRef.current?.getContext('2d')?.clearRect(0, 0, raster.width, raster.height)
        if (repairCanvasRef.current) repairCanvasRef.current.style.transform = ''
        tileLayerViewRef.current = null
        sourceRef.current = 'gpu'
        renderedViewRef.current = { ...view }
      } else paintCpuPreview(view)
      const moving = transitionActiveRef.current || navigationInputAtRef.current !== null
      scheduleRenderRef.current(!moving)
    } else {
      const navigating = transitionActiveRef.current || navigationInputAtRef.current !== null || drag.current !== null
      if (navigating && reprojectFastPreview(view)) {
        // Keep the last native-resolution image as an immediate camera preview.
        // A settled render replaces it after the gesture, so input never waits
        // for a full-screen escape-time pass.
      } else {
        fastDraw.current()
        renderedViewRef.current = { ...view }
        sourceRef.current = 'fast'
      }
      if (!deepView(view)) setRenderStatus('')
    }
    if (navigationInputAtRef.current !== null && measuredGestureRef.current !== navigationInputAtRef.current) {
      const startedAt = navigationInputAtRef.current
      measuredGestureRef.current = startedAt
      if (cameraMeasureFrameRef.current !== null) cancelAnimationFrame(cameraMeasureFrameRef.current)
      cameraMeasureFrameRef.current = requestAnimationFrame(() => {
        cameraMeasureFrameRef.current = null
        cameraResponseMsRef.current = performance.now() - startedAt
        metricRef.current.cameraResponseMs = cameraResponseMsRef.current
        publishMetrics()
      })
    }
    // The event path updates viewRef synchronously; this layout effect only moves the camera and queues tiles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepActive, view, iterations, mode, raster, gpuReady, workersReady])

  useEffect(() => {
    if (deepActive && gpuRendererRef.current) gpuRendererRef.current.setPalette(paletteIndex)
    else if (deepActive && workersReady && !gpuRendererRef.current) scheduleRenderRef.current(true)
  }, [palette, paletteIndex, deepActive, gpuReady, workersReady])

  function commitView(next: View, mark = true) {
    const normalized = normalizeViewCoordinate(next.x, next.y, next.zoom)
    viewRef.current = normalized
    config.current = { ...config.current, view: normalized }
    setView(normalized)
    if (mark) setPreset('custom')
  }

  const cancelTransition = () => {
    if (transitionFrameRef.current !== null) cancelAnimationFrame(transitionFrameRef.current)
    if (cameraMeasureFrameRef.current !== null) cancelAnimationFrame(cameraMeasureFrameRef.current)
    transitionFrameRef.current = null
    transitionActiveRef.current = false
  }
  const scheduleSettledRender = () => {
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null
      navigationInputAtRef.current = null
      if (deepView(config.current.view) || !fastSupported) scheduleRenderRef.current(true)
      else {
        fastDraw.current()
        renderedViewRef.current = { ...config.current.view }
        sourceRef.current = 'fast'
      }
    }, 220)
  }

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const canvas = fastCanvasRef.current
    if (!canvas) return
    cancelTransition()
    if (navigationInputAtRef.current === null) { navigationInputAtRef.current = performance.now(); cameraResponseMsRef.current = null }
    const rect = surfaceRect(canvas)
    const current = viewRef.current
    const nextZoom = multiplyMagnification(current.zoom, factor)
    if (magnificationLog10(nextZoom) < Math.log10(0.72)) return
    const digits = precisionDigits(nextZoom)
    const oldX = parseFixed(current.x, digits), oldY = parseFixed(current.y, digits)
    const dx = clientX - rect.left - rect.width / 2
    const dy = rect.height / 2 - (clientY - rect.top)
    focusRef.current = { x: (clientX - rect.left) * raster.width / Math.max(1, rect.width), y: (clientY - rect.top) * raster.height / Math.max(1, rect.height) }
    const worldX = oldX + coordinateOffset(dx, rect.height, current.zoom, digits)
    const worldY = oldY + coordinateOffset(dy, rect.height, current.zoom, digits)
    const nextX = worldX - coordinateOffset(dx, rect.height, nextZoom, digits)
    const nextY = worldY - coordinateOffset(dy, rect.height, nextZoom, digits)
    commitView({ x: formatFixed(nextX, digits), y: formatFixed(nextY, digits), zoom: nextZoom })
    scheduleSettledRender()
  }
  const onWheel = (event: globalThis.WheelEvent) => {
    event.preventDefault()
    zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.00135))
  }
  useEffect(() => {
    const canvases = [fastCanvasRef.current, gpuCanvasRef.current, cpuCanvasRef.current].filter((canvas): canvas is HTMLCanvasElement => !!canvas)
    for (const canvas of canvases) canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => { for (const canvas of canvases) canvas.removeEventListener('wheel', onWheel) }
  }, [raster.width, raster.height])
  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    cancelTransition()
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    if (navigationInputAtRef.current === null) { navigationInputAtRef.current = performance.now(); cameraResponseMsRef.current = null }
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      const points = [...pointers.current.values()]
      drag.current = { mode: 'pinch', x: 0, y: 0, view: viewRef.current, distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), centerX: (points[0].x + points[1].x) / 2, centerY: (points[0].y + points[1].y) / 2 }
    } else drag.current = { mode: 'pan', x: event.clientX, y: event.clientY, view: viewRef.current }
  }
  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(event.pointerId) || !drag.current) return
    if (navigationInputAtRef.current === null) { navigationInputAtRef.current = performance.now(); cameraResponseMsRef.current = null }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const rect = surfaceRect(event.currentTarget)
    const active = drag.current
    const digits = precisionDigits(active.view.zoom)
    const centerX = parseFixed(active.view.x, digits), centerY = parseFixed(active.view.y, digits)
    if (active.mode === 'pinch' && pointers.current.size >= 2) {
      const points = [...pointers.current.values()].slice(0, 2)
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
      const midpointX = (points[0].x + points[1].x) / 2
      const midpointY = (points[0].y + points[1].y) / 2
      const nextZoom = multiplyMagnification(active.view.zoom, distance / Math.max(1, active.distance || 1))
      const nextDigits = precisionDigits(nextZoom)
      const nextCenterX = parseFixed(active.view.x, nextDigits), nextCenterY = parseFixed(active.view.y, nextDigits)
      const beforeX = (active.centerX || midpointX) - rect.left - rect.width / 2
      const beforeY = rect.height / 2 - ((active.centerY || midpointY) - rect.top)
      const afterX = midpointX - rect.left - rect.width / 2
      const afterY = rect.height / 2 - (midpointY - rect.top)
      const worldX = nextCenterX + coordinateOffset(beforeX, rect.height, active.view.zoom, nextDigits)
      const worldY = nextCenterY + coordinateOffset(beforeY, rect.height, active.view.zoom, nextDigits)
      focusRef.current = { x: (midpointX - rect.left) * raster.width / Math.max(1, rect.width), y: (midpointY - rect.top) * raster.height / Math.max(1, rect.height) }
      commitView({
        x: formatFixed(worldX - coordinateOffset(afterX, rect.height, nextZoom, nextDigits), nextDigits),
        y: formatFixed(worldY - coordinateOffset(afterY, rect.height, nextZoom, nextDigits), nextDigits),
        zoom: nextZoom,
      })
    } else {
      const dx = event.clientX - active.x
      const dy = event.clientY - active.y
      focusRef.current = { x: (event.clientX - rect.left) * raster.width / Math.max(1, rect.width), y: (event.clientY - rect.top) * raster.height / Math.max(1, rect.height) }
      commitView({
        x: formatFixed(centerX - coordinateOffset(dx, rect.height, active.view.zoom, digits), digits),
        y: formatFixed(centerY + coordinateOffset(dy, rect.height, active.view.zoom, digits), digits),
        zoom: active.view.zoom,
      })
    }
    scheduleSettledRender()
  }
  const pointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId)
    const remaining = [...pointers.current.values()][0]
    drag.current = remaining ? { mode: 'pan', x: remaining.x, y: remaining.y, view: viewRef.current } : null
    if (!remaining) {
      navigationInputAtRef.current = null
      if (deepView(config.current.view) || !fastSupported) scheduleRenderRef.current(true)
      else {
        fastDraw.current()
        renderedViewRef.current = { ...config.current.view }
        sourceRef.current = 'fast'
      }
    }
  }

  useEffect(() => () => {
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    if (throttleTimerRef.current !== null) window.clearTimeout(throttleTimerRef.current)
    if (gpuBatchTimerRef.current !== null) window.clearTimeout(gpuBatchTimerRef.current)
    if (transitionFrameRef.current !== null) cancelAnimationFrame(transitionFrameRef.current)
  }, [])

  const transitionTo = (name: string) => {
    const destination = presets[name]
    if (!destination) return
    cancelTransition()
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    navigationInputAtRef.current = null
    setPreset(name)
    const from = viewRef.current
    const to = normalizeViewCoordinate(destination.x, destination.y, destination.zoom)
    const digits = precisionDigits(magnificationLog10(from.zoom) >= magnificationLog10(to.zoom) ? from.zoom : to.zoom)
    const ax = parseFixed(from.x, digits), ay = parseFixed(from.y, digits)
    const bx = parseFixed(to.x, digits), by = parseFixed(to.y, digits)
    const denominator = 1_000_000_000n
    const began = performance.now()
    const duration = 760
    transitionActiveRef.current = true
    const tick = (now: number) => {
      const raw = Math.min(1, (now - began) / duration)
      const t = raw * raw * (3 - 2 * raw)
      const fraction = BigInt(Math.round(t * Number(denominator)))
      const logZoom = magnificationLog10(from.zoom) + (magnificationLog10(to.zoom) - magnificationLog10(from.zoom)) * t
      commitView({
        x: formatFixed(ax + (bx - ax) * fraction / denominator, digits),
        y: formatFixed(ay + (by - ay) * fraction / denominator, digits),
        zoom: magnificationFromLog10(logZoom),
      }, false)
      if (raw < 1) transitionFrameRef.current = requestAnimationFrame(tick)
      else {
        transitionActiveRef.current = false
        transitionFrameRef.current = null
        commitView(to, false)
        if (deepView(to) || !fastSupported) scheduleRenderRef.current(true)
        else {
          fastDraw.current()
          renderedViewRef.current = { ...to }
          sourceRef.current = 'fast'
        }
      }
    }
    transitionFrameRef.current = requestAnimationFrame(tick)
  }

  const reset = () => transitionTo('overview')
  const adjustZoom = (factor: number) => {
    const rect = fastCanvasRef.current ? surfaceRect(fastCanvasRef.current) : null
    if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  return <div className="experiment-surface" onPointerDownCapture={hint.dismiss} onKeyDownCapture={hint.dismiss}>
    <canvas ref={fastCanvasRef} className="experiment-canvas fractal-canvas fractal-fast" aria-label="Mandelbrot and Julia fractal. Drag to move the view; scroll or pinch to zoom into the coastline." style={{ visibility: !deepActive ? 'visible' : 'hidden' }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} />
    <canvas ref={gpuCanvasRef} className="experiment-canvas fractal-canvas fractal-gpu" aria-label="Deep zoom fractal view. Drag to move; scroll or pinch to zoom." style={{ visibility: deepActive && gpuReady ? 'visible' : 'hidden' }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} />
    <canvas ref={cpuCanvasRef} className="experiment-canvas fractal-canvas fractal-cpu" aria-label="Deep zoom fractal view. Drag to move; scroll or pinch to zoom." style={{ visibility: deepActive && !gpuReady ? 'visible' : 'hidden' }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} />
    <canvas ref={repairCanvasRef} className="experiment-canvas fractal-repair" aria-hidden="true" />
    <div className="canvas-coordinate">Re {formatCoordinate(view.x)} <span>·</span> Im {formatCoordinate(view.y)} <span>·</span> ×{formatMagnification(view.zoom)}</div>
    {renderStatus && <span className="fractal-render-status" aria-live="polite">{renderStatus}</span>}
    {hint.visible ? <aside className="scene-nudge" id="mandelbrot-first-move" role="note"><span>Try this · The Infinite Shore</span><p>Drag to move across the coastline. Scroll or pinch to zoom in and discover smaller details.</p><button onClick={hint.dismiss} aria-label="Dismiss first-move hint">×</button></aside> : <button className="scene-nudge-reopen" onClick={hint.show} aria-label="Show interaction tip" title="Show interaction tip">i</button>}
    <ControlPanel title="The Infinite Shore" note="COMPLEX DYNAMICS" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Cartography" value={preset} options={[
        ['overview', 'The whole set'], ['seahorse', 'Seahorse valley'], ['spiral', 'The whirlpool'], ['mini', 'Miniature Mandelbrot'],
        ['filament', 'Filament lace'], ['antenna', 'Satellite antenna'], ['deep', 'Satellite filament · 10⁵⁰×'], ['custom', 'Current view'],
      ]} onChange={(name) => { if (name !== 'custom') transitionTo(name); else setPreset('custom') }} />
      <div className="segmented-control"><span>Navigate</span><div><button onClick={() => adjustZoom(1 / 1.7)} aria-label="Zoom out">−</button><button onClick={() => adjustZoom(1.7)} aria-label="Zoom in">+</button><button onClick={reset}>Reset</button></div></div>
      <Segmented label="Equation" value={mode} options={[["mandelbrot", "Mandelbrot"], ["julia", "Julia"]]} onChange={(value) => setMode(value as 'mandelbrot' | 'julia')} />
      <SelectControl label="Pigment" value={palette} options={[["abyss", "Abyss"], ["mineral", "Mineral"], ["twilight", "Twilight"], ["ice", "Ice"], ["ember", "Ember"]]} onChange={setPalette} />
      <RangeControl label="Escape detail" value={iterations} min={160} max={4000} step={40} onChange={setIterations} />
      <p className="control-note">Each pixel starts a number that is repeatedly squared and added. Points that stay bounded belong to the set; nearby colours show how quickly other points escape. Julia mode starts at each pixel and uses one fixed added number. Wheel or pinch into the cursor; drag to move.</p>
    </ControlPanel>
  </div>
}
