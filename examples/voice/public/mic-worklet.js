// Runs in the audio thread. The AudioContext is created at 24 kHz, so the browser
// already resamples the mic; this only cuts it into 20 ms frames of PCM16.
class MicFrames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(480); // 20 ms at 24 kHz
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      this.frame[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === this.frame.length) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(480);
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor("mic-frames", MicFrames);
