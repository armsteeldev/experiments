import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ActionRow, ControlPanel, RangeControl, Segmented, SelectControl } from '../components/Controls'
import type { ExperimentControls } from '../types'
import { addWavePulse, createDoubleSlitState, createWaveState, setWaveBarrier, stepWave, waveEnergy } from '../simulations/waves'
import type { WaveState } from '../simulations/waves'
import { clamp, normalizedPointer, resizeCanvas, safeState } from './invisibleWorld'
import './invisible-world.css'

type Tool = 'pulse' | 'emitter' | 'barrier' | 'erase'
type Preset = 'slits' | 'interference' | 'standing'
type ViewMode = 'amplitude' | 'energy'

function makePreset(preset: Preset): WaveState {
  const state = preset === 'slits' ? createDoubleSlitState() : createWaveState()
  if (preset === 'interference') state.emitters.push(
    { x: state.width * 0.31, y: state.height * 0.49, frequency: 0.095, amplitude: 0.2, phase: 0, phaseJitter: 0, active: true },
    { x: state.width * 0.31, y: state.height * 0.55, frequency: 0.095, amplitude: 0.2, phase: 0, phaseJitter: 0, active: true },
  )
  if (preset === 'standing') state.emitters.push(
    { x: state.width * 0.24, y: state.height * 0.5, frequency: 0.082, amplitude: 0.2, phase: 0, phaseJitter: 0, active: true },
    { x: state.width * 0.76, y: state.height * 0.5, frequency: 0.082, amplitude: 0.2, phase: Math.PI, phaseJitter: 0, active: true },
  )
  stepWave(state, preset === 'slits' ? 150 : 100)
  return state
}

