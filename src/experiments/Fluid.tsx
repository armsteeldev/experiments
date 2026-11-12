import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { ExperimentControls } from '../types'
import { ControlPanel, RangeControl, SelectControl, Segmented } from '../components/Controls'
import FluidCpuFallback from './FluidCpuFallback'

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number }
type Program = { handle: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> }
type Uniform = number | number[]
type Bundle = {
  gl: WebGL2RenderingContext
  vao: WebGLVertexArrayObject
  programs: Record<string, Program>
  velocity: [Target, Target]
  velocityOriginal: Target
  dye: [Target, Target]
  pressure: [Target, Target]
  divergence: Target
  curl: Target
  width: number
  height: number
  velocityIndex: number
  dyeIndex: number
}
type PointerSample = { x: number; y: number; dx: number; dy: number }
type Pigment = { name: string; dye: [number, number, number] }

const pigments: Record<string, Pigment> = {
  aurora: { name: 'Aurora', dye: [0.18, 0.86, 0.92] },
  petal: { name: 'Wild petal', dye: [0.96, 0.3, 0.64] },
  ember: { name: 'Ember', dye: [1, 0.43, 0.12] },
  violet: { name: 'Violet hour', dye: [0.58, 0.39, 1] },
  pearl: { name: 'Moon pearl', dye: [0.84, 0.93, 0.79] },
}
const fullscreenVertex = [
  '#version 300 es',
  'const vec2 p[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));',
  'out vec2 vUv;',
  'void main(){vec2 pos=p[gl_VertexID];gl_Position=vec4(pos,0.,1.);vUv=pos*0.5+0.5;}',
].join('\n')
const linearSample = [
  'vec4 sampleLinear(sampler2D field, vec2 uv, vec2 texel) {',
  '  vec2 p = uv / texel - 0.5;',
  '  vec2 f = fract(p);',
  '  vec2 a = (floor(p) + 0.5) * texel;',
  '  vec4 c00 = texture(field, a);',
  '  vec4 c10 = texture(field, a + vec2(texel.x,0.0));',
  '  vec4 c01 = texture(field, a + vec2(0.0,texel.y));',
  '  vec4 c11 = texture(field, a + texel);',
  '  return mix(mix(c00,c10,f.x),mix(c01,c11,f.x),f.y);',
  '}',
]
const shaderSource: Record<string, string> = {
  clear: ['#version 300 es', 'precision highp float;', 'out vec4 outColor;', 'void main(){outColor=vec4(0.0);}'].join('\n'),
  advectVelocity: ['#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'out vec4 outColor;', 'uniform sampler2D uVelocity;', 'uniform vec2 uTexel;', 'uniform float uDt;', 'uniform float uFade;', ...linearSample, 'void main(){vec2 v=sampleLinear(uVelocity,vUv,uTexel).rg; vec2 back=vUv-v*uDt*uTexel; outColor=vec4(sampleLinear(uVelocity,back,uTexel).rg*uFade,0.0,1.0);}'].join('\n'),
  advectDye: ['#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'out vec4 outColor;', 'uniform sampler2D uDye;', 'uniform sampler2D uVelocity;', 'uniform vec2 uDyeTexel;', 'uniform vec2 uVelocityTexel;', 'uniform float uDt;', 'uniform float uFade;', ...linearSample, 'void main(){vec2 v=sampleLinear(uVelocity,vUv,uVelocityTexel).rg; vec2 back=vUv-v*uDt*uVelocityTexel; outColor=vec4(sampleLinear(uDye,back,uDyeTexel).rgb*uFade,1.0);}'].join('\n'),
  diffuse: ['#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'out vec4 outColor;', 'uniform sampler2D uOriginal;', 'uniform sampler2D uCurrent;', 'uniform vec2 uTexel;', 'uniform float uA;', 'void main(){vec2 v=texture(uCurrent,vUv).rg; vec2 n=texture(uCurrent,vUv+vec2(0.0,uTexel.y)).rg; vec2 s=texture(uCurrent,vUv-vec2(0.0,uTexel.y)).rg; vec2 e=texture(uCurrent,vUv+vec2(uTexel.x,0.0)).rg; vec2 w=texture(uCurrent,vUv-vec2(uTexel.x,0.0)).rg; vec2 d=(texture(uOriginal,vUv).rg+uA*(n+s+e+w))/(1.0+4.0*uA); outColor=vec4(d,0.0,1.0);}'].join('\n'),
  copy: ['#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'out vec4 outColor;', 'uniform sampler2D uSource;', 'void main(){outColor=texture(uSource,vUv);}'].join('\n'),
  divergence: ['#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'out vec4 outColor;', 'uniform sampler2D uVelocity;', 'uniform vec2 uTexel;', 'void main(){float l=texture(uVelocity,vUv-vec2(uTexel.x,0.0)).r; float r=texture(uVelocity,vUv+vec2(uTexel.x,0.0)).r; float b=texture(uVelocity,vUv-vec2(0.0,uTexel.y)).g; float t=texture(uVelocity,vUv+vec2(0.0,uTexel.y)).g; outColor=vec4(0.5*(r-l+t-b),0.0,0.0,1.0);}'].join('\n'),
  pressure: ['#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'out vec4 outColor;', 'uniform sampler2D uPressure;', 'uniform sampler2D uDivergence;', 'uniform vec2 uTexel;', 'void main(){float n=texture(uPressure,vUv+vec2(0.0,uTexel.y)).r; float s=texture(uPressure,vUv-vec2(0.0,uTexel.y)).r; float e=texture(uPressure,vUv+vec2(uTexel.x,0.0)).r; float w=texture(uPressure,vUv-vec2(uTexel.x,0.0)).r; float d=texture(uDivergence,vUv).r; outColor=vec4((n+s+e+w-d)*0.25,0.0,0.0,1.0);}'].join('\n'),
  project: ['#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'out vec4 outColor;', 'uniform sampler2D uVelocity;', 'uniform sampler2D uPressure;', 'uniform vec2 uTexel;', 'void main(){vec2 v=texture(uVelocity,vUv).rg; float pL=texture(uPressure,vUv-vec2(uTexel.x,0.0)).r; float pR=texture(uPressure,vUv+vec2(uTexel.x,0.0)).r; float pB=texture(uPressure,vUv-vec2(0.0,uTexel.y)).r; float pT=texture(uPressure,vUv+vec2(0.0,uTexel.y)).r; v-=0.5*vec2(pR-pL,pT-pB); if(vUv.x<uTexel.x*1.5||vUv.x>1.0-uTexel.x*1.5)v.x=0.0; if(vUv.y<uTexel.y*1.5||vUv.y>1.0-uTexel.y*1.5)v.y=0.0; outColor=vec4(v,0.0,1.0);}'].join('\n'),
  curl: ['#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'out vec4 outColor;', 'uniform sampler2D uVelocity;', 'uniform vec2 uTexel;', 'void main(){float vR=texture(uVelocity,vUv+vec2(uTexel.x,0.0)).g; float vL=texture(uVelocity,vUv-vec2(uTexel.x,0.0)).g; float uT=texture(uVelocity,vUv+vec2(0.0,uTexel.y)).r; float uB=texture(uVelocity,vUv-vec2(0.0,uTexel.y)).r; outColor=vec4(0.5*(vR-vL-uT+uB),0.0,0.0,1.0);}'].join('\n'),
  vorticity: ['#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'out vec4 outColor;', 'uniform sampler2D uVelocity;', 'uniform sampler2D uCurl;', 'uniform vec2 uTexel;', 'uniform float uDt;', 'uniform float uStrength;', 'void main(){float c=texture(uCurl,vUv).r; float l=abs(texture(uCurl,vUv-vec2(uTexel.x,0.0)).r); float r=abs(texture(uCurl,vUv+vec2(uTexel.x,0.0)).r); float b=abs(texture(uCurl,vUv-vec2(0.0,uTexel.y)).r); float t=abs(texture(uCurl,vUv+vec2(0.0,uTexel.y)).r); vec2 grad=vec2(r-l,t-b); grad/=length(grad)+1e-5; vec2 v=texture(uVelocity,vUv).rg+uDt*uStrength*c*vec2(grad.y,-grad.x); outColor=vec4(v,0.0,1.0);}'].join('\n'),
  splat: ['#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'out vec4 outColor;', 'uniform sampler2D uSource;', 'uniform vec2 uPoint;', 'uniform vec2 uTexel;', 'uniform vec2 uImpulse;', 'uniform vec3 uColor;', 'uniform float uRadius;', 'uniform int uDye;', 'uniform float uGain;', 'void main(){vec4 source=texture(uSource,vUv); vec2 d=(vUv-uPoint)*vec2(1.0/uTexel.x,1.0/uTexel.y); float r=uRadius*min(1.0/uTexel.x,1.0/uTexel.y); float q=exp(-dot(d,d)/max(1.0,r*r*0.32)); if(uDye==1)outColor=vec4(source.rgb+uColor*q*uGain,1.0); else outColor=vec4(source.rg+uImpulse*q*uGain,0.0,1.0);}'].join('\n'),
  render: ['#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'out vec4 outColor;', 'uniform sampler2D uDye;', 'uniform sampler2D uVelocity;', 'uniform vec2 uDyeTexel;', 'uniform vec2 uVelocityTexel;', 'uniform int uStyle;', 'uniform float uTime;', ...linearSample, 'void main(){vec3 d=max(vec3(0.0),sampleLinear(uDye,vUv,uDyeTexel).rgb); vec2 v=sampleLinear(uVelocity,vUv,uVelocityTexel).rg; float density=dot(d,vec3(0.28,0.56,0.16)); float g=length(vec2(dFdx(density),dFdy(density))); vec3 ink=vec3(1.0)-exp(-d*1.75); vec3 color=ink; if(uStyle==0){color=vec3(ink.r*0.55+ink.g*0.18,ink.g*0.72+ink.b*0.24,ink.b*0.82+ink.r*0.18); color*=0.92+0.1*cos(density*3.0-vUv.y*4.0+uTime*0.08);} if(uStyle==1){color=vec3(1.0)-exp(-d*2.7); color*=0.72+0.28*exp(-g*10.0);} if(uStyle==2){float smoke=1.0-exp(-density*0.86); color=vec3(0.43,0.62,0.76)*smoke+vec3(0.08,0.13,0.17)*pow(smoke,2.0);} if(uStyle==3){float energy=pow(max(0.0,1.0-exp(-density*1.6)),0.7); color=vec3(0.16,0.42,0.95)*energy+vec3(0.1,0.95,0.89)*pow(energy,2.4)+vec3(0.9,0.28,0.94)*pow(energy,3.8); color+=0.16*exp(-g*4.0);} float motion=clamp(length(v)*0.008,0.0,0.16); color*=0.91+motion; vec3 bg=vec3(0.012,0.019,0.032); outColor=vec4(bg+color*0.88,1.0);}'].join('\n'),
}

function createShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not allocate a simulation shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Simulation shader compilation failed')
  return shader
}

function createProgram(gl: WebGL2RenderingContext, source: string): Program {
  const vertex = createShader(gl, gl.VERTEX_SHADER, fullscreenVertex)
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, source)
  const handle = gl.createProgram()
  if (!handle) throw new Error('Could not allocate a simulation program')
  gl.attachShader(handle, vertex)
  gl.attachShader(handle, fragment)
  gl.linkProgram(handle)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(handle) || 'Could not link simulation shaders')
  return { handle, uniforms: new Map() }
}

function target(gl: WebGL2RenderingContext, width: number, height: number): Target {
  const texture = gl.createTexture(), framebuffer = gl.createFramebuffer()
  if (!texture || !framebuffer) throw new Error('Could not allocate a fluid field')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('This device cannot render floating-point fluid fields')
  return { texture, framebuffer, width, height }
}

function deleteTarget(gl: WebGL2RenderingContext, value: Target) {
  gl.deleteTexture(value.texture)
  gl.deleteFramebuffer(value.framebuffer)
}

function disposeBundle(bundle: Bundle | null) {
  if (!bundle) return
  const gl = bundle.gl
  for (const value of [...bundle.velocity, bundle.velocityOriginal, ...bundle.dye, ...bundle.pressure, bundle.divergence, bundle.curl]) deleteTarget(gl, value)
}

function uniform(program: Program, gl: WebGL2RenderingContext, name: string) {
  if (!program.uniforms.has(name)) program.uniforms.set(name, gl.getUniformLocation(program.handle, name))
  return program.uniforms.get(name) || null
}

function drawPass(bundle: Bundle, programName: string, destination: Target | null, sources: [string, WebGLTexture][], values: Record<string, Uniform> = {}) {
  const { gl, programs, vao } = bundle
  const program = programs[programName]
  gl.bindFramebuffer(gl.FRAMEBUFFER, destination?.framebuffer || null)
  gl.viewport(0, 0, destination?.width || bundle.width, destination?.height || bundle.height)
  gl.useProgram(program.handle)
  gl.bindVertexArray(vao)
  sources.forEach(([name, texture], unitIndex) => {
    gl.activeTexture(gl.TEXTURE0 + unitIndex)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(uniform(program, gl, name), unitIndex)
  })
  for (const [name, value] of Object.entries(values)) {
    const location = uniform(program, gl, name)
    if (Array.isArray(value)) {
      if (value.length === 2) gl.uniform2f(location, value[0], value[1])
      else if (value.length === 3) gl.uniform3f(location, value[0], value[1], value[2])
    } else if (name === 'uStyle' || name === 'uDye') gl.uniform1i(location, value)
    else gl.uniform1f(location, value)
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}

function swapVelocity(bundle: Bundle) { bundle.velocityIndex = 1 - bundle.velocityIndex }
function swapDye(bundle: Bundle) { bundle.dyeIndex = 1 - bundle.dyeIndex }
function currentVelocity(bundle: Bundle) { return bundle.velocity[bundle.velocityIndex] }
function nextVelocity(bundle: Bundle) { return bundle.velocity[1 - bundle.velocityIndex] }
function currentDye(bundle: Bundle) { return bundle.dye[bundle.dyeIndex] }
function nextDye(bundle: Bundle) { return bundle.dye[1 - bundle.dyeIndex] }

function clearFields(bundle: Bundle) {
  const { gl } = bundle
  gl.clearColor(0, 0, 0, 0)
  for (const field of [...bundle.velocity, bundle.velocityOriginal, ...bundle.dye, ...bundle.pressure, bundle.divergence, bundle.curl]) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, field.framebuffer)
    gl.viewport(0, 0, field.width, field.height)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }
  bundle.velocityIndex = 0
  bundle.dyeIndex = 0
}

function splat(bundle: Bundle, kind: 'velocity' | 'dye', x: number, y: number, radius: number, impulse: [number, number], color: [number, number, number], gain = 1) {
  const field = kind === 'velocity' ? currentVelocity(bundle) : currentDye(bundle)
  const destination = kind === 'velocity' ? nextVelocity(bundle) : nextDye(bundle)
  drawPass(bundle, 'splat', destination, [['uSource', field.texture]], {
    uPoint: [x, y], uTexel: [1 / field.width, 1 / field.height], uImpulse: impulse,
    uColor: color, uRadius: radius, uDye: kind === 'dye' ? 1 : 0, uGain: gain,
  })
  if (kind === 'velocity') swapVelocity(bundle)
  else swapDye(bundle)
}

function seed(bundle: Bundle, name: string, color: [number, number, number]) {
  clearFields(bundle)
  const radius = name === 'still' ? 0.052 : name === 'vortex' ? 0.09 : 0.062
  const source = (x: number, y: number, dx: number, dy: number, tint: [number, number, number], size = radius, pigmentLoad = 1.55) => {
    splat(bundle, 'velocity', x, y, size, [dx, dy], tint, 1)
    splat(bundle, 'dye', x, y, size, [0, 0], tint, pigmentLoad)
  }
  if (name === 'still') {
    source(0.43, 0.51, 1.2, 0.2, color, 0.08)
    source(0.58, 0.52, -0.8, -0.2, [0.9, 0.54, 0.33], 0.07)
  } else if (name === 'vortex') {
    const spectrum: [number, number, number][] = [color, [0.84, 0.3, 0.76], [0.94, 0.52, 0.2], [0.31, 0.54, 1]]
    for (let i = 0; i < 24; i++) {
      const angle = i / 24 * Math.PI * 2
      const x = 0.5 + Math.cos(angle) * 0.24, y = 0.5 + Math.sin(angle) * 0.24
      source(x, y, -Math.sin(angle) * 148, Math.cos(angle) * 148, spectrum[Math.floor(i / 6) % spectrum.length], 0.055, 0.52)
    }
    for (let i = 0; i < 22; i++) {
      const t = i / 21, angle = t * Math.PI * 3.2 - 1.3, radius = 0.028 + t * 0.19
      const x = 0.5 + Math.cos(angle) * radius, y = 0.5 + Math.sin(angle) * radius
      source(x, y, -Math.sin(angle) * 180, Math.cos(angle) * 180, spectrum[(Math.floor(i / 6) + 1) % spectrum.length], 0.042, 0.38)
    }
  } else {
    source(0.27, 0.46, 126, 56, color, 0.09, 1.15)
    source(0.72, 0.59, -126, -36, [0.95, 0.38, 0.62], 0.09, 1.15)
    source(0.51, 0.73, 42, -118, [0.86, 0.74, 0.38], 0.07, 0.95)
  }
}

function step(bundle: Bundle, dt: number, viscosity: number, vorticityStrength: number, dissipation: number) {
  let velocity = currentVelocity(bundle)
  const texel = [1 / velocity.width, 1 / velocity.height]
  if (viscosity > 0.002) {
    drawPass(bundle, 'copy', bundle.velocityOriginal, [['uSource', velocity.texture]])
    const original = bundle.velocityOriginal
    let current = velocity
    const a = Math.min(0.6, viscosity * dt * 22)
    for (let i = 0; i < (viscosity > 0.55 ? 7 : 4); i++) {
      drawPass(bundle, 'diffuse', nextVelocity(bundle), [['uOriginal', original.texture], ['uCurrent', current.texture]], { uTexel: texel, uA: a })
      swapVelocity(bundle)
      current = currentVelocity(bundle)
    }
  }
  drawPass(bundle, 'advectVelocity', nextVelocity(bundle), [['uVelocity', currentVelocity(bundle).texture]], { uTexel: texel, uDt: dt, uFade: Math.exp(-dt * 0.08) })
  swapVelocity(bundle)
  if (vorticityStrength > 0) {
    drawPass(bundle, 'curl', bundle.curl, [['uVelocity', currentVelocity(bundle).texture]], { uTexel: texel })
    drawPass(bundle, 'vorticity', nextVelocity(bundle), [['uVelocity', currentVelocity(bundle).texture], ['uCurl', bundle.curl.texture]], { uTexel: texel, uDt: dt, uStrength: vorticityStrength })
    swapVelocity(bundle)
  }
  velocity = currentVelocity(bundle)
  drawPass(bundle, 'divergence', bundle.divergence, [['uVelocity', velocity.texture]], { uTexel: texel })
  let pressure = bundle.pressure[0]
  for (let i = 0; i < 24; i++) {
    const destination = bundle.pressure[1 - (i % 2)]
    drawPass(bundle, 'pressure', destination, [['uPressure', pressure.texture], ['uDivergence', bundle.divergence.texture]], { uTexel: texel })
    pressure = destination
  }
  drawPass(bundle, 'project', nextVelocity(bundle), [['uVelocity', velocity.texture], ['uPressure', pressure.texture]], { uTexel: texel })
  swapVelocity(bundle)
  const dye = currentDye(bundle), dyeNext = nextDye(bundle)
  drawPass(bundle, 'advectDye', dyeNext, [['uDye', dye.texture], ['uVelocity', currentVelocity(bundle).texture]], {
    uDyeTexel: [1 / dye.width, 1 / dye.height],
    uVelocityTexel: [1 / currentVelocity(bundle).width, 1 / currentVelocity(bundle).height],
    uDt: dt, uFade: Math.pow(dissipation, dt * 60),
  })
  swapDye(bundle)
}

function createBundle(canvas: HTMLCanvasElement): Bundle {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' })
  if (!gl) throw new Error('WebGL 2 is unavailable')
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Floating-point render targets are unavailable')
  const vao = gl.createVertexArray()
  if (!vao) throw new Error('Vertex array support is unavailable')
  gl.bindVertexArray(vao)
  const programs = Object.fromEntries(Object.entries(shaderSource).map(([name, source]) => [name, createProgram(gl, source)]))
  const initial = { gl, vao, programs, velocity: null, velocityOriginal: null, dye: null, pressure: null, divergence: null, curl: null, width: 1, height: 1, velocityIndex: 0, dyeIndex: 0 } as unknown as Bundle
  return initial
}

function resizeBundle(bundle: Bundle, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return false
  const maxTexture = bundle.gl.getParameter(bundle.gl.MAX_TEXTURE_SIZE) as number
  const density = Math.min(devicePixelRatio || 1, 2, Math.sqrt(3_000_000 / (rect.width * rect.height)), maxTexture / rect.width, maxTexture / rect.height)
  const width = Math.max(1, Math.floor(rect.width * density)), height = Math.max(1, Math.floor(rect.height * density))
  if (bundle.width === width && bundle.height === height && bundle.velocity[0]) return false
  disposeBundle(bundle.width > 1 ? bundle : null)
  canvas.width = width
  canvas.height = height
  bundle.width = width
  bundle.height = height
  const aspect = width / height
  const velocityHeight = Math.max(220, Math.min(620, Math.round(height * 0.48)))
  const velocityWidth = Math.max(220, Math.min(maxTexture, Math.round(velocityHeight * aspect)))
  const dyeScale = Math.min(1, Math.sqrt(3_000_000 / (width * height)))
  const dyeWidth = Math.max(1, Math.floor(width * dyeScale))
  const dyeHeight = Math.max(1, Math.floor(height * dyeScale))
  bundle.velocity = [target(bundle.gl, velocityWidth, velocityHeight), target(bundle.gl, velocityWidth, velocityHeight)]
  bundle.velocityOriginal = target(bundle.gl, velocityWidth, velocityHeight)
  bundle.dye = [target(bundle.gl, dyeWidth, dyeHeight), target(bundle.gl, dyeWidth, dyeHeight)]
  bundle.pressure = [target(bundle.gl, velocityWidth, velocityHeight), target(bundle.gl, velocityWidth, velocityHeight)]
  bundle.divergence = target(bundle.gl, velocityWidth, velocityHeight)
  bundle.curl = target(bundle.gl, velocityWidth, velocityHeight)
  clearFields(bundle)
  return true
}

function releaseBundle(bundle: Bundle) {
  disposeBundle(bundle.width > 1 ? bundle : null)
  bundle.gl.deleteVertexArray(bundle.vao)
  for (const program of Object.values(bundle.programs)) bundle.gl.deleteProgram(program.handle)
}

function GpuFluid(props: ExperimentControls & { onUnsupported: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointer = useRef<PointerSample | null>(null)
  const seedRef = useRef<(name: string) => void>(() => {})
  const clearRef = useRef<() => void>(() => {})
  const [style, setStyle] = useState(() => typeof props.stateFromUrl?.style === 'string' ? props.stateFromUrl.style : 'silk')
  const [palette, setPalette] = useState(() => typeof props.stateFromUrl?.palette === 'string' && pigments[props.stateFromUrl.palette] ? props.stateFromUrl.palette : 'aurora')
  const [viscosity, setViscosity] = useState(() => Number(props.stateFromUrl?.viscosity) || 0.12)
  const [dissipation, setDissipation] = useState(() => Number(props.stateFromUrl?.dissipation) || 0.994)
  const [force, setForce] = useState(() => Number(props.stateFromUrl?.force) || 0.72)
  const [brushSize, setBrushSize] = useState(() => Number(props.stateFromUrl?.brushSize) || 42)
  const [vorticity, setVorticity] = useState(() => Number(props.stateFromUrl?.vorticity) || 16)
  const [ambient, setAmbient] = useState(() => props.stateFromUrl?.ambient !== false)
  const [presetName, setPresetName] = useState(() => typeof props.stateFromUrl?.preset === 'string' ? props.stateFromUrl.preset : 'vortex')
  const [velocityGrid, setVelocityGrid] = useState([0, 0])
  const presetNameRef = useRef(presetName)
  presetNameRef.current = presetName
  const params = useRef({ style, palette, viscosity, dissipation, force, brushSize, vorticity, ambient, paused: props.paused })
  params.current = { style, palette, viscosity, dissipation, force, brushSize, vorticity, ambient, paused: props.paused }

  useEffect(() => {
    props.onShareState({ style, palette, viscosity, dissipation, force, brushSize, vorticity, ambient, preset: presetName })
  }, [style, palette, viscosity, dissipation, force, brushSize, vorticity, ambient, presetName, props.onShareState])

  const failed = useCallback(() => props.onUnsupported(), [props.onUnsupported])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let bundle: Bundle
    let raf = 0, last = 0, lastAmbient = 0
    let ambientX = 0.5, ambientY = 0.5
    try {
      bundle = createBundle(canvas)
    } catch {
      failed()
      return
    }
    const resize = () => {
      try {
        if (resizeBundle(bundle, canvas)) {
          setVelocityGrid([bundle.velocity[0].width, bundle.velocity[0].height])
          seed(bundle, presetNameRef.current, pigments[params.current.palette].dye)
          render()
        }
      } catch { failed() }
    }
    const render = (now = 0) => {
      if (!bundle.width || !bundle.height || !bundle.dye?.[0]) return
      const mode = ({ silk: 0, ink: 1, smoke: 2, electric: 3 } as Record<string, number>)[params.current.style] ?? 0
      drawPass(bundle, 'render', null, [['uDye', currentDye(bundle).texture], ['uVelocity', currentVelocity(bundle).texture]], {
        uDyeTexel: [1 / currentDye(bundle).width, 1 / currentDye(bundle).height],
        uVelocityTexel: [1 / currentVelocity(bundle).width, 1 / currentVelocity(bundle).height],
        uStyle: mode, uTime: now / 1000,
      })
    }
    seedRef.current = (name) => { seed(bundle, name, pigments[params.current.palette].dye); render() }
    clearRef.current = () => { clearFields(bundle); pointer.current = null; render() }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden || params.current.paused || now - last < 30) return
      const dt = Math.min(1 / 24, Math.max(1 / 60, (now - last) / 1000 || 1 / 30))
      last = now
      const trace = pointer.current
      if (trace) {
        const current = currentVelocity(bundle)
        const rect = canvas.getBoundingClientRect()
        const scale = current.height / Math.max(1, rect.height)
        const impulse: [number, number] = [trace.dx * scale * 24 * params.current.force, -trace.dy * scale * 24 * params.current.force]
        const pigment = pigments[params.current.palette].dye
        const radius = params.current.brushSize / Math.max(1, rect.height)
        splat(bundle, 'velocity', trace.x, trace.y, radius, impulse, pigment)
        splat(bundle, 'dye', trace.x, trace.y, radius, [0, 0], pigment, 1.3)
        pointer.current = { ...trace, dx: 0, dy: 0 }
      }
      if (params.current.ambient && now - lastAmbient > 160) {
        const t = now * 0.00018
        const x = 0.5 + Math.cos(t) * 0.27
        const y = 0.5 + Math.sin(t * 1.43) * 0.2
        const dx = (x - ambientX) * currentVelocity(bundle).height * 6
        const dy = (y - ambientY) * currentVelocity(bundle).height * 6
        const paletteIndex = Math.floor(now / 1900) % 5
        const emitterColor: [number, number, number][] = [[0.18, 0.84, 0.92], [0.9, 0.35, 0.64], [0.9, 0.68, 0.38], [0.44, 0.4, 0.96], [0.75, 0.88, 0.8]]
        const color = emitterColor[paletteIndex]
        splat(bundle, 'velocity', x, y, 0.035, [dx, dy], color, 0.28)
        splat(bundle, 'dye', x, y, 0.035, [0, 0], color, 0.22)
        ambientX = x; ambientY = y; lastAmbient = now
      }
      const styleVorticity = (params.current.style === 'ink' ? params.current.vorticity * 0.72 : params.current.style === 'electric' ? params.current.vorticity * 1.25 : params.current.vorticity) * 0.12
      const styleViscosity = params.current.style === 'smoke' ? params.current.viscosity * 1.6 : params.current.style === 'silk' ? params.current.viscosity * 0.65 : params.current.viscosity
      step(bundle, dt, styleViscosity, styleVorticity, params.current.dissipation)
      render(now)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      releaseBundle(bundle)
      seedRef.current = () => {}
      clearRef.current = () => {}
      pointer.current = null
    }
  }, [failed])

  const setPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = 1 - (event.clientY - rect.top) / rect.height
    if (!pointer.current) pointer.current = { x, y, dx: 0, dy: 0 }
    else pointer.current = { x, y, dx: (event.clientX - rect.left) - (pointer.current.x * rect.width), dy: (event.clientY - rect.top) - ((1 - pointer.current.y) * rect.height) }
  }
  const selectPreset = (name: string) => { setPresetName(name); seedRef.current(name) }

  return <div className="experiment-surface">
    <canvas ref={canvasRef} className="experiment-canvas fluid-canvas" aria-label="GPU fluid dynamics. Drag to inject momentum and pigment." onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pointer.current = null; setPoint(event) }} onPointerMove={(event) => { if (event.buttons || event.pointerType === 'touch') setPoint(event) }} onPointerUp={() => { pointer.current = null }} onPointerCancel={() => { pointer.current = null }} />
    <span className="canvas-coordinate">FLOATING-POINT VELOCITY · {velocityGrid[0]} × {velocityGrid[1]}</span>
    <ControlPanel title="A Quiet Current" note="GPU INCOMPRESSIBLE FLOW" visible={props.controlsVisible} onClose={props.onCloseControls}>
      <SelectControl label="Rendering style" value={style} options={[['silk', 'Silk · flowing ribbons'], ['ink', 'Ink · dense pigment'], ['smoke', 'Smoke · soft volume'], ['electric', 'Electric · luminous folds']]} onChange={setStyle} />
      <SelectControl label="Pigment" value={palette} options={Object.entries(pigments).map(([key, item]) => [key, item.name])} onChange={setPalette} />
      <div className="preset-row"><span>FLOW</span>{[['crossing', 'Crossing'], ['vortex', 'Vortex'], ['still', 'Quiet']].map(([key, label]) => <button key={key} className={presetName === key ? 'selected' : ''} onClick={() => selectPreset(key)}>{label}</button>)}</div>
      <Segmented label="Ambient source" value={ambient ? 'on' : 'off'} options={[['on', 'Drifting'], ['off', 'Gesture']]} onChange={(value) => setAmbient(value === 'on')} />
      <RangeControl label="Brush width" value={brushSize} min={12} max={110} step={2} onChange={setBrushSize} format={(value) => value + ' px'} />
      <RangeControl label="Force" value={force} min={0.15} max={1.8} step={0.05} onChange={setForce} format={(value) => value.toFixed(2) + '×'} />
      <RangeControl label="Vorticity" value={vorticity} min={0} max={32} step={1} onChange={setVorticity} />
      <RangeControl label="Viscosity" value={viscosity} min={0} max={0.9} step={0.01} onChange={setViscosity} format={(value) => value < 0.1 ? 'silk' : value < 0.4 ? 'soft' : 'thick'} />
      <RangeControl label="Dye persistence" value={dissipation} min={0.96} max={0.999} step={0.001} onChange={setDissipation} format={(value) => (value * 100).toFixed(1) + '%'} />
      <button className="panel-action" onClick={() => clearRef.current()}><span>Clear the water</span><i>↺</i></button>
      <p className="control-note">Velocity and pressure run on a compact grid; pigment evolves at display resolution. Vorticity keeps eddies alive as color stretches and mixes.</p>
    </ControlPanel>
  </div>
}

export default function Fluid(props: ExperimentControls) {
  const [fallback, setFallback] = useState(false)
  const onUnsupported = useCallback(() => setFallback(true), [])
  return fallback ? <FluidCpuFallback {...props} /> : <GpuFluid {...props} onUnsupported={onUnsupported} />
}
