import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { ExperimentControls } from '../types'
import { ControlPanel, RangeControl, SelectControl, Segmented } from '../components/Controls'
import { useDiscoveryHint } from '../lib/useDiscoveryHint'
import { boundedStateInteger, boundedStateNumber, boundedStateSeed, stateChoice } from '../lib/experimentState'

const MAX_CELLS = 90_000
const palettes: Record<string, [number, number, number][]> = {
  mineral: [[6, 11, 18], [56, 112, 132], [174, 205, 192], [233, 226, 194]],
  coral: [[14, 8, 18], [104, 38, 66], [220, 106, 116], [255, 208, 158]],
  verdigris: [[6, 20, 25], [42, 104, 93], [165, 196, 153], [235, 225, 192]],
  ultraviolet: [[13, 8, 30], [71, 48, 143], [177, 105, 210], [247, 190, 222]],
  ember: [[18, 9, 15], [115, 43, 31], [222, 108, 48], [255, 214, 132]],
}
const seeds: Record<string, { feed: number; kill: number }> = {
  spots: { feed: 0.0367, kill: 0.0649 }, coral: { feed: 0.0545, kill: 0.062 }, labyrinth: { feed: 0.029, kill: 0.057 }, waves: { feed: 0.025, kill: 0.05 },
}
type ReactionState = { w: number; h: number; n: number; a: Float32Array; b: Float32Array; aa: Float32Array; bb: Float32Array; image: ImageData }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
function gridFor(width: number, height: number) {
  const aspect = Math.max(0.28, Math.min(3.6, width / Math.max(1, height)))
  if (aspect >= 1) { const w = Math.round(Math.sqrt(MAX_CELLS * aspect)); return { w, h: Math.round(w / aspect) } }
  const h = Math.round(Math.sqrt(MAX_CELLS / aspect)); return { w: Math.round(h * aspect), h }
}
function createState(w: number, h: number, ctx: CanvasRenderingContext2D): ReactionState {
  const n = w * h
  return { w, h, n, a: new Float32Array(n), b: new Float32Array(n), aa: new Float32Array(n), bb: new Float32Array(n), image: ctx.createImageData(w, h) }
}
function sample(field: Float32Array, w: number, h: number, x: number, y: number) {
  x = clamp(x, 0.001, w - 1.002); y = clamp(y, 0.001, h - 1.002)
  const x0 = x | 0, y0 = y | 0, x1 = x0 + 1, y1 = y0 + 1, tx = x - x0, ty = y - y0
  const a = field[y0 * w + x0] * (1 - tx) + field[y0 * w + x1] * tx
  const b = field[y1 * w + x0] * (1 - tx) + field[y1 * w + x1] * tx
  return a * (1 - ty) + b * ty
}

