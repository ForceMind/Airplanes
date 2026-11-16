// Original procedural audio; no downloaded sound assets or network calls.
export function createAudio() {
  let context = null, master = null, engine = null, engineGain = null, enabled = false, lastShot = 0;
  function ensure() {
    if (context) return true;
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return false;
    context = new AudioContext();
    master = context.createGain(); master.gain.value = 0; master.connect(context.destination);
    engine = context.createOscillator(); engine.type = 'sawtooth'; engine.frequency.value = 50;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 190;
    engineGain = context.createGain(); engineGain.gain.value = 0;
    engine.connect(filter); filter.connect(engineGain); engineGain.connect(master); engine.start();
    return true;
  }
  function setEnabled(next) {
    try {
      if (!ensure()) return false;
      enabled = !!next;
      if (enabled) context.resume().catch(() => {});
      master.gain.setTargetAtTime(enabled ? .22 : 0, context.currentTime, .1);
      return enabled;
    } catch { enabled = false; return false; }
  }
  function flight(speed, active) {
    if (!context || !enabled) return;
    engine.frequency.setTargetAtTime(35 + Math.min(220, speed || 0) * .24, context.currentTime, .2);
    engineGain.gain.setTargetAtTime(active ? .17 : 0, context.currentTime, .12);
  }
  function effect(type) {
    if (!context || !enabled) return;
    const now = context.currentTime;
    if (type === 'shot' && now - lastShot < .1) return;
    if (type === 'shot') lastShot = now;
    const length = type === 'explosion' ? .42 : .07;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * length), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    const source = context.createBufferSource(); source.buffer = buffer;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = type === 'explosion' ? 480 : 2200;
    const gain = context.createGain(); gain.gain.value = type === 'explosion' ? .8 : .32;
    source.connect(filter); filter.connect(gain); gain.connect(master); source.start();
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  return { setEnabled, flight, effect, get enabled() { return enabled; } };
}
