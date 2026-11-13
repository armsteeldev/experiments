import { useEffect, useRef } from 'react'
import { rasterMandelbrot } from '../lib/fractalPreview'

type Props = { id: string; live?: boolean }
type Palette = [string, string, string]

const palettes: Record<string, Palette> = {
  mandelbrot: ['#c8d3d9', '#84b4c8', '#7276a2'],
  fluid: ['#d4a990', '#739ca4', '#a786bd'],
  boids: ['#d8d1ae', '#86b7af', '#d69479'],
  attractors: ['#9ac9cf', '#8292c8', '#d2a4c2'],
  reaction: ['#d0a078', '#a7b484', '#87aeb0'],
  lsystem: ['#c4b27c', '#8fae7e', '#d19d76'],
  gravity: ['#9cc4d5', '#c9aa82', '#8a85bd'],
  cpu: ['#9bc5d0', '#7d94a9', '#d3b17f'],
  neural: ['#8caed1', '#c392ad', '#d5c387'],
  circuit: ['#91c1b2', '#cfb77e', '#829cc9'],
  electric: ['#9ec9d7', '#d3b67f', '#a78cbd'],
  automata: ['#a8c0a0', '#82b5b2', '#d0a77b'],
  adder: ['#9bbbc8', '#d0ae76', '#a49ac6'],
}
const previewModes: Record<string, string> = {
  'gravity-playground': 'gravity',
  'inside-machine': 'cpu',
  'neural-network': 'neural',
  'neural-networks': 'neural',
  'logic-laboratory': 'circuit',
  'invisible-forces': 'electric',
  'cellular-automata': 'automata',
}
const fractalCache = new Map<string, HTMLCanvasElement>()
const backgroundCache = new Map<string, HTMLCanvasElement>()
type PendingFractal = { width: number; height: number; palette: Palette }
let fractalWorker: Worker | null = null
let fractalWorkerUnavailable = false
const fractalPending = new Map<string, PendingFractal>()

function drawFractalFallback(canvas: HTMLCanvasElement, palette: Palette) {
  const width = Math.min(420, canvas.width)
  const height = Math.min(180, Math.max(140, Math.round(width * canvas.height / canvas.width)))
  const scratch = document.createElement('canvas')
  scratch.width = width
  scratch.height = height
  const scratchContext = scratch.getContext('2d')
  const targetContext = canvas.getContext('2d')
  if (!scratchContext || !targetContext) return
  const image = scratchContext.createImageData(width, height)
  image.data.set(rasterMandelbrot(width, height, palette))
  scratchContext.putImageData(image, 0, 0)
  targetContext.drawImage(scratch, 0, 0, canvas.width, canvas.height)
}

