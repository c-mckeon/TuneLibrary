// Reads ABC notation (as posted on thesession.org) and works out which chord
// is playing in each bar, in playing order: A1, A2, B1, B2...
// Handles repeats, first/second endings, pick-up notes, tuplets and broken rhythm.

const ChordChart = (function () {
  // Bar length in eighth notes (thesession.org uses L:1/8) for each tune type
  const BAR_UNITS = {
    reel: 8, hornpipe: 8, barndance: 8, strathspey: 8, march: 8,
    jig: 6, "slip jig": 9, slide: 12, polka: 4, waltz: 6, mazurka: 6, "three-two": 12
  };
  // A chord symbol: root, optional quality/extension, optional bass note. Rejects part labels like "A'"
  const CHORD_RE = /^[A-G][#b]?(m|min|maj|dim|aug|sus|add|[0-9]|b(?=[0-9])|\(|\))*(\/[A-G][#b]?)?$/;

  function barUnits(type) {
    return BAR_UNITS[(type || "").toLowerCase()] || 8;
  }

  // Note length suffix: "2", "/", "//", "3/2", "/4"
  function readLength(s, i) {
    const m = s.slice(i).match(/^(\d*)(\/*)(\d*)/);
    let len = m[1] ? parseInt(m[1], 10) : 1;
    if (m[2]) len /= m[3] ? parseInt(m[3], 10) * Math.pow(2, m[2].length - 1) : Math.pow(2, m[2].length);
    return { len, next: i + m[0].length };
  }

  // ABC -> list of bars: { units, chords: [{chord, t}], startRepeat, endRepeat, ending, closes }
  function readBars(abc) {
    let s = abc
      .replace(/%[^\n]*/g, "")              // comments
      .replace(/!/g, "\n")                  // thesession.org line breaks
      .split("\n")
      .filter(line => !/^\s*[A-Za-z]:/.test(line)) // header fields like P:A, K:Edor
      .join(" ")
      .replace(/\[[A-Za-z]:[^\]]*\]/g, "")  // inline fields
      .replace(/\{[^}]*\}/g, "");           // grace notes

    const bars = [];
    let bar = newBar();
    let tuplet = null;           // { left, factor }
    let broken = 1;              // length multiplier for the next note from > or <
    let lastNote = null;         // so ">" can lengthen the previous note
    let pendingStart = false;
    // First/second endings can span several bars: inEnding is the ending we're in (0 = none)
    let inEnding = 0, endingBars = 0, firstEndingLength = 0;

    function newBar() {
      return { units: 0, chords: [], startRepeat: false, endRepeat: false, ending: 0, closes: false };
    }
    function addNote(len) {
      let units = len * broken;
      broken = 1;
      if (tuplet) {
        units *= tuplet.factor;
        if (--tuplet.left === 0) tuplet = null;
      }
      lastNote = { bar, units };
      bar.units += units;
    }
    function endBar(info) {
      bar.endRepeat = info.endRepeat;
      bar.closes = info.closes;
      if (bar.units > 0 || bar.chords.length) {
        bars.push(bar);
        if (inEnding) endingBars++;
      } else if (bars.length) {
        // Empty bar between two bar lines: the repeat/close marks belong to the previous bar
        const prev = bars[bars.length - 1];
        prev.endRepeat = prev.endRepeat || info.endRepeat;
        prev.closes = prev.closes || info.closes;
      }
      // An ending runs until a repeat sign or double bar; a second ending that's
      // left open stops after as many bars as the first one had
      if (inEnding && (info.endRepeat || info.closes || info.startRepeat)) {
        if (inEnding === 1) firstEndingLength = endingBars;
        inEnding = 0;
      }
      if (inEnding >= 2 && firstEndingLength && endingBars >= firstEndingLength) inEnding = 0;
      if (info.ending) { inEnding = info.ending; endingBars = 0; }

      bar = newBar();
      if (info.startRepeat) pendingStart = true;
      bar.startRepeat = pendingStart;
      bar.ending = inEnding;
    }
    function noteStarted() {
      // A repeat start sticks to the bar until it gets its first note
      pendingStart = false;
    }

    let i = 0;
    while (i < s.length) {
      const c = s[i];

      if (c === '"') {
        const close = s.indexOf('"', i + 1);
        const text = s.slice(i + 1, close < 0 ? s.length : close).trim();
        if (CHORD_RE.test(text)) bar.chords.push({ chord: text.split(/[\s(]/)[0], t: bar.units });
        i = close < 0 ? s.length : close + 1;
        continue;
      }

      // Bar lines: | || |] [| |: :| :: :|2 |1 [1
      const bl = s.slice(i).match(/^(:*)(\[?\|+\]?|::)(:*)\s*\[?([12](?:[,-][12])*)?/) ||
                 s.slice(i).match(/^\[([12])/);
      if (bl && (bl[2] || bl[1] !== undefined) && (c === "|" || c === ":" || (c === "[" && /^\[[|12]/.test(s.slice(i))))) {
        const full = bl[0];
        const isEndingOnly = /^\[[12]/.test(full);
        const repeatEnd = !isEndingOnly && (bl[1].length > 0 || bl[2] === "::");
        const repeatStart = !isEndingOnly && (bl[3].length > 0 || bl[2] === "::");
        const endingNum = isEndingOnly ? parseInt(bl[1], 10) : (bl[4] ? parseInt(bl[4], 10) : 0);
        const closes = !isEndingOnly && /\|\||\|\]|\[\|/.test(bl[2]);
        if (isEndingOnly) {
          // "[2" right after a bar line: just marks the ending of the bar now starting
          inEnding = endingNum;
          endingBars = 0;
          bar.ending = endingNum;
        } else {
          endBar({ endRepeat: repeatEnd, startRepeat: repeatStart, ending: endingNum, closes });
        }
        i += full.length;
        continue;
      }

      if (c === "(" && /\d/.test(s[i + 1] || "")) {
        const m = s.slice(i).match(/^\((\d)(?::(\d)?)?(?::(\d))?/);
        const p = parseInt(m[1], 10);
        const q = m[2] ? parseInt(m[2], 10) : ({ 2: 3, 3: 2, 4: 3, 6: 2 }[p] || 2);
        tuplet = { left: m[3] ? parseInt(m[3], 10) : p, factor: q / p };
        i += m[0].length;
        continue;
      }

      if (c === ">" || c === "<") {
        const n = s.slice(i).match(/^[<>]+/)[0];
        const dots = n.length, longer = 2 - Math.pow(0.5, dots), shorter = Math.pow(0.5, dots);
        if (lastNote) {
          const extra = lastNote.units * ((c === ">" ? longer : shorter) - 1);
          lastNote.bar.units += extra;
          lastNote.units += extra;
        }
        broken = c === ">" ? shorter : longer;
        i += n.length;
        continue;
      }

      // Chord of notes [CEG]2: counts once, using its first note's length (or a length after "]")
      if (c === "[") {
        const close = s.indexOf("]", i);
        const inner = s.slice(i + 1, close);
        const first = inner.match(/[=^_]*[A-Ga-g][,']*(\d*\/*\d*)/);
        const after = readLength(s, close + 1);
        const innerLen = first ? readLength(first[1] || "", 0).len : 1;
        noteStarted();
        addNote(innerLen * (after.next > close + 1 ? after.len : 1));
        i = after.next;
        continue;
      }

      const note = s.slice(i).match(/^[=^_]*[A-Ga-gzxZ][,']*/);
      if (note) {
        const { len, next } = readLength(s, i + note[0].length);
        noteStarted();
        addNote(/Z/.test(note[0]) ? 0 : len);
        i = next;
        continue;
      }

      i++; // ties, slurs, ornaments, spaces
    }
    endBar({ endRepeat: false, startRepeat: false, ending: 0, closes: true });
    return bars;
  }

  // Group bars into sections that repeat as a unit; each is a part (A, B, C...)
  function readSections(bars) {
    const sections = [];
    let cur = null;
    bars.forEach((bar, idx) => {
      if (!cur || (bar.startRepeat && cur.bars.length && !bar.ending)) {
        cur = { bars: [], repeated: false };
        sections.push(cur);
      }
      cur.bars.push(bar);
      if (bar.endRepeat) cur.repeated = true;
      const next = bars[idx + 1];
      const nextIsEnding2 = next && next.ending >= 2;
      if ((bar.endRepeat && !nextIsEnding2) || (bar.closes && !(next && next.ending >= 2))) cur = null;
    });
    return sections;
  }

  // Full chart: { barUnits, sequence: [{ label, part, bars: [[{chord, at}]] }], chords: [...] }
  function parse(abc, type) {
    const units = barUnits(type);
    let bars = readBars(abc);

    const isPickup = b => b.units < units * 0.75 && !b.chords.length;
    // Pick-up notes at the start of a part (e.g. "|:BA|", or "(3DEF|:" before the first repeat) are not a real bar
    const sections = readSections(bars).filter(section => {
      if (section.bars.length > 1 && isPickup(section.bars[0])) section.bars.shift();
      return section.bars.length > 1; // a lone bar is a leftover, not a part
    });

    // Chords for each pass through each section, carrying the chord over bars without one
    let lastChord = null;
    const passes = [];
    sections.forEach((section, si) => {
      const count = section.repeated ? 2 : 1;
      for (let pass = 1; pass <= count; pass++) {
        const playBars = section.bars.filter(b => !b.ending || b.ending === pass);
        const out = playBars.map(b => {
          const chords = b.chords.map(c => ({ chord: c.chord, at: Math.min(0.99, c.t / units) }));
          if (lastChord && (!chords.length || chords[0].at > 0.01)) chords.unshift({ chord: lastChord, at: 0 });
          const merged = chords.filter((c, k) => k === 0 || c.chord !== chords[k - 1].chord);
          if (merged.length) lastChord = merged[merged.length - 1].chord;
          return merged;
        });
        passes.push({ section: si, pass, repeated: section.repeated, bars: out });
      }
    });

    // Label parts A, B, C... A written-out repeat (two unrepeated sections in a row
    // with the same chords) counts as the same part played twice
    const signature = p => p.bars.map(b => b.map(c => c.chord).join(",")).join("|");
    const sequence = [];
    let letter = -1;
    passes.forEach((p, k) => {
      const prev = passes[k - 1];
      const writtenOutRepeat = prev && !p.repeated && !prev.repeated && prev.pass === 1 &&
        !prev.pairedWithNext && signature(prev) === signature(p);
      if (writtenOutRepeat) {
        prev.pairedWithNext = true;
        sequence[sequence.length - 1].label = sequence[sequence.length - 1].part + "1";
        sequence.push({ label: sequence[sequence.length - 1].part + "2", part: sequence[sequence.length - 1].part, bars: p.bars });
        p.pass = 2;
        return;
      }
      if (p.pass === 1) letter++;
      const part = String.fromCharCode(65 + letter);
      sequence.push({ label: part + (p.repeated ? p.pass : ""), part, bars: p.bars });
    });

    // First bars before any chord: borrow the first chord of the tune
    const firstChord = (sequence.flatMap(o => o.bars).find(b => b.length) || [])[0];
    sequence.forEach(o => o.bars.forEach(b => { if (!b.length && firstChord) b.push({ chord: firstChord.chord, at: 0 }); }));

    const chords = [];
    sequence.forEach(o => o.bars.forEach(b => b.forEach(c => { if (!chords.includes(c.chord)) chords.push(c.chord); })));
    return { barUnits: units, sequence, chords };
  }

  // How many chord symbols an ABC setting has (to find settings worth using)
  function countChords(abc) {
    return (abc.match(/"[^"]*"/g) || []).filter(q => CHORD_RE.test(q.slice(1, -1).trim())).length;
  }

  // Simpler stand-ins for chords we may not have a diagram for, best first:
  // "Am9" -> ["Am9", "Am7", "Am"], "D/F#" -> ["D/F#", "D"], "Cmaj9" -> ["Cmaj9", "Cmaj7", "C"]
  function fallbacks(chord) {
    const out = [chord];
    const base = chord.split("/")[0];
    const m = base.match(/^([A-G][#b]?)(m(?!aj)|min)?(.*)$/);
    if (m) {
      const root = m[1], minor = m[2] ? "m" : "", ext = m[3];
      if (/^maj(9|11|13)/.test(ext)) out.push(root + minor + "maj7");
      else if (/^(9|11|13|7)/.test(ext)) out.push(root + minor + "7");
      out.push(base, root + minor);
    }
    return out.filter((c, i) => out.indexOf(c) === i);
  }

  return { parse, countChords, fallbacks };
})();
