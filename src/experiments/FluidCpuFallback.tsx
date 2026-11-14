import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { ExperimentControls } from '../types'
import { ControlPanel, RangeControl, SelectControl } from '../components/Controls'
import { useDiscoveryHint } from '../lib/useDiscoveryHint'

const MAX_CELLS = 90_000
const pigment: Record<string, [number, number, number]> = {
  aurora: [72, 196, 211], petal: [223, 111, 165], ember: [246, 145, 72], violet: [155, 128, 231],
}
const accent: Record<string, [number, number, number]> = {
  aurora: [224, 112, 171], petal: [76, 193, 205], ember: [117, 139, 232], violet: [238, 154, 96],
}

type FluidState = {
  w: number; h: number; n: number
  u: Float32Array; v: Float32Array; u0: Float32Array; v0: Float32Array
  pressure: Float32Array; pressure2: Float32Array; divergence: Float32Array; curl: Float32Array
  dye: Float32Array[]; dye0: Float32Array[]; image: ImageData
}
type PointerTrace = { x: number; y: number; oldX: number; oldY: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function gridFor(width: number, height: number) {
  const aspect = Math.max(0.28, Math.min(3.6, width / Math.max(1, height)))
  if (aspect >= 1) {
    const w = Math.round(Math.sqrt(MAX_CELLS * aspect))
    return { w, h: Math.round(w / aspect) }
  }
  const h = Math.round(Math.sqrt(MAX_CELLS / aspect))
  return { w: Math.round(h * aspect), h }
}

function createFluid(w: number, h: number, ctx: CanvasRenderingContext2D): FluidState {
  const n = w * h
  return {
    w, h, n,
    u: new Float32Array(n), v: new Float32Array(n), u0: new Float32Array(n), v0: new Float32Array(n),
    pressure: new Float32Array(n), pressure2: new Float32Array(n), divergence: new Float32Array(n), curl: new Float32Array(n),
    dye: [new Float32Array(n), new Float32Array(n), new Float32Array(n)],
    dye0: [new Float32Array(n), new Float32Array(n), new Float32Array(n)],
    image: ctx.createImageData(w, h),
  }
}

function sample(field: Float32Array, w: number, h: number, x: number, y: number) {
  x = clamp(x, 0.001, w - 1.002); y = clamp(y, 0.001, h - 1.002)
  const x0 = x | 0, y0 = y | 0, x1 = x0 + 1, y1 = y0 + 1
  const tx = x - x0, ty = y - y0, row = y0 * w, next = y1 * w
  const a = field[row + x0] * (1 - tx) + field[row + x1] * tx
  const b = field[next + x0] * (1 - tx) + field[next + x1] * tx
  return a * (1 - ty) + b * ty
}

function diffuse(field: Float32Array, source: Float32Array, w: number, h: number, amount: number, dt: number) {
  if (amount < 0.002) return
  const a = amount * dt * 21
  const denominator = 1 + 4 * a
  for (let pass = 0; pass < 7; pass++) {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      field[i] = (source[i] + a * (field[i - 1] + field[i + 1] + field[i - w] + field[i + w])) / denominator
    }
  }
}

function advect(field: Float32Array, source: Float32Array, u: Float32Array, v: Float32Array, w: number, h: number, dt: number, fade = 1) {
  const stride = dt * 30
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    field[i] = sample(source, w, h, x - u[i] * stride, y - v[i] * stride) * fade
  }
}

function confineVorticity(s: FluidState, dt: number) {
  const { w, h, u, v, curl } = s
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    curl[i] = 0.5 * (v[i + 1] - v[i - 1] - u[i + w] + u[i - w])
  }
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x
    const gx = Math.abs(curl[i + 1]) - Math.abs(curl[i - 1])
    const gy = Math.abs(curl[i + w]) - Math.abs(curl[i - w])
    const length = Math.hypot(gx, gy) + 1e-5
    const force = 0.42 * curl[i] * dt * 30 / length
    u[i] += gy * force
    v[i] -= gx * force
  }
}

