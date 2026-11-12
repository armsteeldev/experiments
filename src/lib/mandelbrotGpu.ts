import type { Magnification } from './deepZoom'

export type GpuTile = {
  cacheKey: string
  slot: number
  x: number
  y: number
  width: number
  height: number
  reference: Float32Array
  referenceExponents: Int32Array
  scaleMantissa: number
  scaleExponent: number
  iterations: number
  mode: 'mandelbrot' | 'julia'
}

export type PreviewWarp = { scale: number; x: number; y: number }
export type GpuStats = { batchTiles: number; uploadMs: number; completionMs: number; glitchIndices: number[] }

const BUFFER = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 }
const TEXTURE = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 }

const computeWGSL = /* wgsl */`
struct RefOrbit {
  xy: vec4<f32>,
  exponent: i32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}
struct TileInfo {
  originSize: vec4<u32>,
  refScale: vec4<u32>,
  iterModeSlot: vec4<u32>,
}
struct Params { dimensions: vec4<u32> }
@group(0) @binding(0) var<storage, read> orbit: array<RefOrbit>;
@group(0) @binding(1) var<storage, read> tiles: array<TileInfo>;
@group(0) @binding(2) var<storage, read_write> values: array<f32>;
@group(0) @binding(3) var<storage, read_write> valid: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> glitches: array<atomic<u32>>;
@group(0) @binding(5) var<uniform> params: Params;

fn pow2(exponent: i32) -> f32 {
  if (exponent < -140) { return 0.0; }
  if (exponent > 120) { return 3.402823e38; }
  return exp2(f32(exponent));
}
fn smoothIteration(n: u32, log2MagnitudeSquared: f32) -> f32 {
  let logRadius = max(1.0e-20, 0.5 * log2MagnitudeSquared);
  return f32(n + 1u) - log2(max(1.0e-20, logRadius));
}
fn evaluateOrbit(tile: TileInfo, local: vec2<u32>, slot: u32) -> f32 {
  let globalWidth = params.dimensions.x;
  let globalHeight = params.dimensions.y;
  let origin = tile.originSize.xy;
  let tileSize = tile.originSize.zw;
  let refStart = tile.refScale.x;
  let refLength = tile.refScale.y;
  let scaleMantissa = bitcast<f32>(tile.refScale.z);
  let scaleExponent = bitcast<i32>(tile.refScale.w);
  let iterations = tile.iterModeSlot.x;
  let mode = tile.iterModeSlot.y;

  let dxPixels = f32(local.x) + 0.5 - f32(tileSize.x) * 0.5;
  let dyPixels = -(f32(local.y) + 0.5 - f32(tileSize.y) * 0.5);
  let dcx = dxPixels * scaleMantissa;
  let dcy = dyPixels * scaleMantissa;
  let pixelMagnitude = max(max(abs(dcx), abs(dcy)), 1.0);
  let normalizeShift = i32(ceil(log2(pixelMagnitude)));
  let dcMantissa = vec2<f32>(dcx, dcy) * pow2(-normalizeShift);
  let dcExponent = scaleExponent + normalizeShift;

  var delta = vec2<f32>(0.0);
  var deltaExponent = 0;
  if (mode == 1u) {
    delta = dcMantissa;
    deltaExponent = dcExponent;
  }

  for (var n = 0u; n < iterations; n = n + 1u) {
    if (n >= refLength) {
      atomicStore(&glitches[slot], 1u);
      return -2.0;
    }
    let referencePoint = orbit[refStart + n];
    let refX = referencePoint.xy.x + referencePoint.xy.z;
    let refY = referencePoint.xy.y + referencePoint.xy.w;
    let refExponent = referencePoint.exponent;

    let refNormExp = max(refExponent, deltaExponent);
    let refScale = pow2(refExponent - refNormExp);
    let deltaScale = pow2(deltaExponent - refNormExp);
    let refNorm = vec2<f32>(refX, refY) * refScale;
    let deltaNorm = delta * deltaScale;
    let combined = refNorm + deltaNorm;
    let magnitudeSquared = dot(combined, combined);
    if (magnitudeSquared > 0.0) {
      let log2MagnitudeSquared = log2(magnitudeSquared) + 2.0 * f32(refNormExp);
      if (log2MagnitudeSquared > 4.0) { return smoothIteration(n, log2MagnitudeSquared); }
    }

    // Pauldelbrot's |Z + z|² < G|Z|² glitch test, performed in a
    // shared exponent domain so tiny deep-zoom deltas do not underflow.
    if (refExponent - deltaExponent < 18 && deltaExponent - refExponent < 18) {
      let ref2 = dot(refNorm, refNorm);
      if (ref2 > 0.0 && magnitudeSquared < ref2 * 1.0e-6) {
        atomicStore(&glitches[slot], 1u);
        return -2.0;
      }
    }

    let hasDelta = delta.x != 0.0 || delta.y != 0.0;
    let linearExp = select(-1000000, refExponent + deltaExponent, hasDelta);
    let quadraticExp = select(-1000000, 2 * deltaExponent, hasDelta);
    var commonExp = max(linearExp, quadraticExp);
    if (mode == 0u) { commonExp = max(commonExp, dcExponent); }
    let linearX = 2.0 * (refX * delta.x - refY * delta.y);
    let linearY = 2.0 * (refX * delta.y + refY * delta.x);
    let quadraticX = delta.x * delta.x - delta.y * delta.y;
    let quadraticY = 2.0 * delta.x * delta.y;
    var nextDelta = vec2<f32>(0.0);
    if (hasDelta) {
      nextDelta = vec2<f32>(linearX, linearY) * pow2(linearExp - commonExp)
        + vec2<f32>(quadraticX, quadraticY) * pow2(quadraticExp - commonExp);
    }
    if (mode == 0u) { nextDelta = nextDelta + dcMantissa * pow2(dcExponent - commonExp); }

    let largest = max(abs(nextDelta.x), abs(nextDelta.y));
    if (largest == 0.0) {
      delta = vec2<f32>(0.0);
      deltaExponent = 0;
    } else {
      let shift = clamp(i32(floor(log2(largest))) + 1, -100, 100);
      delta = nextDelta * pow2(-shift);
      deltaExponent = commonExp + shift;
    }
  }
  return -1.0;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let slot = wid.z;
  let tile = tiles[slot];
  let local = gid.xy;
  if (local.x >= tile.originSize.z || local.y >= tile.originSize.w) { return; }
  let point = tile.originSize.xy + local;
  if (point.x >= params.dimensions.x || point.y >= params.dimensions.y) { return; }
  let value = evaluateOrbit(tile, local, slot);
  values[point.y * params.dimensions.x + point.x] = value;
  if (value != -2.0) { atomicStore(&valid[tile.iterModeSlot.z], 1u); }
}
`

