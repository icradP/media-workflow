import type { DecodedVideoFrame } from '@media-workflow/core';

/**
 * Minimal WebGPU ambient types so codec stays free of @webgpu/types.
 * Runtime uses navigator.gpu when present; otherwise Canvas2D fallback.
 */
interface GpuAdapter {
  requestDevice(): Promise<GpuDevice>;
}

interface GpuDevice {
  createShaderModule(descriptor: { code: string }): unknown;
  createRenderPipeline(descriptor: Record<string, unknown>): GpuRenderPipeline;
  createTexture(descriptor: Record<string, unknown>): GpuTexture;
  createBindGroupLayout(descriptor: Record<string, unknown>): unknown;
  createPipelineLayout(descriptor: Record<string, unknown>): unknown;
  createBindGroup(descriptor: Record<string, unknown>): unknown;
  createCommandEncoder(): GpuCommandEncoder;
  createSampler(descriptor?: Record<string, unknown>): unknown;
  queue: {
    writeTexture(
      destination: Record<string, unknown>,
      data: Uint8Array,
      dataLayout: Record<string, unknown>,
      size: Record<string, unknown>,
    ): void;
    submit(commandBuffers: unknown[]): void;
  };
  destroy?: () => void;
}

interface GpuTexture {
  createView(descriptor?: Record<string, unknown>): unknown;
  destroy(): void;
}

interface GpuRenderPipeline {
  getBindGroupLayout(index: number): unknown;
}

interface GpuCommandEncoder {
  beginRenderPass(descriptor: Record<string, unknown>): GpuRenderPass;
  finish(): unknown;
}

interface GpuRenderPass {
  setPipeline(pipeline: GpuRenderPipeline): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  draw(vertexCount: number, instanceCount?: number): void;
  end(): void;
}

interface GpuCanvasContext {
  configure(descriptor: Record<string, unknown>): void;
  getCurrentTexture(): GpuTexture;
}

type GpuNavigator = Navigator & {
  gpu?: {
    requestAdapter(): Promise<GpuAdapter | null>;
    getPreferredCanvasFormat(): string;
  };
};

const YUV_SHADER = /* wgsl */ `
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0),
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 0.0),
    vec2f(0.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(1.0, 0.0),
  );
  var out: VertexOut;
  out.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}

@group(0) @binding(0) var yTex: texture_2d<f32>;
@group(0) @binding(1) var uTex: texture_2d<f32>;
@group(0) @binding(2) var vTex: texture_2d<f32>;
@group(0) @binding(3) var nearestSampler: sampler;

@fragment
fn fsMain(input: VertexOut) -> @location(0) vec4f {
  let y = textureSample(yTex, nearestSampler, input.uv).r;
  let u = textureSample(uTex, nearestSampler, input.uv).r - 0.5;
  let v = textureSample(vTex, nearestSampler, input.uv).r - 0.5;
  // BT.601 limited-range style conversion used elsewhere in the UI
  let c = y - 16.0 / 255.0;
  let r = clamp(1.164 * c + 1.596 * v, 0.0, 1.0);
  let g = clamp(1.164 * c - 0.392 * u - 0.813 * v, 0.0, 1.0);
  let b = clamp(1.164 * c + 2.017 * u, 0.0, 1.0);
  return vec4f(r, g, b, 1.0);
}
`;

export interface YuvCanvasRenderer {
  readonly backend: 'webgpu' | 'canvas2d';
  draw(frame: DecodedVideoFrame): void;
  destroy(): void;
}

interface WebGpuState {
  device: GpuDevice;
  context: GpuCanvasContext;
  pipeline: GpuRenderPipeline;
  sampler: unknown;
  format: string;
  y?: GpuTexture;
  u?: GpuTexture;
  v?: GpuTexture;
  width: number;
  height: number;
}

const rendererCache = new WeakMap<HTMLCanvasElement, Promise<YuvCanvasRenderer>>();

/** Prefer WebGPU; fall back to Canvas2D putImageData for unsupported browsers. */
export async function createYuvCanvasRenderer(
  canvas: HTMLCanvasElement,
): Promise<YuvCanvasRenderer> {
  const cached = rendererCache.get(canvas);
  if (cached) return cached;

  const pending = (async () => {
    const gpu = await tryCreateWebGpuRenderer(canvas);
    if (gpu) return gpu;
    return createCanvas2dRenderer(canvas);
  })();

  rendererCache.set(canvas, pending);
  try {
    return await pending;
  } catch (error) {
    rendererCache.delete(canvas);
    throw error;
  }
}