function project(s: FluidState) {
  const { w, h, u, v, pressure, pressure2, divergence } = s
  pressure.fill(0)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    divergence[i] = -0.5 * (u[i + 1] - u[i - 1] + v[i + w] - v[i - w])
  }
  let p = pressure, next = pressure2
  for (let pass = 0; pass < 18; pass++) {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      next[i] = (p[i - 1] + p[i + 1] + p[i - w] + p[i + w] + divergence[i]) * 0.25
    }
    const swap = p; p = next; next = swap
  }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    u[i] -= 0.5 * (p[i + 1] - p[i - 1])
    v[i] -= 0.5 * (p[i + w] - p[i - w])
  }
  s.pressure = p; s.pressure2 = next

}

function inject(s: FluidState, x: number, y: number, dx: number, dy: number, color: [number, number, number], radius: number, impulse: number) {
  const cx = clamp(Math.round(x), 2, s.w - 3), cy = clamp(Math.round(y), 2, s.h - 3)
  for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
    const distance = ox * ox + oy * oy
    if (distance > radius * radius) continue
    const falloff = Math.exp(-distance / (radius * radius * 0.32)), i = (cy + oy) * s.w + cx + ox
    s.u[i] += dx * impulse * falloff
    s.v[i] += dy * impulse * falloff
    for (let channel = 0; channel < 3; channel++) {
      s.dye[channel][i] = Math.min(1.6, s.dye[channel][i] + color[channel] / 255 * falloff * 0.68)
    }
  }
}

function seedScene(s: FluidState, mode: string, colorName: string) {
  s.u.fill(0); s.v.fill(0); s.pressure.fill(0); s.pressure2.fill(0)
  for (const channel of [...s.dye, ...s.dye0]) channel.fill(0)
  const base = pigment[colorName] || pigment.aurora, second = accent[colorName] || accent.aurora
  const scale = Math.min(s.w, s.h), radius = Math.max(5, Math.round(scale * 0.105))
  const blob = (cx: number, cy: number, color: [number, number, number], direction: number, spin: number, size = radius) => {
    for (let oy = -size * 2; oy <= size * 2; oy++) for (let ox = -size * 2; ox <= size * 2; ox++) {
      const x = Math.round(cx + ox), y = Math.round(cy + oy)
      if (x < 2 || y < 2 || x >= s.w - 2 || y >= s.h - 2) continue
      const r2 = ox * ox + oy * oy, strength = Math.exp(-r2 / (size * size * 1.7))
      if (strength < 0.025) continue
      const i = y * s.w + x
      for (let c = 0; c < 3; c++) s.dye[c][i] += color[c] / 255 * strength * 0.92
      const tangent = spin * strength
      s.u[i] += direction * strength - oy / size * tangent
      s.v[i] += oy / size * 0.12 * strength + ox / size * tangent
    }
  }
  if (mode === 'vortex') {
    blob(s.w * 0.5, s.h * 0.51, base, 0, 2.6, radius * 1.25)
    blob(s.w * 0.5, s.h * 0.51, second, 0, -1.9, radius * 0.46)
  } else if (mode === 'still') {
    blob(s.w * 0.48, s.h * 0.51, base, 0, 0.12, radius * 0.82)
  } else {
    blob(s.w * 0.32, s.h * 0.48, base, 1.45, -0.68)
    blob(s.w * 0.68, s.h * 0.55, second, -1.35, 0.72)
    blob(s.w * 0.5, s.h * 0.72, base, 0.38, 0.84, radius * 0.46)
  }
}

