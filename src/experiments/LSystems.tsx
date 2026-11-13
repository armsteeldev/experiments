import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { ExperimentControls } from '../types'
import { ActionRow, ControlPanel, RangeControl, SelectControl } from '../components/Controls'
import { generateFernGeometry } from '../simulations/fern'
import type { FernGeometry, FernSegment } from '../simulations/fern'

type Preset = { name: string; axiom: string; rules: Record<string, string>; angle: number; iterations: number; max: number; step: number; taper?: number; organic?: boolean; draw: string }
type Segment = FernSegment
type Camera = { zoom: number; x: number; y: number }
type Geometry = FernGeometry
const MAX_SYMBOLS = 520_000
const MAX_SEGMENTS = 100_000
const presets: Record<string, Preset> = {
  tree: { name: 'Wind-shaped tree', axiom: 'F', rules: { F: 'F[+F]F[-F]F' }, angle: 28, iterations: 6, max: 6, step: 0.8, taper: 0.79, organic: true, draw: 'F' },
  fern: { name: 'Unfurling fern', axiom: 'X', rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' }, angle: 28, iterations: 6, max: 6, step: 0.75, taper: 0.91, organic: true, draw: 'F' },
  coral: { name: 'Branching coral', axiom: 'F', rules: { F: 'F[+F]F[-F][F]' }, angle: 22, iterations: 6, max: 6, step: 0.79, taper: 0.84, organic: true, draw: 'F' },
  fan: { name: 'Sea fan', axiom: 'X', rules: { X: 'F[+X]F[-X][+X]FX', F: 'FF' }, angle: 23, iterations: 5, max: 5, step: 0.76, taper: 0.9, organic: true, draw: 'F' },
  koch: { name: 'Folded coastline', axiom: 'F', rules: { F: 'F+F--F+F' }, angle: 60, iterations: 5, max: 6, step: 1, draw: 'F' },
  dragon: { name: 'Paper dragon', axiom: 'FX', rules: { X: 'X+YF+', Y: '-FX-Y' }, angle: 90, iterations: 12, max: 13, step: 1, draw: 'F' },
  hilbert: { name: 'Hilbert passage', axiom: 'A', rules: { A: '+BF-AFA-FB+', B: '-AF+BFB+FA-' }, angle: 90, iterations: 6, max: 7, step: 1, draw: 'F' },
  sierpinski: { name: 'Sierpiński pathway', axiom: 'A', rules: { A: 'B-A-B', B: 'A+B+A' }, angle: 60, iterations: 7, max: 8, step: 1, draw: 'AB' },
}
const palettes: Record<string, string[]> = {
  sage: ['#e1d0a6', '#b9c595', '#86b49a', '#76abb2', '#d2d2b7', '#efe1c2'],
  frost: ['#d4e5e3', '#9bc7d1', '#7ca8ca', '#a5a1d5', '#d8b8d0', '#e9d8c5'],
  ember: ['#e8cb9b', '#e7a775', '#d67f74', '#b47788', '#a196bd', '#edc6a1'],
  violet: ['#f1d2b3', '#d1a2ba', '#9c9adb', '#71afc6', '#80c6aa', '#e4d4a1'],
}

function generate(kind: string, iterations: number, angle: number, randomness: number, seed: number): Geometry {
  if (kind === 'fern') return generateFernGeometry(iterations, randomness, seed)
  const preset = presets[kind] || presets.tree
  let sentence = preset.axiom
  for (let generation = 0; generation < iterations; generation++) {
    let next = ''
    for (const symbol of sentence) {
      const replacement = preset.rules[symbol] || symbol
      if (next.length + replacement.length > MAX_SYMBOLS) break
      next += replacement
    }
    sentence = next
    if (!sentence.length) break
  }
  let randomState = seed >>> 0
  const random = () => { randomState = (randomState * 1664525 + 1013904223) >>> 0; return randomState / 4294967296 }
  const stack: { x: number; y: number; angle: number; depth: number }[] = []
  const segments: Segment[] = []
  let x = 0, y = 0, heading = -Math.PI / 2, depth = 0, maxDepth = 0
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const symbol of sentence) {
    if (preset.draw.includes(symbol)) {
      const step = preset.step * (preset.organic ? Math.pow(preset.taper ?? 0.76, depth) : 1)
      const dx = Math.cos(heading) * step, dy = Math.sin(heading) * step
      const bend = preset.organic ? (random() - 0.5) * randomness * step * 0.65 : 0
      const nx = x + dx, ny = y + dy
      segments.push({ x1: x, y1: y, cx: x + dx * 0.5 - Math.sin(heading) * bend, cy: y + dy * 0.5 + Math.cos(heading) * bend, x2: nx, y2: ny, depth, order: segments.length })
      minX = Math.min(minX, x, nx); maxX = Math.max(maxX, x, nx)
      minY = Math.min(minY, y, ny); maxY = Math.max(maxY, y, ny)
      x = nx; y = ny
      maxDepth = Math.max(maxDepth, depth)
      if (segments.length >= MAX_SEGMENTS) break
    } else if (symbol === '+') heading += (angle + (random() - 0.5) * angle * randomness) * Math.PI / 180
    else if (symbol === '-') heading -= (angle + (random() - 0.5) * angle * randomness) * Math.PI / 180
    else if (symbol === '[') { stack.push({ x, y, angle: heading, depth }); depth++; maxDepth = Math.max(maxDepth, depth) }
    else if (symbol === ']') {
      const saved = stack.pop()
      if (saved) { x = saved.x; y = saved.y; heading = saved.angle; depth = saved.depth }
    }
  }
  if (!Number.isFinite(minX)) return { segments: [], bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 }, maxDepth: 1 }
  return { segments, bounds: { minX, maxX, minY, maxY }, maxDepth: Math.max(1, maxDepth) }
}

