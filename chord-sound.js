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

  // Damp the previous chord quickly, like a hand re-striking the strings
  function dampRinging(now) {
    ringing.forEach(v => {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, 0.03);
      v.source.stop(now + 0.3);
    });
    ringing = [];
  }

  // ---------- piano ----------

  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function pitchClass(name) {
    let n = NOTE[name[0]];
    if (name[1] === "#") n++;
    if (name[1] === "b") n--;
    return (n + 12) % 12;
  }

  // Notes of a chord from its name, as semitones above the root: "Am9" -> [0, 3, 7, 10, 14]
  function chordTones(name) {
    const m = name.trim().match(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/);
    if (!m) return null;
    let q = m[2];
    const tones = new Set([0]);
    let third = 4, fifth = 7, dim = false;
    if (/^(min|m)(?!aj)/.test(q)) { third = 3; q = q.replace(/^(min|m)/, ""); }
    if (/^dim/.test(q)) { third = 3; fifth = 6; dim = true; q = q.replace(/^dim/, ""); if (/^7/.test(q)) tones.add(9); }
    if (/^(aug|\+)/.test(q)) { fifth = 8; q = q.replace(/^(aug|\+)/, ""); }
    if (/sus2/.test(q)) third = 2;
    else if (/sus/.test(q)) third = 5;
    if (/b5/.test(q)) fifth = 6;
    if (/maj(7|9|11|13)/.test(q)) tones.add(11);
    else if (!dim && /(^|[^d])(7|9|11|13)/.test(q.replace(/add\d+/, ""))) tones.add(10);
    if (/9/.test(q)) tones.add(14);
    if (/11/.test(q)) tones.add(17);
    if (/13/.test(q)) tones.add(21);
    if (/(^|[^1])6/.test(q)) tones.add(9);
    tones.add(third);
    tones.add(fifth);
    return { root: pitchClass(m[1]), bass: m[3] ? pitchClass(m[3]) : null, tones: [...tones].sort((a, b) => a - b) };
  }

  // MIDI notes to play: the bass note low down, the chord close together around middle C
  function pianoVoicing(name) {
    const c = chordTones(name);
    if (!c) return null;
    const bass = 36 + (c.bass != null ? c.bass : c.root);   // C2..B2
    let base = 48 + c.root;                                   // C3..B3
    if (base < 52) base += 12;                                // keep it out of the mud
    return [bass].concat(c.tones.map(t => base + t));
  }

  // One piano note: overtones that fade at different rates, a soft hammer knock, slightly stretched tuning
  const pianoCache = {};
  function pianoBuffer(midi) {
    if (pianoCache[midi]) return pianoCache[midi];
    const sr = ctx.sampleRate;
    const freq = midiToFreq(midi);
    const length = 2.4;
    const n = Math.floor(sr * length);
    const buf = ctx.createBuffer(1, n, sr);
    const y = buf.getChannelData(0);
    const pitchFactor = Math.sqrt(freq / 261.6);   // higher notes die away sooner
    const partials = [];
    for (let h = 1; h <= 8; h++) {
      const pf = freq * h * Math.sqrt(1 + 0.0004 * h * h);
      if (pf > sr / 2 - 1000) break;
      partials.push({ w: 2 * Math.PI * pf / sr, amp: 1 / Math.pow(h, 1.4), decay: (0.9 + h * 0.55) * pitchFactor / sr });
    }
    let peak = 0;
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (const p of partials) v += p.amp * Math.sin(p.w * i) * Math.exp(-p.decay * i);
      const attack = Math.min(1, i / (sr * 0.004));
      y[i] = v * attack;
      if (Math.abs(y[i]) > peak) peak = Math.abs(y[i]);
    }
    // Hammer: a short, softened noise burst
    let last = 0;
    const knock = Math.floor(sr * 0.012);
    for (let i = 0; i < knock; i++) {
      last = 0.35 * (Math.random() * 2 - 1) + 0.65 * last;
      y[i] += last * 0.25 * peak * (1 - i / knock);
    }
    for (let i = 0; i < n; i++) y[i] /= peak || 1;
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < fade; i++) y[n - 1 - i] *= i / fade;
    pianoCache[midi] = buf;
    return buf;
  }

  function playPiano(chord) {
    const notes = pianoVoicing(chord);
    if (!notes) return false;
    audio();
    const now = ctx.currentTime + 0.01;
    dampRinging(now);
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3500;
    tone.connect(master);
    notes.forEach((midi, k) => {
      // Each note on two very slightly detuned "strings", played almost together
      [-2, 2].forEach(detune => {
        const source = ctx.createBufferSource();
        source.buffer = pianoBuffer(midi);
        source.detune.value = detune;
        const gain = ctx.createGain();
        gain.gain.value = (k === 0 ? 0.55 : 0.4) / Math.sqrt(notes.length);
        source.connect(gain);
        gain.connect(tone);
        source.start(now + k * 0.006);
        ringing.push({ source, gain });
      });
    });
    return true;
  }

  // Build the piano notes for some chords ahead of time, a little at a time, so the first chord isn't late
  function prepare(chords, instrument) {
    if (instrument !== "piano") return;
    audio();
    const queue = [];
    chords.forEach(c => (pianoVoicing(c) || []).forEach(m => { if (!queue.includes(m)) queue.push(m); }));
    const step = () => {
      const m = queue.shift();
      if (m == null) return;
      pianoBuffer(m);
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  // ---------- guitar / mandolin ----------

  function play(chord, instrument) {
    if (instrument === "piano") return playPiano(chord);
    const inst = INSTRUMENTS[instrument];
    const shapes = (typeof CHORD_SHAPES !== "undefined" && CHORD_SHAPES[instrument]) || {};
    // Chords we have no shape for (e.g. Am9) play their nearest simpler chord (Am7, then Am)
    const candidates = typeof ChordChart !== "undefined" ? ChordChart.fallbacks(chord) : [chord];
    const match = candidates.map(shapeName).find(name => shapes[name]);
    const frets = match && shapes[match];
    if (!inst || !frets) return false;

    audio();
    const now = ctx.currentTime + 0.01;

    dampRinging(now);

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

  return { play, prepare, chordTones };
})();
