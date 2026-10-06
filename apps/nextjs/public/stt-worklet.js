/**
 * Audio worklet: forward raw microphone frames to the main thread.
 *
 * Runs on the audio render thread and does nothing but hand each 128-sample
 * mono frame back — the main thread buffers, resamples to 16kHz, encodes to
 * linear16 and streams it to the STT relay. Kept this dumb on purpose: the less
 * that happens on the render thread, the less chance of audio glitches.
 *
 * Served from /public so it loads with `audioWorklet.addModule("/stt-worklet.js")`.
 */
class PCMForwarder extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      // Copy — the input buffer is reused by the engine after this returns.
      this.port.postMessage(channel.slice(0));
    }
    // Keep the processor alive even when the graph is otherwise idle.
    return true;
  }
}

registerProcessor("pcm-forwarder", PCMForwarder);
