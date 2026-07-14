/**
 * AudioWorkletProcessor for the PCM sample ring.
 * Loaded via Blob URL — must stay self-contained (no imports).
 *
 * Register name: "pcm-ring-processor"
 */
export const PCM_RING_WORKLET_NAME = 'pcm-ring-processor';

/** Inline worklet source (AudioWorkletGlobalScope). */
export const PCM_RING_WORKLET_SOURCE = `
class PcmRingCore {
  constructor(options) {
    this.capacitySamples = Math.max(1, options.capacitySamples | 0);
    this.channels = Math.max(1, options.channels | 0);
    this.underrunPolicy = options.underrunPolicy || 'silence';
    this.overrunPolicy = options.overrunPolicy || 'drop_oldest';
    this.loop = options.loop !== false;
    this.planes = [];
    for (let c = 0; c < this.channels; c++) {
      this.planes.push(new Float32Array(this.capacitySamples));
    }
    this.writePos = 0;
    this.readPos = 0;
    this.filled = 0;
    this.loopSnapshot = null;
    this.loopLength = 0;
    this.loopRead = 0;
    this.underrunCount = 0;
    this.overrunCount = 0;
    this.rate = Math.max(0.05, options.rate || 1);
    this.fillMode = options.fillMode || 'static_once';
    this.srcCursor = 0;
  }

  available() { return this.filled; }

  free() { return this.capacitySamples - this.filled; }

  clear() {
    this.writePos = 0;
    this.readPos = 0;
    this.filled = 0;
    this.srcCursor = 0;
  }

  setLoopSnapshot(planes, sampleCount) {
    const count = Math.max(0, Math.min(sampleCount, planes[0] ? planes[0].length : 0));
    this.loopLength = count;
    this.loopRead = 0;
    this.loopSnapshot = [];
    for (let c = 0; c < this.channels; c++) {
      const src = planes[Math.min(c, planes.length - 1)] || new Float32Array(count);
      this.loopSnapshot.push(src.slice(0, count));
    }
  }

  fillFromPlanes(planes, sampleCount) {
    const count = Math.min(this.capacitySamples, sampleCount);
    this.clear();
    const slices = [];
    for (let c = 0; c < this.channels; c++) {
      const src = planes[Math.min(c, planes.length - 1)] || new Float32Array(count);
      slices.push(src.subarray(0, count));
    }
    const written = this.writePlanar(slices, count);
    if (this.loop) this.setLoopSnapshot(slices, count);
    return written;
  }

  writePlanar(planes, sampleCount) {
    let remaining = Math.max(0, sampleCount | 0);
    let srcOffset = 0;
    let written = 0;
    while (remaining > 0) {
      let free = this.free();
      if (free === 0) {
        if (this.overrunPolicy === 'drop_newest') {
          this.overrunCount += remaining;
          break;
        }
        if (this.overrunPolicy === 'block_producer') break;
        const drop = Math.min(this.filled, Math.max(remaining, (this.capacitySamples / 4) | 0));
        this.discard(drop);
        this.overrunCount += drop;
        free = this.free();
        if (free === 0) break;
      }
      const chunk = Math.min(remaining, free, this.capacitySamples - this.writePos);
      for (let c = 0; c < this.channels; c++) {
        const dest = this.planes[c];
        const src = planes[Math.min(c, planes.length - 1)];
        for (let i = 0; i < chunk; i++) {
          dest[this.writePos + i] = src[srcOffset + i] || 0;
        }
      }
      this.writePos = (this.writePos + chunk) % this.capacitySamples;
      this.filled += chunk;
      srcOffset += chunk;
      remaining -= chunk;
      written += chunk;
    }
    return written;
  }

  discard(count) {
    const n = Math.min(Math.max(0, count), this.filled);
    this.readPos = (this.readPos + n) % this.capacitySamples;
    this.filled -= n;
  }

  refillFromLoop() {
    if (!this.loopSnapshot || this.loopLength <= 0) return false;
    this.underrunCount++;
    if (this.free() <= 0) this.discard(Math.min(this.filled, (this.capacitySamples / 2) | 0));
    const chunk = Math.min(this.loopLength, this.free());
    if (chunk <= 0) return false;
    const slices = [];
    for (let c = 0; c < this.channels; c++) {
      const plane = this.loopSnapshot[c];
      const out = new Float32Array(chunk);
      for (let i = 0; i < chunk; i++) {
        out[i] = plane[(this.loopRead + i) % this.loopLength] || 0;
      }
      slices.push(out);
    }
    this.loopRead = (this.loopRead + chunk) % this.loopLength;
    return this.writePlanar(slices, chunk) > 0;
  }

  readPlanarInto(outputs, frames) {
    const playbackRate = Math.max(0.05, this.rate);
    let produced = 0;
    for (let frame = 0; frame < frames; frame++) {
      while (this.filled <= 0) {
        if (this.underrunPolicy === 'wait') {
          for (let c = 0; c < outputs.length; c++) {
            if (outputs[c]) outputs[c].fill(0, frame);
          }
          return produced;
        }
        if (this.underrunPolicy === 'silence') {
          this.underrunCount++;
          for (let c = 0; c < this.channels; c++) {
            if (outputs[c]) outputs[c][frame] = 0;
          }
          produced++;
          this.srcCursor = 0;
          break;
        }
        if (!this.refillFromLoop()) {
          this.underrunCount++;
          for (let c = 0; c < this.channels; c++) {
            if (outputs[c]) outputs[c][frame] = 0;
          }
          produced++;
          break;
        }
      }
      if (this.filled <= 0) continue;
      const idx = this.readPos;
      for (let c = 0; c < this.channels; c++) {
        if (outputs[c]) outputs[c][frame] = this.planes[c][idx] || 0;
      }
      produced++;
      this.srcCursor += playbackRate;
      const consume = Math.max(1, this.srcCursor | 0);
      this.srcCursor -= consume;
      this.discard(Math.min(consume, this.filled));
    }
    return produced;
  }

  writeFromInputs(inputs, frames) {
    if (this.fillMode !== 'continuous') return 0;
    const planes = [];
    for (let c = 0; c < this.channels; c++) {
      const src = inputs[Math.min(c, inputs.length - 1)];
      planes.push(src || new Float32Array(frames));
    }
    return this.writePlanar(planes, frames);
  }
}

class PcmRingProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.ring = new PcmRingCore(opts);
    this.port.onmessage = (event) => this.onMessage(event.data);
  }

  onMessage(data) {
    if (!data || !data.type) return;
    if (data.type === 'configure') {
      this.ring.fillMode = data.fillMode || this.ring.fillMode;
      this.ring.underrunPolicy = data.underrunPolicy || this.ring.underrunPolicy;
      this.ring.overrunPolicy = data.overrunPolicy || this.ring.overrunPolicy;
      this.ring.loop = data.loop !== false;
      if (typeof data.rate === 'number') this.ring.rate = Math.max(0.05, data.rate);
    } else if (data.type === 'setRate') {
      this.ring.rate = Math.max(0.05, data.rate || 1);
    } else if (data.type === 'fill') {
      const planes = data.planes || [];
      this.ring.fillFromPlanes(planes, data.sampleCount || 0);
      this.port.postMessage({
        type: 'filled',
        available: this.ring.available(),
      });
    } else if (data.type === 'clear') {
      this.ring.clear();
    } else if (data.type === 'stats') {
      this.port.postMessage({
        type: 'stats',
        available: this.ring.available(),
        underruns: this.ring.underrunCount,
        overruns: this.ring.overrunCount,
      });
    }
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    if (!output.length || !output[0]) return true;
    const frames = output[0].length;
    this.ring.writeFromInputs(input, frames);

    // Ensure enough planar outs for ring channel count
    const outs = [];
    for (let c = 0; c < this.ring.channels; c++) {
      outs.push(output[Math.min(c, output.length - 1)]);
    }
    this.ring.readPlanarInto(outs, frames);

    // Mirror channel 0 into remaining output channels if mono ring / multi out
    for (let c = this.ring.channels; c < output.length; c++) {
      if (output[c] && outs[0]) output[c].set(outs[0]);
    }
    return true;
  }
}

registerProcessor('${PCM_RING_WORKLET_NAME}', PcmRingProcessor);
`;
