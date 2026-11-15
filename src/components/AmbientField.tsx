import { useEffect, useRef } from 'react'

const vertexSource = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const fragmentSource = `
precision mediump float;
uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform float u_time;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 fade = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, fade.x), mix(c, d, fade.x), fade.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float weight = 0.56;
  float normalization = 0.0;
  mat2 turn = mat2(1.62, 1.18, -1.18, 1.62);
  for (int octave = 0; octave < 4; octave++) {
    value += noise(p) * weight;
    normalization += weight;
    p = turn * p + vec2(13.7, 7.3);
    weight *= 0.48;
  }
  return value / normalization;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 pointer = (u_pointer - 0.5) * vec2(aspect, 1.0);
  float t = u_time;

  vec2 drift = vec2(t * 0.010, -t * 0.007);
  vec2 current = vec2(
    fbm(p * 1.12 + vec2(2.7, 6.4) + drift),
    fbm(p * 1.12 + vec2(8.3, 1.9) - drift * 0.82)
  );
  float pointerWeight = exp(-dot((p - pointer) * vec2(1.15, 1.0), (p - pointer) * vec2(1.15, 1.0)) * 3.2);
  vec2 warp = (current - 0.5) * 0.82 + (p - pointer) * pointerWeight * 0.11;
  vec2 q = p + warp;

  float deepField = fbm(q * 1.55 + vec2(-t * 0.004, t * 0.003));
  float fineField = fbm(q * 2.48 - warp * 0.48 + vec2(3.2, 9.1) + drift * 0.35);
  float tide = fbm(q * vec2(1.05, 1.34) + vec2(4.4, -2.8) - drift * 0.55);

  float ribbon = exp(-abs(deepField - 0.50) * 27.0);
  float ribbonSoft = exp(-abs(deepField - 0.48) * 11.0);
  float crossing = exp(-abs(fineField - tide + 0.075) * 22.0);
  float depth = smoothstep(0.29, 0.79, fineField) * smoothstep(0.2, 0.9, tide);
  float glimmer = smoothstep(0.72, 0.93, fineField) * 0.16;

  vec2 lightPoint = q - vec2(-0.37, 0.22);
  float volume = exp(-dot(lightPoint * vec2(0.72, 1.16), lightPoint * vec2(0.72, 1.16)) * 1.55);
  float lowerLight = exp(-dot((q - vec2(0.38, -0.39)) * vec2(0.83, 1.1), (q - vec2(0.38, -0.39)) * vec2(0.83, 1.1)) * 1.9);
  float centerShade = exp(-dot(p * vec2(0.77, 1.16), p * vec2(0.77, 1.16)) * 2.5);
  float edgeFalloff = 1.0 - smoothstep(0.13, 1.45, length(p * vec2(0.72, 1.03)));

  vec3 color = vec3(0.018, 0.025, 0.04);
  color += vec3(0.032, 0.052, 0.066) * depth;
  color += vec3(0.05, 0.068, 0.084) * volume;
  color += vec3(0.035, 0.05, 0.064) * lowerLight;
  color += vec3(0.08, 0.116, 0.132) * ribbonSoft * 0.26;
  color += vec3(0.16, 0.194, 0.212) * ribbon * (0.29 + glimmer);
  color += vec3(0.1, 0.132, 0.15) * crossing * 0.18;
  color += vec3(0.18, 0.22, 0.24) * glimmer * volume;
  color *= (0.69 + edgeFalloff * 0.31) * (1.0 - centerShade * 0.18);
  color += vec3(0.035, 0.054, 0.065) * pointerWeight * 0.035;
  gl_FragColor = vec4(color, 1.0);
}
`

