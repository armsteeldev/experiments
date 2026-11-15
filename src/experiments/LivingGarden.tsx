import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ActionRow, ControlPanel, RangeControl } from '../components/Controls'
import type { ExperimentControls } from '../types'
import { addGardenAgent, addGardenFood, createGardenState, meanGardenTrait, stepGarden } from '../simulations/garden'
import type { GardenAgent, GardenState } from '../simulations/garden'
import { clamp, normalizedPointer, resizeCanvas, safeState } from './invisibleWorld'
import './invisible-world.css'

type Tool = 'observe' | 'organism' | 'food'
type GardenStats = { population: number; generation: number; births: number; deaths: number; efficiency: number; speed: number; resource: number; climate: string; currentTemperature: number; currentResourceRate: number }

function cloneState(state: GardenState): GardenState { return JSON.parse(JSON.stringify(state)) as GardenState }

export default function LivingGarden({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const canvasRef = useRef<HTMLCanvasElement>(null), stateRef = useRef<GardenState | null>(null)
  const sizeRef = useRef({ width: 1000, height: 700, dpr: 1 }), resizeRef = useRef<ResizeObserver | null>(null)
  const trailsRef = useRef(new Map<number, { points: { x: number; y: number }[]; hue: number }>()), savedRef = useRef<GardenState | null>(null)
  const keyboardPoint = useRef({ x: 0.5, y: 0.5 })
  if (!stateRef.current) stateRef.current = createGardenState(41721, 1000, 700)
  const [tool, setTool] = useState<Tool>('observe'), [temperature, setTemperature] = useState(0.42), [resourceRate, setResourceRate] = useState(1), [seasonal, setSeasonal] = useState(false)
  const [selected, setSelected] = useState<number | null>(null), [stats, setStats] = useState<GardenStats>({ population: 34, generation: 0, births: 0, deaths: 0, efficiency: 0.56, speed: 42, resource: 30, climate: 'Steady', currentTemperature: .42, currentResourceRate: 1 })
  const restored = useRef(false)

  useEffect(() => {
    if (!stateFromUrl || restored.current) return
    restored.current = true
    const value = safeState(stateFromUrl, 'temperature', temperature)
    if (typeof value === 'number' && value >= 0.1 && value <= 0.9) setTemperature(value)
    const resources = safeState(stateFromUrl, 'resourceRate', resourceRate), cycle = safeState(stateFromUrl, 'seasonal', seasonal)
    if (typeof resources === 'number' && resources >= 0.25 && resources <= 1.9) setResourceRate(resources)
    if (typeof cycle === 'boolean') setSeasonal(cycle)
  }, [stateFromUrl, temperature, resourceRate, seasonal])
  useEffect(() => { onShareState({ temperature, resourceRate, seasonal }) }, [temperature, resourceRate, seasonal, onShareState])

  const paint = useCallback((time: number) => {
    const canvas = canvasRef.current, state = stateRef.current, context = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !state || !context) return
    const { width, height, dpr } = sizeRef.current
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    const ground = context.createLinearGradient(0, 0, width, height)
    ground.addColorStop(0, '#091511'); ground.addColorStop(0.52, '#0b1715'); ground.addColorStop(1, '#101b18')
    context.fillStyle = ground; context.fillRect(0, 0, width, height)
    const canopy = context.createRadialGradient(width * 0.51, height * 0.48, height * 0.06, width * 0.51, height * 0.48, height * 0.72)
    canopy.addColorStop(0, 'rgba(72,124,92,.18)'); canopy.addColorStop(0.55, 'rgba(31,75,60,.12)'); canopy.addColorStop(1, 'rgba(7,15,14,0)')
    context.fillStyle = canopy; context.fillRect(0, 0, width, height)
    context.save(); context.globalAlpha = 0.14; context.lineWidth = 0.6
    for (let i = 0; i < 8; i++) {
      const x = width * (0.08 + i * 0.125), sway = Math.sin(time * 0.0004 + i) * 14
      context.beginPath(); context.moveTo(x, height); context.bezierCurveTo(x + sway, height * 0.66, x - sway, height * 0.34, x + sway * 0.4, 0)
      context.strokeStyle = i % 2 ? '#709d78' : '#9ba16a'; context.stroke()
    }
    context.restore()
    for (const food of state.food) {
      if (food.energy <= 0.01) continue
      const radius = 2.2 + food.energy * 3.2
      const bloom = context.createRadialGradient(food.x, food.y, 0, food.x, food.y, radius * 3.2)
      bloom.addColorStop(0, 'rgba(238,207,127,.88)'); bloom.addColorStop(0.16, 'rgba(185,177,105,.43)'); bloom.addColorStop(1, 'rgba(174,183,91,0)')
      context.fillStyle = bloom; context.fillRect(food.x - radius * 3.2, food.y - radius * 3.2, radius * 6.4, radius * 6.4)
      context.beginPath(); context.ellipse(food.x, food.y, radius * 1.2, radius * 0.64, time * 0.0002, 0, Math.PI * 2); context.fillStyle = '#dbca7e'; context.fill()
    }
    const liveIds = new Set(state.agents.map((agent) => agent.id))
    for (const id of trailsRef.current.keys()) if (!liveIds.has(id)) trailsRef.current.delete(id)
    if (state.tick % 3 === 0) for (const agent of state.agents) {
      const record = trailsRef.current.get(agent.id) ?? { points: [], hue: agent.hue }
      record.points.push({ x: agent.x, y: agent.y }); if (record.points.length > 10) record.points.shift(); record.hue = agent.hue; trailsRef.current.set(agent.id, record)
    }
    for (const { points, hue } of trailsRef.current.values()) {
      if (points.length < 2) continue
      context.beginPath(); points.forEach((point, index) => { if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y) })
      context.strokeStyle = `hsla(${hue},65%,68%,.09)`; context.lineWidth = 1; context.stroke()
    }
    for (const agent of state.agents) drawOrganism(context, agent, agent.id === selected, time)
    drawPopulationChart(context, state, width, height)
    if (canvas === document.activeElement) {
      const x = keyboardPoint.current.x * width, y = keyboardPoint.current.y * height
      context.beginPath(); context.arc(x, y, 14, 0, Math.PI * 2); context.strokeStyle = 'rgba(231,238,197,.75)'; context.lineWidth = 1; context.stroke()
      context.beginPath(); context.moveTo(x - 19, y); context.lineTo(x + 19, y); context.moveTo(x, y - 19); context.lineTo(x, y + 19); context.stroke()
    }
  }, [selected])

  useEffect(() => {
    const canvas = canvasRef.current, state = stateRef.current
    if (!canvas || !state) return
    const resize = () => {
      const beforeWidth = state.width, beforeHeight = state.height
      const size = resizeCanvas(canvas, 1.3), width = size.width, height = size.height
      if (beforeWidth > 0 && beforeHeight > 0) {
        const sx = width / beforeWidth, sy = height / beforeHeight
        for (const agent of state.agents) { agent.x *= sx; agent.y *= sy }
        for (const food of state.food) { food.x *= sx; food.y *= sy }
      }
      state.width = width; state.height = height
      trailsRef.current.clear()
      sizeRef.current = { width, height, dpr: size.dpr }
      paint(performance.now())
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize(); resizeRef.current = observer
    return () => { observer.disconnect(); resizeRef.current = null }
  }, [paint])

  useEffect(() => {
    let frame = 0, lastStep = 0, lastPaint = 0, disposed = false, lastTime = 0, sceneTime = 0, statsTime = performance.now()
    const render = (now: number) => {
      if (disposed) return
      const state = stateRef.current!
      if (lastTime && !paused) sceneTime += Math.min(100, now - lastTime)
      lastTime = now
      if (seasonal) {
        const cycle = Math.sin(state.tick * 0.08 * (2 * Math.PI / 120))
        state.temperature = clamp(temperature + cycle * 0.22, 0.1, 0.9)
        state.resourceRate = clamp(resourceRate * (0.78 - cycle * 0.32), 0.25, 1.9)
      } else { state.temperature = temperature; state.resourceRate = resourceRate }
      if (!paused && now - lastStep >= 32) { stepGarden(state, 0.08); lastStep = now }
      if (now - lastPaint >= (paused ? 250 : 33)) { paint(sceneTime); lastPaint = now }
      if (now - statsTime > 650) {
        const climate = seasonal ? (state.temperature > temperature + .13 ? 'Hot · dry' : state.temperature < temperature - .13 ? 'Cool · growing' : 'Mild') : 'Steady'
        setStats({ population: state.agents.length, generation: state.generation, births: state.totalBirths, deaths: state.totalDeaths, efficiency: meanGardenTrait(state, 'efficiency'), speed: meanGardenTrait(state, 'speed'), resource: state.food.reduce((sum, item) => sum + item.energy, 0), climate, currentTemperature: state.temperature, currentResourceRate: state.resourceRate })
        statsTime = now
      }
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => { disposed = true; cancelAnimationFrame(frame) }
  }, [paused, temperature, resourceRate, seasonal, paint])

  useEffect(() => () => { trailsRef.current.clear(); savedRef.current = null }, [])

  const pointOnField = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = normalizedPointer(event, event.currentTarget), size = sizeRef.current
    return { x: point.x * size.width, y: point.y * size.height }
  }
  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pointOnField(event), state = stateRef.current!
    if (tool === 'organism') { addGardenAgent(state, point.x, point.y); event.currentTarget.setPointerCapture(event.pointerId) }
    else if (tool === 'food') { addGardenFood(state, point.x, point.y, 0.9); event.currentTarget.setPointerCapture(event.pointerId) }
    else {
      const nearest = state.agents.reduce<{ agent: GardenAgent | null; distance: number }>((result, agent) => {
        const distance = Math.hypot(agent.x - point.x, agent.y - point.y)
        return distance < result.distance ? { agent, distance } : result
      }, { agent: null, distance: 26 })
      setSelected(nearest.agent?.id ?? null)
    }
    paint(performance.now())
  }
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || tool === 'observe') return
    const point = pointOnField(event)
    if (tool === 'food') addGardenFood(stateRef.current!, point.x, point.y, 0.62)
  }
  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }
  const canvasKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key.startsWith('Arrow')) {
      event.preventDefault(); event.stopPropagation()
      keyboardPoint.current.x = clamp(keyboardPoint.current.x + (event.key === 'ArrowRight' ? 0.035 : event.key === 'ArrowLeft' ? -0.035 : 0), 0.02, 0.98)
      keyboardPoint.current.y = clamp(keyboardPoint.current.y + (event.key === 'ArrowDown' ? 0.035 : event.key === 'ArrowUp' ? -0.035 : 0), 0.04, 0.92)
      paint(performance.now()); return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault(); event.stopPropagation()
    const state = stateRef.current!, x = keyboardPoint.current.x * sizeRef.current.width, y = keyboardPoint.current.y * sizeRef.current.height
    if (tool === 'organism') addGardenAgent(state, x, y)
    else if (tool === 'food') addGardenFood(state, x, y)
    else {
      const nearest = state.agents.reduce<{ agent: GardenAgent | null; distance: number }>((result, agent) => {
        const distance = Math.hypot(agent.x - x, agent.y - y)
        return distance < result.distance ? { agent, distance } : result
      }, { agent: null, distance: 38 })
      setSelected(nearest.agent?.id ?? null)
    }
    paint(performance.now())
  }
  const reset = () => { const state = createGardenState(41721, sizeRef.current.width, sizeRef.current.height); state.temperature = temperature; state.resourceRate = resourceRate; stateRef.current = state; trailsRef.current.clear(); setSelected(null) }
  const save = () => { savedRef.current = cloneState(stateRef.current!); setStats((previous) => ({ ...previous })) }
  const restore = () => { if (savedRef.current) { stateRef.current = cloneState(savedRef.current); trailsRef.current.clear(); setTemperature(stateRef.current.temperature); setResourceRate(stateRef.current.resourceRate) } }
  const selectedAgent = stateRef.current?.agents.find((agent) => agent.id === selected)
  const setPreset = (name: 'balanced' | 'bloom' | 'drought') => {
    setSeasonal(false)
    if (name === 'balanced') { setTemperature(0.42); setResourceRate(1) }
    if (name === 'bloom') { setTemperature(0.31); setResourceRate(1.7) }
    if (name === 'drought') { setTemperature(0.74); setResourceRate(0.48) }
  }

  return <section className="iw-scene iw-garden" aria-label="Agent-based evolutionary garden">
    <canvas ref={canvasRef} className="iw-canvas iw-garden-canvas" tabIndex={0} aria-label="Living ecosystem. Organisms move toward resources, spend energy, inherit traits and reproduce. Click an organism to inspect it, or focus the canvas, use arrow keys to position a tool and press Enter." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onKeyDown={canvasKeyDown} />
    <div className="iw-titleplate"><span>17 · ECOLOGY STUDY</span><strong>The Living Garden</strong><small>Survival leaves a pattern in the soil.</small></div>
    <div className="iw-garden-tools iw-glass-surface" role="group" aria-label="Ecosystem tools">
      {(['observe', 'organism', 'food'] as Tool[]).map((value) => <button key={value} className={tool === value ? 'is-selected' : ''} onClick={() => setTool(value)} aria-pressed={tool === value}>{value === 'observe' ? 'Inspect' : value === 'organism' ? 'Add life' : 'Scatter food'}</button>)}
    </div>
    <div className="iw-garden-stats iw-glass-surface" aria-live="polite"><span>POPULATION</span><strong>{stats.population}<i> / 320</i></strong><div>GEN {stats.generation} <b>·</b> +{stats.births} births <b>·</b> −{stats.deaths} deaths</div><div>{stats.climate.toUpperCase()} <b>·</b> EFF {stats.efficiency.toFixed(2)} <b>·</b> ENERGY {stats.resource.toFixed(1)}</div></div>
    {selectedAgent && <div className="iw-garden-inspector iw-glass-surface" role="status"><span>INDIVIDUAL · {selectedAgent.id.toString().padStart(3, '0')}</span><strong>Generation {selectedAgent.generation}</strong><div>Efficiency {selectedAgent.efficiency.toFixed(2)} · speed {selectedAgent.speed.toFixed(1)}</div><div>Energy {selectedAgent.energy.toFixed(2)} · age {selectedAgent.age.toFixed(1)}</div></div>}
    <ControlPanel title="Living garden" note="Inherited traits · agent model" visible={controlsVisible} onClose={onCloseControls} footer={<span>Reproduction transfers energy; offspring inherit with bounded mutation.</span>}>
      <div className="iw-panel-section"><span>Environmental experiment</span><div className="iw-button-row"><button onClick={() => setPreset('balanced')}>Balanced</button><button onClick={() => setPreset('bloom')}>Cool bloom</button><button onClick={() => setPreset('drought')}>Lean soil</button></div>
        <button className={`iw-season-toggle ${seasonal ? 'is-active' : ''}`} aria-pressed={seasonal} onClick={() => setSeasonal((value) => !value)}>{seasonal ? 'Seasonal cycle · on' : 'Cycle the seasons'}</button>
      </div>
      <RangeControl label="Temperature" value={temperature} min={0.1} max={0.9} step={0.01} format={(value) => `${(value * 100).toFixed(0)}%`} onChange={setTemperature} />
      <RangeControl label="Resource return" value={resourceRate} min={0.25} max={1.9} step={0.05} format={(value) => `${value.toFixed(2)}×`} onChange={setResourceRate} />
      <div className="iw-trait-readout"><span>Population traits · {stats.climate}</span><div><i>MEAN SPEED</i><b>{stats.speed.toFixed(1)}</b><i>MEAN EFFICIENCY</i><b>{stats.efficiency.toFixed(3)}</b><i>LIVE CLIMATE</i><b>{(stats.currentTemperature * 100).toFixed(0)}% · {stats.currentResourceRate.toFixed(2)}×</b></div><small>Natural selection is conditional on this simplified food and energy model.</small></div>
      <p className="control-note">Organisms find nearby food, convert it into energy, and pay upkeep for metabolism, movement and conversion efficiency. Faster and more active search can find food sooner but costs more energy. Seasonal mode cycles hot dry periods with cool growing periods. Traits change only in offspring; this is a teaching model, not a complete account of biological evolution.</p>
      <ActionRow><button className="panel-action" onClick={save}>Save this condition</button><button className="panel-action" onClick={restore} disabled={!savedRef.current}>Restore saved world</button></ActionRow>
      <ActionRow><button className="panel-action" onClick={reset}>Restart seeded garden <i>↺</i></button></ActionRow>
    </ControlPanel>
  </section>
}