const displayWGSL = /* wgsl */`
struct DisplayParams {
  dimensions: vec4<f32>,
  transform: vec4<f32>,
  tile: vec4<u32>,
  palette: vec4<u32>,
}
struct VOut { @builtin(position) position: vec4<f32> }
@group(0) @binding(0) var preview: texture_2d<f32>;
@group(0) @binding(1) var previewSampler: sampler;
@group(0) @binding(2) var<storage, read> values: array<f32>;
@group(0) @binding(3) var<storage, read> valid: array<u32>;
@group(0) @binding(4) var<uniform> params: DisplayParams;
@vertex fn vs(@builtin(vertex_index) index: u32) -> VOut {
  var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var out: VOut;
  out.position = vec4<f32>(positions[index], 0.0, 1.0);
  return out;
}
fn mix3(a: vec3<f32>, b: vec3<f32>, t: f32) -> vec3<f32> { return a + (b - a) * t; }
fn paletteColor(value: f32) -> vec3<f32> {
  var stops = array<vec3<f32>, 5>(
    vec3<f32>(0.016, 0.031, 0.075), vec3<f32>(0.039, 0.145, 0.263),
    vec3<f32>(0.09, 0.412, 0.537), vec3<f32>(0.357, 0.812, 0.745), vec3<f32>(0.973, 0.835, 0.627));
  if (params.palette.x == 1u) {
    stops = array<vec3<f32>, 5>(vec3<f32>(0.039, 0.047, 0.094), vec3<f32>(0.212, 0.212, 0.353), vec3<f32>(0.518, 0.322, 0.404), vec3<f32>(0.882, 0.565, 0.384), vec3<f32>(0.969, 0.863, 0.651));
  } else if (params.palette.x == 2u) {
    stops = array<vec3<f32>, 5>(vec3<f32>(0.031, 0.039, 0.106), vec3<f32>(0.165, 0.184, 0.376), vec3<f32>(0.325, 0.514, 0.682), vec3<f32>(0.796, 0.608, 0.749), vec3<f32>(0.969, 0.867, 0.796));
  } else if (params.palette.x == 3u) {
    stops = array<vec3<f32>, 5>(vec3<f32>(0.02, 0.055, 0.102), vec3<f32>(0.078, 0.235, 0.408), vec3<f32>(0.212, 0.576, 0.749), vec3<f32>(0.604, 0.855, 0.855), vec3<f32>(0.945, 0.973, 0.886));
  } else if (params.palette.x == 4u) {
    stops = array<vec3<f32>, 5>(vec3<f32>(0.027, 0.02, 0.078), vec3<f32>(0.224, 0.071, 0.306), vec3<f32>(0.659, 0.18, 0.416), vec3<f32>(0.98, 0.486, 0.263), vec3<f32>(1.0, 0.871, 0.529));
  }
  let phase = fract(max(value, 0.0) * 0.034 + 0.012) * 4.0;
  let segment = min(u32(floor(phase)), 3u);
  let t0 = fract(phase); let t = t0 * t0 * (3.0 - 2.0 * t0);
  return mix3(stops[segment], stops[segment + 1u], t);
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  let size = params.dimensions.xy;
  let pixel = in.position.xy;
  let center = size * 0.5;
  let previewPixel = center + (pixel - center - params.transform.yz) / params.transform.x;
  let uv = previewPixel / size;
  var background = vec4<f32>(0.006, 0.014, 0.025, 1.0);
  if (params.transform.x > 0.0 && all(uv >= vec2<f32>(0.0)) && all(uv <= vec2<f32>(1.0))) {
    background = textureSampleLevel(preview, previewSampler, uv, 0.0);
  }
  let tileCoord = vec2<u32>(pixel) / params.tile.x;
  let slot = tileCoord.y * params.tile.y + tileCoord.x;
  if (slot >= params.tile.z || valid[slot] == 0u) { return background; }
  let point = vec2<u32>(pixel);
  let index = point.y * u32(size.x) + point.x;
  let value = values[index];
  if (value == -2.0) { return background; }
  if (value < 0.0) { return vec4<f32>(0.004, 0.008, 0.018, 1.0); }
  return vec4<f32>(paletteColor(value), 1.0);
}
`

