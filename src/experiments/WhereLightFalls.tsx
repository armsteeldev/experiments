import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ActionRow, ControlPanel, RangeControl, Segmented } from '../components/Controls'
import type { ExperimentControls } from '../types'
import { createLensingTable, rasterizeLensedSky, traceSchwarzschildPhoton } from '../simulations/lensing'
import type { LensingTable, PhotonTrace } from '../simulations/lensing'
import { clamp, resizeCanvas, safeState } from './invisibleWorld'
import './invisible-world.css'

type ViewMode = 'lensed sky' | 'trajectories'
type LensingStats = { outcome: PhotonTrace['outcome']; deflection: number | null; impact: number; radius: number }
type WorkerResponse = { type: 'table'; requestId: number; table: LensingTable } | { type: 'sky'; requestId: number; width: number; height: number; pixels: ArrayBuffer }

function seeded(seed: number) {
  let value = seed >>> 0
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296 }
}
function makeStarfield(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.fillStyle = '#050913'; context.fillRect(0, 0, width, height)
  const nebula = context.createRadialGradient(width * 0.47, height * 0.52, 0, width * 0.47, height * 0.52, width * 0.68)
  nebula.addColorStop(0, 'rgba(103,77,133,.2)'); nebula.addColorStop(0.35, 'rgba(42,80,113,.18)'); nebula.addColorStop(0.72, 'rgba(27,45,77,.1)'); nebula.addColorStop(1, 'rgba(7,10,18,0)')
  context.fillStyle = nebula; context.fillRect(0, 0, width, height)
  const random = seeded(72143)
  for (let i = 0; i < 980; i++) {
    const x = random() * width, y = random() * height, radius = 0.28 + random() * 1.15
    const warm = random() > 0.81, alpha = 0.14 + random() * 0.58
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2)
    context.fillStyle = warm ? `rgba(255,221,185,${alpha})` : `rgba(190,218,255,${alpha})`; context.fill()
    if (radius > 1.05 && random() > 0.72) {
      context.beginPath(); context.moveTo(x - 4, y); context.lineTo(x + 4, y); context.moveTo(x, y - 4); context.lineTo(x, y + 4)
      context.strokeStyle = `rgba(213,231,255,${alpha * 0.24})`; context.lineWidth = 0.5; context.stroke()
    }
  }
  return canvas
}