function getFractalWorker() {
  if (fractalWorkerUnavailable || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null
  if (fractalWorker) return fractalWorker
  try {
    fractalWorker = new Worker(new URL('../workers/previewRaster.worker.ts', import.meta.url), { type: 'module' })
    fractalWorker.onmessage = ({ data }: MessageEvent<{ key: string; bitmap: ImageBitmap }>) => {
      const target = fractalCache.get(data.key)
      if (target) target.getContext('2d')?.drawImage(data.bitmap, 0, 0)
      data.bitmap.close()
      fractalPending.delete(data.key)
      window.dispatchEvent(new Event('armsteel-preview-ready'))
    }
    fractalWorker.onerror = () => {
      fractalWorkerUnavailable = true
      fractalWorker?.terminate()
      fractalWorker = null
      for (const [key, request] of fractalPending) {
        const target = fractalCache.get(key)
        if (target) drawFractalFallback(target, request.palette)
      }
      fractalPending.clear()
      window.dispatchEvent(new Event('armsteel-preview-ready'))
    }
  } catch {
    fractalWorkerUnavailable = true
    return null
  }
  return fractalWorker
}

const paletteFor = (id: string): Palette => palettes[id] ?? palettes[previewModes[id]] ?? ['#b4c6cc', '#85a9bc', '#9d90b4']
const randomAt = (n: number) => {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return value - Math.floor(value)
}

function background(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette) {
  const key = `${w}x${h}:${palette.join('-')}`
  let surface = backgroundCache.get(key)
  if (!surface) {
    surface = document.createElement('canvas')
    surface.width = w
    surface.height = h
    const base = surface.getContext('2d', { alpha: false })
    if (!base) return
    base.fillStyle = '#080c13'
    base.fillRect(0, 0, w, h)
    const glow = base.createRadialGradient(w * 0.52, h * 0.48, 0, w * 0.52, h * 0.48, h * 0.84)
    glow.addColorStop(0, 'rgba(38,58,74,.33)')
    glow.addColorStop(0.48, 'rgba(16,28,41,.18)')
    glow.addColorStop(1, 'rgba(5,9,15,0)')
    base.fillStyle = glow
    base.fillRect(0, 0, w, h)

    const light = base.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, h * 0.7)
    light.addColorStop(0, palette[1] + '12')
    light.addColorStop(1, palette[1] + '00')
    base.fillStyle = light
    base.fillRect(0, 0, w, h)

    for (let i = 0; i < 44; i++) {
      const x = randomAt(i + 2) * w
      const y = randomAt(i + 91) * h
      const radius = randomAt(i + 191) * 1.1 + 0.25
      base.fillStyle = `rgba(202,220,230,${0.035 + randomAt(i + 271) * 0.09})`
      base.beginPath()
      base.arc(x, y, radius, 0, Math.PI * 2)
      base.fill()
    }
    backgroundCache.set(key, surface)
    if (backgroundCache.size > 6) backgroundCache.delete(backgroundCache.keys().next().value!)
  }
  ctx.drawImage(surface, 0, 0)
}

function drawMandelbrot(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, time: number) {
  const worker = getFractalWorker()
  const targetWidth = worker ? Math.min(1024, Math.max(520, Math.round(w * 0.78))) : Math.min(420, Math.max(300, Math.round(w * 0.4)))
  const targetHeight = worker ? Math.min(440, Math.max(240, Math.round(h * 0.75))) : Math.min(180, Math.max(140, Math.round(h * 0.35)))
  const key = `${targetWidth}x${targetHeight}:${palette.join('-')}`
  let target = fractalCache.get(key)
  if (!target) {
    target = document.createElement('canvas')
    target.width = targetWidth
    target.height = targetHeight
    fractalCache.set(key, target)
    if (fractalCache.size > 6) fractalCache.delete(fractalCache.keys().next().value!)
    if (worker) {
      fractalPending.set(key, { width: targetWidth, height: targetHeight, palette })
      worker.postMessage({ key, width: targetWidth, height: targetHeight, palette })
    } else {
      drawFractalFallback(target, palette)
    }
  }
  const scale = Math.max(w * 0.84 / target.width, h * 0.84 / target.height)
  const drawW = target.width * scale, drawH = target.height * scale
  ctx.save()
  ctx.globalAlpha = 0.94
  ctx.drawImage(target, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH)
  ctx.restore()
  const glintX = w * (0.34 + 0.31 * (0.5 + Math.sin(time * 0.12) * 0.5))
  const glint = ctx.createRadialGradient(glintX, h * 0.47, 0, glintX, h * 0.47, h * 0.17)
  glint.addColorStop(0, palette[0] + '22')
  glint.addColorStop(1, palette[0] + '00')
  ctx.fillStyle = glint
  const glintRadius = h * 0.17
  ctx.fillRect(glintX - glintRadius, h * 0.47 - glintRadius, glintRadius * 2, glintRadius * 2)
  const rim = ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.11, w * 0.5, h * 0.5, h * 0.58)
  rim.addColorStop(0, 'rgba(0,0,0,0)')
  rim.addColorStop(1, palette[1] + '19')
  ctx.fillStyle = rim
  const rimRadius = h * 0.58
  ctx.fillRect(w * 0.5 - rimRadius, h * 0.5 - rimRadius, rimRadius * 2, rimRadius * 2)
}

