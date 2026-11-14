import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { ExperimentControls } from '../types'
import { ActionRow, ControlPanel, RangeControl, SelectControl } from '../components/Controls'
import { useDiscoveryHint } from '../lib/useDiscoveryHint'
import { generateFernGeometry } from '../simulations/fern'
import { generateParametricTree } from '../simulations/parametricTree'
import type { FernGeometry, FernSegment } from '../simulations/fern'

type Preset = { name: string; axiom?: string; rules?: Record<string, string>; angle: number; iterations: number; max: number; step: number; taper?: number; organic?: boolean; draw: string }
type Segment = FernSegment
type Camera = { zoom: number; x: number; y: number }
type Geometry = FernGeometry
const MAX_SYMBOLS = 520_000
const MAX_SEGMENTS = 100_000
const presets: Record<string, Preset> = {
  tree: { name: 'Wind-shaped tree', angle: 52, iterations: 6, max: 6, step: 0.94, taper: 0.86, organic: true, draw: 'F' },
  fern: { name: 'Unfurling fern', angle: 28, iterations: 6, max: 6, step: 0.75, taper: 0.91, organic: true, draw: 'F' },
  coral: { name: 'Branching coral', axiom: 'F', rules: { F: 'F[+F]F[-F][F]' }, angle: 22, iterations: 6, max: 6, step: 0.79, taper: 0.84, organic: true, draw: 'F' },
  fan: { name: 'Sea fan', axiom: 'X', rules: { X: 'F[+X][-X]F[+X][-X]F[+X][-X]X', F: 'FF' }, angle: 42, iterations: 5, max: 5, step: 0.76, taper: 0.9, organic: true, draw: 'F' },
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
  if (kind === 'fern') return generateFernGeometry(iterations, randomness, seed, angle)
  if (kind === 'tree') return generateParametricTree(iterations, randomness, seed, angle)
  const preset = presets[kind] || presets.tree
  let sentence = preset.axiom || 'F'
  for (let generation = 0; generation < iterations; generation++) {
    let next = ''
    for (const symbol of sentence) {
      const replacement = preset.rules?.[symbol] || symbol
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
  const hint = useDiscoveryHint('lsystem')
  const initialKind = typeof stateFromUrl?.kind === 'string' && presets[stateFromUrl.kind] ? stateFromUrl.kind : 'fern'
  const [kind, setKind] = useState(initialKind)
  const [iterations, setIterations] = useState(() => Number(stateFromUrl?.iterations) || presets[initialKind].iterations)
  const [angle, setAngle] = useState(() => Number(stateFromUrl?.angle) || presets[initialKind].angle)
  const [randomness, setRandomness] = useState(() => stateFromUrl?.randomness !== undefined ? Number(stateFromUrl.randomness) : (presets[initialKind].organic ? 0.26 : 0))
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
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const depthCounts = geometry.segments.reduce<Record<number, number>>((counts, segment) => { counts[segment.depth] = (counts[segment.depth] || 0) + 1; return counts }, {})
    const inspect = () => ({ kind, total: geometryRef.current.segments.length, progress: progress.current, maxDepth: geometryRef.current.maxDepth, depthCounts })
    ;(window as Window & { __ARMSTEEL_GROWTH__?: typeof inspect }).__ARMSTEEL_GROWTH__ = inspect
    return () => { delete (window as Window & { __ARMSTEEL_GROWTH__?: typeof inspect }).__ARMSTEEL_GROWTH__ }
  }, [kind, geometry])
  useEffect(() => { onShareState({ kind, iterations, angle, randomness, width, palette, seed, zoom: camera.zoom, panX: camera.x, panY: camera.y }) }, [kind, iterations, angle, randomness, width, palette, seed, camera, onShareState])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    let cssWidth = 0, cssHeight = 0, dpr = 1, raf = 0
    const chunks = chunksRef.current
    let fanWebPaths: Path2D[] = []
    const colors = palettes[palette] || palettes.sage
    const build = () => {
      const geometryNow = geometryRef.current
      const chunkSize = 64
      chunks.length = 0
      fanWebPaths = []
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
      if (kind === 'fan' && geometryNow.segments.length) {
        const { minY, maxY, minX, maxX } = geometryNow.bounds
        const spanY = maxY - minY || 1, spanX = maxX - minX || 1
        for (let row = 1; row <= 28; row++) {
          const y = minY + spanY * (0.16 + row / 30 * 0.8)
          let left = Infinity, right = -Infinity
          for (const segment of geometryNow.segments) {
            const dy = segment.y2 - segment.y1
            if (Math.abs(dy) < 1e-8 || y < Math.min(segment.y1, segment.y2) || y > Math.max(segment.y1, segment.y2)) continue
            const t = (y - segment.y1) / dy
            if (t < 0 || t > 1) continue
            const x = segment.x1 + (segment.x2 - segment.x1) * t
            left = Math.min(left, x); right = Math.max(right, x)
          }
          if (!Number.isFinite(left) || right - left < spanX * .12) continue
          const web = new Path2D()
          web.moveTo(left, y)
          web.quadraticCurveTo((left + right) / 2, y + spanY * .008, right, y)
          fanWebPaths.push(web)
        }
      }
    }
    const draw = (visible: number, state = cameraRef.current) => {
      ctx.fillStyle = '#080c14'
      ctx.fillRect(0, 0, cssWidth, cssHeight)
      const count = Math.min(geometryRef.current.segments.length, Math.floor(visible))
      const chunkSize = 64
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
      if (kind === 'fan' && fanWebPaths.length) {
        ctx.globalAlpha = .35
        ctx.strokeStyle = colors[2]
        ctx.lineWidth = .9 / scale
        for (const web of fanWebPaths) ctx.stroke(web)
        ctx.globalAlpha = 1
      }
      const drawPaths = (paths: Path2D[]) => {
        for (let tier = 0; tier < paths.length; tier++) {
          ctx.strokeStyle = colors[Math.min(colors.length - 1, Math.floor(tier / 7 * colors.length))]
          ctx.globalAlpha = 0.7 + tier * 0.035
          const taper = presets[kind]?.organic ? Math.pow(kind === 'tree' ? 0.82 : 0.74, tier * (kind === 'tree' ? 0.7 : 0.58)) : 1
          ctx.lineWidth = Math.max(0.45, width * taper * (kind === 'tree' ? 1.65 : 1)) / scale
          ctx.stroke(paths[tier])
        }
      }
      const completeChunks = Math.floor(count / chunkSize)
      for (let i = 0; i < completeChunks; i++) {
        const paths = chunks[i]
        drawPaths(paths)
      }
      const partialStart = completeChunks * chunkSize
      if (count > partialStart) {
        const partial = Array.from({ length: 8 }, () => new Path2D())
        for (let i = partialStart; i < count; i++) {
          const segment = geometryRef.current.segments[i]
          const tier = presets[kind]?.organic
            ? Math.min(7, Math.floor(segment.depth / Math.max(1, geometryRef.current.maxDepth) * 7))
            : Math.min(7, Math.floor(segment.order / Math.max(1, geometryRef.current.segments.length) * 8))
          partial[tier].moveTo(segment.x1, segment.y1)
          partial[tier].quadraticCurveTo(segment.cx, segment.cy, segment.x2, segment.y2)
        }
        drawPaths(partial)
      }
      if (kind === 'fern') {
        ctx.fillStyle = colors[colors.length - 2]
        ctx.strokeStyle = colors[colors.length - 1]
        ctx.globalAlpha = .82
        for (let i = 0; i < count; i++) {
          const segment = geometryRef.current.segments[i]
          if (!segment.leafSize) continue
          ctx.beginPath()
          const dx = segment.x2 - segment.x1, dy = segment.y2 - segment.y1
          const normalX = -dy / Math.max(1e-6, Math.hypot(dx, dy)), normalY = dx / Math.max(1e-6, Math.hypot(dx, dy))
          const middleX = (segment.x1 + segment.x2) / 2, middleY = (segment.y1 + segment.y2) / 2
          const widthAtMiddle = segment.leafSize * 0.46
          ctx.moveTo(segment.x1, segment.y1)
          ctx.quadraticCurveTo(middleX + normalX * widthAtMiddle, middleY + normalY * widthAtMiddle, segment.x2, segment.y2)
          ctx.quadraticCurveTo(middleX - normalX * widthAtMiddle, middleY - normalY * widthAtMiddle, segment.x1, segment.y1)
          ctx.fill()
          ctx.globalAlpha = .32
          ctx.lineWidth = .38 / scale
          ctx.beginPath(); ctx.moveTo(segment.x1, segment.y1); ctx.lineTo(segment.x2, segment.y2); ctx.stroke()
          ctx.globalAlpha = .82
        }
        ctx.globalAlpha = 1
      } else if (presets[kind]?.organic && count > 0) {
        const maxDepth = geometryRef.current.maxDepth
        ctx.fillStyle = kind === 'coral' ? '#f1b28d' : kind === 'tree' ? colors[1] : colors[colors.length - 1]
        ctx.strokeStyle = kind === 'coral' ? '#f4d3ad' : colors[colors.length - 1]
        ctx.globalAlpha = kind === 'coral' ? .78 : kind === 'tree' ? .8 : .7
        for (let i = 0; i < count; i++) {
          const segment = geometryRef.current.segments[i]
          if (segment.depth < maxDepth - (kind === 'tree' ? 3 : 1) || segment.order % (kind === 'coral' ? 2 : kind === 'tree' ? 2 : 3) !== 0) continue
          const heading = Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1)
          if (kind === 'tree') {
            const leafBase = { x: segment.x2, y: segment.y2 }
            const leafSpan = 12 + (segment.order % 5) * 1.6
            const leafWidth = 4 + (segment.order % 3) * 1.2
            for (const side of [-1, 1]) {
              const leafAngle = heading + side * (.52 + (segment.order % 7) * .018)
              const tip = { x: leafBase.x + Math.cos(leafAngle) * leafSpan / scale, y: leafBase.y + Math.sin(leafAngle) * leafSpan / scale }
              const middle = { x: (leafBase.x + tip.x) / 2, y: (leafBase.y + tip.y) / 2 }
              const normalX = -Math.sin(leafAngle) * leafWidth / scale, normalY = Math.cos(leafAngle) * leafWidth / scale
              ctx.fillStyle = segment.order % 7 === 0 ? colors[2] : colors[1]
              ctx.beginPath()
              ctx.moveTo(leafBase.x, leafBase.y)
              ctx.quadraticCurveTo(middle.x + normalX, middle.y + normalY, tip.x, tip.y)
              ctx.quadraticCurveTo(middle.x - normalX, middle.y - normalY, leafBase.x, leafBase.y)
              ctx.closePath(); ctx.fill()
            }
          } else if (kind === 'coral') {
            const length = Math.max(.035, Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) * .72)
            ctx.lineWidth = Math.max(.7, width * .3) / scale
            for (const side of [-1, 1]) {
              const baseX = segment.x2 + Math.cos(heading) * length * .12, baseY = segment.y2 + Math.sin(heading) * length * .12
              const tipX = baseX + Math.cos(heading + side * .48) * length, tipY = baseY + Math.sin(heading + side * .48) * length
              ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.quadraticCurveTo(baseX + Math.cos(heading + side * .3) * length * .75, baseY + Math.sin(heading + side * .3) * length * .75, tipX, tipY); ctx.stroke()
              ctx.beginPath(); ctx.arc(tipX, tipY, Math.max(.012, length * .11), 0, Math.PI * 2); ctx.fill()
            }
            ctx.beginPath(); ctx.arc(segment.x2, segment.y2, Math.max(.014, length * .13), 0, Math.PI * 2); ctx.fill()
          } else {
            const length = Math.max(.045, Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) * .9)
            for (const side of [-1, 1]) {
              const leafAngle = heading + side * .62
              const tipX = segment.x2 + Math.cos(leafAngle) * length, tipY = segment.y2 + Math.sin(leafAngle) * length
              const middleX = (segment.x2 + tipX) / 2, middleY = (segment.y2 + tipY) / 2
              ctx.beginPath(); ctx.moveTo(segment.x2, segment.y2); ctx.quadraticCurveTo(middleX - Math.sin(leafAngle) * length * .24, middleY + Math.cos(leafAngle) * length * .24, tipX, tipY); ctx.quadraticCurveTo(middleX + Math.sin(leafAngle) * length * .24, middleY - Math.cos(leafAngle) * length * .24, segment.x2, segment.y2); ctx.fill()
            }
          }
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
    setRandomness(preset.organic ? 0.26 : 0)
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
  const replayGrowth = () => { setGrowing(true); setGrowthKey((value) => value + 1); hint.dismiss() }

  return <div className="experiment-surface">
    <canvas ref={canvasRef} className="experiment-canvas lsystem-canvas" aria-label="Generative botanical and L-system artwork. Drag to pan and scroll to zoom." aria-describedby={hint.visible ? 'lsystem-first-move' : undefined} onPointerDown={(event) => { hint.dismiss(); pointerDown(event) }} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} />
    {hint.visible ? <aside className="scene-nudge" id="lsystem-first-move" role="note"><span>Try this · A Grammar of Growth</span><p>Watch the fern unfurl, then switch to a tree or coral and follow the branching rule.</p><button onClick={hint.dismiss} aria-label="Dismiss first-move hint">×</button><button className="scene-nudge-action" onClick={replayGrowth}>Replay the growth</button></aside> : <button className="scene-nudge-reopen" onClick={hint.show} aria-label="Show interaction tip" title="Show interaction tip">i</button>}
    <span className="canvas-coordinate">{preset.name.toUpperCase()} · {geometry.segments.length.toLocaleString()} CURVES</span>
    <ControlPanel title="A Grammar of Growth" note="GENERATIVE SYSTEMS" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Growth form" value={kind} options={Object.entries(presets).map(([key, value]) => [key, value.name])} onChange={selectPreset} />
      <RangeControl label="Generations" value={iterations} min={1} max={preset.max} step={1} onChange={(value) => { setIterations(value); setGrowing(true); setGrowthKey((current) => current + 1) }} />
      <RangeControl label="Branch angle" value={angle} min={8} max={112} step={0.5} onChange={(value) => { setAngle(value); setGrowing(true); setGrowthKey((current) => current + 1) }} format={(value) => value.toFixed(1) + '°'} />
      <RangeControl label="Wind / asymmetry" value={randomness} min={0} max={0.65} step={0.01} onChange={(value) => { setRandomness(value); setGrowing(true); setGrowthKey((current) => current + 1) }} format={(value) => Math.round(value * 100) + '%'} />
      <RangeControl label="Ink weight" value={width} min={0.6} max={4} step={0.1} onChange={setWidth} format={(value) => value.toFixed(1)} />
      <SelectControl label="Pigment" value={palette} options={[['sage', 'Moss and lichen'], ['frost', 'Winter glass'], ['ember', 'Autumn ember'], ['violet', 'Ultraviolet garden']]} onChange={setPalette} />
      <details className="lsystem-rule"><summary>{kind === 'fern' ? 'How this fern is constructed' : kind === 'tree' ? 'How this tree grows' : 'See the rule behind this shape'}</summary>{kind === 'fern' ? <p>This is a seeded parametric botanical generator, not an L-system rewrite. Seven curved rachises carry paired pinnae and smaller lance-shaped leaflets; the wind control changes their asymmetry.</p> : kind === 'tree' ? <p>This is a seeded parametric tree, not an L-system rewrite. A curved trunk divides into boughs and finer twigs at every generation; branch angle sets the crown spread and wind changes each limb's bend.</p> : <><p>Start with <code>{preset.axiom}</code>. At every generation, replace each symbol using these rules:</p>{Object.entries(preset.rules || {}).map(([symbol, replacement]) => <code className="lsystem-rule-line" key={symbol}>{symbol} → {replacement}</code>)}<p>The string is interpreted as forward strokes, turns and saved branches. Every generation repeats the same replacement.</p></>}</details>
      <ActionRow>
        <button className="panel-action" onClick={() => { setGrowing(true); setGrowthKey((value) => value + 1) }}><span>Replay the growth</span><i>↗</i></button>
        <button className="panel-action" onClick={() => setGrowing((value) => !value)}><span>{growing ? 'Pause growth' : 'Resume growth'}</span><i>{growing ? 'Ⅱ' : '▶'}</i></button>
      </ActionRow>
      <button className="panel-action" onClick={randomize}><span>Let the wind decide</span><i>↻</i></button>
      <p className="control-note">The fern and tree use seeded parametric botany. Coral, sea fan and the geometric patterns use visible L-system rewrites. Drag to pan, scroll to magnify, and replay to watch growth unfold.</p>
    </ControlPanel>
  </div>
}
