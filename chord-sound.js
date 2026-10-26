// Plays a strummed chord using a synthesised plucked string (Karplus-Strong).
// No sound files: each string's note is generated once, then cached.

const ChordSound = (function () {
  // Open-string MIDI notes, low to high
  const INSTRUMENTS = {
    // brightness: how sharp the pluck is (lower = softer); lowpass: tone cutoff in Hz; strumGap: seconds between strings
    guitar:   { tuning: [40, 45, 50, 55, 59, 64], sustain: 3.0, length: 2.5, brightness: 0.3, courses: 1, strumGap: 0.009, lowpass: 3000 },
    // Mandolin strings come in pairs, so each note is played twice, slightly out of tune with itself
    mandolin: { tuning: [55, 62, 69, 76],         sustain: 1.9, length: 2.1, brightness: 0.7, courses: 2, strumGap: 0.013, lowpass: 7000 }
  };
  const FLAT_TO_SHARP = { Db: "Cs", Eb: "Ds", Gb: "Fs", Ab: "Gs", Bb: "As" };

  let ctx = null, master = null;
  let volume = 1; // backing volume, 0..1 (set by the slider)
  const MASTER_LEVEL = 0.8;
  let ringing = []; // voices from the last strum, cut short by the next one
  const bufferCache = {};

  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const compressor = ctx.createDynamicsCompressor();
      master = ctx.createGain();
      master.gain.value = MASTER_LEVEL * volume;
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

  // Strike some piano notes at `when`; returns the voices so they can be damped later
  function pianoStrike(midis, when, level, out) {
    const voices = [];
    midis.forEach((midi, k) => {
      // Each note on two very slightly detuned "strings", played almost together
      [-2, 2].forEach(detune => {
        const source = ctx.createBufferSource();
        source.buffer = pianoBuffer(midi);
        source.detune.value = detune;
        const gain = ctx.createGain();
        gain.gain.value = level;
        source.connect(gain);
        gain.connect(out);
        source.start(when + k * 0.006);
        const voice = { source, gain };
        ringing.push(voice);
        voices.push(voice);
      });
    });
    return voices;
  }

  function playPiano(chord, rhythm) {
    const notes = pianoVoicing(chord);
    if (!notes) return false;
    audio();
    const now = ctx.currentTime + 0.01;
    dampRinging(now);
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3500;
    tone.connect(master);
    const n = Math.sqrt(notes.length);

    // Rhythm: bass note on the beat (root, then the fifth below), chord on the off-beat ("oom-pah")
    const hits = rhythm && !rhythm.held ? grooveHits(rhythm, now) : [];
    if (hits.length) {
      const bass = notes[0], upper = notes.slice(1);
      let previous = [];
      hits.forEach(hit => {
        damp(previous, hit.when, 0.05);
        previous = hit.kind === "bass"
          ? pianoStrike([hit.beat % 2 ? bass + 7 : bass], hit.when, hit.beat === 0 ? 0.5 : 0.42, tone)
          : pianoStrike(upper, hit.when, 0.36 / Math.sqrt(upper.length), tone);
      });
      return true;
    }

    pianoStrike([notes[0]], now, 0.55 / n, tone);
    pianoStrike(notes.slice(1), now + 0.006, 0.4 / n, tone);
    return true;
  }

  // ---------- concertina ----------

  // Free reeds: a bright, buzzy tone with every harmonic present (odd ones a little stronger)
  let reedWave = null;
  function reed() {
    if (!reedWave) {
      const count = 20;
      const real = new Float32Array(count + 1), imag = new Float32Array(count + 1);
      for (let h = 1; h <= count; h++) imag[h] = (h % 2 ? 1 : 0.6) / Math.pow(h, 1.1);
      reedWave = ctx.createPeriodicWave(real, imag);
    }
    return reedWave;
  }

  // The chord's notes (up to the 7th) close together between G3 and F#5, with the root an octave below
  function concertinaVoicing(name) {
    const c = chordTones(name);
    if (!c) return null;
    const base = 55 + (c.root - 7 + 12) % 12;                       // G3..F#4
    const bass = c.bass != null ? 43 + (c.bass - 7 + 12) % 12 : base - 12;
    return [bass].concat(c.tones.filter(t => t < 12).map(t => base + t));
  }

  // Where the bass notes and chord stabs fall in a bar, by tune type, as fractions of a beat.
  // Off-beats are pushed a little late in reels and hornpipes for a swung, jaunty feel.
  const GROOVES = {
    reel:        { beats: 2, hits: [[0, "bass"], [0.54, "chord"]] },
    march:       { beats: 2, hits: [[0, "bass"], [0.5, "chord"]] },
    polka:       { beats: 2, hits: [[0, "bass"], [0.5, "chord"]] },
    hornpipe:    { beats: 2, hits: [[0, "bass"], [0.64, "chord"]] },
    barndance:   { beats: 2, hits: [[0, "bass"], [0.62, "chord"]] },
    strathspey:  { beats: 2, hits: [[0, "bass"], [0.66, "chord"]] },
    jig:         { beats: 2, hits: [[0, "bass"], [2 / 3, "chord"]] },
    "slip jig":  { beats: 3, hits: [[0, "bass"], [2 / 3, "chord"]] },
    slide:       { beats: 4, hits: [[0, "bass"], [2 / 3, "chord"]] },
    "three-two": { beats: 3, hits: [[0, "bass"], [0.55, "chord"]] },
    waltz:       { beats: 1, hits: [[0, "bass"], [1 / 3, "chord"], [2 / 3, "chord"]] },
    mazurka:     { beats: 1, hits: [[0, "bass"], [1 / 3, "chord"], [2 / 3, "chord"]] }
  };

  // The hits (bass on the beat, chord on the off-beat) that fall in the rest of the current chord.
  // rhythm: { barSeconds, frac (where in the bar we are now), from, to (the chord's span in the bar), type }
  // Each hit: { when (audio time), kind: "bass"|"chord", beat (0 = first beat of the bar), gap (seconds to the next hit) }
  function grooveHits(rhythm, now) {
    if (!rhythm || !(rhythm.barSeconds > 0.2)) return [];
    const groove = GROOVES[(rhythm.type || "").toLowerCase()] || GROOVES.reel;
    const beatSeconds = rhythm.barSeconds / groove.beats;
    const hits = [];
    for (let b = 0; b < groove.beats; b++) {
      groove.hits.forEach(([at, kind], h) => {
        const f = (b + at) / groove.beats;                       // position in the bar
        if (f < rhythm.from - 0.02 || f >= rhythm.to - 0.001) return;
        const delay = (f - rhythm.frac) * rhythm.barSeconds;
        if (delay < -0.08) return;                               // already gone by
        const nextAt = h + 1 < groove.hits.length ? groove.hits[h + 1][0] : 1;
        hits.push({ when: now + Math.max(0, delay), kind, beat: b, gap: (nextAt - at) * beatSeconds });
      });
    }
    return hits;
  }

  // Quickly quieten earlier voices at `when` (a hand re-striking or lifting off)
  function damp(voices, when, speed = 0.03) {
    voices.forEach(v => {
      v.gain.gain.setTargetAtTime(0, when, speed);
      v.source.stop(when + 0.3);
    });
  }

  // One short reed note, scheduled at `when`
  // decay (optional): instead of holding for `length`, die away gradually like a piano note
  // (seconds to fall to about a third; the next chord still cuts it off)
  function reedNote(midi, when, length, level, out, decay) {
    const source = ctx.createOscillator();
    source.setPeriodicWave(reed());
    source.frequency.value = midiToFreq(midi);
    source.detune.value = Math.random() * 4 - 2;   // reeds are never perfectly matched
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + 0.012);
    if (decay) {
      gain.gain.setTargetAtTime(0, when + 0.012, decay);
      length = decay * 6; // inaudible by then
    } else {
      gain.gain.setTargetAtTime(level * 0.75, when + 0.012, 0.06);  // a little push of the bellows, then settle
      gain.gain.setTargetAtTime(0, when + length, 0.09);
    }
    source.connect(gain);
    gain.connect(out);
    source.start(when);
    source.stop(when + length + 0.5);
    ringing.push({ source, gain });
  }

  // Bass on the beat (root, then the fifth below on the next beat), short chord stabs on the off-beats.
  // rhythm: { barSeconds, frac (where in the bar we are now), from, to (the chord's span in the bar), type }
  // Without rhythm (e.g. trying the sound) it plays one short bass + chord.
  function playConcertina(chord, rhythm) {
    const notes = concertinaVoicing(chord);
    if (!notes) return false;
    audio();
    const now = ctx.currentTime + 0.01;
    dampRinging(now);
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2600;
    tone.Q.value = 0.5;
    tone.connect(master);
    const bass = notes[0], upper = notes.slice(1);
    const chordLevel = 0.3 / Math.sqrt(upper.length);
    const stab = (when, length) => upper.forEach(m => reedNote(m, when, length, chordLevel, tone));

    // Rhythm off: one chord (bass softly underneath) that dies away like the piano, a little slower
    if (rhythm && rhythm.held) {
      const decay = 1.0;
      reedNote(bass, now, 0, 0.12, tone, decay);
      upper.forEach(m => reedNote(m, now, 0, chordLevel, tone, decay));
      return true;
    }

    if (!rhythm || !(rhythm.barSeconds > 0.2)) {
      reedNote(bass, now, 0.35, 0.34, tone);
      stab(now + 0.2, 0.3);
      return true;
    }

    grooveHits(rhythm, now).forEach(hit => {
      const length = Math.max(0.06, hit.gap * (hit.kind === "bass" ? 0.9 : 0.85));
      if (hit.kind === "bass") reedNote(hit.beat % 2 ? bass - 5 : bass, hit.when, length, hit.beat === 0 ? 0.14 : 0.11, tone);
      else stab(hit.when, length);
    });
    return true;
  }

  // Metronome tick `delay` seconds from now: a short, soft blip, higher on the first beat of the bar
  function click(delay, accent) {
    audio();
    const when = ctx.currentTime + 0.01 + Math.max(0, delay);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = accent ? 1760 : 1320;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, when + 0.002);
    gain.gain.setTargetAtTime(0, when + 0.002, 0.012);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + 0.1);
  }

  // Cut off whatever is sounding (e.g. the video was paused)
  function stop() {
    if (ctx) dampRinging(ctx.currentTime);
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

  function play(chord, instrument, rhythm) {
    if (instrument === "piano") return playPiano(chord, rhythm);
    if (instrument === "concertina") return playConcertina(chord, rhythm);
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

    // Rhythm: a full down-strum on the beat, a lighter up-strum across the top strings on the off-beat
    const hits = rhythm && !rhythm.held ? grooveHits(rhythm, now) : [];
    if (hits.length) {
      let previous = [];
      hits.forEach(hit => {
        damp(previous, hit.when, 0.04);
        previous = hit.kind === "bass"
          ? strum(frets, inst, hit.when, tone, { level: hit.beat === 0 ? 1 : 0.85 })
          : strum(frets, inst, hit.when, tone, { up: true, top: inst.tuning.length > 4 ? 4 : 3, level: 0.55 });
      });
      return true;
    }

    strum(frets, inst, now, tone);
    return true;
  }

  // Strum a chord shape at `when`: low to high, or (up) high to low over just the top strings.
  // Returns the voices so they can be damped by the next strum.
  function strum(frets, inst, when, out, { up = false, top = 0, level = 1 } = {}) {
    let strings = frets.map((fret, string) => ({ fret, string })).filter(s => s.fret >= 0);
    if (top) strings = strings.slice(-top);
    if (up) strings.reverse();
    const voices = [];
    strings.forEach(({ fret, string }, k) => {
      const freq = midiToFreq(inst.tuning[string] + fret);
      const at = when + k * inst.strumGap * (up ? 0.7 : 1);
      for (let c = 0; c < inst.courses; c++) {
        // Paired strings: about 3 cents apart, which gives the mandolin shimmer
        const detune = inst.courses > 1 ? (c === 0 ? -3 : 3) : 0;
        const source = ctx.createBufferSource();
        source.buffer = pluckBuffer(freq, inst);
        source.detune.value = detune;
        const gain = ctx.createGain();
        gain.gain.value = level * 0.9 / Math.sqrt(strings.length * inst.courses);
        source.connect(gain);
        gain.connect(out);
        source.start(at + c * 0.004);
        const voice = { source, gain };
        ringing.push(voice);
        voices.push(voice);
      }
    });
    return voices;
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master) master.gain.setTargetAtTime(MASTER_LEVEL * volume, ctx.currentTime, 0.02);
  }

  return { play, prepare, chordTones, setVolume, stop, click };
})();