function drawFluid(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, time: number) {
  const centers = [[0.37 + Math.sin(time * 0.18) * 0.035, 0.5, 0.062], [0.68, 0.47 + Math.cos(time * 0.14) * 0.045, -0.055]]
  const lineCount = Math.max(18, Math.round(w / 28))
  for (let line = 0; line < lineCount; line++) {
    let x = 0.02
    let y = (line + 0.5) / lineCount
    ctx.beginPath()
    ctx.moveTo(x * w, y * h)
    for (let step = 0; step < 260; step++) {
      let vx = 0.52, vy = Math.sin(y * 5.8 + time * 0.11) * 0.018
      for (const [cx, cy, strength] of centers) {
        const dx = x - cx, dy = y - cy
        const radius = dx * dx + dy * dy + 0.018
        vx -= dy / radius * strength
        vy += dx / radius * strength
      }
      x += vx * 0.0038
      y += vy * 0.0038
      if (x < -0.02 || x > 1.04 || y < -0.06 || y > 1.06) break
      ctx.lineTo(x * w, y * h)
    }
    ctx.strokeStyle = palette[line % 3] + (line % 4 === 0 ? '94' : '50')
    ctx.lineWidth = line % 5 === 0 ? 1.15 : 0.65
    ctx.stroke()
  }
  for (const [cx, cy] of centers) {
    const halo = ctx.createRadialGradient(cx * w, cy * h, 0, cx * w, cy * h, h * 0.2)
    halo.addColorStop(0, palette[1] + '32')
    halo.addColorStop(1, palette[1] + '00')
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, w, h)
  }
}

function drawBoids(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, time: number) {
  for (let i = 0; i < 96; i++) {
    const u = randomAt(i + 3)
    const v = randomAt(i + 401)
    const lane = Math.floor(randomAt(i + 777) * 5)
    const x = (0.12 + u * 0.74) * w + Math.sin(time * 0.12 + v * 7) * w * 0.018
    const y = (0.18 + v * 0.64) * h + Math.sin(u * 7 + lane + time * 0.15) * h * 0.075
    const angle = Math.atan2(Math.cos(u * 7 + lane), 1.35)
    const size = 2.1 + randomAt(i + 222) * 2.3
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.moveTo(size * 1.5, 0)
    ctx.lineTo(-size, -size * 0.56)
    ctx.lineTo(-size * 0.42, 0)
    ctx.lineTo(-size, size * 0.56)
    ctx.closePath()
    ctx.fillStyle = palette[(i + lane) % 3] + 'b8'
    ctx.fill()
    ctx.restore()
  }
}

function drawAttractor(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, time: number) {
  let x = 0.1, y = 0, z = 0
  ctx.beginPath()
  for (let i = 0; i < 3600; i++) {
    const dx = 10 * (y - x), dy = x * (28 - z) - y, dz = x * y - 2.666 * z
    x += dx * 0.005; y += dy * 0.005; z += dz * 0.005
    const angle = time * 0.08
    const px = Math.cos(angle) * x - Math.sin(angle) * y
    const py = Math.sin(angle) * x + Math.cos(angle) * y
    const sx = w * 0.5 + px * w * 0.0148
    const sy = h * 0.5 + (z - 25) * h * 0.023 + py * h * 0.014
    if (i) ctx.lineTo(sx, sy)
    else ctx.moveTo(sx, sy)
  }
  ctx.strokeStyle = palette[0] + 'c8'
  ctx.lineWidth = 0.9
  ctx.shadowColor = palette[0] + '82'
  ctx.shadowBlur = 9
  ctx.stroke()
  ctx.shadowBlur = 0
}