export default function Fluid({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const hint = useDiscoveryHint('fluid')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<() => void>(() => {})
  const simulation = useRef<FluidState | null>(null)
  const pointer = useRef<PointerTrace | null>(null)
  const renderer = useRef<{ ctx: CanvasRenderingContext2D; off: HTMLCanvasElement; offctx: CanvasRenderingContext2D } | null>(null)
  const [palette, setPalette] = useState(() => typeof stateFromUrl?.palette === 'string' && pigment[stateFromUrl.palette] ? stateFromUrl.palette : 'aurora')
  const [viscosity, setViscosity] = useState(() => {
    const value = Number(stateFromUrl?.viscosity)
    return clamp(Number.isFinite(value) ? value : 0.13, 0, 0.9)
  })
  const [dissipation, setDissipation] = useState(() => clamp(Number(stateFromUrl?.dissipation) || 0.996, 0.94, 0.999))
  const [presetName, setPresetName] = useState('crossing')
  const params = useRef({ palette, viscosity, dissipation, paused })
  params.current = { palette, viscosity, dissipation, paused }
  useEffect(() => { onShareState({ palette, viscosity, dissipation }) }, [palette, viscosity, dissipation, onShareState])

  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    const off = document.createElement('canvas')
    const offctx = off.getContext('2d', { alpha: false })
    if (!offctx) return
    renderer.current = { ctx, off, offctx }
    let raf = 0, last = 0, previousAspect = 0
    const draw = () => {
      const s = simulation.current, output = renderer.current
      if (!s || !output) return
      const data = s.image.data
      for (let i = 0; i < s.n; i++) {
        const r = s.dye[0][i], g = s.dye[1][i], b = s.dye[2][i]
        const glow = Math.min(1, (r + g + b) * 0.31), idx = i * 4
        data[idx] = 5 + Math.min(250, r * 228 + g * 34 + b * 20 + glow * 20)
        data[idx + 1] = 8 + Math.min(246, g * 222 + r * 24 + b * 30 + glow * 25)
        data[idx + 2] = 14 + Math.min(241, b * 225 + r * 24 + g * 34 + glow * 35)
        data[idx + 3] = 255
      }
      output.offctx.putImageData(s.image, 0, 0)
      output.ctx.imageSmoothingEnabled = true
      output.ctx.drawImage(output.off, 0, 0, canvas.width, canvas.height)
    }
    drawRef.current = draw
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const dpr = Math.min(devicePixelRatio || 1, 2)
      const pixelWidth = Math.max(1, Math.floor(rect.width * dpr)), pixelHeight = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight }
      const aspect = rect.width / rect.height
      if (Math.abs(aspect - previousAspect) > 0.015) {
        const size = gridFor(rect.width, rect.height), old = simulation.current, next = createFluid(size.w, size.h, offctx)
        if (old) {
          for (let y = 1; y < next.h - 1; y++) for (let x = 1; x < next.w - 1; x++) {
            const i = y * next.w + x, ox = x / next.w * old.w, oy = y / next.h * old.h
            next.u[i] = sample(old.u, old.w, old.h, ox, oy) * next.w / old.w
            next.v[i] = sample(old.v, old.w, old.h, ox, oy) * next.h / old.h
            for (let c = 0; c < 3; c++) next.dye[c][i] = sample(old.dye[c], old.w, old.h, ox, oy)
          }
          if (pointer.current) { pointer.current.x *= next.w / old.w; pointer.current.oldX *= next.w / old.w; pointer.current.y *= next.h / old.h; pointer.current.oldY *= next.h / old.h }
        }
        simulation.current = next
        off.width = next.w; off.height = next.h
        previousAspect = aspect
        if (!old) seedScene(next, 'crossing', params.current.palette)
      }
      drawRef.current()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const s = simulation.current, output = renderer.current
      if (!s || !output || document.hidden || params.current.paused || now - last < 33) return
      const dt = Math.min(0.035, (now - last) / 1000 || 1 / 30)
      last = now

      if (pointer.current) {
        const p = pointer.current, trace = [p.x - p.oldX, p.y - p.oldY]
        const color = pigment[params.current.palette] || pigment.aurora
        inject(s, p.x, p.y, trace[0], trace[1], color, Math.max(4, Math.round(Math.min(s.w, s.h) * 0.04)), 0.78)
        p.oldX = p.x; p.oldY = p.y
      }

      const { w, h } = s
      s.u0.set(s.u); s.v0.set(s.v)
      diffuse(s.u, s.u0, w, h, params.current.viscosity * 0.55, dt)
      diffuse(s.v, s.v0, w, h, params.current.viscosity * 0.55, dt)
      s.u0.set(s.u); s.v0.set(s.v)
      advect(s.u, s.u0, s.u0, s.v0, w, h, dt)
      advect(s.v, s.v0, s.u0, s.v0, w, h, dt)
      confineVorticity(s, dt)
      project(s)

      const fade = Math.pow(params.current.dissipation, dt * 60)
      for (let c = 0; c < 3; c++) {
        s.dye0[c].set(s.dye[c])
        advect(s.dye[c], s.dye0[c], s.u, s.v, w, h, dt, fade)
      }

      drawRef.current()
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      simulation.current = null
      renderer.current = null
      pointer.current = null
      drawRef.current = () => {}
    }
  }, [])

  const setPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(), state = simulation.current
    if (!state) return
    const x = (event.clientX - rect.left) / rect.width * state.w
    const y = (event.clientY - rect.top) / rect.height * state.h
    if (!pointer.current) pointer.current = { x, y, oldX: x, oldY: y }
    else {
      pointer.current.x = x; pointer.current.y = y
      if (paused) { pointer.current.oldX = x; pointer.current.oldY = y }
    }
  }
  const clear = () => {
    const s = simulation.current
    if (s) {
      s.u.fill(0); s.v.fill(0); s.pressure.fill(0); s.pressure2.fill(0)
      for (const channel of [...s.dye, ...s.dye0]) channel.fill(0)
    }
    pointer.current = null
    setPresetName('still')
    drawRef.current()
  }
  const seed = (name: string) => {
    setPresetName(name)
    if (simulation.current) { seedScene(simulation.current, name, palette); drawRef.current() }
  }

  return <div className="experiment-surface">
    <canvas ref={canvasRef} className="experiment-canvas fluid-canvas" aria-label="Interactive fluid simulation. Drag to inject colour and motion." aria-describedby={hint.visible ? 'fluid-fallback-first-move' : undefined} onPointerDown={(event) => { hint.dismiss(); event.currentTarget.setPointerCapture(event.pointerId); setPoint(event) }} onPointerMove={(event) => { if (event.buttons || event.pointerType === 'touch') setPoint(event) }} onPointerUp={() => { pointer.current = null }} onPointerCancel={() => { pointer.current = null }} />
    {hint.visible ? <aside className="scene-nudge" id="fluid-fallback-first-move" role="note"><span>Try this · A Quiet Current</span><p>Drag through the colour to stir the water. Your hand adds both a swirl and fresh pigment.</p><button onClick={hint.dismiss} aria-label="Dismiss first-move hint">×</button></aside> : <button className="scene-nudge-reopen" onClick={hint.show} aria-label="Show interaction tip" title="Show interaction tip">i</button>}
    <ControlPanel title="A Quiet Current" note="INCOMPRESSIBLE FLOW" visible={controlsVisible} onClose={onCloseControls}>
      <div className="preset-row"><span>FLOW</span>{[['still', 'Still'], ['crossing', 'Crossing'], ['vortex', 'Vortex']].map(([key, title]) => <button key={key} className={presetName === key ? 'selected' : ''} onClick={() => seed(key)}>{title}</button>)}</div>
      <SelectControl label="Pigment" value={palette} options={[['aurora', 'Aurora'], ['petal', 'Wild petal'], ['ember', 'Ember'], ['violet', 'Violet hour']]} onChange={setPalette} />
      <RangeControl label="Flow resistance · viscosity" value={viscosity} min={0} max={0.9} step={0.01} onChange={setViscosity} format={(value) => value < 0.1 ? 'silk' : value < 0.4 ? 'soft' : 'thick'} />
      <RangeControl label="Colour persistence" value={dissipation} min={0.94} max={0.999} step={0.001} onChange={setDissipation} format={(value) => (value * 100).toFixed(1) + '%'} />
      <button className="panel-action" onClick={clear}><span>Clear the water</span><i>↺</i></button>
      <p className="control-note">Drag to inject momentum and pigment. Opposing strokes fold into vortices and mix as they travel.</p>
    </ControlPanel>
  </div>
}
