import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { ExperimentControls } from '../types'
import { ControlPanel, RangeControl, SelectControl, Segmented } from '../components/Controls'
import ReactionDiffusionCpuFallback from './ReactionDiffusionCpuFallback'

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number }
type Program = { handle: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> }
type Bundle = { gl: WebGL2RenderingContext; vao: WebGLVertexArrayObject; update: Program; initialize: Program; paint: Program; render: Program; fields: [Target, Target]; index: number; width: number; height: number }
type Preset = { name: string; feed: number; kill: number; code: number }

const presets: Record<string, Preset> = {
  spots: { name: 'Pearl field', feed: 0.0367, kill: 0.0649, code: 0 },
  coral: { name: 'Coral branching', feed: 0.0545, kill: 0.062, code: 1 },
  labyrinth: { name: 'Labyrinth', feed: 0.029, kill: 0.057, code: 2 },
  waves: { name: 'Traveling pulses', feed: 0.025, kill: 0.05, code: 3 },
  replication: { name: 'Replication', feed: 0.037, kill: 0.06, code: 4 },
}
const vertexShader = [
  '#version 300 es',
  'const vec2 p[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));',
  'out vec2 vUv;',
  'void main(){vec2 q=p[gl_VertexID];gl_Position=vec4(q,0.,1.);vUv=q*0.5+0.5;}',
].join('\n')
const updateShader = [
  '#version 300 es',
  'precision highp float;',
  'in vec2 vUv;',
  'out vec2 outState;',
  'uniform sampler2D uState;',
  'uniform vec2 uTexel;',
  'uniform float uFeed;',
  'uniform float uKill;',
  'uniform float uDiffA;',
  'uniform float uDiffB;',
  'uniform float uDt;',
  'void main(){',
  '  vec2 c=texture(uState,vUv).rg;',
  '  vec2 n=texture(uState,vUv+vec2(0.0,uTexel.y)).rg;',
  '  vec2 s=texture(uState,vUv-vec2(0.0,uTexel.y)).rg;',
  '  vec2 e=texture(uState,vUv+vec2(uTexel.x,0.0)).rg;',
  '  vec2 w=texture(uState,vUv-vec2(uTexel.x,0.0)).rg;',
  '  vec2 ne=texture(uState,vUv+uTexel).rg;',
  '  vec2 nw=texture(uState,vUv+vec2(-uTexel.x,uTexel.y)).rg;',
  '  vec2 se=texture(uState,vUv+vec2(uTexel.x,-uTexel.y)).rg;',
  '  vec2 sw=texture(uState,vUv-uTexel).rg;',
  '  vec2 lap=-c+0.2*(n+s+e+w)+0.05*(ne+nw+se+sw);',
  '  float reaction=c.x*c.y*c.y;',
  '  float a=clamp(c.x+(uDiffA*lap.x-reaction+uFeed*(1.0-c.x))*uDt,0.0,1.0);',
  '  float b=clamp(c.y+(uDiffB*lap.y+reaction-(uKill+uFeed)*c.y)*uDt,0.0,1.0);',
  '  outState=vec2(a,b);',
  '}',
].join('\n')
const initShader = [
  '#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'out vec2 outState;',
  'uniform int uPreset;', 'uniform float uSeed;', 'uniform float uAspect;',
  'float hash(vec2 p){p=fract(p*vec2(123.34,456.21)+uSeed);p+=dot(p,p+45.32);return fract(p.x*p.y);}',
  'float cellHash(vec2 p,vec2 period){p=mod(mod(p,period)+period,period);return hash(p);}',
  'float valueNoise(vec2 uv,vec2 scale){vec2 p=uv*scale;vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.0-2.0*f);float a=cellHash(i,scale);float b=cellHash(i+vec2(1,0),scale);float c=cellHash(i+vec2(0,1),scale);float d=cellHash(i+vec2(1,1),scale);return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}',
  'void main(){',
  '  vec2 p=vec2(vUv.x*uAspect,vUv.y);',
  '  vec2 cell=floor(vUv*vec2(20.0,14.0));',
  '  vec2 local=fract(vUv*vec2(20.0,14.0))-0.5;',
  '  float h=hash(cell);',
  '  vec2 jitter=vec2(hash(cell+7.1),hash(cell+17.3))-0.5;',
  '  float radius=0.3+0.2*hash(cell+31.7);',
  '  float spot=1.0-smoothstep(radius*0.7,radius,length((local-jitter*0.55)*vec2(uAspect,1.0)));',
  '  float cellsX=2.0*floor(8.0*clamp(uAspect,0.5,3.0)+0.5);',
  '  vec2 organicScale=vec2(cellsX,16.0);',
  '  float organic=valueNoise(vUv,organicScale)*0.5+valueNoise(vUv,organicScale*2.0)*0.32+valueNoise(vUv,organicScale*4.0)*0.18;',
  '  float b=0.0;',
  '  if(uPreset==0)b=spot*step(0.36,h);',
  '  if(uPreset==1)b=smoothstep(0.53,0.67,organic)*0.96;',
  '  if(uPreset==2)b=smoothstep(0.5,0.64,organic)*0.92;',
  '  if(uPreset==3){float d=length((vUv-0.5)*vec2(uAspect,1.0));b=(1.0-smoothstep(0.035,0.055,d))*0.95+spot*step(0.84,h)*0.48;}',
  '  if(uPreset==4){float ring=abs(length((vUv-0.5)*vec2(uAspect,1.0))-0.23);b=max(spot*step(0.7,h),1.0-smoothstep(0.012,0.028,ring));}',
  '  b=clamp(b,0.0,0.98);',
  '  outState=vec2(1.0-b*0.96,b);',
  '}',
].join('\n')
const paintShader = [
  '#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'out vec2 outState;',
  'uniform sampler2D uState;', 'uniform vec2 uPoint;', 'uniform float uRadius;', 'uniform float uAspect;', 'uniform int uErase;',
  'void main(){vec2 state=texture(uState,vUv).rg;vec2 d=fract(vUv-uPoint+0.5)-0.5;d.x*=uAspect;float mask=exp(-dot(d,d)/max(1e-8,uRadius*uRadius*0.18));float b=uErase==1?state.y*(1.0-mask):max(state.y,mask*0.94);float a=uErase==1?max(state.x,1.0-b):min(state.x,1.0-mask*0.92);outState=vec2(clamp(a,0.0,1.0),clamp(b,0.0,1.0));}',
].join('\n')
const renderShader = [
  '#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'out vec4 outColor;',
  'uniform sampler2D uState;', 'uniform vec2 uTexel;', 'uniform int uPalette;', 'uniform float uTime;',
  'vec3 pigment(float t){',
  ' if(uPalette==1)return 0.5+0.5*cos(6.28318*(t*vec3(0.72,0.93,0.78)+vec3(0.02,0.28,0.48)));',
  ' if(uPalette==2)return 0.5+0.5*cos(6.28318*(t*vec3(0.65,0.82,0.62)+vec3(0.04,0.3,0.12)));',
  ' if(uPalette==3)return 0.5+0.5*cos(6.28318*(t*vec3(0.85,0.65,0.92)+vec3(0.05,0.12,0.42)));',
  ' if(uPalette==4)return 0.5+0.5*cos(6.28318*(t*vec3(0.84,0.72,0.56)+vec3(0.02,0.38,0.62)));',
  ' return 0.5+0.5*cos(6.28318*(t*vec3(0.72,0.9,0.72)+vec3(0.03,0.22,0.42)));',
  '}',
  'void main(){',
  ' float b=texture(uState,vUv).g;',
  ' float west=texture(uState,vUv-vec2(uTexel.x,0.0)).g;',
  ' float east=texture(uState,vUv+vec2(uTexel.x,0.0)).g;',
  ' float south=texture(uState,vUv-vec2(0.0,uTexel.y)).g;',
  ' float north=texture(uState,vUv+vec2(0.0,uTexel.y)).g;',
  ' float t=clamp((b-0.004)*2.5,0.0,1.0);',
  ' vec3 color=pigment(t*0.94+0.02);',
  ' float slope=length(vec2(east-west,north-south));',
  ' float light=0.78+0.22*clamp(0.5+(north-south)*28.0,0.0,1.0);',
  ' float glow=pow(t,2.8)*(0.03+min(0.12,slope*5.0));',
  ' color=color*smoothstep(0.02,0.72,t)*light+glow*vec3(0.66,0.85,1.0);',
  ' color+=0.015*sin(uTime*0.14+vUv.x*11.0+vUv.y*8.0)*smoothstep(0.1,0.75,t);',
  ' outColor=vec4(vec3(0.008,0.014,0.023)+color*0.92,1.0);',
  '}',
].join('\n')

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not allocate a reaction shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Reaction shader failed to compile')
  return shader
}
function program(gl: WebGL2RenderingContext, source: string): Program {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexShader), fragment = compile(gl, gl.FRAGMENT_SHADER, source)
  const handle = gl.createProgram()
  if (!handle) throw new Error('Could not create a reaction program')
  gl.attachShader(handle, vertex)
  gl.attachShader(handle, fragment)
  gl.linkProgram(handle)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(handle) || 'Reaction shader link failed')
  return { handle, uniforms: new Map() }
}
function makeTarget(gl: WebGL2RenderingContext, width: number, height: number): Target {
  const texture = gl.createTexture(), framebuffer = gl.createFramebuffer()
  if (!texture || !framebuffer) throw new Error('Could not allocate a reaction field')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, width, height, 0, gl.RG, gl.FLOAT, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('This device cannot render 32-bit reaction fields')
  return { texture, framebuffer, width, height }
}
function destroy(target: Target, gl: WebGL2RenderingContext) { gl.deleteTexture(target.texture); gl.deleteFramebuffer(target.framebuffer) }
function location(p: Program, gl: WebGL2RenderingContext, name: string) {
  if (!p.uniforms.has(name)) p.uniforms.set(name, gl.getUniformLocation(p.handle, name))
  return p.uniforms.get(name) || null
}
function pass(bundle: Bundle, p: Program, destination: Target | null, source: WebGLTexture | null, values: Record<string, number | number[]>) {
  const gl = bundle.gl
  gl.bindFramebuffer(gl.FRAMEBUFFER, destination?.framebuffer || null)
  gl.viewport(0, 0, destination?.width || bundle.width, destination?.height || bundle.height)
  gl.useProgram(p.handle)
  gl.bindVertexArray(bundle.vao)
  if (source) {
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, source)
    gl.uniform1i(location(p, gl, 'uState'), 0)
  }
  for (const [name, value] of Object.entries(values)) {
    const loc = location(p, gl, name)
    if (Array.isArray(value)) {
      if (value.length === 2) gl.uniform2f(loc, value[0], value[1])
    } else if (name === 'uPreset' || name === 'uPalette' || name === 'uErase') gl.uniform1i(loc, value)
    else gl.uniform1f(loc, value)
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}
function current(bundle: Bundle) { return bundle.fields[bundle.index] }
function next(bundle: Bundle) { return bundle.fields[1 - bundle.index] }
function swap(bundle: Bundle) { bundle.index = 1 - bundle.index }
function initialize(bundle: Bundle, preset: Preset, seed: number, aspect: number) {
  pass(bundle, bundle.initialize, bundle.fields[0], null, { uPreset: preset.code, uSeed: seed, uAspect: aspect })
  pass(bundle, bundle.update, bundle.fields[1], bundle.fields[0].texture, {
    uTexel: [1 / bundle.fields[0].width, 1 / bundle.fields[0].height],
    uFeed: 0, uKill: 0, uDiffA: 0, uDiffB: 0, uDt: 0,
  })
  bundle.index = 0
}
function simulate(bundle: Bundle, feed: number, kill: number, diffusion: number, dt: number) {
  pass(bundle, bundle.update, next(bundle), current(bundle).texture, {
    uTexel: [1 / current(bundle).width, 1 / current(bundle).height],
    uFeed: feed, uKill: kill, uDiffA: diffusion, uDiffB: diffusion * 0.5, uDt: dt,
  })
  swap(bundle)
}
function paintField(bundle: Bundle, x: number, y: number, radius: number, aspect: number, erase: boolean) {
  pass(bundle, bundle.paint, next(bundle), current(bundle).texture, {
    uPoint: [x, y], uRadius: radius, uAspect: aspect, uErase: erase ? 1 : 0,
  })
  swap(bundle)
}
function createBundle(canvas: HTMLCanvasElement): Bundle {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' })
  if (!gl) throw new Error('WebGL 2 is unavailable')
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('32-bit floating-point targets are unavailable')
  const vao = gl.createVertexArray()
  if (!vao) throw new Error('Vertex array support is unavailable')
  gl.bindVertexArray(vao)
  const placeholder = makeTarget(gl, 1, 1)
  const bundle: Bundle = {
    gl, vao, update: program(gl, updateShader), initialize: program(gl, initShader), paint: program(gl, paintShader), render: program(gl, renderShader),
    fields: [placeholder, makeTarget(gl, 1, 1)], index: 0, width: 1, height: 1,
  }
  return bundle
}
function resizeBundle(bundle: Bundle, canvas: HTMLCanvasElement, quality: string) {
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return false
  const max = bundle.gl.getParameter(bundle.gl.MAX_TEXTURE_SIZE) as number
  const density = Math.min(devicePixelRatio || 1, 2, Math.sqrt(3_000_000 / (rect.width * rect.height)), max / rect.width, max / rect.height)
  const width = Math.max(1, Math.floor(rect.width * density)), height = Math.max(1, Math.floor(rect.height * density))
  const simScale = Math.min(1, Math.sqrt((quality === 'detail' ? 1_800_000 : 850_000) / (width * height)))
  const simWidth = Math.max(64, Math.floor(width * simScale)), simHeight = Math.max(64, Math.floor(height * simScale))
  if (bundle.width === width && bundle.height === height && bundle.fields[0].width === simWidth && bundle.fields[0].height === simHeight) return false
  if (bundle.width > 1) { destroy(bundle.fields[0], bundle.gl); destroy(bundle.fields[1], bundle.gl) }
  canvas.width = width; canvas.height = height
  bundle.width = width; bundle.height = height
  bundle.fields = [makeTarget(bundle.gl, simWidth, simHeight), makeTarget(bundle.gl, simWidth, simHeight)]
  bundle.index = 0
  return true
}
function release(bundle: Bundle) {
  destroy(bundle.fields[0], bundle.gl)
  destroy(bundle.fields[1], bundle.gl)
  bundle.gl.deleteProgram(bundle.update.handle)
  bundle.gl.deleteProgram(bundle.initialize.handle)
  bundle.gl.deleteProgram(bundle.paint.handle)
  bundle.gl.deleteProgram(bundle.render.handle)
  bundle.gl.deleteVertexArray(bundle.vao)
}

