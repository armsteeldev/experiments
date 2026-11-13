import { useEffect, useRef, useState } from 'react'
import type { ExperimentControls } from '../types'
import { ActionRow, ControlPanel, RangeControl, SelectControl } from '../components/Controls'
import { bodyRadius, circularOrbitVelocity, gravityEnergy, integrateGravity, type CollisionMode, type GravityBody } from '../simulations/gravity'
import './ExpandedExhibits.css'

type Scene = 'solar' | 'binary' | 'chaos' | 'unstable'
const sceneNames: [string, string][] = [['solar', 'A small solar system'], ['binary', 'Binary stars'], ['chaos', 'Three-body chaos'], ['unstable', 'Orbital instability']]
let nextId = 20
const planetColors = ['#92d2e4', '#f0bd91', '#afa3ea', '#8dc7ad', '#e9d497', '#f19583']
function makeScene(scene: Scene): GravityBody[] {
  if (scene === 'binary') return [
    { id: 1, x: -.78, y: 0, vx: 0, vy: -13.6, mass: 610, color: '#f3c17c', trail: [] },
    { id: 2, x: .78, y: 0, vx: 0, vy: 13.6, mass: 610, color: '#8ed5f2', trail: [] },
    { id: 3, x: 0, y: 3.2, vx: 15.2, vy: 0, mass: 1.1, color: '#d9a9ef', trail: [] },
  ]
  if (scene === 'chaos') return [
    { id: 1, x: -.9700, y: .2431, vx: .4712, vy: .4324, mass: 1, color: '#f2a47e', trail: [] },
    { id: 2, x: .9700, y: -.2431, vx: .4662, vy: .4324, mass: 1, color: '#93cde0', trail: [] },
    { id: 3, x: 0, y: 0, vx: -.9324, vy: -.8647, mass: 1, color: '#b8a6ef', trail: [] },
  ]
  if (scene === 'unstable') return [
    { id: 1, x: 0, y: 0, vx: 0, vy: 0, mass: 980, color: '#f0bd77', trail: [] },
    ...[1.25, 2.05, 2.92, 3.88].map((r, i) => ({ id: i + 2, x: r, y: 0, vx: 0, vy: Math.sqrt(980 / r) * (i === 1 ? .82 : 1), mass: [.3, .8, .25, .5][i], color: planetColors[i], trail: [] })),
  ]
  const star: GravityBody = { id: 1, x: 0, y: 0, vx: 0, vy: 0, mass: 980, color: '#f1bf79', trail: [] }
  const radii = [1.18, 1.92, 2.85, 3.8, 4.65]
  const phases = [-0.5, 1.15, 2.55, 3.8, 5.15]
  return [star, ...radii.map((radius, i) => {
    const x = Math.cos(phases[i]) * radius, y = Math.sin(phases[i]) * radius
    return { id: i + 2, x, y, ...circularOrbitVelocity(star, x, y), mass: [.16, .55, .8, .3, .5][i], color: planetColors[i], trail: [] }
  })]
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
type Params = { paused: boolean; speed: number; collision: CollisionMode; trails: boolean; prediction: boolean }

export default function GravityPlayground({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [scene, setScene] = useState<Scene>(() => sceneNames.some(([key]) => key === stateFromUrl?.scene) ? stateFromUrl?.scene as Scene : 'solar')
  const [speed, setSpeed] = useState(() => Number(stateFromUrl?.speed) || 1)
  const [collision, setCollision] = useState<CollisionMode>(() => ['merge','bounce','pass'].includes(String(stateFromUrl?.collision)) ? stateFromUrl?.collision as CollisionMode : 'merge')
  const [mass, setMass] = useState(() => Number(stateFromUrl?.mass) || 2)
  const [launchSpeed, setLaunchSpeed] = useState(() => Number(stateFromUrl?.launchSpeed) || 4)
  const [trails, setTrails] = useState(() => stateFromUrl?.trails !== false)
  const [prediction, setPrediction] = useState(() => stateFromUrl?.prediction === true)
  const [launchMode, setLaunchMode] = useState(false)
  const [launchFeedback, setLaunchFeedback] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [readout, setReadout] = useState({ bodies: 6, energy: '—' })
  const params = useRef<Params>({ paused, speed, collision, trails, prediction })
  params.current = { paused, speed, collision, trails, prediction }
  const state = useRef({ bodies: makeScene(scene), width: 0, height: 0, dpr: 1, scale: 70, cameraX: 0, cameraY: 0, raf: 0, last: 0, accumulator: 0, tick: 0, revision:0, pointer: null as null | { id: number; mode: 'body' | 'pan' | 'launch'; x: number; y: number; worldX: number; worldY: number; startWorldX:number;startWorldY:number } })
  const view = useRef({ mass, selected }); view.current = { mass, selected }

  useEffect(() => { onShareState({ scene, speed, collision, mass, launchSpeed, trails, prediction }) }, [scene, speed, collision, mass, launchSpeed, trails, prediction, onShareState])
  const resetScene = () => {
    const s = state.current
    s.bodies = makeScene(scene)
    s.tick = 0
    s.accumulator = 0
    s.revision++
    s.cameraX = 0
    s.cameraY = 0
    s.scale = s.width && s.height ? Math.min(s.width, s.height) / 10.4 : 70
    setSelected(null)
    setReadout({ bodies: s.bodies.length, energy: '—' })
    setLaunchMode(false)
    setLaunchFeedback('')
  }
  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    const s = state.current
    let stars: { x: number; y: number; r: number; a: number }[] = []
    const resize = () => {
      const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return
      const oldW = s.width, oldH = s.height
      s.width = rect.width; s.height = rect.height
      s.dpr = Math.min(devicePixelRatio || 1, 1.6, Math.sqrt(2_200_000 / (rect.width * rect.height)))
      canvas.width = Math.max(1, Math.floor(rect.width * s.dpr)); canvas.height = Math.max(1, Math.floor(rect.height * s.dpr))
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0)
      if (oldW && oldH) s.scale *= Math.min(s.width, s.height) / Math.min(oldW, oldH)
      else s.scale = Math.min(s.width, s.height) / 10.4
      let seed = 987
      const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
      stars = Array.from({ length: Math.floor(rect.width * rect.height / 6200) }, () => ({ x: random() * s.width, y: random() * s.height, r: .35 + random() * .8, a: .14 + random() * .42 }))
      draw()
    }
    const toScreen = (x: number, y: number) => [s.width / 2 + (x - s.cameraX) * s.scale, s.height / 2 + (y - s.cameraY) * s.scale]
    const drawBody = (body: GravityBody, alpha = 1) => {
      const [x, y] = toScreen(body.x, body.y), radius = Math.max(3, bodyRadius(body) * s.scale * 1.28)
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * (body.mass > 80 ? 5.4 : 3.8))
      glow.addColorStop(0, body.color + '70'); glow.addColorStop(.27, body.color + '22'); glow.addColorStop(1, body.color + '00')
      ctx.globalAlpha = alpha; ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, radius * 5, 0, Math.PI * 2); ctx.fill()
      const core = ctx.createRadialGradient(x - radius * .34, y - radius * .4, radius * .08, x, y, radius)
      core.addColorStop(0, '#fff6df'); core.addColorStop(.28, body.color); core.addColorStop(1, body.color + 'a0')
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill()
      if (body.mass > 100) { ctx.strokeStyle = body.color + '55'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x, y, radius * 1.6, radius * .48, -.17, 0, Math.PI * 2); ctx.stroke() }
      if (view.current.selected === body.id) { ctx.strokeStyle = '#e7edf0a8'; ctx.lineWidth = .8; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.arc(x, y, radius + 8, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]) }
      ctx.globalAlpha = 1
    }
    function draw() {
      if (!ctx || !s.width) return
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0)
      ctx.fillStyle = '#050913'; ctx.fillRect(0, 0, s.width, s.height)
      const haze = ctx.createRadialGradient(s.width * .52, s.height * .47, 0, s.width * .52, s.height * .47, Math.max(s.width, s.height) * .72)
      haze.addColorStop(0, 'rgba(27,40,62,.36)'); haze.addColorStop(1, 'rgba(4,7,13,0)'); ctx.fillStyle = haze; ctx.fillRect(0, 0, s.width, s.height)
      for (const star of stars) { ctx.globalAlpha = star.a; ctx.fillStyle = '#d8e7ec'; ctx.beginPath(); ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2); ctx.fill() } ctx.globalAlpha = 1
      if (params.current.prediction && s.bodies.length && view.current.selected !== null) {
        const id = view.current.selected
        if (!predictionCache || predictionCache.id !== id || predictionCache.revision !== s.revision || s.tick - predictionCache.tick > 18) {
          const future = s.bodies.map((b) => ({ ...b, trail: [] as { x: number; y: number }[] })), target = future.find((b) => b.id === id), points: {x:number;y:number}[] = []
          if (target) for (let i = 0; i < 430; i += 1) { integrateGravity(future, .003, 1, 'pass'); if (i % 2 === 0) points.push({x:target.x,y:target.y}) }
          predictionCache = target ? { id, tick:s.tick, revision:s.revision, points } : null
        }
        if (predictionCache) { ctx.beginPath(); predictionCache.points.forEach((point, i) => { const [x,y]=toScreen(point.x,point.y); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y) }); ctx.strokeStyle = '#d9e4e65a'; ctx.lineWidth = 1; ctx.setLineDash([3, 6]); ctx.stroke(); ctx.setLineDash([]) }
      }
      if (params.current.trails) for (const body of s.bodies) {
        const trail = body.trail ?? []; if (trail.length < 2) continue
        ctx.beginPath(); trail.forEach((point, i) => { const [x, y] = toScreen(point.x, point.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) })
        ctx.strokeStyle = body.color + '76'; ctx.lineWidth = body.mass > 80 ? 1.25 : .8; ctx.shadowColor = body.color; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0
      }
      s.bodies.forEach((body) => drawBody(body))
      const pointer = s.pointer
      if (pointer?.mode === 'launch') {
        const [x, y] = toScreen(pointer.worldX, pointer.worldY)
        ctx.strokeStyle = '#dbe9ed99'; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(pointer.x, pointer.y); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([])
        ctx.fillStyle = '#dbe9ed'; ctx.beginPath(); ctx.arc(pointer.x, pointer.y, Math.max(3, bodyRadius({ id: 0, x: 0, y: 0, vx: 0, vy: 0, mass: view.current.mass, color: '' }) * s.scale), 0, Math.PI * 2); ctx.fill()
      }
    }
    const frame = (now: number) => {
      s.raf = requestAnimationFrame(frame)
      if (document.hidden || !s.width) { s.last = now; return }
      if (!params.current.paused) {
        const elapsed = Math.min(40, s.last ? now - s.last : 16.67); s.accumulator += elapsed / 16.67 * .003 * params.current.speed
        let count = 0
        while (s.accumulator >= .003 && count++ < 5) {
          const bodyCount = s.bodies.length
          integrateGravity(s.bodies, .003, 1, params.current.collision); s.accumulator -= .003; s.tick++
          if (s.tick % 5 === 0) for (const body of s.bodies) { body.trail ??= []; body.trail.push({ x: body.x, y: body.y }); if (body.trail.length > 720) body.trail.shift() }
          if (s.bodies.length !== bodyCount) {
            if (view.current.selected !== null && !s.bodies.some((body) => body.id === view.current.selected)) setSelected(null)
            setReadout({ bodies: s.bodies.length, energy: gravityEnergy(s.bodies).toFixed(1) })
            setLaunchFeedback('Impact · bodies merged while conserving momentum.')
          }
        }
        if (s.tick % 24 === 0) setReadout({ bodies: s.bodies.length, energy: gravityEnergy(s.bodies).toFixed(1) })
      }
      s.last = now; draw()
    }
    let predictionCache: {id:number;tick:number;revision:number;points:{x:number;y:number}[]} | null = null
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas); resize()
    s.raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(s.raf); resizeObserver.disconnect() }
  }, [])

  useEffect(() => { resetScene() }, [scene])

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current, s = state.current; if (!canvas) return
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top
    const wx = s.cameraX + (x - s.width / 2) / s.scale, wy = s.cameraY + (y - s.height / 2) / s.scale
    const hit = s.bodies.slice().reverse().find((body) => { const sx = s.width / 2 + (body.x - s.cameraX) * s.scale, sy = s.height / 2 + (body.y - s.cameraY) * s.scale; return Math.hypot(sx - x, sy - y) < Math.max(12, bodyRadius(body) * s.scale + 5) })
    const mode = launchMode ? 'launch' : hit ? 'body' : 'pan'
    if (hit && !launchMode) setSelected(hit.id)
    s.pointer = { id: event.pointerId, mode, x, y, worldX: wx, worldY: wy, startWorldX:wx, startWorldY:wy }; canvas.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const s = state.current, p = s.pointer; if (!p || p.id !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top
    const wx = s.cameraX + (x - s.width / 2) / s.scale, wy = s.cameraY + (y - s.height / 2) / s.scale
    if (p.mode === 'body') { const body = s.bodies.find((item) => item.id === selected); if (body) { body.x = wx; body.y = wy; body.vx = 0; body.vy = 0 } }
    else if (p.mode === 'pan') { s.cameraX -= (x - p.x) / s.scale; s.cameraY -= (y - p.y) / s.scale; p.x = x; p.y = y }
    p.worldX = wx; p.worldY = wy
  }
  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const s = state.current, p = s.pointer; if (!p || p.id !== event.pointerId) return
    if(p.mode==='body')s.revision++
    if (p.mode === 'launch') {
      const dragged = Math.hypot(p.worldX - p.startWorldX, p.worldY - p.startWorldY) > .08
      const source = s.bodies.reduce<GravityBody | null>((largest, body) => !largest || body.mass > largest.mass ? body : largest, null)
      const dx = source ? p.startWorldX - source.x : 1, dy = source ? p.startWorldY - source.y : 0
      const distance = Math.hypot(dx, dy), minOrbit = source ? Math.max(bodyRadius(source) + bodyRadius({ id: 0, x: 0, y: 0, vx: 0, vy: 0, mass, color: '' }) + .16, source.mass / (22 * 22) * 1.1) : .55
      const orbitRadius = Math.max(distance, minOrbit)
      const x = source ? source.x + (distance > 1e-6 ? dx / distance : 1) * orbitRadius : p.startWorldX
      const y = source ? source.y + (distance > 1e-6 ? dy / distance : 0) * orbitRadius : p.startWorldY
      const orbital = source ? circularOrbitVelocity(source, x, y) : { vx: launchSpeed, vy: 0 }
      const vx = dragged ? clamp((p.worldX - p.startWorldX) * launchSpeed, -22, 22) : orbital.vx
      const vy = dragged ? clamp((p.worldY - p.startWorldY) * launchSpeed, -22, 22) : orbital.vy
      if (s.bodies.length < 32) {
        const body = { id: nextId++, x, y, vx, vy, mass, color: planetColors[nextId % planetColors.length], trail: [] }
        s.bodies.push(body); s.revision++; setSelected(body.id); setReadout({ bodies: s.bodies.length, energy: gravityEnergy(s.bodies).toFixed(1) })
        setLaunchFeedback(dragged ? 'Custom velocity released · select the body to refine its orbit.' : 'Circular orbit launched around the most massive body.')
      } else setLaunchFeedback('This scene is full. Reset it to launch another body.')
      setLaunchMode(false)
    }
    s.pointer = null
  }
  const wheel = (event: WheelEvent) => {
    event.preventDefault(); const s = state.current, rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return; const x = event.clientX - rect.left, y = event.clientY - rect.top
    const beforeX = s.cameraX + (x - s.width / 2) / s.scale, beforeY = s.cameraY + (y - s.height / 2) / s.scale
    s.scale = clamp(s.scale * Math.exp(-event.deltaY * .001), 20, 480)
    s.cameraX = beforeX - (x - s.width / 2) / s.scale; s.cameraY = beforeY - (y - s.height / 2) / s.scale
  }
  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; canvas.addEventListener('wheel', wheel, { passive: false }); return () => canvas.removeEventListener('wheel', wheel) }, [])
  const selectedBody = state.current.bodies.find((body) => body.id === selected)
  const adjustSelected = (key: 'mass' | 'vx' | 'vy', value: number) => { const body=state.current.bodies.find((item)=>item.id===selected);if(!body)return;body[key]=value;state.current.revision++;setReadout({bodies:state.current.bodies.length,energy:gravityEnergy(state.current.bodies).toFixed(1)}) }
  const removeSelected = () => {
    if (selected === null) return
    state.current.bodies = state.current.bodies.filter((body) => body.id !== selected)
    state.current.revision++; setSelected(null); setReadout({ bodies: state.current.bodies.length, energy: gravityEnergy(state.current.bodies).toFixed(1) })
    setLaunchFeedback('Selected body removed.')
  }

  return <section className="experiment-surface gravity-surface" aria-label="Gravity simulator">
    <canvas ref={canvasRef} className="experiment-canvas gravity-canvas" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} />
    <div className="exp-hud gravity-hud"><span className="exp-eyebrow">N-BODY DYNAMICS <i /></span><strong>{readout.bodies.toString().padStart(2, '0')} <small>BODIES</small></strong><span>MECHANICAL ENERGY <b>{readout.energy}</b></span></div>
    <div className="exp-prompt gravity-prompt">{launchMode ? 'CLICK TO PLACE A CIRCULAR ORBIT · DRAG TO SET A CUSTOM VELOCITY' : launchFeedback || 'DRAG A BODY TO REPOSITION · DRAG EMPTY SPACE TO PAN · SCROLL TO ZOOM'}</div>
    <div className="gravity-tools"><button className={launchMode ? 'selected' : ''} onClick={() => { setLaunchMode((v) => !v); setLaunchFeedback('') }} aria-pressed={launchMode}><span>＋</span> Launch body</button>{selectedBody && <button onClick={removeSelected} aria-label="Remove selected body">Remove body</button>}<button onClick={() => setSelected(null)} aria-label="Clear body selection">Clear focus</button></div>
    {selected !== null && <div className="gravity-inspect"><span>SELECTED BODY</span>{(() => { const body = state.current.bodies.find((item) => item.id === selected); return body ? <><strong>{body.mass.toFixed(1)} <small>mass</small></strong><small>v {Math.hypot(body.vx, body.vy).toFixed(2)} units / time</small></> : <small>Choose a body</small> })()}</div>}
    <ControlPanel title="Gravity Playground" note="Newtonian attraction · velocity Verlet" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Initial system" value={scene} options={sceneNames} onChange={(value) => setScene(value as Scene)} />
      <RangeControl label="Simulation speed" value={speed} min={.25} max={2.2} step={.05} format={(v) => `${v.toFixed(2)}×`} onChange={setSpeed} />
      {selectedBody && <><RangeControl label="Focused mass" value={selectedBody.mass} min={.05} max={1200} step={.05} format={(v) => v.toFixed(2)} onChange={(v)=>adjustSelected('mass',v)} /><RangeControl label="Velocity · x" value={selectedBody.vx} min={-35} max={35} step={.05} format={(v)=>v.toFixed(2)} onChange={(v)=>adjustSelected('vx',v)} /><RangeControl label="Velocity · y" value={selectedBody.vy} min={-35} max={35} step={.05} format={(v)=>v.toFixed(2)} onChange={(v)=>adjustSelected('vy',v)} /></>}
      <RangeControl label="New body mass" value={mass} min={.2} max={30} step={.2} format={(v) => v.toFixed(1)} onChange={setMass} />
      <RangeControl label="Launch strength" value={launchSpeed} min={.5} max={9} step={.1} format={(v) => v.toFixed(1)} onChange={setLaunchSpeed} />
      <SelectControl label="Collision response" value={collision} options={[["merge", "Merge · conserve momentum"], ["bounce", "Elastic bounce"], ["pass", "Ignore collisions"]]} onChange={(value) => setCollision(value as CollisionMode)} />
      <ActionRow><button className="small-action" onClick={() => setTrails((v) => !v)}>{trails ? 'Trails on' : 'Trails off'}</button><button className="small-action" onClick={() => setPrediction((v) => !v)}>{prediction ? 'Prediction on' : 'Predict orbit'}</button><button className="small-action" onClick={resetScene} title="Reset bodies and refit the current scene">Reset scene</button></ActionRow>
      <p className="control-note">Click Launch body, then click space to place a near-circular orbit around the most massive body. Drag instead to set a custom velocity. The dashed path predicts the selected body's future; the model holds up to 32 bodies.</p>
    </ControlPanel>
  </section>
}