const blitWGSL = /* wgsl */`
struct VOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var imageSampler: sampler;
@vertex fn vs(@builtin(vertex_index) index: u32) -> VOut {
  var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  let p = positions[index];
  var out: VOut;
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5);
  return out;
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> { return textureSample(image, imageSampler, in.uv); }
`

export class MandelbrotGpuRenderer {
  readonly device: any
  readonly format: string
  readonly context: any
  readonly canvas: HTMLCanvasElement
  readonly onLost: (reason: string) => void
  private computePipeline: any
  private displayPipeline: any
  private blitPipeline: any
  private sampler: any
  private previewTexture: any
  private frameTexture: any
  private valuesBuffer: any
  private validBuffer: any
  private displayParams: any
  private displayBindGroup: any
  private blitBindGroup: any
  private width = 0
  private height = 0
  private tileSize = 64
  private gridColumns = 0
  private tileSlots = 0
  private paletteIndex = 0
  private previewWarp: PreviewWarp = { scale: 1, x: 0, y: 0 }
  private destroyed = false
  private cachedTiles = new Map<string, { buffer: any; width: number; height: number; bytes: number; last: number }>()
  private cachedBytes = 0
  private readonly maxCachedBytes = 32 * 1024 * 1024

  private constructor(canvas: HTMLCanvasElement, device: any, format: string, context: any, onLost: (reason: string) => void) {
    this.canvas = canvas
    this.device = device
    this.format = format
    this.context = context
    this.onLost = onLost
    device.addEventListener('uncapturederror', (event: any) => console.warn('Mandelbrot WebGPU validation error:', event.error?.message || event.error))
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
    const computeModule = device.createShaderModule({ code: computeWGSL })
    const displayModule = device.createShaderModule({ code: displayWGSL })
    const blitModule = device.createShaderModule({ code: blitWGSL })
    this.computePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: computeModule, entryPoint: 'main' } })
    this.displayPipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: displayModule, entryPoint: 'vs' }, fragment: { module: displayModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } })
    this.blitPipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: blitModule, entryPoint: 'vs' }, fragment: { module: blitModule, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
    device.lost.then((info: any) => {
      if (!this.destroyed) onLost(info?.message || info?.reason || 'The graphics device was lost.')
    }).catch(() => {})
  }

  static async create(canvas: HTMLCanvasElement, onLost: (reason: string) => void) {
    const gpu = (navigator as any).gpu
    if (!gpu) throw new Error('WebGPU is not available in this browser.')
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('No compatible WebGPU adapter was found.')
    const device = await adapter.requestDevice()
    const format = gpu.getPreferredCanvasFormat()
    const context = (canvas as any).getContext('webgpu')
    if (!context) throw new Error('This canvas could not create a WebGPU context.')
    device.pushErrorScope('validation')
    const renderer = new MandelbrotGpuRenderer(canvas, device, format, context, onLost)
    const validationError = await device.popErrorScope()
    if (validationError) {
      renderer.destroy()
      throw new Error(validationError.message || 'The deep-zoom GPU shaders could not be initialized.')
    }
    return renderer
  }

  resize(width: number, height: number) {
    if (this.destroyed || width < 1 || height < 1) return
    this.device.pushErrorScope('validation')
    this.width = width
    this.height = height
    this.gridColumns = Math.ceil(width / this.tileSize)
    const rows = Math.ceil(height / this.tileSize)
    this.tileSlots = this.gridColumns * rows
    this.canvas.width = width
    this.canvas.height = height
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque', usage: TEXTURE.RENDER_ATTACHMENT })
    this.previewTexture?.destroy()
    this.frameTexture?.destroy()
    this.valuesBuffer?.destroy()
    this.validBuffer?.destroy()
    this.previewTexture = this.device.createTexture({ size: [width, height, 1], format: 'rgba8unorm', usage: TEXTURE.TEXTURE_BINDING | TEXTURE.COPY_DST | TEXTURE.RENDER_ATTACHMENT })
    this.frameTexture = this.device.createTexture({ size: [width, height, 1], format: 'rgba8unorm', usage: TEXTURE.TEXTURE_BINDING | TEXTURE.COPY_SRC | TEXTURE.COPY_DST | TEXTURE.RENDER_ATTACHMENT })
    this.valuesBuffer = this.device.createBuffer({ size: alignTo(width * height * 4, 4), usage: BUFFER.STORAGE | BUFFER.COPY_DST | BUFFER.COPY_SRC })
    this.validBuffer = this.device.createBuffer({ size: alignTo(this.tileSlots * 4, 4), usage: BUFFER.STORAGE | BUFFER.COPY_DST })
    this.displayParams = this.device.createBuffer({ size: 64, usage: BUFFER.UNIFORM | BUFFER.COPY_DST })
    this.displayBindGroup = this.device.createBindGroup({
      layout: this.displayPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.previewTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.valuesBuffer } },
        { binding: 3, resource: { buffer: this.validBuffer } },
        { binding: 4, resource: { buffer: this.displayParams } },
      ],
    })
    this.blitBindGroup = this.device.createBindGroup({ layout: this.blitPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.frameTexture.createView() }, { binding: 1, resource: this.sampler }] })
    const valid = new Uint32Array(this.tileSlots)
    const initial = new Float32Array(width * height)
    initial.fill(-2)
    this.device.queue.writeBuffer(this.valuesBuffer, 0, initial)
    this.device.queue.writeBuffer(this.validBuffer, 0, valid)
    const clearEncoder = this.device.createCommandEncoder()
    for (const texture of [this.previewTexture, this.frameTexture]) {
      const pass = clearEncoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), clearValue: { r: 0.006, g: 0.014, b: 0.025, a: 1 }, loadOp: 'clear', storeOp: 'store' }] })
      pass.end()
    }
    this.device.queue.submit([clearEncoder.finish()])
    this.setDisplayParameters(this.previewWarp)
    void this.device.popErrorScope().then((error: any) => { if (error) throw error }).catch((error: unknown) => {
      console.warn('Mandelbrot WebGPU resize failed; using CPU tiles.', error)
      this.onLost(error instanceof Error ? error.message : 'WebGPU resize failed.')
    })
  }

  setPalette(index: number) {
    this.paletteIndex = Math.max(0, Math.min(4, index | 0))
    this.setDisplayParameters(this.previewWarp)
    this.present()
  }

  get tileColumns() { return this.gridColumns }
  get tileRows() { return Math.ceil(this.height / this.tileSize) }
  get tileCacheBytes() { return this.cachedBytes }
  getTileSize() { return this.tileSize }

  hasCachedTile(cacheKey: string) { return this.cachedTiles.has(cacheKey) }

  /** Keep the last composite in a GPU texture, then reproject it immediately for the new camera. */
  moveCamera(warp: PreviewWarp, source?: HTMLCanvasElement) {
    if (!this.width || !this.height) return
    if (source && source.width === this.width && source.height === this.height) {
      this.device.queue.copyExternalImageToTexture({ source }, { texture: this.previewTexture }, [this.width, this.height, 1])
    } else this.device.queue.copyTextureToTexture({ texture: this.frameTexture }, { texture: this.previewTexture }, [this.width, this.height, 1])
    this.previewWarp = warp
    this.device.queue.writeBuffer(this.validBuffer, 0, new Uint32Array(this.tileSlots))
    this.setDisplayParameters(warp)
    this.present()
  }

  async renderBatch(batch: GpuTile[]): Promise<GpuStats> {
    if (!batch.length || this.destroyed) return { batchTiles: 0, uploadMs: 0, completionMs: 0, glitchIndices: [] }
    if (!this.valuesBuffer || !this.validBuffer || !this.width || !this.height) throw new Error('WebGPU tile buffers are not initialized for the current viewport.')
    const start = performance.now()
    let orbitCount = 0
    for (const tile of batch) orbitCount += tile.referenceExponents.length
    const orbitData = new Uint32Array(orbitCount * 8)
    const orbitFloats = new Float32Array(orbitData.buffer)
    const descriptorData = new Uint32Array(batch.length * 12)
    let refCursor = 0
    batch.forEach((tile, index) => {
      const count = tile.referenceExponents.length
      const src = tile.reference
      for (let i = 0; i < count; i++) {
        const orbitAt = (refCursor + i) * 8
        const sourceAt = i * 4
        orbitFloats.set(src.subarray(sourceAt, sourceAt + 4), orbitAt)
        orbitData[orbitAt + 4] = tile.referenceExponents[i] >>> 0
      }
      const base = index * 12
      descriptorData[base] = tile.x
      descriptorData[base + 1] = tile.y
      descriptorData[base + 2] = tile.width
      descriptorData[base + 3] = tile.height
      descriptorData[base + 4] = refCursor
      descriptorData[base + 5] = count
      descriptorData[base + 6] = floatBits(tile.scaleMantissa)
      descriptorData[base + 7] = tile.scaleExponent >>> 0
      descriptorData[base + 8] = tile.iterations
      descriptorData[base + 9] = tile.mode === 'julia' ? 1 : 0
      descriptorData[base + 10] = tile.slot
      refCursor += count
    })
    const orbitBuffer = this.device.createBuffer({ size: alignTo(orbitData.byteLength, 16), usage: BUFFER.STORAGE | BUFFER.COPY_DST })
    const tileBuffer = this.device.createBuffer({ size: alignTo(descriptorData.byteLength, 16), usage: BUFFER.STORAGE | BUFFER.COPY_DST })
    const glitchBuffer = this.device.createBuffer({ size: alignTo(batch.length * 4, 4), usage: BUFFER.STORAGE | BUFFER.COPY_DST | BUFFER.COPY_SRC })
    const readback = this.device.createBuffer({ size: alignTo(batch.length * 4, 4), usage: BUFFER.MAP_READ | BUFFER.COPY_DST })
    const paramsBuffer = this.device.createBuffer({ size: 16, usage: BUFFER.UNIFORM | BUFFER.COPY_DST })
    const zeroFlags = new Uint32Array(batch.length)
    this.device.queue.writeBuffer(orbitBuffer, 0, orbitData)
    this.device.queue.writeBuffer(tileBuffer, 0, descriptorData)
    this.device.queue.writeBuffer(glitchBuffer, 0, zeroFlags)
    this.device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([this.width, this.height, this.tileSize, this.gridColumns]))
    const uploadMs = performance.now() - start
    const group = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: orbitBuffer } },
        { binding: 1, resource: { buffer: tileBuffer } },
        { binding: 2, resource: { buffer: this.valuesBuffer } },
        { binding: 3, resource: { buffer: this.validBuffer } },
        { binding: 4, resource: { buffer: glitchBuffer } },
        { binding: 5, resource: { buffer: paramsBuffer } },
      ],
    })
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(this.computePipeline)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(Math.ceil(this.tileSize / 8), Math.ceil(this.tileSize / 8), batch.length)
    pass.end()
    encoder.copyBufferToBuffer(glitchBuffer, 0, readback, 0, batch.length * 4)
    const cacheBuffers = batch.map((tile) => this.device.createBuffer({ size: alignTo(tile.width * tile.height * 4, 4), usage: BUFFER.COPY_DST | BUFFER.COPY_SRC }))
    batch.forEach((tile, index) => {
      for (let row = 0; row < tile.height; row++) {
        const sourceOffset = ((tile.y + row) * this.width + tile.x) * 4
        const destinationOffset = row * tile.width * 4
        encoder.copyBufferToBuffer(this.valuesBuffer, sourceOffset, cacheBuffers[index], destinationOffset, tile.width * 4)
      }
    })
    this.device.queue.submit([encoder.finish()])
    this.setDisplayParameters(this.previewWarp)
    this.present()
    await readback.mapAsync(BUFFER.MAP_READ)
    const values = new Uint32Array(readback.getMappedRange().slice(0))
    readback.unmap()
    const completionMs = performance.now() - start
    const glitchIndices: number[] = []
    for (let index = 0; index < values.length; index++) if (values[index]) glitchIndices.push(index)
    const glitchSet = new Set(glitchIndices)
    batch.forEach((tile, index) => {
      if (glitchSet.has(index) || tile.width * tile.height * 4 > this.maxCachedBytes) { cacheBuffers[index].destroy(); return }
      this.putCachedTile(tile.cacheKey, cacheBuffers[index], tile.width, tile.height)
    })
    for (const buffer of [orbitBuffer, tileBuffer, glitchBuffer, readback, paramsBuffer]) buffer.destroy()
    return { batchTiles: batch.length, uploadMs, completionMs, glitchIndices }
  }

  restoreCachedTile(cacheKey: string, tile: Pick<GpuTile, 'slot' | 'x' | 'y' | 'width' | 'height'>) {
    const cached = this.cachedTiles.get(cacheKey)
    if (!cached || this.destroyed) return false
    cached.last = performance.now()
    const encoder = this.device.createCommandEncoder()
    for (let row = 0; row < tile.height; row++) {
      encoder.copyBufferToBuffer(cached.buffer, row * tile.width * 4, this.valuesBuffer, ((tile.y + row) * this.width + tile.x) * 4, tile.width * 4)
    }
    this.device.queue.writeBuffer(this.validBuffer, tile.slot * 4, new Uint32Array([1]))
    this.device.queue.submit([encoder.finish()])
    this.setDisplayParameters(this.previewWarp)
    this.present()
    return true
  }

  restoreCachedTiles(items: Array<{ cacheKey: string; tile: Pick<GpuTile, 'slot' | 'x' | 'y' | 'width' | 'height'> }>) {
    const available = items.flatMap((item) => {
      const cached = this.cachedTiles.get(item.cacheKey)
      if (!cached) return []
      cached.last = performance.now()
      return [{ ...item, cached }]
    })
    if (!available.length || this.destroyed) return 0
    const encoder = this.device.createCommandEncoder()
    const slots = new Uint32Array(available.length)
    available.forEach(({ tile, cached }, itemIndex) => {
      slots[itemIndex] = tile.slot
      for (let row = 0; row < tile.height; row++) {
        encoder.copyBufferToBuffer(cached.buffer, row * tile.width * 4, this.valuesBuffer, ((tile.y + row) * this.width + tile.x) * 4, tile.width * 4)
      }
    })
    for (const slot of slots) this.device.queue.writeBuffer(this.validBuffer, slot * 4, new Uint32Array([1]))
    this.device.queue.submit([encoder.finish()])
    this.setDisplayParameters(this.previewWarp)
    this.present()
    return available.length
  }

  private putCachedTile(key: string, buffer: any, width: number, height: number) {
    const previous = this.cachedTiles.get(key)
    if (previous) { this.cachedBytes -= previous.bytes; previous.buffer.destroy(); this.cachedTiles.delete(key) }
    const bytes = width * height * 4
    while (this.cachedBytes + bytes > this.maxCachedBytes && this.cachedTiles.size) {
      const oldest = [...this.cachedTiles.entries()].reduce((a, b) => a[1].last < b[1].last ? a : b)
      this.cachedBytes -= oldest[1].bytes
      oldest[1].buffer.destroy()
      this.cachedTiles.delete(oldest[0])
    }
    this.cachedTiles.set(key, { buffer, width, height, bytes, last: performance.now() })
    this.cachedBytes += bytes
  }

  private setDisplayParameters(warp: PreviewWarp) {
    if (!this.displayParams || !this.width || !this.height) return
    const data = new ArrayBuffer(64)
    const floats = new Float32Array(data)
    const uints = new Uint32Array(data)
    floats[0] = this.width
    floats[1] = this.height
    floats[4] = Number.isFinite(warp.scale) && warp.scale > 0 ? warp.scale : 0
    floats[5] = Number.isFinite(warp.x) ? warp.x : 0
    floats[6] = Number.isFinite(warp.y) ? warp.y : 0
    uints[8] = this.tileSize
    uints[9] = this.gridColumns
    uints[10] = this.tileSlots
    uints[12] = this.paletteIndex
    this.device.queue.writeBuffer(this.displayParams, 0, data)
  }

  private present() {
    if (!this.width || !this.height || !this.frameTexture || this.destroyed) return
    const encoder = this.device.createCommandEncoder()
    const composite = encoder.beginRenderPass({ colorAttachments: [{ view: this.frameTexture.createView(), clearValue: { r: 0.006, g: 0.014, b: 0.025, a: 1 }, loadOp: 'clear', storeOp: 'store' }] })
    composite.setPipeline(this.displayPipeline)
    composite.setBindGroup(0, this.displayBindGroup)
    composite.draw(3)
    composite.end()
    const surface = this.context.getCurrentTexture().createView()
    const blit = encoder.beginRenderPass({ colorAttachments: [{ view: surface, clearValue: { r: 0.006, g: 0.014, b: 0.025, a: 1 }, loadOp: 'clear', storeOp: 'store' }] })
    blit.setPipeline(this.blitPipeline)
    blit.setBindGroup(0, this.blitBindGroup)
    blit.draw(3)
    blit.end()
    this.device.queue.submit([encoder.finish()])
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    for (const cached of this.cachedTiles.values()) cached.buffer.destroy()
    this.cachedTiles.clear()
    this.cachedBytes = 0
    for (const resource of [this.previewTexture, this.frameTexture, this.valuesBuffer, this.validBuffer, this.displayParams]) resource?.destroy()
    this.device.destroy()
  }
}