export async function drawDecodedFrameToCanvas(
  canvas: HTMLCanvasElement,
  frame: DecodedVideoFrame,
): Promise<YuvCanvasRenderer> {
  const renderer = await createYuvCanvasRenderer(canvas);
  renderer.draw(frame);
  return renderer;
}

async function tryCreateWebGpuRenderer(
  canvas: HTMLCanvasElement,
): Promise<YuvCanvasRenderer | null> {
  const nav = navigator as GpuNavigator;
  if (!nav.gpu) return null;
  let device: GpuDevice | undefined;
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) return null;
    device = await adapter.requestDevice();
    const format = nav.gpu.getPreferredCanvasFormat();
    const shader = device.createShaderModule({ code: YUV_SHADER });
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vsMain' },
      fragment: {
        module: shader,
        entryPoint: 'fsMain',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });
    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    // Attach WebGPU only after the pipeline is ready so Canvas2D fallback remains possible.
    const context = canvas.getContext('webgpu') as unknown as GpuCanvasContext | null;
    if (!context) {
      device.destroy?.();
      return null;
    }
    context.configure({
      device,
      format,
      alphaMode: 'opaque',
    });

    const state: WebGpuState = {
      device,
      context,
      pipeline,
      sampler,
      format,
      width: 0,
      height: 0,
    };

    return {
      backend: 'webgpu',
      draw(frame) {
        drawWebGpu(state, canvas, frame);
      },
      destroy() {
        state.y?.destroy();
        state.u?.destroy();
        state.v?.destroy();
        device?.destroy?.();
        rendererCache.delete(canvas);
      },
    };
  } catch {
    device?.destroy?.();
    return null;
  }
}

function drawWebGpu(
  state: WebGpuState,
  canvas: HTMLCanvasElement,
  frame: DecodedVideoFrame,
): void {
  const width = Math.max(1, frame.displayWidth);
  const height = Math.max(1, frame.displayHeight);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    state.context.configure({
      device: state.device,
      format: state.format,
      alphaMode: 'opaque',
    });
  }

  ensurePlaneTextures(state, width, height);
  uploadPlanes(state, frame, width, height);

  const bindGroup = state.device.createBindGroup({
    layout: state.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: state.y!.createView() },
      { binding: 1, resource: state.u!.createView() },
      { binding: 2, resource: state.v!.createView() },
      { binding: 3, resource: state.sampler },
    ],
  });

  const encoder = state.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: state.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.setPipeline(state.pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(6);
  pass.end();
  state.device.queue.submit([encoder.finish()]);
}

function ensurePlaneTextures(state: WebGpuState, width: number, height: number): void {
  if (state.width === width && state.height === height && state.y && state.u && state.v) {
    return;
  }
  state.y?.destroy();
  state.u?.destroy();
  state.v?.destroy();
  const uvWidth = Math.max(1, Math.ceil(width / 2));
  const uvHeight = Math.max(1, Math.ceil(height / 2));
  state.y = createR8Texture(state.device, width, height);
  state.u = createR8Texture(state.device, uvWidth, uvHeight);
  state.v = createR8Texture(state.device, uvWidth, uvHeight);
  state.width = width;
  state.height = height;
}

function createR8Texture(device: GpuDevice, width: number, height: number): GpuTexture {
  return device.createTexture({
    size: { width, height },
    format: 'r8unorm',
    usage: 0x04 | 0x02, // TEXTURE_BINDING | COPY_DST
  });
}

function uploadPlanes(
  state: WebGpuState,
  frame: DecodedVideoFrame,
  width: number,
  height: number,
): void {
  const planes = normalizeI420Planes(frame, width, height);
  writeR8Plane(state, state.y!, planes.y, width, height, planes.yStride);
  writeR8Plane(
    state,
    state.u!,
    planes.u,
    planes.uvWidth,
    planes.uvHeight,
    planes.uStride,
  );
  writeR8Plane(
    state,
    state.v!,
    planes.v,
    planes.uvWidth,
    planes.uvHeight,
    planes.vStride,
  );
}

function writeR8Plane(
  state: WebGpuState,
  texture: GpuTexture,
  source: Uint8Array,
  width: number,
  height: number,
  stride: number,
): void {
  const packed = packPlane(source, width, height, stride);
  state.device.queue.writeTexture(
    { texture },
    packed,
    { bytesPerRow: width, rowsPerImage: height },
    { width, height },
  );
}