function drawReaction(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, time: number) {
  const cell = Math.max(5, Math.round(w / 96))
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      const u = x / w, v = y / h
      const a = Math.sin(u * 22 + Math.sin(v * 13 + time * 0.13) * 2.2)
      const b = Math.cos(v * 19 - Math.cos(u * 11 - time * 0.1) * 2.4)
      const c = Math.sin((u + v) * 14 + Math.cos(u * 8 + v * 5) * 1.4)
      const value = a * b + c * 0.48
      if (value > 0.62) {
        const shade = Math.abs(Math.round((u * 9 + v * 11) * 7)) % 3
        const radius = cell * (0.38 + Math.min(0.44, (value - 0.62) * 0.6))
        ctx.fillStyle = palette[shade] + 'a8'
        ctx.beginPath()
        ctx.ellipse(x + cell * 0.5, y + cell * 0.5, radius * 1.22, radius * 0.74, value * 0.55, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}

function drawBranch(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, depth: number, palette: Palette, wind: number, seed: number) {
  if (depth <= 0 || length < 1.4) return
  const bend = Math.sin(seed * 8.9 + depth * 1.7 + wind) * 0.035
  const nextAngle = angle + bend
  const nx = x + Math.cos(nextAngle) * length
  const ny = y + Math.sin(nextAngle) * length
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.quadraticCurveTo((x + nx) / 2 + bend * length * 1.8, (y + ny) / 2, nx, ny)
  ctx.strokeStyle = palette[depth % 3] + (depth > 4 ? '9c' : '75')
  ctx.lineWidth = Math.max(0.55, depth * 0.43)
  ctx.stroke()
  const spread = 0.43 + randomAt(seed + depth) * 0.2
  drawBranch(ctx, nx, ny, nextAngle - spread, length * (0.69 + randomAt(seed + 2) * 0.04), depth - 1, palette, wind, seed + 1.4)
  drawBranch(ctx, nx, ny, nextAngle + spread, length * (0.68 + randomAt(seed + 3) * 0.04), depth - 1, palette, wind, seed + 2.3)
}

function drawLSystem(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, time: number) {
  const rootX = w * 0.5, rootY = h * 0.92
  const root = ctx.createRadialGradient(rootX, rootY, 0, rootX, rootY, h * 0.42)
  root.addColorStop(0, palette[1] + '35')
  root.addColorStop(1, palette[1] + '00')
  ctx.fillStyle = root
  ctx.fillRect(0, 0, w, h)
  ctx.lineCap = 'round'
  drawBranch(ctx, rootX, rootY, -Math.PI / 2, h * 0.2, 8, palette, time * 0.18, 11)
}

function drawGravity(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, time: number) {
  const cx = w * 0.5, cy = h * 0.5
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-0.22)
  for (let i = 0; i < 5; i++) {
    const rx = w * (0.13 + i * 0.065), ry = h * (0.1 + i * 0.04)
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
    ctx.strokeStyle = palette[i % 3] + '48'; ctx.lineWidth = 0.8; ctx.stroke()
    const angle = time * (0.2 + i * 0.035) + i * 1.2
    const x = Math.cos(angle) * rx, y = Math.sin(angle) * ry
    ctx.beginPath(); ctx.arc(x, y, 2.2 + (i % 2), 0, Math.PI * 2)
    ctx.fillStyle = palette[(i + 1) % 3]; ctx.shadowColor = palette[(i + 1) % 3]; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0
  }
  ctx.restore()
  const sun = ctx.createRadialGradient(cx, cy, 0, cx, cy, h * 0.11)
  sun.addColorStop(0, palette[1] + 'b0'); sun.addColorStop(0.12, palette[1] + '38'); sun.addColorStop(1, palette[1] + '00')
  ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h)
}