function GpuReaction(props: ExperimentControls & { onUnsupported: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [presetName, setPresetName] = useState(() => typeof props.stateFromUrl?.preset === 'string' && presets[props.stateFromUrl.preset] ? props.stateFromUrl.preset : 'labyrinth')
  const [feed, setFeed] = useState(() => Number(props.stateFromUrl?.feed) || presets[presetName].feed)
  const [kill, setKill] = useState(() => Number(props.stateFromUrl?.kill) || presets[presetName].kill)
  const [diffusion, setDiffusion] = useState(() => Number(props.stateFromUrl?.diffusion) || 1)
  const [steps, setSteps] = useState(() => Number(props.stateFromUrl?.steps) || 3)
  const [palette, setPalette] = useState(() => typeof props.stateFromUrl?.palette === 'string' ? props.stateFromUrl.palette : 'verdigris')
  const [brush, setBrush] = useState(() => typeof props.stateFromUrl?.brush === 'string' ? props.stateFromUrl.brush : 'seed')
  const [brushSize, setBrushSize] = useState(() => Number(props.stateFromUrl?.brushSize) || 28)
  const [quality, setQuality] = useState(() => typeof props.stateFromUrl?.quality === 'string' ? props.stateFromUrl.quality : 'detail')
  const [seed, setSeed] = useState(() => Number(props.stateFromUrl?.seed) || 42)
  const bundleRef = useRef<Bundle | null>(null)
  const resetRef = useRef<(kind: string, seedValue: number) => void>(() => {})
  const resizeRef = useRef<() => void>(() => {})
  const paintRef = useRef<(x: number, y: number, erase: boolean) => void>(() => {})
  const params = useRef({ presetName, feed, kill, diffusion, steps, palette, brush, brushSize, quality, seed, paused: props.paused })
  params.current = { presetName, feed, kill, diffusion, steps, palette, brush, brushSize, quality, seed, paused: props.paused }

  useEffect(() => { props.onShareState({ preset: presetName, feed, kill, diffusion, steps, palette, brush, brushSize, quality, seed }) }, [presetName, feed, kill, diffusion, steps, palette, brush, brushSize, quality, seed, props.onShareState])
  const failed = useCallback(() => props.onUnsupported(), [props.onUnsupported])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let bundle: Bundle
    let raf = 0, last = 0, clock = 0
    try { bundle = createBundle(canvas); bundleRef.current = bundle } catch { failed(); return }
    const render = (time: number) => {
      const state = current(bundle)
      pass(bundle, bundle.render, null, state.texture, {
        uTexel: [1 / state.width, 1 / state.height],
        uPalette: ({ mineral: 0, coral: 1, verdigris: 2, ultraviolet: 3, ember: 4 } as Record<string, number>)[params.current.palette] ?? 0,
        uTime: time / 1000,
      })
    }
    const reset = (kind: string, seedValue: number) => {
      const preset = presets[kind] || presets.spots
      initialize(bundle, preset, seedValue, bundle.width / bundle.height)
      clock = 0
      render(0)
    }
    resetRef.current = reset
    paintRef.current = (x, y, erase) => {
      if (bundle.fields[0].width <= 1) return
      paintField(bundle, x, y, params.current.brushSize / Math.max(1, canvas.getBoundingClientRect().height), bundle.width / bundle.height, erase)
      render(clock)
    }
    const resize = () => {
      try {
        if (resizeBundle(bundle, canvas, params.current.quality)) {
          initialize(bundle, presets[params.current.presetName] || presets.spots, params.current.seed, bundle.width / bundle.height)
          render(0)
        }
      } catch { failed() }
    }
    resizeRef.current = resize
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden || params.current.paused || now - last < 27) return
      const elapsed = Math.min(1 / 24, Math.max(1 / 60, (now - last) / 1000 || 1 / 30))
      last = now
      clock += elapsed
      for (let i = 0; i < params.current.steps; i++) simulate(bundle, params.current.feed, params.current.kill, params.current.diffusion, 1)
      render(now)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      release(bundle)
      bundleRef.current = null
      resetRef.current = () => {}
      resizeRef.current = () => {}
      paintRef.current = () => {}
    }
  }, [failed])

  useEffect(() => {
    if (bundleRef.current?.width && bundleRef.current.width > 1) resetRef.current(presetName, seed)
  }, [presetName, seed])
  useEffect(() => { resizeRef.current() }, [quality])

  const choosePreset = (name: string) => {
    const preset = presets[name]
    if (!preset) return
    setPresetName(name)
    setFeed(preset.feed)
    setKill(preset.kill)
    resetRef.current(name, seed)
  }
  const paint = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = 1 - (event.clientY - rect.top) / rect.height
    paintRef.current(x, y, brush === 'erase')
  }

  return <div className="experiment-surface">
    <canvas ref={canvasRef} className="experiment-canvas reaction-canvas" aria-label="Gray–Scott reaction diffusion. Paint to add or erase chemical seeds." onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); paint(event) }} onPointerMove={(event) => { if (event.buttons || event.pointerType === 'touch') paint(event) }} />
    <ControlPanel title="The Pattern Beneath" note="GRAY–SCOTT CHEMISTRY" visible={props.controlsVisible} onClose={props.onCloseControls}>
      <SelectControl label="Reaction regime" value={presetName} options={Object.entries(presets).map(([key, preset]) => [key, preset.name])} onChange={choosePreset} />
      <RangeControl label="Feed rate" value={feed} min={0.012} max={0.075} step={0.0005} onChange={setFeed} format={(value) => value.toFixed(4)} />
      <RangeControl label="Kill rate" value={kill} min={0.035} max={0.075} step={0.0005} onChange={setKill} format={(value) => value.toFixed(4)} />
      <RangeControl label="Diffusion" value={diffusion} min={0.55} max={1.45} step={0.01} onChange={setDiffusion} format={(value) => value.toFixed(2)} />
      <RangeControl label="Reaction speed" value={steps} min={1} max={5} step={1} onChange={setSteps} format={(value) => value + ' steps/frame'} />
      <SelectControl label="Pigment" value={palette} options={[['mineral', 'River stone'], ['coral', 'Red coral'], ['verdigris', 'Verdigris'], ['ultraviolet', 'Ultraviolet'], ['ember', 'Warm earth']]} onChange={setPalette} />
      <SelectControl label="Simulation detail" value={quality} options={[['detail', 'High detail'], ['balanced', 'Balanced']]} onChange={setQuality} />
      <Segmented label="Brush" value={brush} options={[['seed', 'Seed'], ['erase', 'Erase']]} onChange={setBrush} />
      <RangeControl label="Brush radius" value={brushSize} min={8} max={72} step={2} onChange={setBrushSize} format={(value) => value + ' px'} />
      <button className="panel-action" onClick={() => setSeed((value) => (value * 1664525 + 1013904223) >>> 0)}><span>Begin a new pattern</span><i>↻</i></button>
      <p className="control-note">A 32-bit Gray–Scott field evolves at high resolution. Paint localized chemical disturbances into the periodic surface.</p>
    </ControlPanel>
  </div>
}

export default function ReactionDiffusion(props: ExperimentControls) {
  const [fallback, setFallback] = useState(false)
  const onUnsupported = useCallback(() => setFallback(true), [])
  return fallback ? <ReactionDiffusionCpuFallback {...props} /> : <GpuReaction {...props} onUnsupported={onUnsupported} />
}