export default function LSystems({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const initialKind = typeof stateFromUrl?.kind === 'string' && presets[stateFromUrl.kind] ? stateFromUrl.kind : 'fern'
  const [kind, setKind] = useState(initialKind)
  const [iterations, setIterations] = useState(() => Number(stateFromUrl?.iterations) || presets[initialKind].iterations)
  const [angle, setAngle] = useState(() => Number(stateFromUrl?.angle) || presets[initialKind].angle)
  const [randomness, setRandomness] = useState(() => stateFromUrl?.randomness !== undefined ? Number(stateFromUrl.randomness) : (presets[initialKind].organic ? 0.13 : 0))
  const [width, setWidth] = useState(() => Number(stateFromUrl?.width) || 2.4)
  const [palette, setPalette] = useState(() => typeof stateFromUrl?.palette === 'string' ? stateFromUrl.palette : 'sage')
  const [seed, setSeed] = useState(() => Number(stateFromUrl?.seed) || 7)
  const [camera, setCamera] = useState<Camera>(() => ({
    zoom: Math.max(0.15, Math.min(24, Number(stateFromUrl?.zoom) || 1)),
    x: Number(stateFromUrl?.panX) || 0,
    y: Number(stateFromUrl?.panY) || 0,
  }))
  const [growing, setGrowing] = useState(true)
  const [growthKey, setGrowthKey] = useState(0)
  const geometry = useMemo(() => generate(kind, iterations, angle, randomness, seed), [kind, iterations, angle, randomness, seed])
  const progress = useRef(0)
  const chunksRef = useRef<Path2D[][]>([])
  const drawRef = useRef<(state?: Camera) => void>(() => {})
  const builtGeometry = useRef<Geometry | null>(null)
  const lastGrowthKey = useRef(-1)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry
  useEffect(() => { onShareState({ kind, iterations, angle, randomness, width, palette, seed, zoom: camera.zoom, panX: camera.x, panY: camera.y }) }, [kind, iterations, angle, randomness, width, palette, seed, camera, onShareState])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    let cssWidth = 0, cssHeight = 0, dpr = 1, raf = 0
    const chunks = chunksRef.current
    const colors = palettes[palette] || palettes.sage
    const build = () => {
      const geometryNow = geometryRef.current
      const chunkSize = 850
      chunks.length = 0
      for (let start = 0; start < geometryNow.segments.length; start += chunkSize) {
        const paths = Array.from({ length: 8 }, () => new Path2D())
        const end = Math.min(geometryNow.segments.length, start + chunkSize)
        for (let i = start; i < end; i++) {
          const segment = geometryNow.segments[i]
          const tier = presets[kind]?.organic
            ? Math.min(7, Math.floor(segment.depth / Math.max(1, geometryNow.maxDepth) * 7))
            : Math.min(7, Math.floor(segment.order / Math.max(1, geometryNow.segments.length) * 8))
          const path = paths[tier]
          path.moveTo(segment.x1, segment.y1)
          path.quadraticCurveTo(segment.cx, segment.cy, segment.x2, segment.y2)
        }
        chunks.push(paths)
      }
    }
    const draw = (visible: number, state = cameraRef.current) => {
      ctx.fillStyle = '#080c14'
      ctx.fillRect(0, 0, cssWidth, cssHeight)
      const count = Math.min(geometryRef.current.segments.length, Math.floor(visible))
      const chunkSize = 850
      const bounds = geometryRef.current.bounds
      const spanX = bounds.maxX - bounds.minX || 1, spanY = bounds.maxY - bounds.minY || 1
      const topSafe = Math.min(74, cssHeight * 0.08)
      const bottomSafe = Math.min(164, cssHeight * 0.18)
      const artHeight = cssHeight - topSafe - bottomSafe
      const scale = Math.min(cssWidth * 0.82 / spanX, artHeight * 0.93 / spanY) * state.zoom
      const centerX = (bounds.minX + bounds.maxX) / 2, centerY = (bounds.minY + bounds.maxY) / 2
      ctx.save()
      ctx.translate(cssWidth / 2 + state.x, topSafe + artHeight / 2 + state.y)
      // The turtle's -π/2 heading points up in the usual canvas coordinate
      // system. Keeping y positive preserves the botanical growth direction.
      ctx.scale(scale, scale)
      ctx.translate(-centerX, -centerY)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (let i = 0; i < chunks.length; i++) {
        if (i * chunkSize >= count) break
        const paths = chunks[i]
        for (let tier = 0; tier < paths.length; tier++) {
          if (!paths[tier]) continue
          ctx.strokeStyle = colors[Math.min(colors.length - 1, Math.floor(tier / 7 * colors.length))]
          ctx.globalAlpha = 0.7 + tier * 0.035
          const taper = presets[kind]?.organic ? Math.pow(0.74, tier * 0.58) : 1
          ctx.lineWidth = Math.max(0.45, width * taper) / scale
          ctx.stroke(paths[tier])
        }
      }
      if (kind === 'fern') {
        ctx.fillStyle = colors[colors.length - 2]
        ctx.globalAlpha = .68
        for (let i = 0; i < count; i++) {
          const segment = geometryRef.current.segments[i]
          if (!segment.leafSize) continue
          const heading = Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1)
          ctx.beginPath()
          ctx.ellipse(segment.x2, segment.y2, segment.leafSize / scale, segment.leafSize * 0.34 / scale, heading, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      } else if (presets[kind]?.organic && count > 0) {
        const maxDepth = geometryRef.current.maxDepth
        ctx.fillStyle = colors[colors.length - 1]
        ctx.globalAlpha = .58
        for (let i = 0; i < count; i++) {
          const segment = geometryRef.current.segments[i]
          if (segment.depth < maxDepth - 1 || segment.order % 3 !== 0) continue
          const heading = Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1)
          ctx.beginPath()
          ctx.ellipse(segment.x2, segment.y2, 2.4 / scale, .7 / scale, heading + Math.PI / 5, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      if (kind !== 'koch' && kind !== 'dragon' && kind !== 'hilbert' && kind !== 'sierpinski' && count > 0) {
        const maxDepth = geometryRef.current.maxDepth
        const segment = geometryRef.current.segments[Math.max(0, count - 1)]
        if (segment && segment.depth >= maxDepth - 1) {
          ctx.globalAlpha = 0.72
          ctx.fillStyle = colors[colors.length - 1]
          ctx.beginPath(); ctx.ellipse(segment.x2, segment.y2, 2.4 / scale, 1.35 / scale, -Math.PI / 3, 0, Math.PI * 2); ctx.fill()
        }
      }
      ctx.globalAlpha = 1
      ctx.restore()
    }
    drawRef.current = (state) => draw(progress.current, state)
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(3_000_000 / (rect.width * rect.height)))
      cssWidth = rect.width; cssHeight = rect.height
      canvas.width = Math.max(1, Math.floor(cssWidth * dpr))
      canvas.height = Math.max(1, Math.floor(cssHeight * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(progress.current)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    const geometryChanged = builtGeometry.current !== geometry
    if (geometryChanged) { build(); builtGeometry.current = geometry }
    if (geometryChanged || lastGrowthKey.current !== growthKey) {
      progress.current = growing && !paused ? 0 : geometry.segments.length
      lastGrowthKey.current = growthKey
    }
    resize()
    const animate = () => {
      if (paused || !growing || progress.current >= geometry.segments.length) return
      progress.current = Math.min(geometry.segments.length, progress.current + Math.max(28, Math.ceil(geometry.segments.length / 240)))
      draw(progress.current)
      if (progress.current < geometry.segments.length) raf = requestAnimationFrame(animate)
    }
    if (growing && !paused && progress.current < geometry.segments.length) raf = requestAnimationFrame(animate)
    return () => { cancelAnimationFrame(raf); observer.disconnect(); drawRef.current = () => {} }
  }, [geometry, palette, width, growing, paused, growthKey, kind])

  const selectPreset = (value: string) => {
    const preset = presets[value]
    if (!preset) return
    setKind(value); setIterations(preset.iterations); setAngle(preset.angle); setGrowing(true)
    setRandomness(preset.organic ? 0.13 : 0)
    setCamera({ zoom: 1, x: 0, y: 0 })
    setGrowthKey((current) => current + 1)
  }
  const randomize = () => {
    setSeed((value) => (value * 1664525 + 1013904223) >>> 0 || 1)
    setAngle(14 + Math.random() * 52)
    setRandomness(Math.random() * 0.48)
    setGrowing(true)
    setGrowthKey((value) => value + 1)
  }
  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY } }
  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return
    const next = { ...cameraRef.current, x: cameraRef.current.x + event.clientX - drag.current.x, y: cameraRef.current.y + event.clientY - drag.current.y }
    drag.current = { x: event.clientX, y: event.clientY }
    cameraRef.current = next
    setCamera(next)
    drawRef.current(next)
  }
  const wheel = (event: WheelEvent) => {
    event.preventDefault()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const current = cameraRef.current
    const factor = Math.exp(-event.deltaY * 0.001)
    const zoom = Math.max(0.15, Math.min(24, current.zoom * factor))
    const px = event.clientX - rect.left - rect.width / 2
    const py = event.clientY - rect.top - rect.height / 2
    const next = { zoom, x: px - (px - current.x) * factor, y: py - (py - current.y) * factor }
    cameraRef.current = next
    setCamera(next)
    drawRef.current(next)
  }
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => canvas.removeEventListener('wheel', wheel)
  }, [])
  const preset = presets[kind]

  return <div className="experiment-surface">
    <canvas ref={canvasRef} className="experiment-canvas lsystem-canvas" aria-label="Generative L-system artwork. Drag to pan and scroll to zoom." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} />
    <span className="canvas-coordinate">{preset.name.toUpperCase()} · {geometry.segments.length.toLocaleString()} CURVES</span>
    <ControlPanel title="A Grammar of Growth" note="GENERATIVE SYSTEMS" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Generative grammar" value={kind} options={Object.entries(presets).map(([key, value]) => [key, value.name])} onChange={selectPreset} />
      <RangeControl label="Generations" value={iterations} min={1} max={preset.max} step={1} onChange={(value) => { setIterations(value); setGrowing(true); setGrowthKey((current) => current + 1) }} />
      <RangeControl label="Branch angle" value={angle} min={8} max={112} step={0.5} onChange={(value) => { setAngle(value); setGrowing(true); setGrowthKey((current) => current + 1) }} format={(value) => value.toFixed(1) + '°'} />
      <RangeControl label="Wind / asymmetry" value={randomness} min={0} max={0.65} step={0.01} onChange={(value) => { setRandomness(value); setGrowing(true); setGrowthKey((current) => current + 1) }} format={(value) => Math.round(value * 100) + '%'} />
      <RangeControl label="Ink weight" value={width} min={0.6} max={4} step={0.1} onChange={setWidth} format={(value) => value.toFixed(1)} />
      <SelectControl label="Pigment" value={palette} options={[['sage', 'Moss and lichen'], ['frost', 'Winter glass'], ['ember', 'Autumn ember'], ['violet', 'Ultraviolet garden']]} onChange={setPalette} />
      <ActionRow>
        <button className="panel-action" onClick={() => { setGrowing(true); setGrowthKey((value) => value + 1) }}><span>Replay the growth</span><i>↗</i></button>
        <button className="panel-action" onClick={() => setGrowing((value) => !value)}><span>{growing ? 'Pause growth' : 'Resume growth'}</span><i>{growing ? 'Ⅱ' : '▶'}</i></button>
      </ActionRow>
      <button className="panel-action" onClick={randomize}><span>Let the wind decide</span><i>↻</i></button>
      <p className="control-note">The fern grows from nested fronds and leaflets; the other forms unfold from branching rules. Drag to pan, scroll to magnify, and replay to watch them grow.</p>
    </ControlPanel>
  </div>
}
