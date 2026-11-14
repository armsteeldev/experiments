import { useEffect, useRef, useState } from 'react'
import type { ExperimentControls } from '../types'
import { ActionRow, ControlPanel, RangeControl, SelectControl } from '../components/Controls'
import { useDiscoveryHint } from '../lib/useDiscoveryHint'
import { electricField, electricPotential, type Charge } from '../simulations/electric'
import './ExpandedExhibits.css'

type Preset = 'dipole' | 'quadrupole' | 'ring' | 'cluster'
const presetOptions: [Preset, string][] = [['dipole', 'Electric dipole'], ['quadrupole', 'Quadrupole'], ['ring', 'A charged ring'], ['cluster', 'Uneven cluster']]
let chargeId = 50
function presetCharges(preset: Preset): Charge[] {
  const make = (x: number, y: number, q: number): Charge => ({ id: chargeId++, x, y, q })
  if (preset === 'quadrupole') return [make(-.85,-.75,1),make(.85,-.75,-1),make(-.85,.75,-1),make(.85,.75,1)]
  if (preset === 'ring') return Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return make(Math.cos(a) * 1.2, Math.sin(a) * 1.2, i % 2 ? -0.65 : .65) })
  if (preset === 'cluster') return [make(-1.15,-.35,1),make(.45,-.8,-.8),make(.95,.52,1),make(-.42,.95,-.62),make(.2,.15,.4)]
  return [make(-1.05,0,1),make(1.05,0,-1)]
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
type Particle = { x: number; y: number; vx: number; vy: number; q: number; trail: { x: number; y: number }[] }