export default function WhereLightFalls({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const canvasRef = useRef<HTMLCanvasElement>(null), workerRef = useRef<Worker | null>(null), requestId = useRef(0), skyRequestId = useRef(0)
  const sizeRef = useRef({ width: 800, height: 560, dpr: 1 }), backgroundRef = useRef<HTMLCanvasElement | null>(null), baseSkyRef = useRef<HTMLCanvasElement | null>(null), traceRef = useRef<PhotonTrace | null>(null)
  const [size, setSize] = useState({ width: 800, height: 560 }), [mass, setMass] = useState(1), [distance, setDistance] = useState(36), [sourceRatio, setSourceRatio] = useState(0.58)
  const [impact, setImpact] = useState(5.45), [viewMode, setViewMode] = useState<ViewMode>('lensed sky'), [table, setTable] = useState<LensingTable | null>(null)
  const [loading, setLoading] = useState(true), [advanced, setAdvanced] = useState(false), [stats, setStats] = useState<LensingStats>({ outcome: 'escaped', deflection: 0, impact: 5.45, radius: 0 })
  const restored = useRef(false)
  const massRef = useRef(mass); massRef.current = mass
  const bCrit = 3 * Math.sqrt(3) * mass
  const trace = useMemo(() => traceSchwarzschildPhoton(impact, mass, { step: 0.012, radius: 140 * mass, maxAngle: 40, maxPoints: 7000 }), [impact, mass])
  const trajectoryBundle = useMemo(() => [1.004, 1.016, 1.04, 1.12, 1.35].map((factor) => traceSchwarzschildPhoton(3 * Math.sqrt(3) * mass * factor, mass, { step: 0.016, radius: 82 * mass, maxAngle: 24, maxPoints: 2600 })), [mass])

  useEffect(() => {
    if (!stateFromUrl || restored.current) return
    restored.current = true
    const b = safeState(stateFromUrl, 'impact', impact), d = safeState(stateFromUrl, 'distance', distance)
    if (typeof b === 'number' && b >= 3 && b <= 30) setImpact(b)
    if (typeof d === 'number' && d >= 20 && d <= 72) setDistance(d)
  }, [stateFromUrl, impact, distance])
  useEffect(() => { onShareState({ mass, distance, sourceRatio, impact, viewMode }) }, [mass, distance, sourceRatio, impact, viewMode, onShareState])

  useEffect(() => {
    let worker: Worker
    try { worker = new Worker(new URL('../workers/lensing.worker.ts', import.meta.url), { type: 'module' }) }
    catch { workerRef.current = null; return }
    workerRef.current = worker
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'table') {
        if (data.requestId !== requestId.current) return
        setTable(data.table); setLoading(false)
      } else {
        if (data.requestId !== skyRequestId.current) return
        const surface = document.createElement('canvas'); surface.width = data.width; surface.height = data.height
        surface.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height), 0, 0)
        backgroundRef.current = surface
      }
    }
    let disposed = false, fallbackTimer = 0
    worker.onerror = () => {
      worker.terminate(); workerRef.current = null; setLoading(false)
      fallbackTimer = window.setTimeout(() => { if (!disposed) setTable(createLensingTable(massRef.current, 90, 180)) }, 0)
    }
    return () => { disposed = true; clearTimeout(fallbackTimer); worker.terminate(); workerRef.current = null }
    // The worker is a per-exhibit resource and is recreated only on unmount/remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const id = ++requestId.current
    setLoading(true)
    const timer = window.setTimeout(() => {
      if (workerRef.current) workerRef.current.postMessage({ type: 'table', requestId: id, mass, maxImpact: 90, samples: 340 })
      else setTable(createLensingTable(mass, 90, 180))
    }, 85)
    return () => clearTimeout(timer)
  }, [mass])

  useEffect(() => {
    traceRef.current = trace
    setStats({ outcome: trace.outcome, deflection: trace.deflection, impact, radius: trace.closestApproach / mass })
  }, [trace, impact, mass])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const sizeNow = resizeCanvas(canvas, 1.15)
      sizeRef.current = sizeNow; setSize({ width: sizeNow.width, height: sizeNow.height })
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!size.width || !size.height) return
    const scale = Math.min(1, 480 / (size.width * sizeRef.current.dpr), 380 / (size.height * sizeRef.current.dpr))
    const width = Math.max(220, Math.round(size.width * sizeRef.current.dpr * scale)), height = Math.max(150, Math.round(size.height * sizeRef.current.dpr * scale))
    baseSkyRef.current = makeStarfield(width, height)
  }, [size])

  useEffect(() => {
    if (!table || table.mass !== mass || !size.width || !size.height) { backgroundRef.current = null; return }
    const scale = Math.min(1, 620 / (size.width * sizeRef.current.dpr), 500 / (size.height * sizeRef.current.dpr))
    const width = Math.max(240, Math.round(size.width * sizeRef.current.dpr * scale)), height = Math.max(160, Math.round(size.height * sizeRef.current.dpr * scale))
    const id = ++skyRequestId.current
    const timer = window.setTimeout(() => {
      if (workerRef.current) { workerRef.current.postMessage({ type: 'sky', requestId: id, width, height, distance, sourceRatio }); return }
      const pixels = rasterizeLensedSky(table, width, height, distance, sourceRatio), surface = document.createElement('canvas')
      surface.width = width; surface.height = height; surface.getContext('2d')?.putImageData(new ImageData(pixels, width, height), 0, 0)
      if (id === skyRequestId.current) backgroundRef.current = surface
    }, 90)
    return () => clearTimeout(timer)
  }, [table, size, distance, sourceRatio, mass])

  useEffect(() => {
    const canvas = canvasRef.current, context = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !context) return
    let animation = 0, time = 0, last = 0, disposed = false
    const draw = (now: number) => {
      if (disposed) return
      const { width, height, dpr } = sizeRef.current
      if (!paused && now - last > 20) { time += (now - last) * 0.001; last = now }
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.fillStyle = '#040811'; context.fillRect(0, 0, width, height)
      if (viewMode === 'lensed sky' && backgroundRef.current) context.drawImage(backgroundRef.current, 0, 0, width, height)
      else if (baseSkyRef.current) context.drawImage(baseSkyRef.current, 0, 0, width, height)
      const focal = height * 1.27, shadow = focal * Math.atan(bCrit / distance), horizon = focal * Math.atan(2 * mass / distance), photonSphere = focal * Math.atan(3 * mass / distance), cx = width * 0.5, cy = height * 0.5
      if (viewMode === 'lensed sky') {
        const halo = context.createRadialGradient(cx, cy, Math.max(1, shadow * 0.83), cx, cy, shadow * 1.19)
        halo.addColorStop(0, 'rgba(0,0,0,0)'); halo.addColorStop(0.53, 'rgba(216,169,124,.06)'); halo.addColorStop(0.7, 'rgba(245,212,173,.34)'); halo.addColorStop(0.83, 'rgba(133,188,222,.2)'); halo.addColorStop(1, 'rgba(88,137,190,0)')
        context.fillStyle = halo; context.beginPath(); context.arc(cx, cy, shadow * 1.2, 0, Math.PI * 2); context.fill()
        context.save(); context.translate(cx, cy); context.scale(1, 0.24)
        const disk = context.createRadialGradient(0, 0, shadow * 0.78, 0, 0, shadow * 1.85)
        disk.addColorStop(0, 'rgba(0,0,0,0)'); disk.addColorStop(0.28, 'rgba(0,0,0,0)'); disk.addColorStop(0.43, 'rgba(242,157,105,.17)'); disk.addColorStop(0.62, 'rgba(250,217,166,.24)'); disk.addColorStop(0.78, 'rgba(125,189,236,.12)'); disk.addColorStop(1, 'rgba(92,132,199,0)')
        context.fillStyle = disk; context.beginPath(); context.ellipse(0, 0, shadow * 2, shadow * 2, 0, 0, Math.PI * 2); context.fill()
        for (let ring = 0; ring < 4; ring++) {
          const radius = shadow * (1.02 + ring * 0.15)
          context.beginPath(); context.ellipse(0, 0, radius * 1.28, radius, time * 0.014 + ring * 0.08, 0, Math.PI * 2)
          context.strokeStyle = `rgba(${ring % 2 ? '238,179,119' : '130,198,229'},${0.22 + (Math.sin(time * 0.6 + ring) + 1) * 0.1})`
          context.lineWidth = ring === 1 ? 2.2 : 0.9; context.shadowColor = ring % 2 ? '#e6a574' : '#87c9e6'; context.shadowBlur = 13; context.stroke()
        }
        context.restore(); context.shadowBlur = 0
        context.beginPath(); context.arc(cx, cy, shadow, 0, Math.PI * 2); context.fillStyle = '#020307'; context.fill()
        context.beginPath(); context.arc(cx, cy, shadow * 1.008, 0, Math.PI * 2); context.strokeStyle = 'rgba(186,205,230,.24)'; context.lineWidth = 0.8; context.stroke()
        context.beginPath(); context.arc(cx, cy, horizon, 0, Math.PI * 2); context.strokeStyle = 'rgba(4,6,10,.98)'; context.lineWidth = 3; context.stroke()
      } else {
        const pixelsPerMass = focal / distance
        for (const sample of trajectoryBundle) {
          if (sample.points.length < 2) continue
          context.beginPath(); sample.points.forEach((point, index) => { const x = cx + point.x * pixelsPerMass, y = cy - point.y * pixelsPerMass; if (index === 0) context.moveTo(x, y); else context.lineTo(x, y) })
          context.strokeStyle = sample.captured ? 'rgba(239,157,119,.4)' : 'rgba(131,197,237,.38)'; context.lineWidth = 0.8; context.stroke()
        }
        const selectedTrace = traceRef.current
        if (selectedTrace?.points.length) {
          context.beginPath()
          selectedTrace.points.forEach((point, index) => {
            const x = cx + point.x * pixelsPerMass, y = cy - point.y * pixelsPerMass
            if (index === 0) context.moveTo(x, y); else context.lineTo(x, y)
          })
          context.strokeStyle = selectedTrace.outcome === 'captured' ? 'rgba(255,175,128,.78)' : selectedTrace.outcome === 'near-critical' ? 'rgba(225,176,255,.82)' : 'rgba(188,228,255,.78)'; context.lineWidth = 1.25; context.shadowColor = selectedTrace.outcome === 'captured' ? '#f09161' : '#8bd6ff'; context.shadowBlur = 11; context.stroke(); context.shadowBlur = 0
        }
        // Trajectories use the equatorial Schwarzschild plane. In this view the
        // mask is the physical 2M horizon; the 3M photon sphere is shown too.
        context.beginPath(); context.arc(cx, cy, horizon, 0, Math.PI * 2); context.fillStyle = '#020307'; context.fill()
        context.beginPath(); context.arc(cx, cy, photonSphere, 0, Math.PI * 2); context.strokeStyle = 'rgba(222,197,238,.42)'; context.lineWidth = 0.8; context.setLineDash([3, 5]); context.stroke(); context.setLineDash([])
        context.beginPath(); context.arc(cx, cy, horizon, 0, Math.PI * 2); context.strokeStyle = 'rgba(242,224,206,.34)'; context.lineWidth = 1; context.stroke()
      }
      context.font = '8px ui-monospace, monospace'; context.fillStyle = 'rgba(190,208,222,.56)'; context.textAlign = 'center'
      context.fillText('EVENT HORIZON · 2M', cx, cy + horizon + 17)
      context.textAlign = 'left'
      if (loading) { context.fillStyle = 'rgba(211,227,240,.7)'; context.fillText('COMPUTING SCHWARZSCHILD DEFLECTION TABLE…', 24, height - 28) }
      animation = requestAnimationFrame(draw)
    }
    animation = requestAnimationFrame(draw)
    return () => { disposed = true; cancelAnimationFrame(animation) }
  }, [paused, mass, distance, bCrit, loading, size, viewMode, trajectoryBundle])

  const setImpactFromPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(), dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2
    const focal = rect.height * 1.27, angle = Math.atan(Math.hypot(dx, dy) / focal), value = distance * Math.tan(angle)
    setImpact(clamp(value, 3.1 * mass, 28 * mass))
  }
  const canvasKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!event.key.startsWith('Arrow')) return
    event.preventDefault(); event.stopPropagation()
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1
    setImpact((value) => clamp(value + direction * 0.08 * mass, 3.1 * mass, 28 * mass))
  }
  const reset = () => { setMass(1); setDistance(36); setSourceRatio(0.58); setImpact(5.45); setViewMode('lensed sky') }
  const strongBending = stats.outcome === 'captured' ? 'Captured' : stats.outcome === 'near-critical' ? 'Near critical' : `${(stats.deflection! * 180 / Math.PI).toFixed(2)}°`
  const bOverM = stats.impact / mass
  const tableReady = Boolean(table)

  return <section className="iw-scene iw-lensing" aria-label="Numerical Schwarzschild gravitational lensing experiment">
    <canvas ref={canvasRef} className="iw-canvas iw-lensing-canvas" tabIndex={0} aria-label="Schwarzschild black hole lensing view. Click to choose an impact parameter; focus the canvas and use arrow keys to move toward or away from the capture boundary." onPointerDown={setImpactFromPointer} onKeyDown={canvasKeyDown} />
    <div className="iw-titleplate iw-titleplate-wide"><span>19 · RELATIVISTIC STUDY</span><strong>Where Light Falls</strong><small>Follow a photon close to the point of no return.</small></div>
    <div className="iw-lensing-readout iw-glass-surface" aria-live="polite"><span>{stats.outcome.toUpperCase()} TRAJECTORY</span><strong>{strongBending}</strong><div>b / M {bOverM.toFixed(3)} <i>·</i> rₘᵢₙ / M {stats.radius.toFixed(3)}</div></div>
    <div className="iw-lensing-caption"><span>Schwarzschild metric · non-rotating mass</span><span>{viewMode === 'lensed sky' ? 'Artistic disk layer · not radiative transfer' : 'Horizon 2M · photon sphere 3M'}</span></div>
    <ControlPanel title="Where light falls" note="Schwarzschild geodesics" visible={controlsVisible} onClose={onCloseControls} footer={<span>{tableReady ? 'Deflection table ready · image projection is a thin-lens approximation.' : 'Building a numerical deflection table in a worker.'}</span>}>
      <Segmented label="Explore" value={viewMode} options={[["lensed sky", "Lensed sky"], ["trajectories", "Ray path"]]} onChange={(value) => setViewMode(value as ViewMode)} />
      <RangeControl label="Mass scale" value={mass} min={0.55} max={1.45} step={0.01} format={(value) => `${value.toFixed(2)} M₀`} onChange={setMass} />
      <RangeControl label="Observer distance" value={distance} min={22} max={72} step={1} format={(value) => `${Math.round(value)} M₀`} onChange={setDistance} />
      {viewMode === 'lensed sky' && <RangeControl label="Source-plane ratio" value={sourceRatio} min={0.25} max={0.88} step={0.01} format={(value) => value.toFixed(2)} onChange={setSourceRatio} />}
      <RangeControl label="Impact parameter" value={impact} min={3.1 * mass} max={28 * mass} step={0.01} format={(value) => `${value.toFixed(2)} M₀`} onChange={setImpact} />
      <div className="iw-photon-measure iw-glass-inset"><span>{stats.outcome.toUpperCase()}</span><strong>{strongBending}</strong><div>b₍crit₎ = 3√3M = {bCrit.toFixed(3)} M</div><div>Photon sphere r = 3M · horizon r = 2M</div></div>
      <button className="iw-subtle-toggle" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced}>{advanced ? 'Hide' : 'Inspect'} the mathematical model</button>
      {advanced && <div className="iw-model-note"><strong>Equatorial null geodesic</strong><code>d²u/dφ² + u = 3Mu², &nbsp; u = 1/r</code><p>We integrate the Schwarzschild null-geodesic equation with RK4 from an asymptotic impact parameter b. Rays below b₍crit₎ = 3√3M cross the horizon; escaping rays approach a finite deflection. The sky image then applies a thin-lens source-plane projection to that numerically computed bending. Spacetime is non-rotating and uncharged; emission, polarization and radiative transfer are not modelled.</p></div>}
      <p className="control-note">Click a point in the field to choose its impact parameter. The capture boundary and trajectory come from the same geodesic model; the luminous disk is a clearly separate artistic layer.</p>
      <ActionRow><button className="panel-action" onClick={() => setImpact(bCrit * 1.015)}>Near-critical flyby</button><button className="panel-action" onClick={() => setImpact(bCrit * 0.91)}>Captured path</button></ActionRow>
      <ActionRow><button className="panel-action" onClick={reset}>Reset observer <i>↺</i></button></ActionRow>
    </ControlPanel>
  </section>
}
