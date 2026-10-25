// Plays a strummed chord using a synthesised plucked string (Karplus-Strong).
// No sound files: each string's note is generated once, then cached.

const ChordSound = (function () {
  // Open-string MIDI notes, low to high
  const INSTRUMENTS = {
    // brightness: how sharp the pluck is (lower = softer); lowpass: tone cutoff in Hz; strumGap: seconds between strings
    guitar:   { tuning: [40, 45, 50, 55, 59, 64], sustain: 3.0, length: 2.5, brightness: 0.3, courses: 1, strumGap: 0.009, lowpass: 3000 },
    // Mandolin strings come in pairs, so each note is played twice, slightly out of tune with itself
    mandolin: { tuning: [55, 62, 69, 76],         sustain: 1.4, length: 1.6, brightness: 0.5, courses: 2, strumGap: 0.011, lowpass: 4500 }
  };
  const FLAT_TO_SHARP = { Db: "Cs", Eb: "Ds", Gb: "Fs", Ab: "Gs", Bb: "As" };

  let ctx = null, master = null;
  let ringing = []; // voices from the last strum, cut short by the next one
  const bufferCache = {};

  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const compressor = ctx.createDynamicsCompressor();
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(compressor);
      compressor.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // One plucked note: a burst of noise fed round a delay loop one period long.
  // Averaging neighbouring samples each pass makes the high end die away like a real string.
  function pluckBuffer(freq, inst) {
    const id = freq.toFixed(3) + inst.sustain + inst.brightness;
    if (bufferCache[id]) return bufferCache[id];

    const sr = ctx.sampleRate;
    const n = Math.floor(sr * inst.length);
    const buf = ctx.createBuffer(1, n, sr);
    const y = buf.getChannelData(0);

    const period = sr / freq;
    const delay = period - 0.5;                       // the averaging adds half a sample of delay
    const loss = Math.pow(0.001, 1 / (inst.sustain * freq)); // fades to -60dB after `sustain` seconds

    // Excitation: noise, softened for a warmer pluck (less brightness = more smoothing)
    const start = Math.ceil(period) + 2;
    let last = 0;
    for (let i = 0; i < start && i < n; i++) {
      const noise = Math.random() * 2 - 1;
      last = inst.brightness * noise + (1 - inst.brightness) * last;
      y[i] = last;
    }

    // Read the loop at a fractional position so high notes stay in tune
    const at = t => {
      const i = Math.floor(t), f = t - i;
      return i < 0 ? 0 : y[i] * (1 - f) + y[i + 1] * f;
    };
    for (let i = start; i < n; i++) {
      const t = i - delay;
      y[i] = loss * 0.5 * (at(t) + at(t - 1));
    }

    // Short fade at the end so the buffer doesn't click when it runs out
    const fade = Math.min(n, Math.floor(sr * 0.05));
    for (let i = 0; i < fade; i++) y[n - 1 - i] *= i / fade;

    bufferCache[id] = buf;
    return buf;
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // "F#m" / "Gbm" / "Fsm" -> the shape name used in CHORD_SHAPES
  function shapeName(chord) {
    let name = chord.trim().replace("#", "s");
    const flat = name.slice(0, 2);
    if (FLAT_TO_SHARP[flat]) name = FLAT_TO_SHARP[flat] + name.slice(2);
    return name;
  }

  function play(chord, instrument) {
    const inst = INSTRUMENTS[instrument];
    const shapes = (typeof CHORD_SHAPES !== "undefined" && CHORD_SHAPES[instrument]) || {};
    const frets = shapes[shapeName(chord)];
    if (!inst || !frets) return false;

    audio();
    const now = ctx.currentTime + 0.01;

    // Damp the previous strum quickly, like a hand re-striking the strings
    ringing.forEach(v => {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, 0.03);
      v.source.stop(now + 0.3);
    });
    ringing = [];

    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = inst.lowpass;
    tone.connect(master);

    const played = frets.filter(f => f >= 0).length;
    let k = 0;
    frets.forEach((fret, string) => {
      if (fret < 0) return;
      const freq = midiToFreq(inst.tuning[string] + fret);
      const when = now + k * inst.strumGap;
      k++;
      for (let c = 0; c < inst.courses; c++) {
        // Paired strings: about 3 cents apart, which gives the mandolin shimmer
        const detune = inst.courses > 1 ? (c === 0 ? -3 : 3) : 0;
        const source = ctx.createBufferSource();
        source.buffer = pluckBuffer(freq, inst);
        source.detune.value = detune;
        const gain = ctx.createGain();
        gain.gain.value = 0.9 / Math.sqrt(played * inst.courses);
        source.connect(gain);
        gain.connect(tone);
        source.start(when + c * 0.004);
        ringing.push({ source, gain });
      }
    });
    return true;
  }

  return { play };
})();
