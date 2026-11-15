import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { ExperimentControls } from '../types'
import { ControlPanel, RangeControl, SelectControl } from '../components/Controls'
import { useDiscoveryHint } from '../lib/useDiscoveryHint'
import { boundedStateNumber, stateChoice } from '../lib/experimentState'
import { AttractorTrailBuffer, attractorRenderStride, shouldRenderAttractorFrame } from '../simulations/attractorTrail'

type Point3 = { x: number; y: number; z: number }
type SystemName = 'lorenz' | 'rossler' | 'thomas' | 'aizawa' | 'halvorsen'
type Camera = { x: number; y: number; zoom: number }
function cameraFor(system: SystemName, state?: Record<string, unknown> | null): Camera {
  const shared = state?.camera as Partial<Camera> | undefined
  if (shared && typeof shared === 'object') {
    return {
      x: boundedStateNumber(shared.x, 0, -1.3, 1.3),
      y: boundedStateNumber(shared.y, 0, -1_000_000, 1_000_000),
      zoom: boundedStateNumber(shared.zoom, 1, 0.45, 4.5),
    }
  }
  if (system === 'lorenz') return { x: 1.3, y: 0, zoom: 1 }
  if (system === 'rossler') return { x: 0.38, y: 0.48, zoom: 1.18 }
  if (system === 'aizawa') return { x: 0.72, y: 0.48, zoom: 1.16 }
  return { x: 0.68, y: 0.42, zoom: 1.12 }
}
const systemNames: Record<SystemName, string> = {
  lorenz: 'Lorenz · butterfly',
  rossler: 'Rössler · ribbon',
  thomas: 'Thomas · cyclic',
  aizawa: 'Aizawa · tangled torus',
  halvorsen: 'Halvorsen · three-fold',
}
const extent: Record<SystemName, number> = { lorenz: 30, rossler: 11, thomas: 4.3, aizawa: 2.6, halvorsen: 11 }
const palettes: Record<string, [string, string, string]> = {
  polar: ['#79c7d8', '#a6a6e8', '#f0c9a6'],
  aurora: ['#75c5a1', '#77a9d9', '#e1c991'],
  ember: ['#efaa71', '#d57b8a', '#b6a4e2'],
  glacial: ['#b7e6df', '#76a9d3', '#9686c8'],
}

const derivativeScratch = Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0 }))
function derivativeInto(x: number, y: number, z: number, system: SystemName, q: { rho: number; sigma: number; beta: number; a: number; b: number; c: number }, out: Point3) {
  if (system === 'lorenz') { out.x = q.sigma * (y - x); out.y = x * (q.rho - z) - y; out.z = x * y - q.beta * z; return }
  if (system === 'rossler') { out.x = -y - z; out.y = x + q.a * y; out.z = q.b + z * (x - q.c); return }
  if (system === 'thomas') { out.x = Math.sin(y) - q.a * x; out.y = Math.sin(z) - q.a * y; out.z = Math.sin(x) - q.a * z; return }
  if (system === 'aizawa') {
    out.x = (z - q.b) * x - 3.5 * y
    out.y = 3.5 * x + (z - q.b) * y
    out.z = q.c + q.a * z - z * z * z / 3 - (x * x + y * y) * (1 + 0.25 * z) + 0.1 * z * x * x * x
    return
  }
  out.x = -q.a * x - 4 * y - 4 * z - y * y
  out.y = -q.a * y - 4 * z - 4 * x - z * z
  out.z = -q.a * z - 4 * x - 4 * y - x * x
}
function advancePoint(p: Point3, dt: number, system: SystemName, q: { rho: number; sigma: number; beta: number; a: number; b: number; c: number }) {
  const half = dt / 2, k1 = derivativeScratch[0], k2 = derivativeScratch[1], k3 = derivativeScratch[2], k4 = derivativeScratch[3]
  derivativeInto(p.x, p.y, p.z, system, q, k1)
  derivativeInto(p.x + k1.x * half, p.y + k1.y * half, p.z + k1.z * half, system, q, k2)
  derivativeInto(p.x + k2.x * half, p.y + k2.y * half, p.z + k2.z * half, system, q, k3)
  derivativeInto(p.x + k3.x * dt, p.y + k3.y * dt, p.z + k3.z * dt, system, q, k4)
  p.x += dt / 6 * (k1.x + 2 * k2.x + 2 * k3.x + k4.x)
  p.y += dt / 6 * (k1.y + 2 * k2.y + 2 * k3.y + k4.y)
  p.z += dt / 6 * (k1.z + 2 * k2.z + 2 * k3.z + k4.z)
}