export default function InvisibleForces({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hint = useDiscoveryHint('forces')
  const initialPreset = presetOptions.some(([key]) => key === stateFromUrl?.preset) ? stateFromUrl?.preset as Preset : 'dipole'
  const [preset, setPreset] = useState<Preset>(initialPreset)
  const [showPotential, setShowPotential] = useState(true)
  const [showLines, setShowLines] = useState(true)
  const [showParticles, setShowParticles] = useState(true)
  const [fieldScale, setFieldScale] = useState(1)
  const [addSign, setAddSign] = useState<1 | -1 | 0>(0)
  const [selectedChargeId, setSelectedChargeId] = useState<number | null>(null)
  const [chargeStrength, setChargeStrength] = useState(1)
  const [notice, setNotice] = useState('')
  const [probe, setProbe] = useState({ strength: '—', potential: '—' })
  const state = useRef({ charges: presetCharges(initialPreset), particles: [] as Particle[], width: 0, height: 0, dpr: 1, scale: 0, cameraX: 0, cameraY: 0, raf: 0, last: 0, pointer: null as null | { id: number; mode: 'charge' | 'pan' | 'add'; chargeId?: number; x: number; y: number; startX:number;startY:number; worldX: number; worldY: number } })
  const parameters = useRef({ paused, showPotential, showLines, showParticles, fieldScale, selectedChargeId }); parameters.current = { paused, showPotential, showLines, showParticles, fieldScale, selectedChargeId }
  useEffect(() => { onShareState({ preset, showPotential, showLines, showParticles, fieldScale }) }, [preset, showPotential, showLines, showParticles, fieldScale, onShareState])

  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d', { alpha: false }), heat = document.createElement('canvas'), heatCtx = heat.getContext('2d')
    if (!canvas || !ctx || !heatCtx) return
    const s = state.current; let width = 0, height = 0, dpr = 1, raf = 0, lastDraw = 0, lastReadout = 0
    const resize = () => { const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return; width = rect.width; height = rect.height; dpr = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(2_400_000 / (width * height))); canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); s.width = width; s.height = height; s.dpr = dpr; if (!s.scale) s.scale = Math.min(width, height) / 5.4 }
    const toScreen = (x: number, y: number) => [width / 2 + (x - s.cameraX) * s.scale, height / 2 + (y - s.cameraY) * s.scale]
    const toWorld = (x: number, y: number) => [s.cameraX + (x - width / 2) / s.scale, s.cameraY + (y - height / 2) / s.scale]
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (document.hidden || !width || now - lastDraw < 34) return
      const q = parameters.current
      const elapsed = Math.min(.05, s.last ? (now - s.last) / 1000 : 1 / 30)
      if (!q.paused) for (const particle of s.particles) {
        const e = electricField(s.charges, particle.x, particle.y), scale = q.fieldScale * particle.q * elapsed
        particle.vx += e.x * scale; particle.vy += e.y * scale; particle.x += particle.vx * elapsed; particle.y += particle.vy * elapsed
        particle.trail.push({ x: particle.x, y: particle.y }); if (particle.trail.length > 440) particle.trail.shift()
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#071018'; ctx.fillRect(0, 0, width, height)
      const haze = ctx.createRadialGradient(width * .51, height * .5, 0, width * .51, height * .5, Math.max(width, height) * .68); haze.addColorStop(0,'rgba(23,48,62,.28)'); haze.addColorStop(1,'rgba(3,7,12,0)'); ctx.fillStyle = haze; ctx.fillRect(0,0,width,height)
      if (q.showPotential && s.charges.length) {
        const cols = 144, rows = Math.max(52, Math.round(cols * height / width)); heat.width = cols; heat.height = rows
        const image = heatCtx.createImageData(cols, rows)
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          const [wx, wy] = toWorld((x + .5) / cols * width, (y + .5) / rows * height), value = electricPotential(s.charges, wx, wy), amount = clamp(Math.abs(value) * .25, 0, .5), index = (y * cols + x) * 4
          image.data[index] = value >= 0 ? 52 : 242; image.data[index + 1] = value >= 0 ? 163 : 119; image.data[index + 2] = value >= 0 ? 191 : 111; image.data[index + 3] = Math.round(amount * 255)
        }
        heatCtx.putImageData(image, 0, 0); ctx.save(); ctx.globalAlpha = .76; ctx.imageSmoothingEnabled = true; ctx.drawImage(heat, 0, 0, width, height); ctx.restore()
        const contourCols=52,contourRows=Math.max(28,Math.round(contourCols*height/width)),values=Array.from({length:contourRows+1},(_,gy)=>Array.from({length:contourCols+1},(_,gx)=>{const [wx,wy]=toWorld(gx/contourCols*width,gy/contourRows*height);return electricPotential(s.charges,wx,wy)}))
        const levels=[-2.2,-1.6,-1.15,-.78,-.48,.48,.78,1.15,1.6,2.2]
        for(const level of levels){ctx.beginPath();for(let gy=0;gy<contourRows;gy++)for(let gx=0;gx<contourCols;gx++){const x0=gx/contourCols*width,y0=gy/contourRows*height,dx=width/contourCols,dy=height/contourRows,v=[values[gy][gx],values[gy][gx+1],values[gy+1][gx+1],values[gy+1][gx]],p:[[number,number],[number,number],[number,number],[number,number]]=[[x0,y0],[x0+dx,y0],[x0+dx,y0+dy],[x0,y0+dy]],hits:[number,number][]=[];for(let edge=0;edge<4;edge++){const j=(edge+1)%4;if((v[edge]<level)!==(v[j]<level)){const t=(level-v[edge])/(v[j]-v[edge]);hits.push([p[edge][0]+(p[j][0]-p[edge][0])*t,p[edge][1]+(p[j][1]-p[edge][1])*t])}}for(let k=0;k+1<hits.length;k+=2){ctx.moveTo(hits[k][0],hits[k][1]);ctx.lineTo(hits[k+1][0],hits[k+1][1])}}ctx.strokeStyle=level>0?'rgba(141,213,222,.3)':'rgba(245,178,146,.29)';ctx.lineWidth=.7;ctx.stroke()}
      }
      if (q.showLines && s.charges.length) for (const charge of s.charges) {
        if(charge.q<0&&s.charges.some((item)=>item.q>0))continue
        const direction = charge.q >= 0 ? 1 : -1, count = Math.min(32, Math.max(8, Math.round(12 * Math.abs(charge.q))))
        for (let i = 0; i < count; i++) {
          const angle = i * Math.PI * 2 / count, start = { x: charge.x + Math.cos(angle) * .075, y: charge.y + Math.sin(angle) * .075 }
          let x = start.x, y = start.y, points: number[][] = []
          for (let j = 0; j < 520; j++) {
            const field = electricField(s.charges, x, y), magnitude = Math.hypot(field.x, field.y); if (magnitude < 1e-8) break
            x += direction * field.x / magnitude * .023; y += direction * field.y / magnitude * .023
            const [sx, sy] = toScreen(x, y); points.push([sx, sy])
            if (s.charges.some((other) => other.id !== charge.id && Math.hypot(x - other.x, y - other.y) < .075) || Math.abs(x - s.cameraX) > width / s.scale * .65 || Math.abs(y - s.cameraY) > height / s.scale * .65) break
          }
          if (points.length > 2) { ctx.beginPath(); points.forEach(([x,y],index) => index ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.strokeStyle = charge.q >= 0 ? 'rgba(143,225,224,.65)' : 'rgba(247,175,143,.53)'; ctx.lineWidth = .9; ctx.stroke(); const [x1,y1] = points[Math.floor(points.length * .63)], [x2,y2] = points[Math.floor(points.length * .65)]; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.strokeStyle = '#e6f0e6'; ctx.lineWidth = .8; ctx.stroke() }
        }
      }
      if (q.showLines && s.charges.length) {
        for (let gy = 0; gy < 13; gy++) for (let gx = 0; gx < 19; gx++) {
          const sx = width * (.06 + gx * .049), sy = height * (.1 + gy * .066), [wx, wy] = toWorld(sx, sy)
          if (s.charges.some((charge) => Math.hypot(wx - charge.x, wy - charge.y) < .38)) continue
          const e = electricField(s.charges, wx, wy), magnitude = Math.hypot(e.x, e.y); if (magnitude < .003) continue
          const length = 3 + Math.min(10, magnitude * 1.8), dx = e.x / magnitude * length, dy = e.y / magnitude * length
          ctx.beginPath(); ctx.moveTo(sx - dx / 2, sy - dy / 2); ctx.lineTo(sx + dx / 2, sy + dy / 2); ctx.strokeStyle = `rgba(197,218,220,${Math.min(.4,.12 + magnitude * .08)})`; ctx.lineWidth = .7; ctx.stroke()
          const angle = Math.atan2(dy, dx); ctx.beginPath(); ctx.moveTo(sx + dx / 2, sy + dy / 2); ctx.lineTo(sx + dx / 2 - Math.cos(angle - .55) * 3, sy + dy / 2 - Math.sin(angle - .55) * 3); ctx.lineTo(sx + dx / 2 - Math.cos(angle + .55) * 3, sy + dy / 2 - Math.sin(angle + .55) * 3); ctx.closePath(); ctx.fillStyle = '#c8e3df88'; ctx.fill()
        }
      }
      if (q.showParticles) for (const particle of s.particles) {
        ctx.beginPath(); particle.trail.forEach((point,index) => { const [x,y] = toScreen(point.x,point.y); index ? ctx.lineTo(x,y) : ctx.moveTo(x,y) }); ctx.strokeStyle = particle.q >= 0 ? '#f2d18c88' : '#d8a4ec88'; ctx.lineWidth = 1.2; ctx.stroke()
        const [x,y] = toScreen(particle.x,particle.y); ctx.fillStyle = particle.q >= 0 ? '#ffdfa3' : '#dcb9f2'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(x,y,3.5,0,Math.PI*2); ctx.fill(); ctx.shadowBlur = 0
      }
      for (const charge of s.charges) {
        const [x,y] = toScreen(charge.x,charge.y), color = charge.q >= 0 ? '#83e1dc' : '#f2a17f', radius = 10 + Math.min(6, Math.abs(charge.q) * 2)
        const glow = ctx.createRadialGradient(x,y,0,x,y,radius*4); glow.addColorStop(0,color+'77'); glow.addColorStop(.35,color+'27'); glow.addColorStop(1,color+'00'); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x,y,radius*4,0,Math.PI*2); ctx.fill()
        ctx.beginPath(); ctx.arc(x,y,radius,0,Math.PI*2); ctx.fillStyle = '#0a1720'; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 1.25; ctx.stroke(); ctx.fillStyle = color; ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(charge.q >= 0 ? '+' : '−',x,y-1); ctx.textBaseline = 'alphabetic'
        if (parameters.current.selectedChargeId === charge.id) { ctx.beginPath(); ctx.arc(x,y,radius + 8,0,Math.PI*2); ctx.strokeStyle = '#e9f4e8a8'; ctx.lineWidth = .8; ctx.setLineDash([2,4]); ctx.stroke(); ctx.setLineDash([]) }
      }
      if (now - lastReadout > 260) {
        const center = toWorld(width * .5,height * .5), field = electricField(s.charges,center[0],center[1]); setProbe({ strength: Math.hypot(field.x,field.y).toFixed(2), potential: electricPotential(s.charges,center[0],center[1]).toFixed(2) }); lastReadout = now
      }
      s.last=now;lastDraw = now
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize(); raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); observer.disconnect() }
  }, [])

  useEffect(() => { state.current.charges = presetCharges(preset); state.current.particles = []; setSelectedChargeId(null); setChargeStrength(1); setNotice('') }, [preset])
  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const s = state.current, rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top, wx = s.cameraX + (x - s.width / 2) / s.scale, wy = s.cameraY + (y - s.height / 2) / s.scale
    const charge = s.charges.slice().reverse().find((item) => Math.hypot((item.x - s.cameraX) * s.scale + s.width / 2 - x, (item.y - s.cameraY) * s.scale + s.height / 2 - y) < 24)
    const mode = addSign ? 'add' : charge ? 'charge' : 'pan'
    if (charge && !addSign) { setSelectedChargeId(charge.id); setChargeStrength(Math.abs(charge.q)); setNotice('Charge selected · move it or adjust its strength in Controls.') }
    else if (!addSign) { setSelectedChargeId(null); setNotice('') }
    s.pointer = { id: event.pointerId, mode, chargeId: charge?.id, x, y, startX:x, startY:y, worldX: wx, worldY: wy }; event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const s = state.current, p = s.pointer; if (!p || p.id !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top, wx = s.cameraX + (x - s.width / 2) / s.scale, wy = s.cameraY + (y - s.height / 2) / s.scale
    if (p.mode === 'charge') { const item = s.charges.find((candidate) => candidate.id === p.chargeId); if (item) { item.x = wx; item.y = wy } }
    else if (p.mode === 'pan') { s.cameraX -= (x - p.x) / s.scale; s.cameraY -= (y - p.y) / s.scale; p.x = x; p.y = y }
    p.worldX = wx; p.worldY = wy
  }
  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const s = state.current, p = s.pointer; if (!p || p.id !== event.pointerId) return
    if (p.mode === 'add') {
      if (s.charges.length >= 16) setNotice('The field is full. Remove a charge before adding another.')
      else { const charge = { id: chargeId++, x: p.worldX, y: p.worldY, q: addSign || 1 }; s.charges.push(charge); setSelectedChargeId(charge.id); setChargeStrength(1); setNotice('Charge placed · drag it to reshape its field.') }
      setAddSign(0)
    }
    else if (p.mode === 'pan' && Math.hypot(p.x - p.startX, p.y - p.startY) < 6) {
      s.particles.push({ x: p.worldX, y: p.worldY, vx: 0, vy: 0, q: .13, trail: [] }); if (s.particles.length > 5) s.particles.shift(); setNotice('Positive test particle released. Its path follows qE/m.')
    }
    s.pointer = null
  }
  const wheel = (event: WheelEvent) => {
    event.preventDefault(); const canvas = canvasRef.current; if (!canvas) return; const s = state.current, rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top, beforeX = s.cameraX + (x - s.width / 2) / s.scale, beforeY = s.cameraY + (y - s.height / 2) / s.scale
    s.scale = clamp(s.scale * Math.exp(-event.deltaY * .001), Math.min(s.width,s.height)/14, Math.min(s.width,s.height)*1.4); s.cameraX = beforeX - (x - s.width / 2) / s.scale; s.cameraY = beforeY - (y - s.height / 2) / s.scale
  }
  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; canvas.addEventListener('wheel', wheel, { passive: false }); return () => canvas.removeEventListener('wheel', wheel) }, [])
  const selectedCharge = state.current.charges.find((charge) => charge.id === selectedChargeId)
  const adjustChargeStrength = (value: number) => {
    setChargeStrength(value)
    const charge = state.current.charges.find((item) => item.id === selectedChargeId)
    if (charge) charge.q = (charge.q < 0 ? -1 : 1) * value
  }
  const flipChargePolarity = () => {
    const charge = state.current.charges.find((item) => item.id === selectedChargeId)
    if (charge) { charge.q *= -1; setNotice(`Selected charge is now ${charge.q > 0 ? 'positive' : 'negative'}.`) }
  }
  const placePositiveAtCentre = () => {
    const s = state.current
    if (s.charges.length >= 16) { setNotice('The field is full. Remove a charge before adding another.'); return }
    const charge = { id: chargeId++, x: s.cameraX, y: s.cameraY, q: 1 }
    s.charges.push(charge); setSelectedChargeId(charge.id); setChargeStrength(1); setAddSign(0)
    setNotice('Positive charge placed at the centre. Field lines point away from it.')
    hint.dismiss()
  }

  return <section className="experiment-surface forces-surface" aria-label="Electrostatics field visualizer">
    <canvas ref={canvasRef} className="experiment-canvas forces-canvas" aria-label="Electric charges create a field. Positive charges send field arrows outward; negative charges draw them inward." aria-describedby={hint.visible ? 'forces-first-move' : undefined} onPointerDown={(event) => { hint.dismiss(); pointerDown(event) }} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} />
    {hint.visible ? <aside className="scene-nudge scene-nudge-high" id="forces-first-move" role="note"><span>Try this · Invisible Forces</span><p>Add a positive charge. Arrows leave it and end at negative charges; tap open space to release a test particle.</p><button onClick={hint.dismiss} aria-label="Dismiss first-move hint">×</button><button className="scene-nudge-action" onClick={placePositiveAtCentre}>Place + at the centre</button></aside> : <button className="scene-nudge-reopen scene-nudge-reopen-high" onClick={hint.show} aria-label="Show interaction tip" title="Show interaction tip">i</button>}
    <div className="forces-heading"><span className="exp-eyebrow">ELECTROSTATICS · SUPERPOSITION <i /></span><h2>What the eye <em>cannot see.</em></h2></div>
    <div className="forces-scale"><span>NORMALIZED FIELD AT CENTRE</span><strong>{probe.strength}<small> E</small></strong><span>POTENTIAL <b>{probe.potential} Φ</b></span></div>
    <div className="forces-tools"><button className={addSign === 1 ? 'selected' : ''} onClick={() => { setSelectedChargeId(null); setAddSign((value) => value === 1 ? 0 : 1); setNotice('') }}>＋ Positive charge</button><button className={addSign === -1 ? 'selected' : ''} onClick={() => { setSelectedChargeId(null); setAddSign((value) => value === -1 ? 0 : -1); setNotice('') }}>− Negative charge</button><button onClick={() => { const p = state.current, removed = p.charges.pop(); if (removed?.id === selectedChargeId) { setSelectedChargeId(null); setChargeStrength(1) } setNotice(removed ? 'Last charge removed.' : 'There are no charges to remove.') }}>Remove last</button></div>
    <div className="forces-caption">{addSign ? 'CLICK THE FIELD TO PLACE A CHARGE' : notice || 'DRAG CHARGES · DRAG EMPTY SPACE TO PAN · SCROLL TO ZOOM · CLICK TO RELEASE A TEST PARTICLE'}</div>
    <ControlPanel title="Invisible Forces" note="Coulomb field · potential · particle motion" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Charge arrangement" value={preset} options={presetOptions} onChange={(value) => setPreset(value as Preset)} />
      {selectedCharge && <><RangeControl label={`Selected ${selectedCharge.q > 0 ? 'positive' : 'negative'} charge strength`} value={chargeStrength} min={.1} max={2} step={.05} format={(value) => value.toFixed(2)} onChange={adjustChargeStrength} /><ActionRow><button className="small-action" onClick={flipChargePolarity}>Flip polarity</button><button className="small-action" onClick={() => setSelectedChargeId(null)}>Unselect charge</button></ActionRow></>}
      <RangeControl label="Test-particle charge" value={fieldScale} min={.3} max={2} step={.05} format={(value) => `${value.toFixed(2)}×`} onChange={setFieldScale} />
      <ActionRow><button className="small-action" onClick={() => setShowPotential((value) => !value)}>{showPotential ? 'Potential on' : 'Potential off'}</button><button className="small-action" onClick={() => setShowLines((value) => !value)}>{showLines ? 'Field lines on' : 'Field lines off'}</button></ActionRow>
      <ActionRow><button className="small-action" onClick={() => setShowParticles((value) => !value)}>{showParticles ? 'Trajectories on' : 'Trajectories off'}</button><button className="small-action" onClick={() => { state.current.particles = []; setNotice('Test particles cleared.') }}>Clear particles</button><button className="small-action" onClick={() => { state.current.charges = presetCharges(preset); state.current.particles = []; setSelectedChargeId(null); setNotice('Preset charges restored.') }}>Restore charges</button></ActionRow>
      <p className="control-note">Positive charges send field arrows outward; negative charges draw them inward. Heat and contours show electric potential. Test particles move under qE/m. The readout uses normalized simulation values, not physical units. Changing a test particle’s charge changes its motion, not the source field.</p>
    </ControlPanel>
  </section>
}
