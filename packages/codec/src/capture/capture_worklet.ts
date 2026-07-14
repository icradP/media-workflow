/** Inline AudioWorklet for device capture recording (no ScriptProcessor). */
export const CAPTURE_WORKLET_NAME = 'pcm-capture-processor';

export const CAPTURE_WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = true;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'stop') this.recording = false;
    };
  }

  process(inputs) {
    if (!this.recording) return false;
    const input = inputs[0];
    if (!input || !input.length || !input[0]) return true;
    const frames = input[0].length;
    const channels = input.length;
    const planes = [];
    for (let c = 0; c < channels; c++) {
      planes.push(input[c].slice(0, frames));
    }
    this.port.postMessage({ type: 'chunk', planes, frames }, planes.map((p) => p.buffer));
    return true;
  }
}

registerProcessor('${CAPTURE_WORKLET_NAME}', PcmCaptureProcessor);
`;
