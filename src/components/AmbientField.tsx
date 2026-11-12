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
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(17.1, 9.2);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (gl_FragCoord.xy / u_resolution - 0.5) * vec2(aspect, 1.0);
  vec2 pointer = (u_pointer - 0.5) * vec2(aspect, 1.0);
  float time = u_time;

  vec2 drift = vec2(time * 0.026, -time * 0.018);
  vec2 flow = vec2(
    fbm(p * 1.35 + vec2(4.2, 1.7) + drift),
    fbm(p * 1.35 + vec2(8.1, 5.3) - drift * 0.8)
  );
  float pointerFalloff = exp(-length(p - pointer) * 1.8);
  flow += (p - pointer) * pointerFalloff * 0.075;

  float current = fbm(p * 1.22 + flow * 1.72 + drift * 0.62);
  float undercurrent = fbm(p * 1.8 - flow * 1.28 - drift * 0.46 + vec2(2.7, 9.1));
  float cloud = smoothstep(0.34, 0.82, current);
  float silk = exp(-abs(current - 0.51) * 17.0);
  float reflectedSilk = exp(-abs(undercurrent - 0.47) * 22.0);
  float crossing = exp(-abs(current - undercurrent - 0.08) * 15.0);

  vec3 color = vec3(0.022, 0.031, 0.050);
  color += vec3(0.018, 0.031, 0.052) * cloud;
  color += vec3(0.045, 0.066, 0.085) * silk * 0.34;
  color += vec3(0.075, 0.089, 0.102) * reflectedSilk * 0.12;
  color += vec3(0.048, 0.068, 0.088) * crossing * 0.18;

  float centerVeil = exp(-dot(p * vec2(0.84, 1.16), p * vec2(0.84, 1.16)) * 1.48);
  float vignette = 1.0 - smoothstep(0.3, 1.65, length(p * vec2(0.76, 1.08)));
  color *= (1.0 - centerVeil * 0.16) * (0.76 + vignette * 0.24);
  color += vec3(0.055, 0.070, 0.083) * pointerFalloff * 0.035;
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

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = motionPreference.matches
    let raf = 0
    let elapsed = 0
    let previousFrame = 0
    let pointerX = 0.53
    let pointerY = 0.54
    let targetX = pointerX
    let targetY = pointerY
    let contextLost = false

    const resize = () => {
      const width = window.visualViewport?.width ?? window.innerWidth
      const height = window.visualViewport?.height ?? window.innerHeight
      const pixelRatio = Math.min(window.devicePixelRatio || 1, window.matchMedia('(max-width: 720px)').matches ? 0.9 : 1.2)
      const nextWidth = Math.max(1, Math.round(width * pixelRatio))
      const nextHeight = Math.max(1, Math.round(height * pixelRatio))
      if (canvas.width === nextWidth && canvas.height === nextHeight) return
      canvas.width = nextWidth
      canvas.height = nextHeight
      gl.viewport(0, 0, nextWidth, nextHeight)
      if (reducedMotion && !contextLost) draw(performance.now())
    }

    const draw = (now: number) => {
      raf = 0
      if (document.hidden || contextLost) return
      if (!reducedMotion && previousFrame && now - previousFrame < 32) {
        raf = window.requestAnimationFrame(draw)
        return
      }
      const delta = previousFrame ? Math.min((now - previousFrame) / 1000, 0.06) : 0
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

    const pointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      targetX = event.clientX / Math.max(window.innerWidth, 1)
      targetY = event.clientY / Math.max(window.innerHeight, 1)
    }
    const pointerLeave = () => { targetX = 0.53; targetY = 0.54 }
    const visibility = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(raf)
        raf = 0
      } else if (!reducedMotion && !raf) {
        previousFrame = 0
        raf = window.requestAnimationFrame(draw)
      }
    }
    const motionChanged = () => {
      reducedMotion = motionPreference.matches
      window.cancelAnimationFrame(raf)
      raf = 0
      previousFrame = 0
      if (reducedMotion) draw(performance.now())
      else if (!document.hidden) raf = window.requestAnimationFrame(draw)
    }
    const contextLostHandler = (event: Event) => {
      event.preventDefault()
      contextLost = true
      canvas.dataset.fallback = 'true'
      window.cancelAnimationFrame(raf)
      raf = 0
    }

    resize()
    window.addEventListener('resize', resize, { passive: true })
    window.visualViewport?.addEventListener('resize', resize, { passive: true })
    window.addEventListener('pointermove', pointerMove, { passive: true })
    window.addEventListener('pointerleave', pointerLeave, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    canvas.addEventListener('webglcontextlost', contextLostHandler)
    motionPreference.addEventListener('change', motionChanged)
    if (reducedMotion) draw(performance.now())
    else raf = window.requestAnimationFrame(draw)

    return () => {
      window.cancelAnimationFrame(raf)
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
