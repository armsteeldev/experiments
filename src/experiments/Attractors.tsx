import { useEffect, useRef, useState } from 'react'
import type { PointerEvent, WheelEvent } from 'react'
import type { ExperimentControls } from '../types'
import { ControlPanel, RangeControl, SelectControl } from '../components/Controls'

type Point3 = { x: number; y: number; z: number }
type SystemName = 'lorenz' | 'rossler' | 'thomas' | 'aizawa' | 'halvorsen'
type Camera = { x: number; y: number; zoom: number }
function cameraFor(system: SystemName, state?: Record<string, unknown> | null): Camera {
  const shared = state?.camera as Partial<Camera> | undefined
  if (shared && Number.isFinite(Number(shared.x)) && Number.isFinite(Number(shared.y)) && Number.isFinite(Number(shared.zoom))) {
    return { x: Number(shared.x), y: Number(shared.y), zoom: Math.max(0.45, Math.min(4.5, Number(shared.zoom))) }
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

function derivative(p: Point3, system: SystemName, q: { rho: number; sigma: number; beta: number; a: number; b: number; c: number }) {
  if (system === 'lorenz') return { x: q.sigma * (p.y - p.x), y: p.x * (q.rho - p.z) - p.y, z: p.x * p.y - q.beta * p.z }
  if (system === 'rossler') return { x: -p.y - p.z, y: p.x + q.a * p.y, z: q.b + p.z * (p.x - q.c) }
  if (system === 'thomas') return { x: Math.sin(p.y) - q.a * p.x, y: Math.sin(p.z) - q.a * p.y, z: Math.sin(p.x) - q.a * p.z }
  if (system === 'aizawa') return {
    x: (p.z - q.b) * p.x - 3.5 * p.y,
    y: 3.5 * p.x + (p.z - q.b) * p.y,
    z: q.c + q.a * p.z - p.z * p.z * p.z / 3 - (p.x * p.x + p.y * p.y) * (1 + 0.25 * p.z) + 0.1 * p.z * p.x * p.x * p.x,
  }
  const a = q.a
  return {
    x: -a * p.x - 4 * p.y - 4 * p.z - p.y * p.y,
    y: -a * p.y - 4 * p.z - 4 * p.x - p.z * p.z,
    z: -a * p.z - 4 * p.x - 4 * p.y - p.x * p.x,
  }
}
function add(p: Point3, v: Point3, amount: number): Point3 { return { x: p.x + v.x * amount, y: p.y + v.y * amount, z: p.z + v.z * amount } }
function rk4(p: Point3, dt: number, system: SystemName, q: { rho: number; sigma: number; beta: number; a: number; b: number; c: number }): Point3 {
  const k1 = derivative(p, system, q)
  const k2 = derivative(add(p, k1, dt / 2), system, q)
  const k3 = derivative(add(p, k2, dt / 2), system, q)
  const k4 = derivative(add(p, k3, dt), system, q)
  return {
    x: p.x + dt / 6 * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
    y: p.y + dt / 6 * (k1.y + 2 * k2.y + 2 * k3.y + k4.y),
    z: p.z + dt / 6 * (k1.z + 2 * k2.z + 2 * k3.z + k4.z),
  }
}

export default function Attractors({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const path = useRef<Point3[]>([])
  const trajectoryCenter = useRef<Point3>({ x: 0, y: 0, z: 0 })
  const point = useRef<Point3>({ x: 0.1, y: 0, z: 0 })
  const [cameraState, setCameraState] = useState<Camera>(() => {
    const initial = Object.keys(systemNames).includes(String(stateFromUrl?.system)) ? stateFromUrl?.system as SystemName : 'lorenz'
    return cameraFor(initial, stateFromUrl)
  })
  const camera = useRef<Camera>(cameraState)
  camera.current = cameraState
  const drag = useRef<{ x: number; y: number } | null>(null)
  const drawRef = useRef<() => void>(() => {})
  const resetRef = useRef<() => void>(() => {})
  const [system, setSystem] = useState<SystemName>(() => Object.keys(systemNames).includes(String(stateFromUrl?.system)) ? stateFromUrl?.system as SystemName : 'lorenz')
  const [configuration, setConfiguration] = useState('classic')
  const [speed, setSpeed] = useState(() => Number(stateFromUrl?.speed) || 1.8)
  const [trail, setTrail] = useState(() => Number(stateFromUrl?.trail) || 16000)
  const [palette, setPalette] = useState(() => typeof stateFromUrl?.palette === 'string' ? stateFromUrl.palette : 'polar')
  const [rho, setRho] = useState(() => Number(stateFromUrl?.rho) || 28)
  const [sigma, setSigma] = useState(() => Number(stateFromUrl?.sigma) || 10)
  const [beta, setBeta] = useState(() => Number(stateFromUrl?.beta) || 8 / 3)
  const [a, setA] = useState(() => Number(stateFromUrl?.a) || (stateFromUrl?.system === 'thomas' ? 0.208186 : stateFromUrl?.system === 'halvorsen' ? 1.4 : stateFromUrl?.system === 'aizawa' ? 0.95 : 0.2))
  const [b, setB] = useState(() => Number(stateFromUrl?.b) || (stateFromUrl?.system === 'aizawa' ? 0.7 : 0.2))
  const [c, setC] = useState(() => Number(stateFromUrl?.c) || (stateFromUrl?.system === 'aizawa' ? 0.6 : 5.7))
  const params = useRef({ system, speed, trail, palette, rho, sigma, beta, a, b, c, paused })
  params.current = { system, speed, trail, palette, rho, sigma, beta, a, b, c, paused }
  useEffect(() => { onShareState({ system, speed, trail, palette, rho, sigma, beta, a, b, c, camera: cameraState }) }, [system, speed, trail, palette, rho, sigma, beta, a, b, c, cameraState, onShareState])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    let width = 0, height = 0, raf = 0, previous = 0
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
    const projection = (p: Point3, q: typeof params.current) => {
      const yaw = camera.current.y, pitch = camera.current.x
      const centered = { x: p.x - trajectoryCenter.current.x, y: p.y - trajectoryCenter.current.y, z: p.z - trajectoryCenter.current.z }
      const x = centered.x * Math.cos(yaw) - centered.z * Math.sin(yaw)
      const z0 = centered.x * Math.sin(yaw) + centered.z * Math.cos(yaw)
      const y = centered.y * Math.cos(pitch) - z0 * Math.sin(pitch)
      const z = centered.y * Math.sin(pitch) + z0 * Math.cos(pitch)
      const scale = Math.min(width, height) * 0.4 * camera.current.zoom / extent[q.system]
      const depth = 4.5 / (4.5 + z / extent[q.system] * 0.6)
      return { x: width / 2 + x * scale * depth, y: height / 2 - y * scale * depth, z: z / extent[q.system] }
    }
    const colorAt = (index: number, depth: number, length: number) => {
      const stops = palettes[parameters().palette] || palettes.polar
      const t = Math.max(0, Math.min(0.9999, index / Math.max(1, length) * 0.78 + (depth + 1) * 0.11))
      const position = t * 2
      const segment = Math.min(1, Math.floor(position))
      const mix = position - segment
      const first = stops[segment], second = stops[segment + 1]
      const rgb = [1, 3, 5].map((offset) => Math.round(parseInt(first.slice(offset, offset + 2), 16) * (1 - mix) + parseInt(second.slice(offset, offset + 2), 16) * mix))
      return { color: 'rgb(' + rgb.join(',') + ')', alpha: 0.42 + 0.48 * Math.max(0, Math.min(1, (depth + 1.3) / 2.6)) }
    }
    const draw = () => {
      if (!width || !height) return
      ctx.fillStyle = '#080c14'
      ctx.fillRect(0, 0, width, height)
      const q = parameters(), points = path.current
      if (points.length < 2) return
      const projected = points.map((p) => projection(p, q))
      const groups = 24
      const groupSize = Math.ceil((projected.length - 1) / groups)
      for (let group = 0; group < groups; group++) {
        const from = group * groupSize, to = Math.min(projected.length - 1, from + groupSize)
        if (to <= from) continue
        const start = projected[from], end = projected[to]
        const shade = colorAt(to, end.z, projected.length)
        ctx.beginPath()
        ctx.moveTo(start.x, start.y)
        for (let i = from + 1; i <= to; i++) ctx.lineTo(projected[i].x, projected[i].y)
        ctx.globalAlpha = shade.alpha * 0.18
        ctx.strokeStyle = shade.color
        ctx.lineWidth = 5.5
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()
        ctx.globalAlpha = shade.alpha
        ctx.lineWidth = 1.25 + Math.max(0, end.z) * 0.42
        ctx.stroke()
      }
      const head = projected[projected.length - 1]
      ctx.globalAlpha = 0.9
      ctx.fillStyle = (palettes[q.palette] || palettes.polar)[2]
      ctx.beginPath()
      ctx.arc(head.x, head.y, 2.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    drawRef.current = draw
    resetRef.current = () => {
      path.current = []
      trajectoryCenter.current = { x: 0, y: 0, z: 0 }
      point.current = { x: 0.1, y: 0, z: 0 }
      draw()
    }
    const warm = () => {
      const q = parameters()
      const dt = q.system === 'lorenz' ? 0.004 : q.system === 'aizawa' ? 0.008 : 0.01
      point.current = { x: 0.1, y: 0, z: 0 }
      const burnIn = q.system === 'lorenz' ? 2600 : 4200
      for (let i = 0; i < burnIn; i++) {
        point.current = rk4(point.current, dt, q.system, q)
        if (!Number.isFinite(point.current.x + point.current.y + point.current.z)) { point.current = { x: 0.1, y: 0, z: 0 }; break }
      }
      for (let i = 0; i < q.trail; i++) {
        point.current = rk4(point.current, dt, q.system, q)
        if (Number.isFinite(point.current.x + point.current.y + point.current.z)) path.current.push(point.current)
        else { path.current = []; point.current = { x: 0.1, y: 0, z: 0 }; break }
      }
      if (path.current.length) {
        const center = path.current.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y, z: sum.z + p.z }), { x: 0, y: 0, z: 0 })
        trajectoryCenter.current = { x: center.x / path.current.length, y: center.y / path.current.length, z: center.z / path.current.length }
      }
    }
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (document.hidden || parameters().paused || now - previous < 28) return
      const elapsed = Math.min(2, (now - previous) / 16.67 || 1)
      previous = now
      const q = parameters()
      if (!path.current.length) warm()
      const dt = q.system === 'lorenz' ? 0.004 : q.system === 'aizawa' ? 0.008 : 0.01
      const count = Math.max(1, Math.round(q.speed * elapsed * 11))
      for (let i = 0; i < count; i++) {
        point.current = rk4(point.current, dt, q.system, q)
        path.current.push(point.current)
      }
      if (path.current.length > q.trail) path.current.splice(0, path.current.length - q.trail)
      draw()
    }
    resize()
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); observer.disconnect(); path.current = []; resetRef.current = () => {}; drawRef.current = () => {} }
  }, [])

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
  const wheel = (event: WheelEvent<HTMLCanvasElement>) => { event.preventDefault(); camera.current.zoom = Math.max(0.45, Math.min(4.5, camera.current.zoom * Math.exp(-event.deltaY * 0.001))); setCameraState({ ...camera.current }); drawRef.current() }

  const configurations: [string, string][] = system === 'lorenz'
    ? [['classic', 'Classic butterfly'], ['threshold', 'Near transition'], ['wide', 'Wide wings'], ['custom', 'Custom']]
    : system === 'rossler'
      ? [['classic', 'Classic ribbon'], ['spiral', 'Long spiral'], ['folded', 'Folded ribbon'], ['custom', 'Custom']]
      : [['classic', 'Canonical orbit'], ['soft', 'Alternative orbit'], ['custom', 'Custom']]

  return <div className="experiment-surface">
    <canvas ref={canvasRef} className="experiment-canvas attractor-canvas" aria-label="Interactive three-dimensional strange attractor. Drag to rotate; scroll to zoom." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onWheel={wheel} />
    <span className="canvas-coordinate">{systemNames[system].toUpperCase()} · RK4 · {trail.toLocaleString()} POINT TRAIL</span>
    <ControlPanel title="Weather, Remembered" note="STRANGE ATTRACTORS" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Dynamical system" value={system} options={Object.entries(systemNames).map(([key, name]) => [key, name])} onChange={chooseSystem} />
      <SelectControl label="Configuration" value={configuration} options={configurations} onChange={chooseConfiguration} />
      {system === 'lorenz' ? <>
        <RangeControl label="ρ · instability" value={rho} min={10} max={45} step={0.1} onChange={(value) => { setRho(value); setConfiguration('custom') }} format={(value) => value.toFixed(1)} />
        <RangeControl label="σ · coupling" value={sigma} min={5} max={18} step={0.1} onChange={(value) => { setSigma(value); setConfiguration('custom') }} format={(value) => value.toFixed(1)} />
        <RangeControl label="β · geometry" value={beta} min={1} max={5} step={0.01} onChange={(value) => { setBeta(value); setConfiguration('custom') }} format={(value) => value.toFixed(2)} />
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
      <p className="control-note">Rotate and zoom the projection. Every curve is integrated from its system’s differential equations with fourth-order Runge–Kutta.</p>
    </ControlPanel>
  </div>
}