function drawOrganism(context: CanvasRenderingContext2D, agent: GardenAgent, selected: boolean, time: number) {
  const radius = 3.1 + Math.sqrt(Math.max(0, agent.energy)) * 3.3, angle = Math.atan2(agent.vy, agent.vx), hue = clamp(agent.hue, 88, 198)
  const bodyLength = 0.72 + agent.speed / 135, bodyDepth = 0.42 + agent.efficiency * 0.42
  context.save(); context.translate(agent.x, agent.y); context.rotate(angle)
  context.shadowColor = `hsla(${hue},80%,72%,.8)`; context.shadowBlur = selected ? 23 : 10
  const aura = context.createRadialGradient(0, 0, 0, 0, 0, radius * 3)
  aura.addColorStop(0, `hsla(${hue},88%,76%,.23)`); aura.addColorStop(1, `hsla(${hue},78%,58%,0)`)
  context.fillStyle = aura; context.beginPath(); context.arc(0, 0, radius * 3, 0, Math.PI * 2); context.fill()
  context.shadowBlur = 0
  context.beginPath(); context.ellipse(0, 0, radius * bodyLength, radius * bodyDepth, Math.sin(time * 0.003 + agent.id) * 0.08, 0, Math.PI * 2)
  const body = context.createLinearGradient(-radius, -radius, radius, radius)
  body.addColorStop(0, `hsl(${hue},62%,79%)`); body.addColorStop(0.45, `hsl(${hue + 10},71%,58%)`); body.addColorStop(1, `hsl(${hue + 20},66%,35%)`)
  context.fillStyle = body; context.fill()
  context.beginPath(); context.ellipse(-radius * 0.2, 0, radius * 0.34, radius * (0.2 + agent.efficiency * 0.18), 0, 0, Math.PI * 2); context.fillStyle = 'rgba(10,31,27,.66)'; context.fill()
  context.beginPath(); context.arc(radius * (bodyLength * 0.55), -radius * 0.15, Math.max(0.75, radius * (0.08 + agent.efficiency * 0.035)), 0, Math.PI * 2); context.fillStyle = 'rgba(248,244,209,.92)'; context.fill()
  for (let leg = -1; leg <= 1; leg++) {
    context.beginPath(); context.moveTo(-radius * 0.12, leg * radius * 0.25); context.quadraticCurveTo(-radius * 0.75, leg * radius * 0.7 + Math.sin(time * (0.003 + agent.metabolism * 0.045) + agent.id + leg) * radius * 0.16, -radius * 0.72, leg * radius * 0.78)
    context.strokeStyle = `hsla(${hue},54%,72%,.5)`; context.lineWidth = 0.55; context.stroke()
  }
  if (selected) { context.beginPath(); context.ellipse(0, 0, radius * 1.8, radius * 1.4, 0, 0, Math.PI * 2); context.strokeStyle = 'rgba(248,225,161,.82)'; context.lineWidth = 1; context.stroke() }
  context.restore()
}