export default function ReactionDiffusion({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const hint = useDiscoveryHint('reaction')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const buffers = useRef<ReactionState | null>(null)
  const drawRef = useRef<() => void>(() => {})
  const requestedPreset = stateFromUrl?.preset === 'maze' ? 'labyrinth' : stateFromUrl?.preset
  const initialPreset = stateChoice(requestedPreset, Object.keys(seeds), 'coral')
  const [presetName, setPresetName] = useState(initialPreset)
  const [feed, setFeed] = useState(() => boundedStateNumber(stateFromUrl?.feed, seeds[initialPreset].feed, 0.018, 0.075))
  const [kill, setKill] = useState(() => boundedStateNumber(stateFromUrl?.kill, seeds[initialPreset].kill, 0.035, 0.075))
  const [diffusion, setDiffusion] = useState(() => boundedStateNumber(stateFromUrl?.diffusion, 1, 0.55, 1.45))
  const [steps, setSteps] = useState(() => boundedStateInteger(stateFromUrl?.steps, 3, 1, 5))
  const [palette, setPalette] = useState(() => stateChoice(stateFromUrl?.palette, Object.keys(palettes), 'verdigris'))
  const [seed, setSeed] = useState(() => boundedStateSeed(stateFromUrl?.seed, 42))
  const [scatter, setScatter] = useState(() => stateFromUrl?.scatter === true)
  const [brush, setBrush] = useState<string>(() => stateChoice(stateFromUrl?.brush, ['seed', 'erase'], 'seed'))
  const [brushSize, setBrushSize] = useState(() => boundedStateNumber(stateFromUrl?.brushSize, 28, 8, 72))
  const params = useRef({ feed, kill, diffusion, steps, palette, presetName, seed, scatter, paused })
  params.current = { feed, kill, diffusion, steps, palette, presetName, seed, scatter, paused }
  useEffect(() => { onShareState({ preset: presetName, feed, kill, diffusion, steps, palette, seed, scatter, brush, brushSize }) }, [presetName, feed, kill, diffusion, steps, palette, seed, scatter, brush, brushSize, onShareState])
  useEffect(() => { drawRef.current() }, [palette])

  const initialize = (kind: string, random = false, updateRates = true, seedValue = seed) => {
    const state = buffers.current
    if (!state) return
    const { w, h, n } = state, scale = Math.min(w, h) / 128
    state.a.fill(1); state.b.fill(0)
    if (random) {
      let value = seedValue >>> 0
      const nextRandom = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296 }
      for (let i = 0; i < n; i++) if (nextRandom() < 0.023) state.b[i] = 0.75 + nextRandom() * 0.25
    } else if (kind === 'waves') {
      for (let y = 5; y < h - 5; y++) for (let x = 5; x < w - 5; x++) {
        if (Math.sin(x * 0.2 / scale + Math.sin(y * 0.23 / scale) * 4) > 0.68) state.b[y * w + x] = 0.92
      }
    } else if (kind === 'labyrinth') {
      for (let y = 5; y < h - 5; y++) for (let x = 5; x < w - 5; x++) {
        const value = Math.sin(x * 0.12 / scale + Math.cos(y * 0.11 / scale) * 2) * Math.cos(y * 0.17 / scale - x * 0.07 / scale)
        if (value > 0.65) state.b[y * w + x] = 0.96
      }
    } else {
      const stride = Math.max(7, Math.round((kind === 'coral' ? 18 : 25) * scale))
      const radius = Math.max(2, Math.round((kind === 'coral' ? 3 : 4) * scale))
      for (let cy = Math.round(stride * 0.55); cy < h - stride * 0.35; cy += stride) for (let cx = Math.round(stride * 0.55); cx < w - stride * 0.35; cx += stride) {
        for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
          if (x * x + y * y > radius * radius) continue
          state.b[(cy + y) * w + cx + x] = 1
        }
      }
    }
    if (updateRates) {
      const preset = seeds[kind] || seeds.spots
      setFeed(preset.feed); setKill(preset.kill)
    }
    drawRef.current()
  }

  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    const offscreen = document.createElement('canvas')
    const offctx = offscreen.getContext('2d', { alpha: false })
    if (!offctx) return
    let raf = 0, last = 0, previousAspect = 0
    const draw = () => {
      const state = buffers.current
      if (!state) return
      const colors = palettes[params.current.palette] || palettes.mineral, data = state.image.data
      for (let i = 0; i < state.n; i++) {
        const value = clamp((state.b[i] - 0.08) * 2.15, 0, 1), segment = Math.min(2, Math.floor(value * 3)), t = clamp(value * 3 - segment, 0, 1), idx = i * 4
        for (let c = 0; c < 3; c++) data[idx + c] = colors[segment][c] + (colors[segment + 1][c] - colors[segment][c]) * t
        data[idx + 3] = 255
      }
      offctx.putImageData(state.image, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height)
    }
    drawRef.current = draw
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const dpr = Math.min(devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.floor(rect.width * dpr)), height = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      const aspect = rect.width / rect.height
      if (Math.abs(aspect - previousAspect) > 0.015) {
        const size = gridFor(rect.width, rect.height), old = buffers.current, next = createState(size.w, size.h, offctx)
        if (old) {
          for (let y = 1; y < next.h - 1; y++) for (let x = 1; x < next.w - 1; x++) {
            const i = y * next.w + x, ox = x / next.w * old.w, oy = y / next.h * old.h
            next.a[i] = sample(old.a, old.w, old.h, ox, oy)
            next.b[i] = sample(old.b, old.w, old.h, ox, oy)
          }
        }
        buffers.current = next
        offscreen.width = next.w; offscreen.height = next.h
        previousAspect = aspect
        if (!old) initialize(params.current.presetName, params.current.scatter, false, params.current.seed)
      }
      drawRef.current()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const state = buffers.current
      if (!state || document.hidden || params.current.paused || now - last < 33) return
      last = now
      const { w, h } = state
      for (let pass = 0; pass < params.current.steps; pass++) {
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = y * w + x, av = state.a[i], bv = state.b[i]
          const lapA = -av + 0.2 * (state.a[i - 1] + state.a[i + 1] + state.a[i - w] + state.a[i + w]) + 0.05 * (state.a[i - w - 1] + state.a[i - w + 1] + state.a[i + w - 1] + state.a[i + w + 1])
          const lapB = -bv + 0.2 * (state.b[i - 1] + state.b[i + 1] + state.b[i - w] + state.b[i + w]) + 0.05 * (state.b[i - w - 1] + state.b[i - w + 1] + state.b[i + w - 1] + state.b[i + w + 1])
          const reaction = av * bv * bv
          state.aa[i] = clamp(av + (params.current.diffusion * lapA - reaction + params.current.feed * (1 - av)), 0, 1)
          state.bb[i] = clamp(bv + (0.5 * params.current.diffusion * lapB + reaction - (params.current.kill + params.current.feed) * bv), 0, 1)
        }
        let swap = state.a; state.a = state.aa; state.aa = swap; swap = state.b; state.b = state.bb; state.bb = swap
      }
      drawRef.current()
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); observer.disconnect(); buffers.current = null; drawRef.current = () => {} }
  }, [])

  const seedAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(), state = buffers.current
    if (!state) return
    const cx = Math.round((event.clientX - rect.left) / rect.width * state.w), cy = Math.round((event.clientY - rect.top) / rect.height * state.h)
    const scale = Math.min(state.w, state.h) / 128, radius = Math.max(3, Math.round(brushSize * 0.28 * scale * (brush === 'seed' ? 1 : 2.25)))
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
      const px = cx + x, py = cy + y
      if (px < 1 || py < 1 || px >= state.w - 1 || py >= state.h - 1 || x * x + y * y > radius * radius) continue
      state.b[py * state.w + px] = brush === 'seed' ? 1 : 0
    }
    drawRef.current()
  }
  const selectSeed = (name: string) => { setPresetName(name); setScatter(false); initialize(name, false, true, seed) }
  const beginNewPattern = () => {
    const nextSeed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    setSeed(nextSeed); setScatter(true); initialize(presetName, true, true, nextSeed)
  }

  return <div className="experiment-surface">
    <canvas ref={canvasRef} className="experiment-canvas reaction-canvas" aria-label="Interactive reaction diffusion simulation. Tap or drag to add a chemical seed." aria-describedby={hint.visible ? 'reaction-cpu-first-move' : undefined} onPointerDown={(event) => { hint.dismiss(); event.currentTarget.setPointerCapture(event.pointerId); if (event.button !== 2) seedAt(event) }} onPointerMove={(event) => { if (event.buttons || event.pointerType === 'touch') seedAt(event) }} onContextMenu={(event) => { event.preventDefault(); setBrush((value) => value === 'seed' ? 'erase' : 'seed') }} />
    {hint.visible ? <aside className="scene-nudge" id="reaction-cpu-first-move" role="note"><span>Try this · The Pattern Beneath</span><p>Tap the living pattern to plant a new patch. Watch nearby colours spread and settle into shapes.</p><button onClick={hint.dismiss} aria-label="Dismiss first-move hint">×</button></aside> : <button className="scene-nudge-reopen" onClick={hint.show} aria-label="Show interaction tip" title="Show interaction tip">i</button>}
    <ControlPanel title="The Pattern Beneath" note="GRAY–SCOTT CHEMISTRY" visible={controlsVisible} onClose={onCloseControls}>
      <div className="preset-row" role="group" aria-label="Initial pattern"><span>INITIAL FORM</span>{[['spots', 'Spots'], ['coral', 'Coral'], ['labyrinth', 'Labyrinth'], ['waves', 'Waves']].map(([key, title]) => <button key={key} className={presetName === key && !scatter ? 'selected' : ''} aria-pressed={presetName === key && !scatter} onClick={() => selectSeed(key)}>{title}</button>)}</div>
      <RangeControl label="Feed rate" value={feed} min={0.012} max={0.075} step={0.001} onChange={setFeed} format={(value) => value.toFixed(3)} />
      <RangeControl label="Kill rate" value={kill} min={0.035} max={0.075} step={0.001} onChange={setKill} format={(value) => value.toFixed(3)} />
      <RangeControl label="Diffusion" value={diffusion} min={0.55} max={1.45} step={0.01} onChange={setDiffusion} format={(value) => value.toFixed(2)} />
      <RangeControl label="Time steps" value={steps} min={1} max={5} step={1} onChange={setSteps} format={(value) => value + '×'} />
      <SelectControl label="Pigment" value={palette} options={[['mineral', 'River stone'], ['coral', 'Red coral'], ['verdigris', 'Verdigris'], ['ultraviolet', 'Ultraviolet'], ['ember', 'Warm earth']]} onChange={setPalette} />
      <Segmented label="Brush" value={brush} options={[['seed', 'Seed'], ['erase', 'Erase']]} onChange={setBrush} />
      <RangeControl label="Brush radius" value={brushSize} min={8} max={72} step={2} onChange={setBrushSize} format={(value) => `${value} px`} />
      <button className="panel-action" onClick={beginNewPattern}><span>Scatter new beginnings</span><i>↻</i></button>
      <p className="control-note">Paint a chemical seed with a tap, or choose erase to lift it away. Shared links restore the preset, seed and controls; drawn marks and evolved chemistry start fresh. The Canvas 2D fallback uses a smaller field than the GPU version.</p>
    </ControlPanel>
  </div>
}
