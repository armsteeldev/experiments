import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { ExperimentControls } from '../types'
import { ActionRow, ControlPanel, RangeControl, SelectControl, Segmented } from '../components/Controls'
import { useDiscoveryHint } from '../lib/useDiscoveryHint'

type Species = 0 | 1 | 2
type Agent = { x: number; y: number; vx: number; vy: number; oldX: number; oldY: number; species: Species; plumage: number; size: number }
type Marker = { x: number; y: number; kind: 'attract' | 'repel' | 'obstacle' | 'food' }
type Scenario = 'murmuration' | 'predator' | 'vortex' | 'competition' | 'migration'
const scenarios: Record<Scenario, string> = {
  murmuration: 'Silver murmuration',
  predator: 'Predator and prey',
  vortex: 'Emergent vortex',
  competition: 'Competing populations',
  migration: 'Chaotic migration',
}
const palettes = {
  flock: ['#d8d5c4', '#8dc5ca', '#e4bc8a'],
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
function limit(x: number, y: number, max: number): [number, number] {
  const length = Math.hypot(x, y)
  return length > max ? [x * max / length, y * max / length] : [x, y]
}

export default function Boids({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const hint = useDiscoveryHint('boids')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const agents = useRef<Agent[]>([])
  const markers = useRef<Marker[]>([])
  const drawRef = useRef<() => void>(() => {})
  const [scenario, setScenario] = useState<Scenario>(() => Object.keys(scenarios).includes(String(stateFromUrl?.scenario)) ? stateFromUrl?.scenario as Scenario : 'murmuration')
  const [population, setPopulation] = useState(() => clamp(Number(stateFromUrl?.population) || (window.matchMedia('(max-width: 720px)').matches ? 130 : 230), 120, 1400))
  const [speed, setSpeed] = useState(() => Number(stateFromUrl?.speed) || 1.55)
  const [radius, setRadius] = useState(() => Number(stateFromUrl?.radius) || 104)
  const [tool, setTool] = useState(() => typeof stateFromUrl?.tool === 'string' ? stateFromUrl.tool : 'food')
  const [seed, setSeed] = useState(() => Number(stateFromUrl?.seed) || 17)
  const params = useRef({ scenario, population, speed, radius, tool, seed, paused })
  params.current = { scenario, population, speed, radius, tool, seed, paused }
  useEffect(() => { onShareState({ scenario, population, speed, radius, tool, seed }) }, [scenario, population, speed, radius, tool, seed, onShareState])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    let width = 0, height = 0, raf = 0, previous = 0, lastPopulation = 0, lastSeed = 0, lastScenario = ''
    let columns = 0, rows = 0, cellSize = 0
    let cells: Agent[][] = []
    const randomizer = (initialSeed: number) => {
      let value = initialSeed >>> 0
      return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296 }
    }
    const populate = (count: number, scene: Scenario, initialSeed: number) => {
      const random = randomizer(initialSeed)
      const vortex = scene === 'vortex'
      agents.current = Array.from({ length: count }, (_, i) => {
        let x = random() * width, y = random() * height
        let angle = random() * Math.PI * 2
        if (vortex) {
          angle = random() * Math.PI * 2
          const distance = 40 + random() * Math.min(width, height) * 0.33
          x = width * 0.5 + Math.cos(angle) * distance
          y = height * 0.5 + Math.sin(angle) * distance
          angle += Math.PI / 2
        } else if (scene === 'predator') {
          x = random() < 0.5 ? width * (0.12 + random() * 0.38) : width * (0.58 + random() * 0.32)
          y = height * (0.18 + random() * 0.64)
          if (i < Math.max(8, Math.floor(count * 0.035))) angle = Math.PI + (random() - 0.5) * 0.6
          else angle = (random() - 0.5) * 0.7
        } else if (scene === 'competition') {
          x = i % 2 === 0 ? width * (0.08 + random() * 0.3) : width * (0.62 + random() * 0.3)
          y = height * (0.15 + random() * 0.7)
          angle = i % 2 === 0 ? random() * 0.6 - 0.3 : Math.PI + random() * 0.6 - 0.3
        } else if (scene === 'migration') {
          x = random() * width
          y = random() * height
          angle = (random() - 0.5) * 0.65
        } else {
          const r = Math.sqrt(random()) * Math.min(width, height) * 0.23
          const bearing = random() * Math.PI * 2
          x = width * 0.48 + Math.cos(bearing) * r
          y = height * 0.48 + Math.sin(bearing) * r * 0.56
          // A loose traveling cloud gives local alignment room to gather into
          // a flock before the whole field stretches into its own patterns.
          angle = (random() - 0.5) * 0.78 + 0.08
        }
        const velocity = scene === 'murmuration' ? 0.62 + random() * 0.82 : 0.8 + random() * 1.3
        const species: Species = scene === 'predator'
          ? i < Math.max(8, Math.floor(count * 0.035)) ? 2 : 1
          : scene === 'competition' ? i % 2 as 0 | 1 : 0
        return { x, y, oldX: x, oldY: y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, species, plumage: i % 3, size: 1.05 + random() * 0.35 }
      })
      ctx.fillStyle = '#080d16'
      ctx.fillRect(0, 0, width, height)
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const oldW = width, oldH = height
      const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(3_000_000 / (rect.width * rect.height)))
      width = rect.width; height = rect.height
      canvas.width = Math.max(1, Math.floor(width * ratio))
      canvas.height = Math.max(1, Math.floor(height * ratio))
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      if (oldW && oldH) agents.current.forEach((bird) => {
        bird.x *= width / oldW; bird.oldX *= width / oldW
        bird.y *= height / oldH; bird.oldY *= height / oldH
      })
      cellSize = params.current.radius
      columns = Math.max(1, Math.ceil(width / cellSize))
      rows = Math.max(1, Math.ceil(height / cellSize))
      cells = Array.from({ length: columns * rows }, () => [])
      if (!agents.current.length) populate(params.current.population, params.current.scenario, params.current.seed)
      drawRef.current()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    const render = (leaveTrail: boolean) => {
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.fillStyle = leaveTrail ? 'rgba(7,12,20,0.26)' : '#080d16'
      ctx.fillRect(0, 0, width, height)
      for (const marker of markers.current) {
        const isObstacle = marker.kind === 'obstacle'
        const color = marker.kind === 'repel' ? '#d7918a' : marker.kind === 'food' ? '#d3c87e' : marker.kind === 'obstacle' ? '#8094a2' : '#89c9c6'
        ctx.beginPath()
        ctx.arc(marker.x, marker.y, isObstacle ? 28 : marker.kind === 'food' ? 9 : 6, 0, Math.PI * 2)
        ctx.fillStyle = isObstacle ? 'rgba(96,118,132,.12)' : color + '2a'
        ctx.fill()
        ctx.beginPath()
        ctx.arc(marker.x, marker.y, isObstacle ? 28 : 13, 0, Math.PI * 2)
        ctx.strokeStyle = color + '88'
        ctx.lineWidth = 0.9
        ctx.stroke()
        if (marker.kind === 'food') {
          ctx.beginPath(); ctx.arc(marker.x, marker.y, 2, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
        }
      }
      const colors = params.current.scenario === 'predator'
        ? ['#ffffff', '#7fc7cb', '#f2a579']
        : params.current.scenario === 'competition' ? ['#80c3ca', '#e6b27e', '#f0a87e'] : palettes.flock
      for (const bird of agents.current) {
        const angle = Math.atan2(bird.vy, bird.vx)
        const pace = clamp(Math.hypot(bird.vx, bird.vy) / Math.max(0.1, params.current.speed), 0, 1)
        const color = params.current.scenario === 'murmuration'
          ? colors[bird.plumage]
          : params.current.scenario === 'vortex' || params.current.scenario === 'migration'
            ? `hsl(${174 + pace * 38} 48% ${45 + pace * 23}%)`
            : colors[bird.species]
        const predator = params.current.scenario === 'predator' && bird.species === 2
        const moved = Math.hypot(bird.x - bird.oldX, bird.y - bird.oldY)
        if (moved < Math.min(width, height) * 0.45) {
          ctx.beginPath()
          ctx.moveTo(bird.oldX, bird.oldY)
          ctx.lineTo(bird.x, bird.y)
          ctx.strokeStyle = color
          ctx.globalAlpha = predator ? 0.22 : 0.055
          ctx.lineWidth = predator ? 0.9 : 0.4
          ctx.stroke()
        }
        ctx.save()
        ctx.translate(bird.x, bird.y)
        ctx.rotate(angle)
        ctx.scale(bird.size, bird.size)
        ctx.globalAlpha = predator ? 0.96 : 0.92
        ctx.fillStyle = color
        ctx.beginPath()
        if (predator) {
          ctx.moveTo(6.2, 0); ctx.lineTo(-4.3, -3.2); ctx.lineTo(-1.8, 0); ctx.lineTo(-4.3, 3.2)
        } else {
          // A rounded body with two shallow swept wing arcs reads as a small
          // bird at close range and as a soft, varied cloud at flock scale.
          ctx.ellipse(-0.2, 0, 4.1, 1.45, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.beginPath()
          ctx.moveTo(1.5, -0.65)
          ctx.quadraticCurveTo(-1.6, -2.6, -5.6, -3.6)
          ctx.quadraticCurveTo(-4.1, -1.3, -1.4, 0)
          ctx.moveTo(1.5, 0.65)
          ctx.quadraticCurveTo(-1.6, 2.6, -5.6, 3.6)
          ctx.quadraticCurveTo(-4.1, 1.3, -1.4, 0)
          ctx.strokeStyle = color
          ctx.globalAlpha *= 0.6
          ctx.lineWidth = 0.9
          ctx.lineCap = 'round'
          ctx.stroke()
        }
        if (predator) { ctx.closePath(); ctx.fill() }
        ctx.restore()
      }
      ctx.globalAlpha = 1
    }
    drawRef.current = () => render(false)
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden) return
      const q = params.current
      if (lastPopulation !== q.population || lastSeed !== q.seed || lastScenario !== q.scenario) {
        populate(q.population, q.scenario, q.seed)
        lastPopulation = q.population; lastSeed = q.seed; lastScenario = q.scenario
      }
      if (q.paused || now - previous < 27) return
      const dt = Math.min(1.8, (now - previous) / 16.67 || 1)
      previous = now
      const r = q.radius
      if (cellSize !== r) {
        cellSize = r; columns = Math.max(1, Math.ceil(width / cellSize)); rows = Math.max(1, Math.ceil(height / cellSize))
        cells = Array.from({ length: columns * rows }, () => [])
      } else cells.forEach((cell) => { cell.length = 0 })
      for (const bird of agents.current) {
        const gx = Math.floor(bird.x / cellSize), gy = Math.floor(bird.y / cellSize)
        cells[((gy + rows) % rows) * columns + ((gx + columns) % columns)]?.push(bird)
      }
      const radius2 = r * r
      const maxSpeed = q.speed * (q.scenario === 'predator' ? 1.2 : 1)
      for (const bird of agents.current) {
        let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, neighbors = 0
        let closestPrey: Agent | null = null, closestPredator: Agent | null = null
        let preyDistance2 = Infinity, predatorDistance2 = Infinity
        const gx = Math.floor(bird.x / cellSize), gy = Math.floor(bird.y / cellSize)
        const reach = q.scenario === 'predator' && bird.species === 1 ? 3 : 1
        const checkedCells = new Set<number>()
        for (let oy = -reach; oy <= reach; oy++) for (let ox = -reach; ox <= reach; ox++) {
          const xx = (gx + ox + columns) % columns, yy = (gy + oy + rows) % rows
          const cellIndex = yy * columns + xx
          if (checkedCells.has(cellIndex)) continue
          checkedCells.add(cellIndex)
          for (const other of cells[cellIndex]) {
            if (other === bird) continue
            let dx = other.x - bird.x, dy = other.y - bird.y
            if (dx > width / 2) dx -= width; else if (dx < -width / 2) dx += width
            if (dy > height / 2) dy -= height; else if (dy < -height / 2) dy += height
            const d2 = dx * dx + dy * dy
            if (d2 > radius2 * (bird.species === 1 ? 6.25 : 1)) continue
            if (q.scenario === 'predator' && bird.species === 2 && other.species === 1 && d2 < preyDistance2) {
              preyDistance2 = d2; closestPrey = other
            } else if (q.scenario === 'predator' && bird.species === 1 && other.species === 2 && d2 < predatorDistance2) {
              predatorDistance2 = d2; closestPredator = other
            }
            const sameGroup = other.species === bird.species
            if (d2 < radius2 && sameGroup) {
              sx -= dx / (d2 + 20); sy -= dy / (d2 + 20)
              ax += other.vx; ay += other.vy
              cx += bird.x + dx; cy += bird.y + dy
              neighbors++
            } else if (q.scenario === 'competition' && !sameGroup && d2 < radius2 * 0.64) {
              sx -= dx / (d2 + 16) * 2.5; sy -= dy / (d2 + 16) * 2.5
            }
          }
        }
        let fx = 0, fy = 0
        if (neighbors) {
          // Keep separation local; letting its inverse-distance sum dominate
          // alignment caused the opening flock to radiate into a starburst.
          const separation = limit(sx * 42, sy * 42, 0.11)
          const alignment = limit(ax / neighbors - bird.vx, ay / neighbors - bird.vy, q.scenario === 'murmuration' ? 0.13 : 0.085)
          const cohesionScale = q.scenario === 'murmuration' ? 0.0028 : 0.00115
          const cohesion = limit((cx / neighbors - bird.x) * cohesionScale, (cy / neighbors - bird.y) * cohesionScale, q.scenario === 'murmuration' ? 0.12 : 0.084)
          fx += separation[0] + alignment[0] + cohesion[0]
          fy += separation[1] + alignment[1] + cohesion[1]
        }
        if (closestPrey) {
          let dx = closestPrey.x - bird.x, dy = closestPrey.y - bird.y
          if (dx > width / 2) dx -= width; if (dx < -width / 2) dx += width
          if (dy > height / 2) dy -= height; if (dy < -height / 2) dy += height
          const chase = limit(dx * 0.00075, dy * 0.00075, 0.15)
          fx += chase[0]; fy += chase[1]
        }
        if (closestPredator) {
          let dx = bird.x - closestPredator.x, dy = bird.y - closestPredator.y
          if (dx > width / 2) dx -= width; if (dx < -width / 2) dx += width
          if (dy > height / 2) dy -= height; if (dy < -height / 2) dy += height
          const flee = limit(dx * 0.0018, dy * 0.0018, 0.22)
          fx += flee[0]; fy += flee[1]
        }
        if (q.scenario === 'vortex') {
          const dx = bird.x - width / 2, dy = bird.y - height / 2
          const swirl = limit(-dy * 0.00014, dx * 0.00014, 0.07)
          fx += swirl[0]; fy += swirl[1]
        } else if (q.scenario === 'migration') {
          const wind = limit(maxSpeed - bird.vx, 0.1 - bird.vy, 0.04)
          fx += wind[0]; fy += wind[1]
        }
        if (q.scenario === 'murmuration') {
          // Keep this showcase flock in view without pinning it to a point:
          // the edge only turns birds back once they approach the frame.
          const margin = Math.min(76, Math.min(width, height) * 0.13)
          if (bird.x < margin) fx += (margin - bird.x) / margin * 0.14
          else if (bird.x > width - margin) fx -= (bird.x - (width - margin)) / margin * 0.14
          if (bird.y < margin) fy += (margin - bird.y) / margin * 0.14
          else if (bird.y > height - margin) fy -= (bird.y - (height - margin)) / margin * 0.14
        }
        for (const marker of markers.current) {
          let dx = marker.x - bird.x, dy = marker.y - bird.y
          if (dx > width / 2) dx -= width; else if (dx < -width / 2) dx += width
          if (dy > height / 2) dy -= height; else if (dy < -height / 2) dy += height
          const distance = Math.hypot(dx, dy) || 1
          if (marker.kind === 'obstacle' && distance < 76) {
            const force = (1 - distance / 76) * 0.22
            fx -= dx / distance * force; fy -= dy / distance * force
          } else if (marker.kind === 'food' && distance < 240) {
            const strength = 0.026 / Math.max(0.25, distance / 100)
            fx += dx / distance * strength; fy += dy / distance * strength
          } else if (marker.kind === 'attract' && distance < 300) {
            const strength = 0.021 / Math.max(0.2, distance / 110)
            fx += dx / distance * strength; fy += dy / distance * strength
          } else if (marker.kind === 'repel' && distance < 280) {
            const strength = 0.032 / Math.max(0.25, distance / 100)
            fx -= dx / distance * strength; fy -= dy / distance * strength
          }
        }
        const force = limit(fx, fy, 0.23)
        bird.vx += force[0] * dt
        bird.vy += force[1] * dt
        const velocity = limit(bird.vx, bird.vy, maxSpeed * (bird.species === 2 ? 1.25 : 1))
        bird.oldX = bird.x; bird.oldY = bird.y
        bird.vx = velocity[0]; bird.vy = velocity[1]
        if (q.scenario === 'murmuration') {
          bird.x += bird.vx * dt; bird.y += bird.vy * dt
          if (bird.x < 6 || bird.x > width - 6) { bird.x = clamp(bird.x, 6, width - 6); bird.vx *= -0.72 }
          if (bird.y < 6 || bird.y > height - 6) { bird.y = clamp(bird.y, 6, height - 6); bird.vy *= -0.72 }
        } else {
          bird.x = (bird.x + bird.vx * dt + width) % width
          bird.y = (bird.y + bird.vy * dt + height) % height
        }
      }
      render(true)
    }
    raf = requestAnimationFrame(frame)
    resize()
    return () => { cancelAnimationFrame(raf); resizeObserver.disconnect(); agents.current = []; markers.current = []; drawRef.current = () => {} }
  }, [])

  const placeMarker = (x: number, y: number, kind: Marker['kind'] = tool as Marker['kind']) => {
    markers.current.push({ x, y, kind })
    if (markers.current.length > 16) markers.current.shift()
    drawRef.current()
  }
  const addMarker = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    hint.dismiss()
    const rect = event.currentTarget.getBoundingClientRect()
    placeMarker(event.clientX - rect.left, event.clientY - rect.top)
  }
  const placeFoodAtCentre = () => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect) placeMarker(rect.width / 2, rect.height / 2, 'food')
    hint.dismiss()
  }
  const randomize = () => { setSeed((value) => (value * 1664525 + 1013904223) >>> 0 || 1); markers.current = [] }

  return <div className="experiment-surface">
    <canvas ref={canvasRef} className="experiment-canvas boids-canvas" aria-label="Interactive artificial life. Tap to place food that attracts the flock; change the field in controls." aria-describedby={hint.visible ? 'boids-first-move' : undefined} onPointerDown={addMarker} onContextMenu={(event) => event.preventDefault()} />
    {hint.visible ? <aside className="scene-nudge" id="boids-first-move" role="note"><span>Try this · A Murmuration</span><p>Drop food into the flock and watch nearby birds turn toward it. Every bird follows only its local neighbours.</p><button onClick={hint.dismiss} aria-label="Dismiss first-move hint">×</button><button className="scene-nudge-action" onClick={placeFoodAtCentre}>Drop food here</button></aside> : <button className="scene-nudge-reopen" onClick={hint.show} aria-label="Show interaction tip" title="Show interaction tip">i</button>}
    <span className="canvas-coordinate">{scenarios[scenario].toUpperCase()} · {population.toLocaleString()} AGENTS</span>
    <ControlPanel title={scenario === 'vortex' ? 'An Emergent Vortex' : 'A Murmuration'} note="SPATIAL ECOLOGY" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Behavioural scene" value={scenario} options={Object.entries(scenarios).map(([key, name]) => [key, name])} onChange={(value) => { setScenario(value as Scenario); markers.current = [] }} />
      <RangeControl label="Population" value={population} min={120} max={1400} step={20} onChange={setPopulation} />
      <RangeControl label="Pace" value={speed} min={0.55} max={4.2} step={0.05} onChange={setSpeed} format={(value) => value.toFixed(1) + '×'} />
      <RangeControl label="Awareness" value={radius} min={28} max={132} step={2} onChange={setRadius} format={(value) => value + ' px'} />
      <Segmented label="Place into the field" value={tool} options={[['attract', 'Attract'], ['repel', 'Repel'], ['obstacle', 'Barrier'], ['food', 'Food']]} onChange={setTool} />
      <p className="control-note">Each bird reacts to nearby flockmates: it keeps space, matches their heading and turns toward the group. Awareness sets how far it looks; food, attractors, repellers and barriers change the surroundings.</p>
      <ActionRow>
        <button className="panel-action" onClick={() => { markers.current = []; drawRef.current() }}><span>Clear field marks</span><i>×</i></button>
        <button className="panel-action" onClick={randomize}><span>Re-seed system</span><i>↻</i></button>
      </ActionRow>
      <p className="control-note">{scenario === 'predator' ? 'Hunters pursue nearby prey; prey align, gather and flee from danger.' : scenario === 'competition' ? 'Two groups flock by their own local rules and repel the other population.' : scenario === 'vortex' ? 'A gentle rotating field seeds the circulation; local separation, alignment and cohesion reshape the flock. Hue shifts with speed.' : 'Separation, alignment and cohesion turn local sensing into collective movement. Hue shifts with speed.'} Place a field to alter the flow.</p>
    </ControlPanel>
  </div>
}