export default function AmbientField() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return

    const contextOptions: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    }
    const gl = (canvas.getContext('webgl', contextOptions)
      || canvas.getContext('experimental-webgl', contextOptions)) as WebGLRenderingContext | null
    if (!gl) {
      canvas.dataset.fallback = 'true'
      return
    }

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader)
        return null
      }
      return shader
    }

    const vertex = compile(gl.VERTEX_SHADER, vertexSource)
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource)
    const program = gl.createProgram()
    if (!vertex || !fragment || !program) {
      if (vertex) gl.deleteShader(vertex)
      if (fragment) gl.deleteShader(fragment)
      if (program) gl.deleteProgram(program)
      canvas.dataset.fallback = 'true'
      return
    }

    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
      gl.deleteProgram(program)
      canvas.dataset.fallback = 'true'
      return
    }

    const buffer = gl.createBuffer()
    if (!buffer) {
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
      gl.deleteProgram(program)
      canvas.dataset.fallback = 'true'
      return
    }

    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const resolution = gl.getUniformLocation(program, 'u_resolution')
    const pointerUniform = gl.getUniformLocation(program, 'u_pointer')
    const timeUniform = gl.getUniformLocation(program, 'u_time')
    canvas.dataset.fallback = 'false'

    const slowFrameLimitMs = 80
    const slowFramesBeforeDownscale = 3
    const densityStep = 0.74
    const minimumRenderScale = 0.52
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const mobileViewport = window.matchMedia('(max-width: 720px)')
    let reducedMotion = motionPreference.matches
    let heroVisible = true
    let raf = 0
    let elapsed = 0
    let previousFrame = 0
    let slowFrameStreak = 0
    let renderScale = 1
    let pointerX = 0.53
    let pointerY = 0.54
    let targetX = pointerX
    let targetY = pointerY
    let contextLost = false

    const draw = (now: number) => {
      raf = 0
      if (document.hidden || !heroVisible || contextLost) return
      if (!reducedMotion && previousFrame && now - previousFrame < 40) {
        raf = window.requestAnimationFrame(draw)
        return
      }
      const frameInterval = previousFrame ? now - previousFrame : 0
      if (!reducedMotion && frameInterval > slowFrameLimitMs) slowFrameStreak++
      else slowFrameStreak = Math.max(0, slowFrameStreak - 1)
      if (slowFrameStreak >= slowFramesBeforeDownscale && renderScale > minimumRenderScale) {
        // This shader is atmospheric decoration; lower only its pixel fill when frames keep falling behind.
        renderScale = Math.max(minimumRenderScale, Math.round(renderScale * densityStep * 100) / 100)
        slowFrameStreak = 0
        resize()
      }
      const delta = previousFrame ? Math.min((now - previousFrame) / 1000, 0.08) : 0
      previousFrame = now
      if (!reducedMotion) elapsed += delta
      pointerX += (targetX - pointerX) * 0.035
      pointerY += (targetY - pointerY) * 0.035
      if (resolution) gl.uniform2f(resolution, canvas.width, canvas.height)
      if (pointerUniform) gl.uniform2f(pointerUniform, pointerX, 1 - pointerY)
      if (timeUniform) gl.uniform1f(timeUniform, elapsed)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (!reducedMotion) raf = window.requestAnimationFrame(draw)
    }

    const schedule = () => {
      if (!reducedMotion && !document.hidden && heroVisible && !contextLost && !raf) raf = window.requestAnimationFrame(draw)
    }
    const resize = () => {
      const width = window.visualViewport?.width ?? window.innerWidth
      const height = window.visualViewport?.height ?? window.innerHeight
      const density = Math.min(window.devicePixelRatio || 1, 1.15) * (mobileViewport.matches ? 0.72 : 0.86) * renderScale
      const nextWidth = Math.max(1, Math.round(width * density))
      const nextHeight = Math.max(1, Math.round(height * density))
      if (canvas.width === nextWidth && canvas.height === nextHeight) return
      canvas.width = nextWidth
      canvas.height = nextHeight
      gl.viewport(0, 0, nextWidth, nextHeight)
      if (reducedMotion && heroVisible && !contextLost) draw(performance.now())
    }

    const pointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || reducedMotion) return
      targetX = event.clientX / Math.max(window.innerWidth, 1)
      targetY = event.clientY / Math.max(window.innerHeight, 1)
    }
    const pointerLeave = () => { targetX = 0.53; targetY = 0.54 }
    const visibility = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(raf)
        raf = 0
        slowFrameStreak = 0
      } else {
        previousFrame = 0
        if (reducedMotion) draw(performance.now())
        else schedule()
      }
    }
    const motionChanged = () => {
      reducedMotion = motionPreference.matches
      window.cancelAnimationFrame(raf)
      raf = 0
      previousFrame = 0
      if (reducedMotion) draw(performance.now())
      else schedule()
    }
    const contextLostHandler = (event: Event) => {
      event.preventDefault()
      contextLost = true
      canvas.dataset.fallback = 'true'
      window.cancelAnimationFrame(raf)
      raf = 0
    }
    const hero = canvas.closest('.exhibition-page')?.querySelector('.portal-hero')
    const observer = hero && 'IntersectionObserver' in window ? new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting
      if (heroVisible) {
        if (reducedMotion) draw(performance.now())
        else schedule()
      } else {
        window.cancelAnimationFrame(raf)
        raf = 0
        previousFrame = 0
        slowFrameStreak = 0
      }
    }, { threshold: 0.01 }) : null

    resize()
    if (hero && observer) observer.observe(hero)
    window.addEventListener('resize', resize, { passive: true })
    window.visualViewport?.addEventListener('resize', resize, { passive: true })
    window.addEventListener('pointermove', pointerMove, { passive: true })
    window.addEventListener('pointerleave', pointerLeave, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    canvas.addEventListener('webglcontextlost', contextLostHandler)
    motionPreference.addEventListener('change', motionChanged)
    if (reducedMotion) draw(performance.now())
    else schedule()

    return () => {
      window.cancelAnimationFrame(raf)
      observer?.disconnect()
      window.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerleave', pointerLeave)
      document.removeEventListener('visibilitychange', visibility)
      canvas.removeEventListener('webglcontextlost', contextLostHandler)
      motionPreference.removeEventListener('change', motionChanged)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
    }
  }, [])

  return <canvas className="ambient-field" ref={ref} aria-hidden="true" />
}
