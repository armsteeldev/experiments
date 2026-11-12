import { useEffect, useRef } from 'react'

type Props = { id: string; live?: boolean }
const colors: Record<string, string[]> = {
  mandelbrot: ['#82b8d5', '#ddd6b6', '#617cce'],
  fluid: ['#f29375', '#df6bb3', '#6b8cf1'],
  boids: ['#d4d8bc', '#8bb9b4', '#e0ae83'],
  attractors: ['#82c8dd', '#9084d8', '#d6a6d0'],
  reaction: ['#d58b61', '#c8c184', '#779b77'],
  lsystem: ['#c5b481', '#8cad81', '#d0b08a'],
}

export default function ArtworkPreview({ id, live = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let raf = 0, visible = false, frame = 0
    let lastPaint = 0
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reduceMotion = motionPreference.matches
    const palette = colors[id] || colors.mandelbrot
    const paint = (now = performance.now()) => {
      if (live && !reduceMotion && visible && !document.hidden && now - lastPaint < 32) {
        raf = requestAnimationFrame(paint)
        return
      }
      lastPaint = now
      const w = canvas.width, h = canvas.height
      ctx.clearRect(0, 0, w, h)
      const t = live && !reduceMotion ? frame * 0.001 : 0
      const glow = ctx.createRadialGradient(w * 0.53, h * 0.52, 1, w * 0.53, h * 0.52, h * 0.8)
      glow.addColorStop(0, 'rgba(42,62,81,.35)')
      glow.addColorStop(1, 'rgba(6,10,17,0)')
      ctx.fillStyle = '#080c14'; ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h)
      if (id === 'mandelbrot') {
        for (let k = 0; k < 5; k++) {
          ctx.beginPath()
          const radius = h * (0.12 + k * 0.076)
          for (let i = 0; i <= 180; i++) {
            const a = i * Math.PI / 90
            const x = w * 0.52 + Math.cos(a) * radius * (1 + 0.19 * Math.cos(a * 7))
            const y = h * 0.51 + Math.sin(a) * radius * (0.68 + 0.11 * Math.sin(a * 5))
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
          }
          ctx.closePath(); ctx.strokeStyle = palette[k % 3] + '66'; ctx.lineWidth = 1.1; ctx.stroke()
        }
        ctx.beginPath(); ctx.arc(w * 0.51, h * 0.5, h * 0.045, 0, Math.PI * 2); ctx.fillStyle = palette[1]; ctx.fill()
      } else if (id === 'fluid') {
        for (let line = 0; line < 28; line++) {
          const startY = h * (0.13 + line * 0.028)
          ctx.beginPath()
          for (let x = 0; x <= w; x += 3) {
            const u = x / w
            const swell = Math.exp(-Math.pow((u - 0.5) * 4.5, 2))
            const y = startY + Math.sin(u * 9 + line * 0.23 + t) * 10 * swell + Math.sin(u * 3.8 - t * 0.5) * 4
            x ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
          }
          ctx.strokeStyle = palette[line % 3] + (line % 2 ? '70' : '45'); ctx.lineWidth = line % 7 === 0 ? 1.5 : 0.8; ctx.stroke()
        }
      } else if (id === 'boids') {
        for (let i = 0; i < 105; i++) {
          const a = i * 2.399 + t * 0.18
          const r = Math.sqrt(i / 105) * h * 0.41
          const x = w * 0.51 + Math.cos(a) * r * 1.6, y = h * 0.52 + Math.sin(a) * r
          const ang = a + Math.PI / 2
          ctx.save(); ctx.translate(x, y); ctx.rotate(ang)
          ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(-3, -2); ctx.lineTo(-2, 2); ctx.closePath()
          ctx.fillStyle = palette[i % 3] + 'cc'; ctx.fill(); ctx.restore()
        }
      } else if (id === 'attractors') {
        let x = 0.1, y = 0, z = 0
        ctx.beginPath()
        for (let i = 0; i < 2600; i++) {
          const dx = 10 * (y - x), dy = x * (28 - z) - y, dz = x * y - 2.66 * z
          x += dx * 0.005; y += dy * 0.005; z += dz * 0.005
          const px = w * 0.5 + x * w * 0.015, py = h * 0.53 + (z - 25) * h * 0.022
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py)
        }
        ctx.strokeStyle = palette[0] + 'bd'; ctx.lineWidth = 1; ctx.stroke()
      } else if (id === 'reaction') {
        for (let row = 0; row < 10; row++) {
          for (let col = 0; col < 19; col++) {
            const wave = Math.sin(col * 0.9 + row * 0.53) * Math.cos(row * 1.1 - col * 0.26)
            if (wave > 0.12) {
              const x = col * w / 19, y = row * h / 10
              ctx.beginPath(); ctx.ellipse(x, y, 9 + wave * 9, 4 + wave * 5, wave, 0, Math.PI * 2)
              ctx.fillStyle = palette[Math.abs(col + row) % 3] + 'aa'; ctx.fill()
            }
          }
        }
      } else {
        const branch = (x: number, y: number, angle: number, length: number, depth: number) => {
          if (depth <= 0 || length < 2) return
          const nx = x + Math.cos(angle) * length, ny = y + Math.sin(angle) * length
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny)
          ctx.strokeStyle = palette[depth % 3] + 'ad'; ctx.lineWidth = Math.max(0.7, depth * 0.7); ctx.stroke()
          branch(nx, ny, angle - 0.48, length * 0.73, depth - 1)
          branch(nx, ny, angle + 0.45, length * 0.72, depth - 1)
        }
        branch(w * 0.5, h * 0.94, -Math.PI / 2, h * 0.21, 8)
      }
      if (live && visible && !document.hidden && !reduceMotion) { frame += 32; raf = requestAnimationFrame(paint) }
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      cancelAnimationFrame(raf)
      lastPaint = 0
      if (visible) { if (live && !reduceMotion && !document.hidden) raf = requestAnimationFrame(paint); else paint() }
    }, { rootMargin: '100px' })
    observer.observe(canvas)
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(devicePixelRatio || 1, 1.25, window.matchMedia('(max-width: 720px)').matches ? 0.95 : 1.25)
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      if (visible && (!live || reduceMotion)) paint()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    const motionChanged = () => {
      reduceMotion = motionPreference.matches
      cancelAnimationFrame(raf)
      lastPaint = 0
      if (!visible || document.hidden) return
      if (live && !reduceMotion) raf = requestAnimationFrame(paint)
      else paint()
    }
    const visibilityChanged = () => {
      cancelAnimationFrame(raf)
      lastPaint = 0
      if (document.hidden || !visible || !live || reduceMotion) return
      raf = requestAnimationFrame(paint)
    }
    motionPreference.addEventListener('change', motionChanged)
    document.addEventListener('visibilitychange', visibilityChanged)
    resize()
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      resizeObserver.disconnect()
      motionPreference.removeEventListener('change', motionChanged)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [id, live])
  return <canvas className="artwork-preview" ref={ref} aria-hidden="true" />
}
