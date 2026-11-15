import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ActionRow, ControlPanel, RangeControl, Segmented, SelectControl } from '../components/Controls'
import type { ExperimentControls } from '../types'
import { traceOptics } from '../simulations/optics'
import type { OpticalScene, RaySource, TracedRay } from '../simulations/optics'
import { boundedStateNumber, stateChoice } from '../lib/experimentState'
import { clamp, normalizedPointer, resizeCanvas } from './invisibleWorld'
import './invisible-world.css'

type Placements = { source: [number, number]; prism: [number, number]; mirror: [number, number]; lens: [number, number] }
type SpectrumMode = 'spectrum' | 'single'
type Material = 'crown' | 'flint' | 'ice'
const defaultPlacements: Placements = { source: [0.15, 0.5], prism: [0.47, 0.5], mirror: [0.78, 0.31], lens: [0.74, 0.78] }
function restoredPlacements(value: unknown): Placements {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultPlacements
  const saved = value as Record<string, unknown>
  const result = {} as Placements
  for (const key of ['source', 'prism', 'mirror', 'lens'] as const) {
    const point = saved[key]
    const fallback = defaultPlacements[key]
    result[key] = Array.isArray(point) && point.length === 2
      ? [boundedStateNumber(point[0], fallback[0], 0.06, 0.94), boundedStateNumber(point[1], fallback[1], 0.12, 0.85)]
      : [...fallback]
  }
  return result
}
const wavelengthBands = [405, 430, 458, 488, 520, 550, 585, 620, 655, 680]
const wavelengthColour = (nm: number) => {
  let r = 0, g = 0, b = 0
  if (nm < 440) { r = -(nm - 440) / 60; b = 1 }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1 }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20 }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1 }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65 }
  else r = 1
  const factor = nm < 420 ? 0.35 + 0.65 * (nm - 380) / 40 : nm > 700 ? 0.35 + 0.65 * (780 - nm) / 80 : 1
  return `rgb(${Math.round(255 * Math.pow(r * factor, 0.82))},${Math.round(255 * Math.pow(g * factor, 0.82))},${Math.round(255 * Math.pow(b * factor, 0.82))})`
}

function buildArrangement(width: number, height: number, placements: Placements, prismRotation: number, mirrorAngle: number, focalRatio: number, index: number, dispersion: number): OpticalScene {
  const prismRadius = height * 0.105, [px, py] = placements.prism.map((value, i) => value * (i === 0 ? width : height)) as [number, number]
  const vertices = [0, 1, 2].map((step) => {
    const angle = -Math.PI / 2 + prismRotation + step * Math.PI * 2 / 3
    return { x: px + Math.cos(angle) * prismRadius, y: py + Math.sin(angle) * prismRadius }
  })
  const [mx, my] = placements.mirror.map((value, i) => value * (i === 0 ? width : height)) as [number, number]
  const mirrorHalf = height * 0.14, along = { x: Math.cos(mirrorAngle), y: Math.sin(mirrorAngle) }
  const [lx, ly] = placements.lens.map((value, i) => value * (i === 0 ? width : height)) as [number, number]
  return {
    width, height, maxBounces: 7,
    objects: [
      { kind: 'prism', vertices, index, dispersion },
      { kind: 'mirror', a: { x: mx - along.x * mirrorHalf, y: my - along.y * mirrorHalf }, b: { x: mx + along.x * mirrorHalf, y: my + along.y * mirrorHalf } },
      // The lens normal follows the beam axis, so the left-to-right rays cross its plane.
      { kind: 'lens', center: { x: lx, y: ly }, angle: 0, focalLength: height * focalRatio, aperture: height * 0.24 },
    ],
  }
}

function spectrumRays(scene: OpticalScene, placements: Placements, mode: SpectrumMode, wavelength: number, sourceAngle: number, spread: number): TracedRay[] {
  const sourceX = placements.source[0] * scene.width, sourceY = placements.source[1] * scene.height
  const bands = mode === 'spectrum' ? wavelengthBands : [wavelength]
  const count = mode === 'spectrum' ? 8 : 32
  return bands.flatMap((band) => traceOptics(scene, { x: sourceX, y: sourceY, angle: sourceAngle, spread, count, wavelength: band } satisfies RaySource))
}