function drawPopulationChart(context: CanvasRenderingContext2D, state: GardenState, width: number, height: number) {
  const samples = state.history.slice(-52)
  if (samples.length < 2) return
  const x = 28, y = height - 101, w = Math.min(190, width * 0.29), h = 56
  context.fillStyle = 'rgba(8,17,16,.38)'; context.fillRect(x - 10, y - 23, w + 20, h + 38)
  context.font = '8px ui-monospace, monospace'; context.fillStyle = 'rgba(182,208,185,.66)'; context.fillText('POPULATION · EFFICIENCY', x, y - 9)
  const max = Math.max(20, ...samples.map((item) => item.population))
  context.beginPath(); samples.forEach((item, index) => {
    const px = x + index / (samples.length - 1) * w, py = y + h - item.population / max * h
    if (index === 0) context.moveTo(px, py); else context.lineTo(px, py)
  })
  context.strokeStyle = 'rgba(180,220,157,.78)'; context.lineWidth = 1.1; context.shadowColor = 'rgba(148,220,147,.52)'; context.shadowBlur = 7; context.stroke(); context.shadowBlur = 0
  context.beginPath(); samples.forEach((item, index) => {
    const px = x + index / (samples.length - 1) * w, normalized = Math.max(0, Math.min(1, (item.meanEfficiency - 0.25) / 0.67)), py = y + h - normalized * h
    if (index === 0) context.moveTo(px, py); else context.lineTo(px, py)
  })
  context.strokeStyle = 'rgba(236,205,142,.78)'; context.lineWidth = 1; context.shadowColor = 'rgba(236,205,142,.28)'; context.shadowBlur = 4; context.stroke(); context.shadowBlur = 0
}