function drawNetwork(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, neural = false) {
  const layers = neural ? [3, 5, 5, 3] : [4, 6, 4]
  const points: Array<Array<[number, number]>> = []
  const left = w * 0.19, right = w * 0.81
  layers.forEach((count, layer) => {
    const x = left + (right - left) * layer / (layers.length - 1)
    const top = h * (0.5 - (count - 1) * 0.105)
    points.push(Array.from({ length: count }, (_, i) => [x, top + i * h * 0.21] as [number, number]))
  })
  for (let layer = 0; layer < points.length - 1; layer++) {
    for (const [i, a] of points[layer].entries()) {
      for (const [j, b] of points[layer + 1].entries()) {
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1])
        ctx.strokeStyle = palette[(i + j + layer) % 3] + (neural ? '36' : '43'); ctx.lineWidth = 0.75; ctx.stroke()
      }
    }
  }
  points.flat().forEach(([x, y], i) => {
    const radius = neural ? 3.6 : 2.5
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = '#101c27'; ctx.fill(); ctx.strokeStyle = palette[i % 3] + 'c8'; ctx.lineWidth = 1; ctx.stroke()
    ctx.beginPath(); ctx.arc(x, y, radius * 0.34, 0, Math.PI * 2); ctx.fillStyle = palette[i % 3]; ctx.fill()
  })
}

function drawCircuit(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, time: number) {
  const paths = [
    [[0.05, 0.25], [0.28, 0.25], [0.28, 0.41], [0.5, 0.41], [0.5, 0.51], [0.86, 0.51]],
    [[0.05, 0.74], [0.28, 0.74], [0.28, 0.59], [0.5, 0.59], [0.5, 0.51]],
    [[0.28, 0.25], [0.28, 0.12], [0.71, 0.12], [0.71, 0.51]],
    [[0.28, 0.74], [0.28, 0.88], [0.71, 0.88], [0.71, 0.51]],
  ]
  paths.forEach((path, i) => {
    ctx.beginPath()
    path.forEach(([x, y], n) => n ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h))
    ctx.strokeStyle = palette[i % 3] + '82'; ctx.lineWidth = i === 0 ? 1.4 : 1; ctx.shadowColor = palette[i % 3] + '43'; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0
  })
  for (const [x, y, r] of [[0.42, 0.5, 0.065], [0.65, 0.5, 0.065]]) {
    ctx.beginPath(); ctx.arc(x * w, y * h, h * r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x * w, y * h - h * r); ctx.closePath()
    ctx.fillStyle = 'rgba(10,17,26,.88)'; ctx.fill(); ctx.strokeStyle = palette[1] + 'b0'; ctx.lineWidth = 1; ctx.stroke()
  }
  const pulseX = ((time * 0.12) % 1) * w
  const pulse = ctx.createRadialGradient(pulseX, h * 0.51, 0, pulseX, h * 0.51, 11)
  pulse.addColorStop(0, palette[0] + 'c0'); pulse.addColorStop(1, palette[0] + '00')
  ctx.fillStyle = pulse; ctx.fillRect(pulseX - 12, h * 0.51 - 12, 24, 24)
}

function drawElectric(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, time: number) {
  const left = [w * 0.35, h * 0.5], right = [w * 0.65, h * 0.5]
  const count = 18
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2
    ctx.beginPath()
    for (let step = 0; step <= 100; step++) {
      const t = step / 100
      const bow = Math.sin(t * Math.PI) * h * 0.23 * Math.sin(angle)
      const x = left[0] + (right[0] - left[0]) * t
      const y = left[1] + bow + Math.cos(angle) * h * 0.018 + Math.sin(time * 0.1 + i) * 0.4
      step ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    ctx.strokeStyle = palette[i % 3] + (i % 3 === 0 ? '72' : '38'); ctx.lineWidth = 0.8; ctx.stroke()
  }
  for (const [index, [x, y]] of [left, right].entries()) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, h * 0.16)
    glow.addColorStop(0, palette[index] + 'a0'); glow.addColorStop(0.1, palette[index] + '40'); glow.addColorStop(1, palette[index] + '00')
    ctx.fillStyle = glow; ctx.fillRect(x - h * 0.16, y - h * 0.16, h * 0.32, h * 0.32)
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = palette[index]; ctx.fill()
  }
}