export default function GeometryOfLight({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const canvasRef = useRef<HTMLCanvasElement>(null), sizeRef = useRef({ width: 1, height: 1, dpr: 1 })
  const dragRef = useRef<keyof Placements | null>(null)
  const [selectedElement, setSelectedElement] = useState<keyof Placements | null>(null), [hoverElement, setHoverElement] = useState<keyof Placements | null>(null)
  const [placements, setPlacements] = useState<Placements>(() => restoredPlacements(stateFromUrl?.placements)), [size, setSize] = useState({ width: 1000, height: 700 })
  const [spectrum, setSpectrum] = useState<SpectrumMode>(() => stateChoice(stateFromUrl?.spectrum, ['spectrum', 'single'], 'spectrum'))
  const [wavelength, setWavelength] = useState(() => boundedStateNumber(stateFromUrl?.wavelength, 520, 380, 700))
  const [material, setMaterial] = useState<Material>(() => stateChoice(stateFromUrl?.material, ['crown', 'flint', 'ice'], 'crown'))
  const [prismRotation, setPrismRotation] = useState(() => boundedStateNumber(stateFromUrl?.prismRotation, 0.17, -0.65, 0.65))
  const [mirrorAngle, setMirrorAngle] = useState(() => boundedStateNumber(stateFromUrl?.mirrorAngle, Math.PI / 4, -0.1, 1.6))
  const [focalRatio, setFocalRatio] = useState(() => boundedStateNumber(stateFromUrl?.focalRatio, 0.24, 0.12, 0.42))
  const [sourceAngle, setSourceAngle] = useState(() => boundedStateNumber(stateFromUrl?.sourceAngle, 0, -0.7, 0.7))
  const [spread, setSpread] = useState(() => boundedStateNumber(stateFromUrl?.spread, 0.065, 0.018, 0.24))
  const glass = useMemo(() => ({ crown: [1.52, 0.018], flint: [1.62, 0.041], ice: [1.31, 0.006] }[material]), [material])
  useEffect(() => { onShareState({ placements, spectrum, wavelength, material, prismRotation, mirrorAngle, focalRatio, sourceAngle, spread }) }, [placements, spectrum, wavelength, material, prismRotation, mirrorAngle, focalRatio, sourceAngle, spread, onShareState])

  const scene = useMemo(() => buildArrangement(size.width, size.height, placements, prismRotation, mirrorAngle, focalRatio, glass[0], glass[1]), [size, placements, prismRotation, mirrorAngle, focalRatio, glass])
  const rays = useMemo(() => spectrumRays(scene, placements, spectrum, wavelength, sourceAngle, spread), [scene, placements, spectrum, wavelength, sourceAngle, spread])
  const rayPaths = useMemo(() => rays.map((ray) => {
    const lengths: number[] = []; let total = 0
    for (let i = 1; i < ray.points.length; i++) { total += Math.hypot(ray.points[i].x - ray.points[i - 1].x, ray.points[i].y - ray.points[i - 1].y); lengths.push(total) }
    return { ray, lengths, total }
  }), [rays])
  const readout = useMemo(() => rays.flatMap((ray) => ray.events).find((event) => event.kind === 'refraction' || event.kind === 'reflection'), [rays])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const updateSize = () => {
      sizeRef.current = resizeCanvas(canvas, 1.4)
      setSize((previous) => previous.width === sizeRef.current.width && previous.height === sizeRef.current.height ? previous : { width: sizeRef.current.width, height: sizeRef.current.height })
    }
    const observer = new ResizeObserver(updateSize); observer.observe(canvas); updateSize()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current, context = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !context) return
    let disposed = false, animation = 0, time = 0, last = 0
    const render = (now: number) => {
      if (disposed) return
      const { width, height, dpr } = sizeRef.current
      if (!paused && now - last > 18) { time += 0.018; last = now }
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      const bg = context.createLinearGradient(0, 0, width, height)
      bg.addColorStop(0, '#08111d'); bg.addColorStop(0.48, '#0b1621'); bg.addColorStop(1, '#101a22')
      context.fillStyle = bg; context.fillRect(0, 0, width, height)
      context.save(); context.globalAlpha = 0.17; context.strokeStyle = '#7893a0'; context.lineWidth = 0.5
      for (let x = 0; x < width; x += 38) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke() }
      for (let y = 0; y < height; y += 38) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke() }
      context.restore()
      const prism = scene.objects.find((object) => object.kind === 'prism')!
      if (prism.kind === 'prism') {
        context.beginPath(); context.moveTo(prism.vertices[0].x, prism.vertices[0].y); prism.vertices.slice(1).forEach((point) => context.lineTo(point.x, point.y)); context.closePath()
        const glassFill = context.createLinearGradient(prism.vertices[0].x, 0, prism.vertices[1].x, height)
        glassFill.addColorStop(0, 'rgba(145,219,228,.14)'); glassFill.addColorStop(0.46, 'rgba(181,202,221,.075)'); glassFill.addColorStop(1, 'rgba(96,142,170,.19)')
        context.fillStyle = glassFill; context.fill(); context.strokeStyle = 'rgba(201,235,240,.62)'; context.lineWidth = 1.25; context.stroke()
        context.beginPath(); context.moveTo(prism.vertices[0].x + 8, prism.vertices[0].y + 15); context.lineTo(prism.vertices[1].x - 13, prism.vertices[1].y - 5); context.strokeStyle = 'rgba(234,250,250,.22)'; context.stroke()
      }
      const mirror = scene.objects.find((object) => object.kind === 'mirror')!
      if (mirror.kind === 'mirror') {
        context.beginPath(); context.moveTo(mirror.a.x, mirror.a.y); context.lineTo(mirror.b.x, mirror.b.y)
        context.lineWidth = 6; context.strokeStyle = 'rgba(175,209,221,.18)'; context.shadowColor = '#b2ecf8'; context.shadowBlur = 16; context.stroke(); context.shadowBlur = 0
        context.lineWidth = 1.5; context.strokeStyle = 'rgba(215,241,247,.84)'; context.stroke()
      }
      const lens = scene.objects.find((object) => object.kind === 'lens')!
      if (lens.kind === 'lens') {
        context.save(); context.translate(lens.center.x, lens.center.y); context.rotate(lens.angle)
        const half = lens.aperture * 0.5, thickness = Math.max(7, height * 0.018)
        const glass = context.createLinearGradient(-thickness, 0, thickness, 0)
        glass.addColorStop(0, 'rgba(102,174,194,.12)'); glass.addColorStop(.5, 'rgba(221,247,247,.27)'); glass.addColorStop(1, 'rgba(108,179,197,.12)')
        context.beginPath(); context.moveTo(0, -half)
        context.quadraticCurveTo(thickness, -half * .58, thickness, 0)
        context.quadraticCurveTo(thickness, half * .58, 0, half)
        context.quadraticCurveTo(-thickness, half * .58, -thickness, 0)
        context.quadraticCurveTo(-thickness, -half * .58, 0, -half); context.closePath()
        context.fillStyle = glass; context.fill(); context.strokeStyle = 'rgba(195,235,239,.65)'; context.lineWidth = 1.1; context.stroke()
        context.beginPath(); context.moveTo(0, -half * .8); context.lineTo(0, half * .8); context.strokeStyle = 'rgba(235,252,250,.27)'; context.lineWidth = .65; context.stroke()
        context.restore()
      }
      for (const path of rayPaths) {
        const { ray, lengths, total } = path
        if (ray.points.length < 2) continue
        const color = spectrum === 'spectrum' ? wavelengthColour(ray.wavelength) : wavelengthColour(wavelength)
        context.beginPath(); context.moveTo(ray.points[0].x, ray.points[0].y)
        for (let i = 1; i < ray.points.length; i++) context.lineTo(ray.points[i].x, ray.points[i].y)
        context.strokeStyle = color; context.globalAlpha = 0.42; context.lineWidth = 1.1; context.shadowColor = color; context.shadowBlur = 10; context.stroke()
        context.globalAlpha = 0.62; context.shadowBlur = 0; context.lineWidth = 0.45; context.strokeStyle = '#f6fbff'; context.stroke()
        const distance = ((time * 86 + (ray.wavelength % 37) * 3) % Math.max(1, total)), segment = lengths.findIndex((value) => value >= distance)
        if (segment >= 0) {
          const before = lengths[segment - 1] ?? 0, t = (distance - before) / Math.max(1e-5, lengths[segment] - before)
          const a = ray.points[segment], b = ray.points[segment + 1], x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t
          context.globalAlpha = 0.95; context.fillStyle = '#fff'; context.shadowColor = color; context.shadowBlur = 9; context.beginPath(); context.arc(x, y, 1.7, 0, Math.PI * 2); context.fill(); context.shadowBlur = 0
        }
      }
      const focus = hoverElement ?? selectedElement
      if (focus) {
        const [fx, fy] = placements[focus]
        const x = fx * width, y = fy * height, radius = focus === 'prism' ? height * .13 : Math.max(23, height * .045)
        context.save(); context.setLineDash([3, 4]); context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2)
        context.strokeStyle = hoverElement === focus ? 'rgba(227,248,248,.86)' : 'rgba(193,230,234,.62)'; context.lineWidth = 1; context.stroke(); context.setLineDash([])
        context.beginPath(); context.arc(x, y, 2.4, 0, Math.PI * 2); context.fillStyle = '#f4ffff'; context.fill()
        context.restore()
      }
      context.globalAlpha = 1
      const [sourceX, sourceY] = placements.source.map((value, i) => value * (i === 0 ? width : height))
      const glow = context.createRadialGradient(sourceX, sourceY, 1, sourceX, sourceY, height * 0.1)
      glow.addColorStop(0, 'rgba(248,253,255,.78)'); glow.addColorStop(0.08, 'rgba(191,234,244,.45)'); glow.addColorStop(1, 'rgba(142,208,225,0)')
      context.fillStyle = glow; context.fillRect(sourceX - height * 0.1, sourceY - height * 0.1, height * 0.2, height * 0.2)
      context.beginPath(); context.arc(sourceX, sourceY, 4, 0, Math.PI * 2); context.fillStyle = '#f4ffff'; context.fill()
      context.beginPath(); context.moveTo(0, height * 0.86); context.lineTo(width, height * 0.86); context.strokeStyle = 'rgba(172,202,215,.2)'; context.lineWidth = 1; context.stroke()
      animation = requestAnimationFrame(render)
    }
    animation = requestAnimationFrame(render)
    return () => { disposed = true; cancelAnimationFrame(animation) }
  }, [paused, rayPaths, scene, placements, spectrum, wavelength, selectedElement, hoverElement])

  const nearestElement = (point: { x: number; y: number }) => {
    const options = Object.entries(placements) as [keyof Placements, [number, number]][]
    const selected = options.sort((a, b) => Math.hypot(a[1][0] - point.x, a[1][1] - point.y) - Math.hypot(b[1][0] - point.x, b[1][1] - point.y))[0]
    return Math.hypot(selected[1][0] - point.x, selected[1][1] - point.y) < 0.13 ? selected[0] : null
  }

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = normalizedPointer(event, event.currentTarget)
    const element = nearestElement(point)
    if (element) { dragRef.current = element; setSelectedElement(element); setHoverElement(element); event.currentTarget.setPointerCapture(event.pointerId) }
  }
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) {
      const point = normalizedPointer(event, event.currentTarget)
      setHoverElement(nearestElement(point)); return
    }
    const point = normalizedPointer(event, event.currentTarget), key = dragRef.current
    setPlacements((previous) => ({ ...previous, [key]: [clamp(point.x, 0.06, 0.94), clamp(point.y, 0.12, 0.85)] }))
  }
  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => { dragRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }
  const canvasKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!event.key.startsWith('Arrow')) return
    event.preventDefault(); event.stopPropagation()
    if (event.key === 'ArrowLeft') setSourceAngle((value) => clamp(value - 0.04, -0.7, 0.7))
    else if (event.key === 'ArrowRight') setSourceAngle((value) => clamp(value + 0.04, -0.7, 0.7))
    else if (event.key === 'ArrowUp') setPrismRotation((value) => clamp(value + 0.04, -0.65, 0.65))
    else if (event.key === 'ArrowDown') setPrismRotation((value) => clamp(value - 0.04, -0.65, 0.65))
  }
  const reset = () => { setPlacements(defaultPlacements); setPrismRotation(0.17); setMirrorAngle(Math.PI / 4); setSourceAngle(0) }
  const degree = (value: number) => value * 180 / Math.PI
  const presetFocus = () => { setPlacements({ source: [0.15, 0.5], prism: [0.4, 0.5], mirror: [0.9, 0.82], lens: [0.72, 0.5] }); setMirrorAngle(0); setSourceAngle(0) }
  const presetPeriscope = () => { setPlacements({ source: [0.15, 0.35], prism: [0.47, 0.38], mirror: [0.78, 0.46], lens: [0.75, 0.75] }); setMirrorAngle(Math.PI / 4); setSourceAngle(0) }

  return <section className="iw-scene iw-optics" aria-label="Interactive geometric optics laboratory">
    <canvas ref={canvasRef} className="iw-canvas iw-optics-canvas" tabIndex={0} aria-label="Optical bench. Drag the source, prism, mirror or lens. With the canvas focused, arrow keys steer the source and rotate the prism." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onKeyDown={canvasKeyDown} />
    <div className="iw-titleplate"><span>15 · OPTICAL STUDY</span><strong>A Geometry of Light</strong><small>Rays change course at every surface.</small></div>
    <div className="iw-instruction"><i /> Drag the glass, mirror, lens or source</div>
    <div className="iw-optics-readout iw-glass-surface" aria-live="polite"><span>LIVE RAY · {spectrum === 'spectrum' ? 'VISIBLE SPECTRUM' : `${wavelength} nm`}</span><strong>{readout ? `${readout.kind.replaceAll('-', ' ')} · ${(degree(readout.incidence)).toFixed(1)}°` : 'Free propagation'}</strong><small>{readout ? `n₁ ${readout.fromIndex.toFixed(3)} → n₂ ${readout.toIndex.toFixed(3)}` : `f = ${(size.height * focalRatio).toFixed(0)} px · thin-lens model`}</small></div>
    <ControlPanel title="Optical bench" note="Geometric rays · 2D" visible={controlsVisible} onClose={onCloseControls} footer={<span>Thin lens is paraxial; prism boundaries use Snell’s law.</span>}>
      <div className="iw-panel-section"><span>Curated arrangements</span><div className="iw-button-row"><button onClick={() => { setPlacements(defaultPlacements); setPrismRotation(0.17); setMirrorAngle(Math.PI / 4) }}>Prism table</button><button onClick={presetFocus}>Focusing</button><button onClick={presetPeriscope}>Periscope</button></div></div>
      <Segmented label="Beam" value={spectrum} options={[["spectrum", "Spectrum"], ["single", "One λ"]]} onChange={(value) => setSpectrum(value as SpectrumMode)} />
      <SelectControl label="Glass" value={material} options={[["crown", "Crown · n 1.52"], ["flint", "Flint · n 1.62"], ["ice", "Ice · n 1.31"]]} onChange={(value) => setMaterial(value as Material)} />
      <RangeControl label="Wavelength" value={wavelength} min={380} max={700} step={1} format={(value) => `${Math.round(value)} nm`} onChange={setWavelength} />
      <RangeControl label="Prism rotation" value={prismRotation} min={-0.65} max={0.65} step={0.01} format={(value) => `${degree(value).toFixed(0)}°`} onChange={setPrismRotation} />
      <RangeControl label="Mirror angle" value={mirrorAngle} min={-0.1} max={1.6} step={0.01} format={(value) => `${degree(value).toFixed(0)}°`} onChange={setMirrorAngle} />
      <RangeControl label="Lens focal length" value={focalRatio} min={0.12} max={0.42} step={0.005} format={(value) => `${Math.round(value * size.height)} px`} onChange={setFocalRatio} />
      <RangeControl label="Source direction" value={sourceAngle} min={-0.7} max={0.7} step={0.01} format={(value) => `${degree(value).toFixed(0)}°`} onChange={setSourceAngle} />
      <RangeControl label="Ray fan" value={spread} min={0.018} max={0.24} step={0.002} format={(value) => `${degree(value).toFixed(1)}°`} onChange={setSpread} />
      <p className="control-note">Ray paths show geometric propagation. The prism uses wavelength-dependent refractive indices; the lens uses the paraxial thin-lens approximation. This model does not simulate diffraction or wave interference.</p>
      <ActionRow><button className="panel-action" onClick={reset}>Restore arrangement <i>↺</i></button></ActionRow>
    </ControlPanel>
  </section>
}