export default function Attractors({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const initialSystem = stateChoice(stateFromUrl?.system, Object.keys(systemNames) as SystemName[], 'lorenz')
  const initialA = initialSystem === 'thomas' ? 0.208186 : initialSystem === 'halvorsen' ? 1.4 : initialSystem === 'aizawa' ? 0.95 : 0.2
  const [minimumA, maximumA] = initialSystem === 'thomas' ? [0.05, 0.38] : initialSystem === 'aizawa' ? [0.55, 1.25] : initialSystem === 'halvorsen' ? [1, 2] : [0.05, 0.45]
  const [minimumB, maximumB] = initialSystem === 'aizawa' ? [0.4, 1.1] : [0.05, 0.45]
  const [minimumC, maximumC] = initialSystem === 'aizawa' ? [0.3, 1.1] : [3, 9]
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hint = useDiscoveryHint('attractors')
  const path = useRef(new AttractorTrailBuffer(28_000))
  const trajectoryCenter = useRef<Point3>({ x: 0, y: 0, z: 0 })
  const point = useRef<Point3>({ x: 0.1, y: 0, z: 0 })
  const [cameraState, setCameraState] = useState<Camera>(() => {
    return cameraFor(initialSystem, stateFromUrl)
  })
  const camera = useRef<Camera>(cameraState)
  camera.current = cameraState
  const drag = useRef<{ x: number; y: number } | null>(null)
  const drawRef = useRef<() => void>(() => {})
  const resetRef = useRef<() => void>(() => {})
  const [system, setSystem] = useState<SystemName>(initialSystem)
  const [configuration, setConfiguration] = useState('classic')
  const [speed, setSpeed] = useState(() => boundedStateNumber(stateFromUrl?.speed, 1.8, 0.25, 4))
  const [trail, setTrail] = useState(() => boundedStateNumber(stateFromUrl?.trail, 16000, 2500, 28000))
  const [palette, setPalette] = useState(() => stateChoice(stateFromUrl?.palette, Object.keys(palettes), 'polar'))
  const [rho, setRho] = useState(() => boundedStateNumber(stateFromUrl?.rho, 28, 10, 45))
  const [sigma, setSigma] = useState(() => boundedStateNumber(stateFromUrl?.sigma, 10, 5, 18))
  const [beta, setBeta] = useState(() => boundedStateNumber(stateFromUrl?.beta, 8 / 3, 1, 5))
  const [a, setA] = useState(() => boundedStateNumber(stateFromUrl?.a, initialA, minimumA, maximumA))
  const [b, setB] = useState(() => boundedStateNumber(stateFromUrl?.b, initialSystem === 'aizawa' ? 0.7 : 0.2, minimumB, maximumB))
  const [c, setC] = useState(() => boundedStateNumber(stateFromUrl?.c, initialSystem === 'aizawa' ? 0.6 : 5.7, minimumC, maximumC))
  const params = useRef({ system, speed, trail, palette, rho, sigma, beta, a, b, c, paused })
  params.current = { system, speed, trail, palette, rho, sigma, beta, a, b, c, paused }
  useEffect(() => { onShareState({ system, speed, trail, palette, rho, sigma, beta, a, b, c, camera: cameraState }) }, [system, speed, trail, palette, rho, sigma, beta, a, b, c, cameraState, onShareState])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    let width = 0, height = 0, raf = 0, previous = 0, lastDrawAt = -Infinity
    let warming = false, burnRemaining = 0, fillRemaining = 0
    let centerX = 0, centerY = 0, centerZ = 0, centerCount = 0
    let renderMs = 0, simulationMs = 0, renderedPoints = 0
    const screenX = new Float32Array(path.current.capacity)
    const screenY = new Float32Array(path.current.capacity)
    const screenZ = new Float32Array(path.current.capacity)
    const stat = { renderer: 'canvas2d', hardwareRenderer: '', renderMs: 0, simulationMs: 0, renderedPoints: 0, trailPoints: 0, warming: false, drawCount: 0 }
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(3_000_000 / (rect.width * rect.height)))
      width = rect.width; height = rect.height
      canvas.width = Math.max(1, Math.floor(width * ratio))
      canvas.height = Math.max(1, Math.floor(height * ratio))
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    const parameters = () => params.current
    const colorAt = (index: number, depth: number, length: number, stops: [string, string, string]) => {
      const t = Math.max(0, Math.min(0.9999, index / Math.max(1, length) * 0.78 + (depth + 1) * 0.11))
      const position = t * 2
      const segment = Math.min(1, Math.floor(position))
      const mix = position - segment
      const first = stops[segment], second = stops[segment + 1]
      const r = Math.round(parseInt(first.slice(1, 3), 16) * (1 - mix) + parseInt(second.slice(1, 3), 16) * mix)
      const g = Math.round(parseInt(first.slice(3, 5), 16) * (1 - mix) + parseInt(second.slice(3, 5), 16) * mix)
      const b = Math.round(parseInt(first.slice(5, 7), 16) * (1 - mix) + parseInt(second.slice(5, 7), 16) * mix)
      return { color: `rgb(${r},${g},${b})`, alpha: 0.42 + 0.48 * Math.max(0, Math.min(1, (depth + 1.3) / 2.6)) }
    }
    const draw = () => {
      if (!width || !height) return
      ctx.fillStyle = '#080c14'
      ctx.fillRect(0, 0, width, height)
      const started = performance.now()
      lastDrawAt = started
      const q = parameters(), points = path.current
      const pointCount = Math.min(points.length, q.trail)
      if (pointCount < 2) return
      const stride = attractorRenderStride(pointCount)
      const sampleCount = Math.ceil((pointCount - 1) / stride) + 1
      const firstPoint = points.length - pointCount
      const yaw = camera.current.y, pitch = camera.current.x
      const sinYaw = Math.sin(yaw), cosYaw = Math.cos(yaw), sinPitch = Math.sin(pitch), cosPitch = Math.cos(pitch)
      const scale = Math.min(width, height) * 0.4 * camera.current.zoom / extent[q.system]
      const center = trajectoryCenter.current
      for (let sample = 0; sample < sampleCount; sample++) {
        const source = firstPoint + Math.min(pointCount - 1, sample * stride)
        const x0 = points.xAt(source) - center.x, y0 = points.yAt(source) - center.y, z0 = points.zAt(source) - center.z
        const x = x0 * cosYaw - z0 * sinYaw
        const rotatedZ = x0 * sinYaw + z0 * cosYaw
        const y = y0 * cosPitch - rotatedZ * sinPitch
        const z = y0 * sinPitch + rotatedZ * cosPitch
        const depthScale = 4.5 / (4.5 + z / extent[q.system] * 0.6)
        screenX[sample] = width / 2 + x * scale * depthScale
        screenY[sample] = height / 2 - y * scale * depthScale
        screenZ[sample] = z / extent[q.system]
      }
      ctx.globalCompositeOperation = 'lighter'
      const groups = Math.min(40, sampleCount - 1)
      const stops = palettes[q.palette] || palettes.polar
      for (let group = 0; group < groups; group++) {
        const from = Math.floor(group * (sampleCount - 1) / groups), to = Math.floor((group + 1) * (sampleCount - 1) / groups)
        if (to <= from) continue
        const sourceEnd = Math.min(pointCount - 1, to * stride)
        const shade = colorAt(sourceEnd, screenZ[to], pointCount, stops)
        ctx.beginPath()
        ctx.moveTo(screenX[from], screenY[from])
        for (let i = from + 1; i <= to; i++) ctx.lineTo(screenX[i], screenY[i])
        ctx.globalAlpha = shade.alpha * 0.12
        ctx.strokeStyle = shade.color
        ctx.lineWidth = 8
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()
        ctx.globalAlpha = shade.alpha
        ctx.lineWidth = 1.25 + Math.max(0, screenZ[to]) * 0.42
        ctx.stroke()
      }
      ctx.shadowBlur = 8
      const dotStride = Math.max(1, Math.round(190 / stride))
      for (let i = Math.max(1, Math.round(80 / stride)); i < sampleCount - Math.round(80 / stride); i += dotStride) {
        const shade = colorAt(Math.min(pointCount - 1, i * stride), screenZ[i], pointCount, stops)
        ctx.globalAlpha = shade.alpha * 0.65
        ctx.fillStyle = shade.color
        ctx.shadowColor = shade.color
        ctx.beginPath()
        ctx.arc(screenX[i], screenY[i], 0.75 + Math.max(0, screenZ[i]) * 0.65, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.shadowBlur = 0
      ctx.globalAlpha = 0.9
      ctx.fillStyle = (palettes[q.palette] || palettes.polar)[2]
      ctx.shadowColor = ctx.fillStyle as string
      ctx.shadowBlur = 15
      ctx.beginPath()
      ctx.arc(screenX[sampleCount - 1], screenY[sampleCount - 1], 2.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      renderMs = performance.now() - started
      renderedPoints = sampleCount
      stat.renderMs = renderMs
      stat.simulationMs = simulationMs
      stat.renderedPoints = renderedPoints
      stat.trailPoints = pointCount
      stat.warming = warming
      stat.drawCount++
    }
    drawRef.current = () => {
      if (parameters().paused || shouldRenderAttractorFrame(performance.now(), lastDrawAt)) draw()
    }
    resetRef.current = () => {
      path.current.clear()
      trajectoryCenter.current = { x: 0, y: 0, z: 0 }
      point.current = { x: 0.1, y: 0, z: 0 }
      warming = false
      burnRemaining = 0
      fillRemaining = 0
      centerX = centerY = centerZ = centerCount = 0
      draw()
    }
    const startWarm = () => {
      const q = parameters()
      point.current.x = 0.1; point.current.y = 0; point.current.z = 0
      path.current.clear()
      trajectoryCenter.current = { x: 0, y: 0, z: 0 }
      centerX = centerY = centerZ = centerCount = 0
      burnRemaining = q.system === 'lorenz' ? 2600 : 4200
      fillRemaining = Math.min(path.current.capacity, q.trail)
      warming = true
    }
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (document.hidden) { previous = now; return }
      const elapsed = Math.max(0.25, Math.min(2, (now - previous) / 16.67 || 1))
      previous = now
      const q = parameters()
      if (q.paused) return
      if (!warming && path.current.length === 0) startWarm()
      const dt = q.system === 'lorenz' ? 0.004 : q.system === 'aizawa' ? 0.008 : 0.01
      const simulationStarted = performance.now()
      if (burnRemaining > 0 || fillRemaining > 0) {
        warming = true
        const budget = 180
        let steps = 0
        while (steps < budget && burnRemaining > 0) {
          advancePoint(point.current, dt, q.system, q)
          burnRemaining--; steps++
        }
        while (steps < budget && burnRemaining === 0 && fillRemaining > 0) {
          advancePoint(point.current, dt, q.system, q)
          if (Number.isFinite(point.current.x + point.current.y + point.current.z)) {
            path.current.push(point.current.x, point.current.y, point.current.z)
            centerX += point.current.x; centerY += point.current.y; centerZ += point.current.z; centerCount++
          } else {
            path.current.clear(); point.current.x = 0.1; point.current.y = 0; point.current.z = 0
            warming = false; burnRemaining = 0; fillRemaining = 0; break
          }
          fillRemaining--; steps++
        }
        if (burnRemaining === 0 && fillRemaining === 0) {
          warming = false
          if (centerCount) trajectoryCenter.current = { x: centerX / centerCount, y: centerY / centerCount, z: centerZ / centerCount }
        }
      } else {
        const count = Math.max(1, Math.round(q.speed * elapsed * 11))
        for (let i = 0; i < count; i++) {
          advancePoint(point.current, dt, q.system, q)
          path.current.push(point.current.x, point.current.y, point.current.z)
        }
      }
      simulationMs = performance.now() - simulationStarted
      if (shouldRenderAttractorFrame(performance.now(), lastDrawAt)) draw()
    }
    if (import.meta.env.DEV) (window as Window & { __ARMSTEEL_ATTRACTORS__?: typeof stat }).__ARMSTEEL_ATTRACTORS__ = stat
    resize()
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); observer.disconnect(); path.current.clear(); if (import.meta.env.DEV) delete (window as Window & { __ARMSTEEL_ATTRACTORS__?: typeof stat }).__ARMSTEEL_ATTRACTORS__; resetRef.current = () => {}; drawRef.current = () => {} }
  }, [])

  useEffect(() => { drawRef.current() }, [cameraState, palette, trail])

  const chooseSystem = (value: string) => {
    const next = value as SystemName
    if (!systemNames[next]) return
    setSystem(next)
    setConfiguration('classic')
    if (next === 'lorenz') { setSigma(10); setRho(28); setBeta(8 / 3) }
    else if (next === 'rossler') { setA(0.2); setB(0.2); setC(5.7) }
    else if (next === 'thomas') setA(0.208186)
    else if (next === 'aizawa') { setA(0.95); setB(0.7); setC(0.6) }
    else setA(1.4)
    const nextCamera = cameraFor(next)
    camera.current = nextCamera
    setCameraState(nextCamera)
    resetRef.current()
  }
  const chooseConfiguration = (value: string) => {
    setConfiguration(value)
    if (system === 'lorenz') {
      if (value === 'classic') { setSigma(10); setRho(28); setBeta(8 / 3) }
      if (value === 'threshold') { setSigma(10); setRho(24); setBeta(8 / 3) }
      if (value === 'wide') { setSigma(10); setRho(38); setBeta(8 / 3) }
    } else if (system === 'rossler') {
      if (value === 'classic') { setA(0.2); setB(0.2); setC(5.7) }
      if (value === 'spiral') { setA(0.15); setB(0.2); setC(8.5) }
      if (value === 'folded') { setA(0.25); setB(0.18); setC(5.4) }
    } else if (system === 'thomas') setA(value === 'classic' ? 0.208186 : value === 'soft' ? 0.17 : 0.3)
    else if (system === 'aizawa') { setA(value === 'classic' ? 0.95 : 0.82); setB(value === 'classic' ? 0.7 : 0.75); setC(value === 'classic' ? 0.6 : 0.68) }
    else setA(value === 'classic' ? 1.4 : 1.25)
    resetRef.current()
  }
  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY } }
  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return
    camera.current.y += (event.clientX - drag.current.x) * 0.006
    camera.current.x = Math.max(-1.3, Math.min(1.3, camera.current.x + (event.clientY - drag.current.y) * 0.006))
    drag.current = { x: event.clientX, y: event.clientY }
    setCameraState({ ...camera.current })
    drawRef.current()
  }
  const wheel = (event: WheelEvent) => { event.preventDefault(); camera.current.zoom = Math.max(0.45, Math.min(4.5, camera.current.zoom * Math.exp(-event.deltaY * 0.001))); setCameraState({ ...camera.current }); drawRef.current() }
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => canvas.removeEventListener('wheel', wheel)
  }, [])

  const configurations: [string, string][] = system === 'lorenz'
    ? [['classic', 'Classic butterfly'], ['threshold', 'Near transition'], ['wide', 'Wide wings'], ['custom', 'Custom']]
    : system === 'rossler'
      ? [['classic', 'Classic ribbon'], ['spiral', 'Long spiral'], ['folded', 'Folded ribbon'], ['custom', 'Custom']]
      : [['classic', 'Canonical orbit'], ['soft', 'Alternative orbit'], ['custom', 'Custom']]

  return <div className="experiment-surface">
    <canvas ref={canvasRef} className="experiment-canvas attractor-canvas" aria-label="Interactive three-dimensional strange attractor. Drag to rotate; scroll to zoom." aria-describedby={hint.visible ? 'attractors-first-move' : undefined} onPointerDown={(event) => { hint.dismiss(); pointerDown(event) }} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} />
    {hint.visible ? <aside className="scene-nudge" id="attractors-first-move" role="note"><span>Try this · Weather, Remembered</span><p>Drag the butterfly to turn it. Change ρ in Controls to see how a small change can reshape its path.</p><button onClick={hint.dismiss} aria-label="Dismiss first-move hint">×</button></aside> : <button className="scene-nudge-reopen" onClick={hint.show} aria-label="Show interaction tip" title="Show interaction tip">i</button>}
    <span className="canvas-coordinate">{systemNames[system].toUpperCase()} · RK4 · {trail.toLocaleString()} POINT TRAIL</span>
    <ControlPanel title="Weather, Remembered" note="STRANGE ATTRACTORS" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Dynamical system" value={system} options={Object.entries(systemNames).map(([key, name]) => [key, name])} onChange={chooseSystem} />
      <SelectControl label="Configuration" value={configuration} options={configurations} onChange={chooseConfiguration} />
      <p className="control-note">{system === 'lorenz' ? 'Lorenz: ρ changes the fold, σ changes how x responds to y−x, and β damps z.' : system === 'rossler' ? 'Rössler: a changes feedback in y, b sets the upward push in z, and c shifts where the trajectory folds.' : system === 'thomas' ? 'Thomas: b sets how strongly the same damping pulls each of x, y and z back toward the centre.' : system === 'aizawa' ? 'Aizawa: a shapes the vertical response, b shifts the centre of the turning, and c adds a vertical push.' : 'Halvorsen: a controls the damping shared by all three directions; changing it reshapes the orbit.'}</p>
      {system === 'lorenz' ? <>
        <RangeControl label="Lorenz ρ · bend" value={rho} min={10} max={45} step={0.1} onChange={(value) => { setRho(value); setConfiguration('custom') }} format={(value) => value.toFixed(1)} />
        <RangeControl label="Lorenz σ · x response" value={sigma} min={5} max={18} step={0.1} onChange={(value) => { setSigma(value); setConfiguration('custom') }} format={(value) => value.toFixed(1)} />
        <RangeControl label="Lorenz β · z damping" value={beta} min={1} max={5} step={0.01} onChange={(value) => { setBeta(value); setConfiguration('custom') }} format={(value) => value.toFixed(2)} />
      </> : system === 'rossler' ? <>
        <RangeControl label="a · growth" value={a} min={0.05} max={0.45} step={0.005} onChange={(value) => { setA(value); setConfiguration('custom') }} format={(value) => value.toFixed(3)} />
        <RangeControl label="b · drift" value={b} min={0.05} max={0.45} step={0.005} onChange={(value) => { setB(value); setConfiguration('custom') }} format={(value) => value.toFixed(3)} />
        <RangeControl label="c · folding" value={c} min={3} max={9} step={0.05} onChange={(value) => { setC(value); setConfiguration('custom') }} format={(value) => value.toFixed(2)} />
      </> : system === 'thomas' ? <RangeControl label="b · damping" value={a} min={0.05} max={0.38} step={0.001} onChange={(value) => { setA(value); setConfiguration('custom') }} format={(value) => value.toFixed(3)} />
        : system === 'aizawa' ? <>
          <RangeControl label="a · lift" value={a} min={0.55} max={1.25} step={0.005} onChange={(value) => { setA(value); setConfiguration('custom') }} format={(value) => value.toFixed(3)} />
          <RangeControl label="b · torus" value={b} min={0.4} max={1.1} step={0.005} onChange={(value) => { setB(value); setConfiguration('custom') }} format={(value) => value.toFixed(3)} />
          <RangeControl label="c · drift" value={c} min={0.3} max={1.1} step={0.005} onChange={(value) => { setC(value); setConfiguration('custom') }} format={(value) => value.toFixed(3)} />
        </> : <RangeControl label="a · symmetry" value={a} min={1} max={2} step={0.005} onChange={(value) => { setA(value); setConfiguration('custom') }} format={(value) => value.toFixed(3)} />}
      <SelectControl label="Light" value={palette} options={[['polar', 'Polar light'], ['aurora', 'Northern green'], ['ember', 'Ember'], ['glacial', 'Glacial glass']]} onChange={setPalette} />
      <RangeControl label="Simulation speed" value={speed} min={0.25} max={4} step={0.05} onChange={setSpeed} format={(value) => value.toFixed(1) + '×'} />
      <RangeControl label="Trail length" value={trail} min={2500} max={28000} step={500} onChange={setTrail} format={(value) => Math.round(value / 1000) + 'k points'} />
      <button className="panel-action" onClick={() => resetRef.current()}><span>Begin the orbit again</span><i>↺</i></button>
      <p className="control-note">These numbers change the equations, so the path itself changes. Rotate and zoom the projection; every curve is integrated with fourth-order Runge–Kutta.</p>
    </ControlPanel>
  </div>
}