type RendererLeaseEntry = {
  promise: Promise<MandelbrotGpuRenderer>
  listeners: Set<(reason: string) => void>
  references: number
  releaseTimer: number | null
}
const rendererLeases = new WeakMap<HTMLCanvasElement, RendererLeaseEntry>()

/** Share a single device/context across React StrictMode's effect replay. */
export function acquireMandelbrotGpuRenderer(canvas: HTMLCanvasElement, onLost: (reason: string) => void) {
  let entry = rendererLeases.get(canvas)
  if (!entry) {
    const listeners = new Set<(reason: string) => void>()
    const promise = MandelbrotGpuRenderer.create(canvas, (reason) => {
      for (const listener of listeners) listener(reason)
    })
    entry = { promise, listeners, references: 0, releaseTimer: null }
    rendererLeases.set(canvas, entry)
    void promise.catch(() => {
      if (rendererLeases.get(canvas) === entry) rendererLeases.delete(canvas)
    })
  }
  if (entry.releaseTimer !== null) { window.clearTimeout(entry.releaseTimer); entry.releaseTimer = null }
  entry.references++
  entry.listeners.add(onLost)
  let released = false
  return {
    promise: entry.promise,
    release() {
      if (released) return
      released = true
      entry!.listeners.delete(onLost)
      entry!.references = Math.max(0, entry!.references - 1)
      if (entry!.references !== 0) return
      entry!.releaseTimer = window.setTimeout(() => {
        if (entry!.references !== 0) return
        rendererLeases.delete(canvas)
        void entry!.promise.then((renderer) => renderer.destroy()).catch(() => {})
      }, 300)
    },
  }
}

function alignTo(value: number, alignment: number) { return Math.ceil(value / alignment) * alignment }
function floatBits(value: number) { const view = new Float32Array([value]); return new Uint32Array(view.buffer)[0] }

export function cacheZoomKey(zoom: Magnification) { return `${zoom.mantissa.toPrecision(15)}e${zoom.exponent}` }