function drawAutomata(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, time: number) {
  const cols = Math.max(34, Math.round(w / 9)), rows = Math.max(20, Math.round(h / 9))
  const cellW = w / cols, cellH = h / rows
  const phase = Math.floor(time * 2.5)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const wave = Math.sin(x * 0.31 + y * 0.14 + phase * 0.11) + Math.sin(y * 0.43 - x * 0.17 + phase * 0.09)
      const seed = randomAt(x * 37 + y * 191 + phase * 13)
      if (wave + seed * 1.1 > 1.26) {
        ctx.fillStyle = palette[Math.floor(seed * 3)] + (seed > 0.76 ? 'd0' : '79')
        ctx.fillRect(x * cellW + 0.5, y * cellH + 0.5, Math.max(1, cellW - 1.2), Math.max(1, cellH - 1.2))
      }
    }
  }
}

function drawDefault(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, time: number) {
  ctx.save()
  ctx.translate(w * 0.5, h * 0.5)
  ctx.rotate(time * 0.025)
  for (let ring = 0; ring < 12; ring++) {
    ctx.beginPath()
    const r = h * (0.11 + ring * 0.027)
    for (let step = 0; step <= 200; step++) {
      const a = step * Math.PI / 100
      const fold = 1 + 0.14 * Math.sin(a * 5 + ring * 0.4) + 0.06 * Math.cos(a * 9 - time * 0.1)
      const x = Math.cos(a) * r * fold * 1.28, y = Math.sin(a) * r * fold * 0.72
      step ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    ctx.strokeStyle = palette[ring % 3] + (ring % 2 ? '52' : '8a')
    ctx.lineWidth = ring % 3 === 0 ? 1.2 : 0.7
    ctx.stroke()
  }
  ctx.restore()
}

function render(ctx: CanvasRenderingContext2D, id: string, w: number, h: number, time: number) {
  const mode = previewModes[id] ?? id
  const palette = paletteFor(id)
  background(ctx, w, h, palette)
  switch (mode) {
    case 'mandelbrot': drawMandelbrot(ctx, w, h, palette, time); break
    case 'fluid': drawFluid(ctx, w, h, palette, time); break
    case 'boids': drawBoids(ctx, w, h, palette, time); break
    case 'attractors': drawAttractor(ctx, w, h, palette, time); break
    case 'reaction': drawReaction(ctx, w, h, palette, time); break
    case 'lsystem': drawLSystem(ctx, w, h, palette, time); break
    case 'gravity': drawGravity(ctx, w, h, palette, time); break
    case 'cpu': drawNetwork(ctx, w, h, palette); break
    case 'neural': drawNetwork(ctx, w, h, palette, true); break
    case 'circuit': case 'adder': drawCircuit(ctx, w, h, palette, time); break
    case 'electric': drawElectric(ctx, w, h, palette, time); break
    case 'automata': drawAutomata(ctx, w, h, palette, time); break
    default: drawDefault(ctx, w, h, palette, time)
  }
}

export default function ArtworkPreview({ id, live = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d', { alpha: false, desynchronized: true })
    if (!canvas || !ctx) return

    let raf = 0
    let visible = false
    let interactionActive = false
    let frame = 0
    let lastPaint = 0
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reduceMotion = motionPreference.matches
    const shouldAnimate = () => live || interactionActive
    const paint = (now = performance.now()) => {
      raf = 0
      const animate = shouldAnimate()
      if (animate && !reduceMotion && visible && !document.hidden && now - lastPaint < 52) {
        raf = requestAnimationFrame(paint)
        return
      }
      lastPaint = now
      render(ctx, id, canvas.width, canvas.height, animate && !reduceMotion ? frame * 0.0005 : 0)
      if (animate && visible && !document.hidden && !reduceMotion) {
        frame += 52
        raf = requestAnimationFrame(paint)
      }
    }
    const setInteraction = (active: boolean) => {
      const wasAnimating = shouldAnimate()
      interactionActive = active
      if (shouldAnimate() && !wasAnimating && visible && !reduceMotion && !document.hidden) {
        raf = requestAnimationFrame(paint)
      } else if (wasAnimating && !shouldAnimate()) {
        cancelAnimationFrame(raf)
        raf = 0
        lastPaint = 0
        frame = 0
        if (visible) paint()
      }
    }
    const interactionTarget = canvas.closest('a')
    const pointerEnter = () => setInteraction(true)
    const pointerLeave = () => setInteraction(false)
    const focusIn = () => setInteraction(true)
    const focusOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !interactionTarget?.contains(event.relatedTarget)) setInteraction(false)
    }
    const previewReady = () => {
      if (!visible) return
      cancelAnimationFrame(raf)
      raf = 0
      lastPaint = 0
      if (shouldAnimate() && !reduceMotion && !document.hidden) raf = requestAnimationFrame(paint)
      else paint()
    }
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      cancelAnimationFrame(raf)
      raf = 0
      lastPaint = 0
      if (visible) {
        if (shouldAnimate() && !reduceMotion && !document.hidden) raf = requestAnimationFrame(paint)
        else paint()
      }
    }, { rootMargin: '80px' }) : null
    if (observer) observer.observe(canvas)
    else visible = true

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const scale = Math.min(devicePixelRatio || 1, window.matchMedia('(max-width: 720px)').matches ? 0.95 : 1.15)
      const width = Math.max(1, Math.round(rect.width * scale))
      const height = Math.max(1, Math.round(rect.height * scale))
      if (canvas.width === width && canvas.height === height) return
      canvas.width = width
      canvas.height = height
      if (visible) {
        cancelAnimationFrame(raf)
        raf = 0
        if (shouldAnimate() && !reduceMotion && !document.hidden) raf = requestAnimationFrame(paint)
        else paint()
      }
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    const motionChanged = () => {
      reduceMotion = motionPreference.matches
      cancelAnimationFrame(raf)
      raf = 0
      lastPaint = 0
      if (!visible || document.hidden) return
      if (shouldAnimate() && !reduceMotion) raf = requestAnimationFrame(paint)
      else paint()
    }
    const visibilityChanged = () => {
      cancelAnimationFrame(raf)
      raf = 0
      lastPaint = 0
      if (document.hidden || !visible || !shouldAnimate() || reduceMotion) return
      raf = requestAnimationFrame(paint)
    }
    interactionTarget?.addEventListener('pointerenter', pointerEnter)
    interactionTarget?.addEventListener('pointerleave', pointerLeave)
    interactionTarget?.addEventListener('focusin', focusIn)
    interactionTarget?.addEventListener('focusout', focusOut)
    motionPreference.addEventListener('change', motionChanged)
    document.addEventListener('visibilitychange', visibilityChanged)
    window.addEventListener('armsteel-preview-ready', previewReady)
    resize()

    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
      resizeObserver.disconnect()
      motionPreference.removeEventListener('change', motionChanged)
      document.removeEventListener('visibilitychange', visibilityChanged)
      window.removeEventListener('armsteel-preview-ready', previewReady)
      interactionTarget?.removeEventListener('pointerenter', pointerEnter)
      interactionTarget?.removeEventListener('pointerleave', pointerLeave)
      interactionTarget?.removeEventListener('focusin', focusIn)
      interactionTarget?.removeEventListener('focusout', focusOut)
    }
  }, [id, live])

  return <canvas className="artwork-preview" ref={ref} aria-hidden="true" />
}