export default function WaveChamber({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const canvasRef = useRef<HTMLCanvasElement>(null), stateRef = useRef<WaveState | null>(null)
  const fieldCanvasRef = useRef<HTMLCanvasElement | null>(null), fieldPixelsRef = useRef<ImageData | null>(null)
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 })
  if (!stateRef.current) stateRef.current = makePreset('slits')
  const [frequency, setFrequency] = useState(0.095), [speed, setSpeed] = useState(0.72), [damping, setDamping] = useState(0.008)
  const [boundary, setBoundary] = useState<'reflect' | 'absorb'>('absorb'), [preset, setPreset] = useState<Preset>('slits')
  const [coherence, setCoherence] = useState<'coherent' | 'wandering'>('coherent'), [phaseOffset, setPhaseOffset] = useState(0)
  const [tool, setTool] = useState<Tool>('pulse'), [viewMode, setViewMode] = useState<ViewMode>('amplitude')
  const [probe, setProbe] = useState({ x: 96, y: 60 }), [telemetry, setTelemetry] = useState({ amplitude: 0, energy: 0 })
  const lastPoint = useRef<{ x: number; y: number } | null>(null), draggingEmitter = useRef<number | null>(null), repaintRef = useRef<() => void>(() => {})
  const probeRef = useRef(probe), lastProbeUi = useRef(0)
  const restored = useRef(false)

  useEffect(() => {
    if (!stateFromUrl || restored.current) return
    restored.current = true
    const initialFrequency = safeState(stateFromUrl, 'frequency', frequency)
    if (typeof initialFrequency === 'number' && initialFrequency >= 0.035 && initialFrequency <= 0.19) setFrequency(initialFrequency)
  }, [stateFromUrl, frequency])

  useEffect(() => { onShareState({ frequency, speed, damping, boundary, preset, viewMode, coherence, phaseOffset }) }, [frequency, speed, damping, boundary, preset, viewMode, coherence, phaseOffset, onShareState])
  useEffect(() => { const second = stateRef.current?.emitters[1]; if (second) second.phase = phaseOffset }, [phaseOffset])

  const paint = useCallback(() => {
    const canvas = canvasRef.current, state = stateRef.current
    if (!canvas || !state) return
    if (!sizeRef.current.width) sizeRef.current = resizeCanvas(canvas, 1.35)
    const size = sizeRef.current, context = canvas.getContext('2d', { alpha: false })
    if (!context) return
    if (!fieldCanvasRef.current) fieldCanvasRef.current = document.createElement('canvas')
    const field = fieldCanvasRef.current
    if (field.width !== state.width || field.height !== state.height || !fieldPixelsRef.current) {
      field.width = state.width; field.height = state.height
      fieldPixelsRef.current = field.getContext('2d')!.createImageData(state.width, state.height)
    }
    const fieldContext = field.getContext('2d', { alpha: false })
    if (!fieldContext) return
    const pixels = fieldPixelsRef.current!, data = pixels.data
    for (let i = 0; i < state.current.length; i++) {
      const value = viewMode === 'amplitude' ? state.current[i] : Math.abs(state.current[i] - state.previous[i]) * 2.1
      const amount = Math.min(1, Math.abs(value) * (viewMode === 'amplitude' ? 14 : 8))
      const positive = value >= 0
      const index = i * 4
      data[index] = Math.round(7 + amount * (positive ? 224 : 47))
      data[index + 1] = Math.round(14 + amount * (positive ? 148 : 185))
      data[index + 2] = Math.round(23 + amount * (positive ? 84 : 218))
      data[index + 3] = 255
      if (state.solid[i]) { data[index] = 25; data[index + 1] = 39; data[index + 2] = 50 }
    }
    fieldContext.putImageData(pixels, 0, 0)
    context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0)
    context.fillStyle = '#070d15'; context.fillRect(0, 0, size.width, size.height)
    context.imageSmoothingEnabled = true
    context.drawImage(field, 0, 0, size.width, size.height)
    const sx = size.width / state.width, sy = size.height / state.height
    for (const emitter of state.emitters) {
      const x = emitter.x * sx, y = emitter.y * sy
      const glow = context.createRadialGradient(x, y, 0, x, y, 26)
      glow.addColorStop(0, 'rgba(255,226,176,.38)'); glow.addColorStop(1, 'rgba(255,190,120,0)')
      context.fillStyle = glow; context.fillRect(x - 27, y - 27, 54, 54)
      context.beginPath(); context.arc(x, y, 4.3, 0, Math.PI * 2); context.fillStyle = '#ffdeb2'; context.fill()
      context.beginPath(); context.arc(x, y, 8, 0, Math.PI * 2); context.strokeStyle = 'rgba(255,226,188,.6)'; context.lineWidth = 1; context.stroke()
    }
    context.strokeStyle = 'rgba(188,224,240,.5)'; context.lineWidth = 0.7
    const sample = probeRef.current
    context.beginPath(); context.arc(sample.x * sx, sample.y * sy, 8, 0, Math.PI * 2); context.moveTo(sample.x * sx - 12, sample.y * sy); context.lineTo(sample.x * sx + 12, sample.y * sy); context.moveTo(sample.x * sx, sample.y * sy - 12); context.lineTo(sample.x * sx, sample.y * sy + 12); context.stroke()
  }, [viewMode])

  useEffect(() => { repaintRef.current = paint }, [paint])

  useEffect(() => {
    const canvas = canvasRef.current, state = stateRef.current
    if (!canvas || !state) return
    let frame = 0, timer = 0, previous = 0
    let disposed = false
    const render = (now: number) => {
      if (disposed) return
      state.speed = speed; state.damping = damping; state.boundary = boundary
      for (let index = 0; index < state.emitters.length; index++) { state.emitters[index].frequency = frequency; state.emitters[index].phaseJitter = coherence === 'wandering' ? 0.18 : 0 }
      if (!paused && now - previous > 15) { stepWave(state, 3); previous = now }
      repaintRef.current()
      frame = requestAnimationFrame(render)
    }
    const resize = new ResizeObserver(() => { sizeRef.current = resizeCanvas(canvas, 1.35); repaintRef.current() }); resize.observe(canvas)
    frame = requestAnimationFrame(render)
    timer = window.setInterval(() => {
      const { x, y } = probeRef.current
      setTelemetry({ amplitude: state.current[y * state.width + x] ?? 0, energy: waveEnergy(state) })
    }, 300)
    return () => { disposed = true; cancelAnimationFrame(frame); clearInterval(timer); resize.disconnect() }
  }, [paused, frequency, speed, damping, boundary, coherence])

  const applyPreset = (next: Preset) => { setPreset(next); setPhaseOffset(next === 'standing' ? Math.PI : 0); setCoherence('coherent'); stateRef.current = makePreset(next); repaintRef.current() }
  const reset = () => { setPhaseOffset(preset === 'standing' ? Math.PI : 0); setCoherence('coherent'); stateRef.current = makePreset(preset); repaintRef.current() }
  const pointOnGrid = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget, point = normalizedPointer(event, canvas), state = stateRef.current!
    return { x: clamp(Math.round(point.x * state.width), 0, state.width - 1), y: clamp(Math.round(point.y * state.height), 0, state.height - 1) }
  }
  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const state = stateRef.current!, point = pointOnGrid(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    lastPoint.current = point; probeRef.current = point; setProbe(point); lastProbeUi.current = performance.now()
    if (tool === 'pulse') addWavePulse(state, point.x, point.y)
    else if (tool === 'emitter') {
      const nearest = state.emitters.findIndex((emitter) => Math.hypot(emitter.x - point.x, emitter.y - point.y) < 10)
      if (nearest >= 0) draggingEmitter.current = nearest
      else { state.emitters.push({ x: point.x, y: point.y, frequency, amplitude: 0.21, phase: 0, phaseJitter: coherence === 'wandering' ? 0.18 : 0, active: true }); draggingEmitter.current = state.emitters.length - 1 }
    } else setWaveBarrier(state, point.x, point.y, point.x, point.y, 2.2, tool === 'barrier')
    repaintRef.current()
  }
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const state = stateRef.current!, point = pointOnGrid(event)
    probeRef.current = point
    if (performance.now() - lastProbeUi.current > 90) { setProbe(point); lastProbeUi.current = performance.now() }
    if (draggingEmitter.current !== null) {
      const emitter = state.emitters[draggingEmitter.current]
      if (emitter) { emitter.x = point.x; emitter.y = point.y }
    } else if (lastPoint.current && (tool === 'barrier' || tool === 'erase')) {
      setWaveBarrier(state, lastPoint.current.x, lastPoint.current.y, point.x, point.y, 2.2, tool === 'barrier')
    }
    lastPoint.current = point; repaintRef.current()
  }
  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    lastPoint.current = null; draggingEmitter.current = null
  }
  const clearEmitters = () => { stateRef.current!.emitters = []; repaintRef.current() }
  const clearBarriers = () => { stateRef.current!.solid.fill(0); repaintRef.current() }
  const manualStep = () => { const state = stateRef.current!; state.speed = speed; state.damping = damping; state.boundary = boundary; stepWave(state, 1); repaintRef.current() }
  const canvasKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key.startsWith('Arrow')) {
      event.preventDefault(); event.stopPropagation()
      const point = { x: clamp(probeRef.current.x + (event.key === 'ArrowRight' ? 4 : event.key === 'ArrowLeft' ? -4 : 0), 0, stateRef.current!.width - 1), y: clamp(probeRef.current.y + (event.key === 'ArrowDown' ? 4 : event.key === 'ArrowUp' ? -4 : 0), 0, stateRef.current!.height - 1) }
      probeRef.current = point; setProbe(point); repaintRef.current(); return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation()
      const state = stateRef.current!, point = probeRef.current
      if (tool === 'pulse') addWavePulse(state, point.x, point.y)
      else if (tool === 'emitter') state.emitters.push({ x: point.x, y: point.y, frequency, amplitude: 0.21, phase: 0, phaseJitter: coherence === 'wandering' ? 0.18 : 0, active: true })
      else setWaveBarrier(state, point.x, point.y, point.x, point.y, 2.2, tool === 'barrier')
      repaintRef.current()
    }
  }

  return <section className="iw-scene iw-wave" aria-label="Interactive finite-difference wave chamber">
    <canvas ref={canvasRef} className="iw-canvas iw-wave-canvas" tabIndex={0} aria-label="Live wave tank. Tap or drag to create a pulse. With the canvas focused, use arrow keys to move the probe and Enter to apply the selected tool." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onKeyDown={canvasKeyDown} />
    <div className="iw-titleplate"><span>14 · FIELD STUDY</span><strong>The Wave Chamber</strong><small>Where two waves meet, a pattern appears.</small></div>
    <div className="iw-instruction"><i /> {tool === 'pulse' ? 'Tap the surface to send a pulse' : tool === 'emitter' ? 'Place or move a continuous source' : tool === 'barrier' ? 'Draw a boundary into the water' : 'Erase a path through the boundary'}</div>
    <div className="iw-wave-tools iw-glass-surface" role="group" aria-label="Wave surface tools">
      {(['pulse', 'emitter', 'barrier', 'erase'] as Tool[]).map((value) => <button key={value} className={tool === value ? 'is-selected' : ''} onClick={() => setTool(value)} aria-pressed={tool === value}>{value === 'pulse' ? 'Pulse' : value === 'emitter' ? 'Emitter' : value === 'barrier' ? 'Draw wall' : 'Erase'}</button>)}
    </div>
    <div className="iw-wave-meter iw-glass-surface" aria-live="polite"><span>PROBE · {probe.x}, {probe.y}</span><strong>{telemetry.amplitude >= 0 ? '+' : ''}{telemetry.amplitude.toFixed(3)} <small>AMPLITUDE</small></strong><div>λc {(speed / Math.max(0.001, frequency)).toFixed(1)} cells <i>·</i> ⟨v²⟩ {telemetry.energy.toFixed(4)}</div></div>
    <ControlPanel title="Wave chamber" note="Finite differences · 2D" visible={controlsVisible} onClose={onCloseControls} footer={<span>Courant number {(speed * 0.72).toFixed(3)} / limit 0.707</span>}>
      <div className="iw-panel-section"><span>Choose a beginning</span><div className="iw-button-row">
        <button className={preset === 'slits' ? 'selected' : ''} onClick={() => applyPreset('slits')}>Double slit</button><button className={preset === 'interference' ? 'selected' : ''} onClick={() => applyPreset('interference')}>In phase</button><button className={preset === 'standing' ? 'selected' : ''} onClick={() => applyPreset('standing')}>Standing</button>
      </div></div>
      <Segmented label="Read the field" value={viewMode} options={[["amplitude", "Amplitude"], ["energy", "Energy"]]} onChange={(value) => setViewMode(value as ViewMode)} />
      {preset !== 'slits' && <>
        <Segmented label="Source relation" value={coherence} options={[["coherent", "Phase locked"], ["wandering", "Phase wander"]]} onChange={(value) => setCoherence(value as 'coherent' | 'wandering')} />
        <RangeControl label="Relative phase · source 2" value={phaseOffset} min={-Math.PI} max={Math.PI} step={0.01} format={(value) => `${(value * 180 / Math.PI).toFixed(0)}°`} onChange={setPhaseOffset} />
      </>}
      <RangeControl label="Frequency" value={frequency} min={0.035} max={0.19} step={0.001} format={(value) => `${value.toFixed(3)} cycles / unit`} onChange={(value) => { setFrequency(value); for (const emitter of stateRef.current!.emitters) emitter.frequency = value }} />
      <RangeControl label="Wave speed" value={speed} min={0.35} max={0.95} step={0.01} format={(value) => value.toFixed(2)} onChange={(value) => setSpeed(Math.min(value, 0.97 / Math.sqrt(2) / 0.72))} />
      <RangeControl label="Damping" value={damping} min={0} max={0.055} step={0.001} format={(value) => value.toFixed(3)} onChange={setDamping} />
      <SelectControl label="Outer edge" value={boundary} options={[["absorb", "Absorbing sponge"], ["reflect", "Reflective · no flux"]]} onChange={(value) => setBoundary(value as 'absorb' | 'reflect')} />
      <p className="control-note">Phase wander applies a reproducible random walk to source phase; it approximates finite coherence. Solid strokes impose zero normal flux; absorbing edges add a graded damping layer. λc is the continuum estimate c / f.</p>
      <ActionRow><button className="panel-action" onClick={manualStep}>Advance one stable step <i>→</i></button><button className="panel-action" onClick={reset}>Reset field <i>↺</i></button></ActionRow>
      <ActionRow><button className="panel-action" onClick={clearEmitters}>Remove emitters</button><button className="panel-action" onClick={clearBarriers}>Clear barriers</button></ActionRow>
    </ControlPanel>
  </section>
}