function packPlane(
  source: Uint8Array,
  width: number,
  height: number,
  stride: number,
): Uint8Array {
  if (stride === width) {
    return source.subarray(0, width * height);
  }
  const packed = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    packed.set(
      source.subarray(row * stride, row * stride + width),
      row * width,
    );
  }
  return packed;
}

function normalizeI420Planes(
  frame: DecodedVideoFrame,
  width: number,
  height: number,
): {
  y: Uint8Array;
  u: Uint8Array;
  v: Uint8Array;
  yStride: number;
  uStride: number;
  vStride: number;
  uvWidth: number;
  uvHeight: number;
} {
  const uvWidth = Math.max(1, Math.ceil(width / 2));
  const uvHeight = Math.max(1, Math.ceil(height / 2));

  if (frame.format === 'I420' || frame.format === 'NV12') {
    if (frame.format === 'NV12') {
      const yPlane = frame.planes[0] ?? new Uint8Array(width * height);
      const uvPlane = frame.planes[1] ?? new Uint8Array(uvWidth * uvHeight * 2);
      const yStride = frame.strides[0] ?? width;
      const uvStride = frame.strides[1] ?? uvWidth * 2;
      const u = new Uint8Array(uvWidth * uvHeight);
      const v = new Uint8Array(uvWidth * uvHeight);
      for (let row = 0; row < uvHeight; row++) {
        for (let col = 0; col < uvWidth; col++) {
          const index = row * uvStride + col * 2;
          u[row * uvWidth + col] = uvPlane[index] ?? 128;
          v[row * uvWidth + col] = uvPlane[index + 1] ?? 128;
        }
      }
      return {
        y: yPlane,
        u,
        v,
        yStride,
        uStride: uvWidth,
        vStride: uvWidth,
        uvWidth,
        uvHeight,
      };
    }

    return {
      y: frame.planes[0] ?? new Uint8Array(width * height),
      u: frame.planes[1] ?? new Uint8Array(uvWidth * uvHeight),
      v: frame.planes[2] ?? new Uint8Array(uvWidth * uvHeight),
      yStride: frame.strides[0] ?? width,
      uStride: frame.strides[1] ?? uvWidth,
      vStride: frame.strides[2] ?? uvWidth,
      uvWidth,
      uvHeight,
    };
  }

  // RGBA8 / BGRA8 → synthesize grayscale I420-ish planes for the shader path
  const rgba = frame.planes[0] ?? new Uint8Array(width * height * 4);
  const stride = frame.strides[0] ?? width * 4;
  const y = new Uint8Array(width * height);
  const u = new Uint8Array(uvWidth * uvHeight);
  const v = new Uint8Array(uvWidth * uvHeight);
  const isBgra = frame.format === 'BGRA8';
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const offset = row * stride + col * 4;
      const r = rgba[offset + (isBgra ? 2 : 0)] ?? 0;
      const g = rgba[offset + 1] ?? 0;
      const b = rgba[offset + (isBgra ? 0 : 2)] ?? 0;
      y[row * width + col] = Math.max(0, Math.min(255, (66 * r + 129 * g + 25 * b + 128) >> 8) + 16);
    }
  }
  u.fill(128);
  v.fill(128);
  return {
    y,
    u,
    v,
    yStride: width,
    uStride: uvWidth,
    vStride: uvWidth,
    uvWidth,
    uvHeight,
  };
}

function createCanvas2dRenderer(canvas: HTMLCanvasElement): YuvCanvasRenderer {
  return {
    backend: 'canvas2d',
    draw(frame) {
      const width = Math.max(1, frame.displayWidth);
      const height = Math.max(1, frame.displayHeight);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext('2d');
      if (!context) return;
      const planes = normalizeI420Planes(frame, width, height);
      const image = context.createImageData(width, height);
      const rgba = image.data;
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const y = planes.y[row * planes.yStride + col] ?? 0;
          const u = planes.u[
            Math.floor(row / 2) * planes.uStride + Math.floor(col / 2)
          ] ?? 128;
          const v = planes.v[
            Math.floor(row / 2) * planes.vStride + Math.floor(col / 2)
          ] ?? 128;
          const c = y - 16;
          const d = u - 128;
          const e = v - 128;
          const index = (row * width + col) * 4;
          rgba[index] = clampByte((298 * c + 409 * e + 128) >> 8);
          rgba[index + 1] = clampByte((298 * c - 100 * d - 208 * e + 128) >> 8);
          rgba[index + 2] = clampByte((298 * c + 516 * d + 128) >> 8);
          rgba[index + 3] = 255;
        }
      }
      context.putImageData(image, 0, 0);
    },
    destroy() {
      rendererCache.delete(canvas);
    },
  };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}
