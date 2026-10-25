// Chord chart + sync to YouTube.
// - Finds a version of the tune with chords on thesession.org and saves it to the tune
// - Shows the chords bar by bar
// - "Sync": while the video plays, tap at the start of each part (A1, A2, B1...);
//   bars are spread evenly between taps, so the current chord can be followed live
// Uses globals from script.js: database, currentMode, tunesCache, selectedTuneKey,
// youtubePlayer, reportWriteError, escapeHtml.

const ChordSync = (function () {
  const panel = document.getElementById("chordSyncPanel");
  const API = "https://thesession.org";

  let tuneKey = null;
  let videoID = null;       // video currently loaded in the main player
  let chart = null;         // parsed chart of the selected tune
  let tapping = null;       // { taps, end, before } while syncing
  let strumAlong = false;
  let steadyTempo = false;  // follow at the average speed instead of every marker
  // Instrument Strum along plays; remembered in this browser only
  const BACKINGS = [["guitar", "Guitar"], ["mandolin", "Mandolin"], ["piano", "Piano"]];
  let backing = "guitar";
  try { backing = localStorage.getItem("tunes.backing") || "guitar"; } catch (e) { /* storage blocked */ }
  if (!BACKINGS.some(b => b[0] === backing)) backing = "guitar";
  let lastShown = "";       // to only update the page when the position changes
  let lastStrummed = null; // chord entry last strummed along

  // ---------- data ----------

  function tune() {
    return (tunesCache && tuneKey && tunesCache[tuneKey]) || {};
  }

  function tuneRef(path) {
    return database.ref(`tunes/${currentMode}/${tuneKey}/${path}`);
  }

  function parsedChart(t) {
    const c = t && t.chordChart;
    if (!c || !c.abc) return null;
    try { return ChordChart.parse(c.abc, c.type); } catch (e) { console.warn("Couldn't read chord chart", e); return null; }
  }

  // Distinct chords of a tune's saved chart (used for the diagrams)
  function chartChords(t) {
    const p = parsedChart(t);
    return p ? p.chords : [];
  }

  // Bars are numbered straight through the tune as played: A1 is bars 0-15, A2 16-31...
  // and on into the next time through. Sync points are [video time, bar number] pairs.
  function barsIn(k) {
    const seq = chart.sequence;
    return seq[k % seq.length].bars.length;
  }
  function firstBarOf(k) {
    let total = 0;
    for (let j = 0; j < k; j++) total += barsIn(j);
    return total;
  }
  function barToPlace(abs) {
    let k = 0;
    while (abs >= barsIn(k)) { abs -= barsIn(k); k++; }
    return { occurrence: k, bar: Math.floor(abs), frac: abs - Math.floor(abs) };
  }

  // Saved timing for the current video: { points: [[time, bar], ...], end }
  function muteKey(part, bar, index) {
    return part + ":" + bar + ":" + index;
  }
  function isMuted(key) {
    return !!(tune().chordMutes || {})[key];
  }
  function toggleMute(key) {
    tuneRef(`chordMutes/${key}`).set(isMuted(key) ? null : true, reportWriteError);
  }

  function savedSync() {
    const all = tune().chordSync || {};
    const s = videoID && all[videoID];
    if (!s || !chart) return null;
    if (Array.isArray(s.points)) return { points: s.points.map(p => [p[0], p[1]]), end: s.end ?? null };
    // Older syncs tapped only the start of each part
    if (Array.isArray(s.taps)) return { points: s.taps.map((t, k) => [t, firstBarOf(k)]), end: s.end ?? null };
    return null;
  }

  function activeSync() {
    return tapping || savedSync();
  }

  // Average bar length over every bar in the timeline (up to the end mark, if there is one)
  function averageBarLength(sync) {
    if (!sync || sync.points.length < 2) return null;
    const bars = timelineBars(sync).filter(b => !b.after);
    if (!bars.length) return null;
    return bars.reduce((total, b) => total + (b.end - b.start), 0) / bars.length;
  }

  // What playback follows: every marker, or with "Steady tempo" one even bar length
  // (the timeline average) from where the first bar starts
  function playbackSync() {
    const s = activeSync();
    if (!steadyTempo || tapping || !s) return s;
    const bar = averageBarLength(s);
    if (!bar) return s;
    const first = s.points[0];
    return { points: [first, [first[0] + bar * 16, first[1] + 16]], end: s.end };
  }

  // Which bar is playing at time t: straight-line between sync points,
  // and past the last one, carrying on at the last known tempo
  function barAt(t, sync) {
    const pts = sync.points;
    if (!pts.length || t < pts[0][0] || (sync.end != null && t >= sync.end)) return null;
    let i = 0;
    while (i + 1 < pts.length && pts[i + 1][0] <= t) i++;
    const a = pts[i], b = pts[i + 1];
    if (b) return { abs: a[1] + (t - a[0]) * (b[1] - a[1]) / (b[0] - a[0]) };
    const barLength = typicalBarLength(pts);
    return barLength ? { abs: a[1] + (t - a[0]) / barLength } : { waiting: true };
  }

  // Usual length of a bar in seconds: the median over all synced bars. Past the last
  // sync point bars use this, so one stretched gap (a pause) doesn't slow everything after it.
  function typicalBarLength(pts) {
    const lengths = [];
    for (let k = 0; k + 1 < pts.length; k++) {
      const bars = pts[k + 1][1] - pts[k][1];
      const each = (pts[k + 1][0] - pts[k][0]) / bars;
      for (let j = 0; j < bars; j++) lengths.push(each);
    }
    if (!lengths.length) return null;
    lengths.sort((x, y) => x - y);
    return lengths[Math.floor(lengths.length / 2)];
  }

  // Where the video is in the chart at time t (seconds), or null outside the tune
  function positionAt(t, sync) {
    if (!chart || !sync || !sync.points.length) return null;
    const seq = chart.sequence, n = seq.length;
    const at = barAt(t, sync);
    if (!at) return null;
    if (at.waiting) return { waiting: true, occurrence: -1 };

    const place = barToPlace(Math.max(0, at.abs));
    const occ = place.occurrence;
    const part = seq[occ % n];
    const bar = place.bar, frac = place.frac;
    const chords = part.bars[bar] || [];
    let ci = 0;
    while (ci + 1 < chords.length && chords[ci + 1].at <= frac) ci++;
    const chord = chords[ci] ? chords[ci].chord : null;

    // Next different chord, looking ahead into the following bars
    let next = null;
    for (let k = ci + 1; k < chords.length && !next; k++) if (chords[k].chord !== chord) next = chords[k].chord;
    for (let b = bar + 1, o = occ, guard = 0; !next && guard < 64; b++, guard++) {
      if (b >= seq[o % n].bars.length) { b = 0; o++; }
      const c = seq[o % n].bars[b].find(x => x.chord !== chord);
      if (c) next = c.chord;
    }

    return {
      abs: firstBarOf(occ) + bar,
      beat: (firstBarOf(occ) + bar) + ":" + ci, // identifies this chord entry, so repeats of the same chord count separately
      muted: isMuted(muteKey(part.part, bar, ci)),
      occurrence: occ, label: part.label, part: part.part, bar, bars: part.bars.length,
      round: Math.floor(occ / n) + 1, chord, next
    };
  }

  // ---------- thesession.org lookup ----------

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("thesession.org returned " + res.status);
    return res.json();
  }

  function setStatus(html) {
    const el = panel.querySelector(".cs-finder");
    if (el) el.innerHTML = html;
  }

  async function findOnTheSession() {
    const name = (tune().name || "").trim();
    renderFinder();
    if (!name) return setStatus("This tune has no name to search for.");
    setStatus("Searching thesession.org…");
    try {
      const data = await getJSON(`${API}/tunes/search?q=${encodeURIComponent(name)}&format=json&perpage=6`);
      const tunes = data.tunes || [];
      if (!tunes.length) return setStatus(`No match for “${escapeHtml(name)}”. Paste the tune's thesession.org link below.` + linkInput());
      setStatus(`<div class="cs-hint">Which tune is it?</div>` +
        tunes.map(t => `<button class="cs-choice" data-tune="${t.id}">${escapeHtml(t.name)} <span class="cs-dim">${escapeHtml(t.type || "")}</span></button>`).join("") +
        linkInput());
      wireFinder();
    } catch (e) {
      setStatus("Couldn't reach thesession.org: " + escapeHtml(e.message));
    }
  }

  function linkInput() {
    return `<div class="cs-row"><input class="cs-link" type="url" placeholder="or paste a thesession.org tune link"><button class="cs-link-go">Use link</button></div>
            <div class="cs-row"><button class="cs-paste-open">Paste ABC from another site…</button><button class="cs-cancel-find">Cancel</button></div>`;
  }

  const TUNE_TYPES = ["reel", "jig", "slip jig", "hornpipe", "polka", "slide", "waltz", "mazurka", "barndance", "strathspey", "march", "three-two"];

  // Paste ABC notation with chord symbols (e.g. "Am"G2Bd) from any site or tune book
  function showPasteForm() {
    const current = tune().chordChart;
    const type = ((current && current.type) || tune().type || "reel").toLowerCase();
    setStatus(`
      <div class="cs-hint">Paste the tune's ABC notation, including chord symbols in quotes like <code>"Am"</code>.
        Header lines (X:, T:, K: …) are fine.</div>
      <textarea class="cs-paste" rows="7" placeholder='|:"Am9"G2Bd BAGB|"D7"AD~D2 ADFD|...'></textarea>
      <div class="cs-row">
        <label class="cs-dim">Type <select class="cs-paste-type">${TUNE_TYPES.map(t => `<option${t === type ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        <button class="cs-paste-go">Use these chords</button>
        <button class="cs-cancel-find">Cancel</button>
      </div>`);
    panel.querySelector(".cs-paste-go").addEventListener("click", () => {
      const abc = panel.querySelector(".cs-paste").value.trim();
      const chosenType = panel.querySelector(".cs-paste-type").value;
      if (ChordChart.countChords(abc) < 2) return alert("I couldn't find chord symbols in that. Chords go in double quotes, like \"Am\".");
      // Use the meter from the header if there is one (M:6/8 -> jig etc.) only to sanity-check; the chosen type sets bar length
      saveChart({ source: "pasted", name: tune().name || "", type: chosenType, key: "", member: "", abc });
    });
    wireFinder();
  }

  function wireFinder() {
    panel.querySelectorAll(".cs-choice[data-tune]").forEach(b => b.addEventListener("click", () => chooseTune(b.dataset.tune)));
    const go = panel.querySelector(".cs-link-go");
    if (go) go.addEventListener("click", () => {
      const m = (panel.querySelector(".cs-link").value || "").match(/tunes\/(\d+)/);
      if (m) chooseTune(m[1]); else alert("That doesn't look like a thesession.org tune link.");
    });
    panel.querySelectorAll(".cs-cancel-find").forEach(c => c.addEventListener("click", render));
    const paste = panel.querySelector(".cs-paste-open");
    if (paste) paste.addEventListener("click", showPasteForm);
  }

  async function chooseTune(id) {
    setStatus("Loading versions…");
    try {
      const t = await getJSON(`${API}/tunes/${id}?format=json`);
      const settings = (t.settings || []).filter(s => ChordChart.countChords(s.abc) >= 4);
      if (!settings.length) {
        return setStatus(`None of the ${t.settings.length} versions of ${escapeHtml(t.name)} on thesession.org have chords.` + linkInput()), wireFinder();
      }
      // If there are timings already, say which versions keep them (same bar layout)
      const old = parsedChart(tune());
      const hasTimings = old && Object.keys(tune().chordSync || {}).length > 0;
      const current = tune().chordChart || {};
      setStatus(`<div class="cs-hint">${settings.length} of ${t.settings.length} versions of <b>${escapeHtml(t.name)}</b> have chords. Pick one:</div>` +
        settings.map((s, k) => {
          let preview = "", fit = "";
          try {
            const p = ChordChart.parse(s.abc, t.type);
            preview = p.chords.join(" ");
            if (hasTimings) fit = layoutOf(p) === layoutOf(old)
              ? `<span class="cs-fit ok">keeps your timings</span>`
              : `<span class="cs-fit">different bar layout</span>`;
          } catch (e) { /* show without preview */ }
          const isCurrent = current.settingId === s.id;
          return `<button class="cs-choice" data-setting="${k}">${escapeHtml(s.key || "")} · by ${escapeHtml((s.member && s.member.name) || "?")}
                  ${isCurrent ? `<span class="cs-fit">current</span>` : ""}${fit}
                  <span class="cs-dim">${escapeHtml(preview)}</span></button>`;
        }).join("") + linkInput());
      panel.querySelectorAll(".cs-choice[data-setting]").forEach(b => b.addEventListener("click", () => {
        const s = settings[Number(b.dataset.setting)];
        saveChart({
          source: "thesession.org", tuneId: t.id, settingId: s.id, name: t.name, type: t.type,
          key: s.key || "", member: (s.member && s.member.name) || "", abc: s.abc
        });
      }));
      wireFinder();
    } catch (e) {
      setStatus("Couldn't load that tune: " + escapeHtml(e.message));
    }
  }

  // Bars per part, as played: "A1 16 · A2 16 · B1 16 · B2 16"
  function layoutOf(parsed) {
    return parsed.sequence.map(o => o.label + " " + o.bars.length).join(" · ");
  }

  function saveChart(chordChart) {
    // Timings are tied to bar numbers, so they carry over when the bar layout is the same
    const old = parsedChart(tune());
    const hasTimings = Object.keys(tune().chordSync || {}).length > 0;
    if (old && hasTimings) {
      let fresh;
      try { fresh = ChordChart.parse(chordChart.abc, chordChart.type); } catch (e) { fresh = null; }
      if (!fresh || !fresh.sequence.length) return alert("Couldn't read the bars in that version.");
      const before = layoutOf(old), after = layoutOf(fresh);
      if (before !== after && !confirm(
        "This version's bars are laid out differently:\n\n" +
        "Now:  " + before + "\nNew:  " + after + "\n\n" +
        "Your timings stay at the same moments in the video, but they're tied to bar numbers, " +
        "so the new chords may land on the wrong bars and need re-syncing. Switch anyway?")) return;
    }
    setStatus(""); // so the live update that follows redraws the panel with the new chart
    tuneRef("chordChart").set(chordChart, function (error) {
      if (error) return reportWriteError(error);
      render();
      if (typeof showTuneChords === "function") showTuneChords(tune());
    });
  }

  // ---------- syncing ----------

  function startTapping() {
    const saved = savedSync();
    tapping = { points: saved ? saved.points : [], end: saved ? saved.end : null };
    render();
  }

  function videoTime() {
    return Math.round(youtubePlayer.getCurrentTime() * 100) / 100;
  }

  // Record "bar `abs` starts at time t". Points after this one are dropped,
  // so going back and clicking again part-way through fixes mistakes.
  function addPoint(t, abs) {
    tapping.points = tapping.points.filter(p => p[0] < t - 0.3 && p[1] < abs);
    tapping.points.push([t, abs]);
    tapping.end = null;
    updateTapInfo();
    if (panel.querySelector(".cs-timeline")) redrawTimeline(tapping);
    else render(); // first point: the timeline appears
  }

  // Points before time t, and where the tempo so far says we should be at t
  function expectation(t) {
    const earlier = tapping.points.filter(p => p[0] < t - 0.3);
    const last = earlier[earlier.length - 1] || null;
    const guess = earlier.length >= 2 ? barAt(t, { points: earlier, end: null }) : null;
    return { last, expected: guess && !guess.waiting ? guess.abs : null };
  }

  // A bar in the chart was clicked as it started. The chart shows each part once,
  // so work out which time through it is (A1 or A2, first or second time through the tune)
  function clickBar(part, bar, cell) {
    if (!tapping || !youtubePlayer || !youtubePlayer.getCurrentTime) return;
    const t = videoTime();
    const { last, expected } = expectation(t);
    const seq = chart.sequence, n = seq.length;
    let best = null;
    for (let k = 0; k < n * 20; k++) {
      if (seq[k % n].part !== part) continue;
      const abs = firstBarOf(k) + bar;
      if (last && abs <= last[1]) continue;              // always moving forward
      if (expected === null) { best = abs; break; }       // no tempo yet: the next one along
      if (best === null || Math.abs(abs - expected) < Math.abs(best - expected)) best = abs;
      else if (abs > expected) break;                      // closest to where we should be
    }
    if (best === null) return;
    addPoint(t, best);
    if (cell) {
      cell.classList.remove("cs-flash");
      void cell.offsetWidth;
      cell.classList.add("cs-flash");
    }
  }

  // Space: "a bar starts now" - the nearest bar line the tempo predicts, or the bar after the last point
  function tapBar() {
    if (!tapping || !youtubePlayer || !youtubePlayer.getCurrentTime) return;
    const t = videoTime();
    const { last, expected } = expectation(t);
    const after = last ? last[1] + 1 : 0;
    addPoint(t, expected === null ? after : Math.max(after, Math.round(expected)));
    flash(".cs-tap");
  }

  function tapEnd() {
    if (!tapping || !youtubePlayer) return;
    const t = videoTime();
    tapping.points = tapping.points.filter(p => p[0] < t);
    tapping.end = t;
    finishTapping(true);
  }

  function finishTapping(save) {
    const result = tapping;
    tapping = null;
    if (save && result) {
      tuneRef(`chordSync/${videoID}`).set(result.points.length ? { points: result.points, end: result.end } : null, reportWriteError);
    }
    render();
  }

  function nudge(seconds) {
    const s = savedSync();
    if (!s) return;
    const shift = x => Math.max(0, Math.round((x + seconds) * 100) / 100);
    tuneRef(`chordSync/${videoID}`).set({
      points: s.points.map(p => [shift(p[0]), p[1]]),
      end: s.end == null ? null : shift(s.end)
    }, reportWriteError);
  }

  function clearSync() {
    if (!confirm("Remove the chord timing for this video?")) return;
    tuneRef(`chordSync/${videoID}`).remove(reportWriteError);
  }

  function describeBar(abs) {
    const p = barToPlace(abs), n = chart.sequence.length;
    const round = Math.floor(p.occurrence / n) + 1;
    return `${chart.sequence[p.occurrence % n].label} bar ${p.bar + 1}${round > 1 ? " (time " + round + ")" : ""}`;
  }

  function updateTapInfo() {
    const el = panel.querySelector(".cs-tap-info");
    if (!el || !tapping) return;
    const last = tapping.points[tapping.points.length - 1];
    el.innerHTML = `Points: ${tapping.points.length}` + (last ? ` · last: <b>${escapeHtml(describeBar(last[1]))}</b>` : "");
  }

  function flash(selector) {
    const el = panel.querySelector(selector);
    if (!el) return;
    el.classList.remove("cs-flash");
    void el.offsetWidth;
    el.classList.add("cs-flash");
  }

  // ---------- timeline editor ----------
  // Every bar start as a marker on the video's timeline: blue = set by hand, grey = spread
  // evenly between blue ones. Drag to move (makes it blue), click to jump the video there,
  // double-click a blue one to remove it.

  let pps = 50 * 0.67 * 0.67; // zoom: pixels per second (default is two "−" clicks out from 50)
  let tlStart = 0;           // video time at the left edge of the timeline
  let dragging = null;
  let settingEnd = false;    // "Set end bar": the next bar clicked becomes the last one played

  // Video time where bar `abs` starts, from the sync points (null if unknown)
  function timeOfBar(abs, pts) {
    if (!pts.length || abs < pts[0][1]) return null;
    let i = 0;
    while (i + 1 < pts.length && pts[i + 1][1] <= abs) i++;
    const a = pts[i], b = pts[i + 1];
    // Between two sync points: spread evenly. Past the last one: the usual bar length.
    if (b) return a[0] + (abs - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
    if (abs === a[1]) return a[0];
    const barLength = typicalBarLength(pts);
    return barLength ? a[0] + (abs - a[1]) * barLength : null;
  }

  function timelineBars(sync) {
    const pts = sync.points;
    if (!pts.length) return [];
    const duration = youtubePlayer && youtubePlayer.getDuration ? youtubePlayer.getDuration() : 0;
    // On to the end of the video; with an End mark, only a few bars past it (shown faded)
    const videoEnd = duration || pts[pts.length - 1][0] + 60;
    const manual = new Set(pts.map(p => p[1]));
    const bars = [];
    let afterEnd = 0;
    for (let abs = pts[0][1]; abs < pts[0][1] + 800; abs++) {
      const start = timeOfBar(abs, pts);
      if (start == null || start >= videoEnd) break;
      const after = sync.end != null && start >= sync.end - 1e-6;
      if (after && ++afterEnd > 8) break;
      const next = timeOfBar(abs + 1, pts);
      bars.push({ abs, start, end: next == null ? start + 2 : Math.min(next, Math.max(videoEnd, start + 0.5)), manual: manual.has(abs), after });
    }
    return bars;
  }

  // Rows that fill the panel width and wrap like text; each row covers rowSeconds of video
  const ROW_H = 62;
  let tlWidth = 600, tlRows = 1, rowSeconds = 12;

  function rowOf(t) { return Math.max(0, Math.floor((t - tlStart) / rowSeconds + 1e-9)); }
  function xIn(t, row) { return (t - tlStart - row * rowSeconds) * pps; }

  function timelineInnerHTML(sync) {
    const bars = timelineBars(sync);
    if (!bars.length) return "";
    const n = chart.sequence.length;
    tlWidth = Math.max(240, (panel.clientWidth || 626) - 26);
    rowSeconds = tlWidth / pps;
    // Left edge follows the first bar, except mid-drag, so the dragged marker tracks the pointer
    // Rows are measured from 0:00 of the video (row k covers k*rowSeconds onwards);
    // rows before the tune starts are left out
    const wantStart = Math.floor(bars[0].start / rowSeconds) * rowSeconds;
    tlStart = dragging ? Math.min(tlStart, wantStart) : wantStart;
    const tEnd = Math.max(sync.end || 0, bars[bars.length - 1].end) + 1;
    tlRows = rowOf(tEnd) + 1;
    const top = (row, offset) => row * ROW_H + offset;

    let html = "";
    for (let r = 0; r < tlRows; r++) {
      html += `<div class="tl-rowbg" style="top:${top(r, 18)}px"></div>`;
      html += `<div class="tl-time" style="top:${top(r, 3)}px">${formatClock(tlStart + r * rowSeconds)}</div>`;
    }

    bars.forEach(b => {
      const place = barToPlace(b.abs);
      const occ = chart.sequence[place.occurrence % n];
      const round = Math.floor(place.occurrence / n) + 1;
      const chords = (occ.bars[place.bar] || []).map((c, ci) => ({ chord: c.chord, t: b.start + c.at * (b.end - b.start), muted: isMuted(muteKey(occ.part, place.bar, ci)) }));
      const startRow = rowOf(b.start);
      if (place.bar === 0) {
        html += `<div class="tl-part" style="left:${xIn(b.start, startRow).toFixed(1)}px;top:${top(startRow, 2)}px">${occ.label}${round > 1 ? " ·" + round : ""}</div>`;
      }
      // A bar that crosses the end of a row continues at the start of the next one
      for (let r = startRow; r <= rowOf(b.end - 1e-6); r++) {
        const segStart = Math.max(b.start, tlStart + r * rowSeconds);
        const segEnd = Math.min(b.end, tlStart + (r + 1) * rowSeconds);
        if (segEnd <= segStart) continue;
        const labels = chords.filter(c => c.t >= segStart - 1e-6 && c.t < segEnd)
          .map(c => `<span class="tl-chord${c.muted ? " muted" : ""}" style="left:${((c.t - segStart) * pps).toFixed(1)}px">${escapeHtml(c.chord)}</span>`).join("");
        html += `<div class="tl-bar${place.bar === 0 && r === startRow ? " tl-part-start" : ""}${r > startRow ? " tl-cont" : ""}${b.after ? " tl-after" : ""}" data-abs="${b.abs}"
          style="left:${xIn(segStart, r).toFixed(1)}px;width:${Math.max(1, (segEnd - segStart) * pps).toFixed(1)}px;top:${top(r, 18)}px">${labels}</div>`;
      }
      if (!b.after) html += `<div class="tl-mark ${b.manual ? "manual" : "auto"}" data-abs="${b.abs}" data-t="${b.start}"
        style="left:${xIn(b.start, startRow).toFixed(1)}px;top:${top(startRow, 14)}px"
        title="${escapeHtml(describeBar(b.abs))} at ${b.start.toFixed(2)}s${b.manual ? " (set by you; Alt+drag to move, double-click to remove)" : " (automatic; Alt+drag or double-click to pin)"}"></div>`;
    });
    if (sync.end != null) {
      const r = rowOf(sync.end);
      html += `<div class="tl-mark end" data-end="1" data-t="${sync.end}" style="left:${xIn(sync.end, r).toFixed(1)}px;top:${top(r, 14)}px"
        title="End at ${sync.end.toFixed(2)}s (double-click to remove)"></div>`;
    }
    return `<div class="tl-inner" style="width:${tlWidth}px;height:${tlRows * ROW_H}px">${html}<div class="tl-playhead"></div></div>`;
  }

  // 75 -> "1:15"
  function formatClock(t) {
    const sec = Math.round(t);
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  // 10.5 -> "00:10:50" (minutes:seconds:hundredths)
  function formatStart(t) {
    const cs = Math.round(Math.max(0, t) * 100);
    const pad = n => String(n).padStart(2, "0");
    return pad(Math.floor(cs / 6000)) + ":" + pad(Math.floor(cs / 100) % 60) + ":" + pad(cs % 100);
  }
  // Accepts "00:10:50", "0:10.5", "10.5", "1:02" -> seconds (null if unreadable)
  function parseStart(text) {
    const v = text.trim();
    let m = v.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
    if (m) return +m[1] * 60 + +m[2] + +m[3].padEnd(2, "0") / 100;
    m = v.match(/^(\d+):(\d+(?:\.\d+)?)$/);
    if (m) return +m[1] * 60 + +m[2];
    m = v.match(/^\d+(?:\.\d+)?$/);
    return m ? +v : null;
  }

  function timelineHTML(sync) {
    if (!sync || !sync.points.length) return "";
    return `
      <div class="cs-row cs-timeline-tools">
        <span class="cs-dim">Timeline: <span class="tl-key manual"></span> set by you · <span class="tl-key auto"></span> automatic.
          <b>Alt+drag</b> to move · <b>Ctrl+click</b> to jump the video there · double-click grey to pin, blue to remove.</span>
        <button class="tl-set-end${settingEnd ? " active" : ""}" title="Then click the last bar to play; chords and strumming stop after it">${settingEnd ? "Click the last bar…" : "Set end bar"}</button>
        <label class="cs-dim tl-start-wrap" title="When bar 1 starts (mm:ss:hundredths). Changing it moves the whole sync.">Start
          <input class="tl-start" type="text" value="${formatStart(sync.points[0][0])}" spellcheck="false"></label>
        <button class="tl-zoom" data-zoom="0.67" title="Zoom out">−</button>
        <button class="tl-zoom" data-zoom="1.5" title="Zoom in">+</button>
        <button class="cs-cue" title="Jump to the cue point">Cue</button>
        <button class="cs-play" title="Play / pause">${isPlaying() ? "⏸︎" : "⏵︎"}</button><button class="cs-mute" title="Mute / unmute the video">${isVideoMuted() ? "🔇" : "🔊"}</button>
      </div>
      <div class="cs-timeline${settingEnd ? " tl-picking-end" : ""}">${timelineInnerHTML(sync)}</div>`;
  }

  // Redraw just the timeline
  function redrawTimeline(sync) {
    const box = panel.querySelector(".cs-timeline");
    if (!box) return;
    box.innerHTML = timelineInnerHTML(sync);
    const field = panel.querySelector(".tl-start");
    if (field && document.activeElement !== field && sync && sync.points.length) field.value = formatStart(sync.points[0][0]);
    lastShown = ""; // re-apply highlights on the next tick
  }

  // Save edited timing: into the sync in progress, or straight to the database
  function commitSync(points, end) {
    points = points.slice().sort((a, b) => a[1] - b[1]);
    if (tapping) {
      tapping.points = points;
      tapping.end = end;
      updateTapInfo();
      redrawTimeline(tapping);
      return;
    }
    redrawTimeline({ points, end });
    tuneRef(`chordSync/${videoID}`).set(points.length ? { points, end } : null, reportWriteError);
  }

  function editableSync() {
    const s = activeSync();
    return s ? { points: s.points.map(p => p.slice()), end: s.end } : null;
  }

  // Sync with one bar start (or the end) moved to time t
  function withMoved(sync, drag, t) {
    if (drag.isEnd) return { points: sync.points, end: t };
    const points = sync.points.filter(p => p[1] !== drag.abs);
    points.push([t, drag.abs]);
    points.sort((a, b) => a[1] - b[1]);
    return { points, end: sync.end != null && sync.end <= t ? null : sync.end };
  }

  // Video time under the pointer, following it from row to row
  function timeAtPointer(e, box) {
    const inner = box.querySelector(".tl-inner");
    if (!inner) return null;
    const rect = inner.getBoundingClientRect();
    const row = Math.min(tlRows - 1, Math.max(0, Math.floor((e.clientY - rect.top) / ROW_H)));
    const x = Math.min(tlWidth, Math.max(0, e.clientX - rect.left));
    return tlStart + row * rowSeconds + x / pps;
  }

  // Make bar `abs` a blue (fixed) point where it currently is
  function pinBar(abs) {
    const sync = editableSync();
    if (!sync || sync.points.some(p => p[1] === abs)) return;
    const t = timeOfBar(abs, sync.points);
    if (t == null) return;
    commitSync(sync.points.concat([[Math.round(t * 100) / 100, abs]]), sync.end);
  }

  let lastClick = { id: null, at: 0 };
  // True when this is the second click on the same thing within 400ms
  function isDoubleClick(id) {
    const double = lastClick.id === id && Date.now() - lastClick.at < 400;
    lastClick = double ? { id: null, at: 0 } : { id, at: Date.now() };
    return double;
  }

  function wireTimeline() {
    const box = panel.querySelector(".cs-timeline");
    if (!box) return;

    box.addEventListener("pointerdown", e => {
      const mark = e.target.closest(".tl-mark");
      const clickedBar = e.target.closest(".tl-bar");
      if (settingEnd && clickedBar) {
        // The tune ends where this bar finishes
        const sync = editableSync();
        const abs = Number(clickedBar.dataset.abs);
        const endTime = sync && timeOfBar(abs + 1, sync.points);
        settingEnd = false;
        if (endTime != null) commitSync(sync.points, Math.round(endTime * 100) / 100);
        else redrawTimeline(activeSync());
        const btn = panel.querySelector(".tl-set-end");
        if (btn) { btn.classList.remove("active"); btn.textContent = "Set end bar"; }
        box.classList.remove("tl-picking-end");
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const t = mark ? Number(mark.dataset.t) : timeAtPointer(e, box);
        if (t != null && youtubePlayer && youtubePlayer.seekTo) youtubePlayer.seekTo(Math.max(0, t), true);
        e.preventDefault();
        return;
      }
      if (!mark && clickedBar && clickedBar.dataset.abs && !clickedBar.classList.contains("tl-after") &&
          isDoubleClick("bar" + clickedBar.dataset.abs)) {
        pinBar(Number(clickedBar.dataset.abs));
        return;
      }
      if (!mark) return;
      const sync = editableSync();
      if (!sync) return;
      const isEnd = !!mark.dataset.end;
      const abs = isEnd ? null : Number(mark.dataset.abs);
      // Without Alt a marker doesn't move; double-click pins a grey one or removes a blue one (or the end)
      if (!e.altKey) {
        if (isDoubleClick(isEnd ? "end" : "mark" + abs)) {
          if (isEnd) commitSync(sync.points, null);
          else if (sync.points.some(p => p[1] === abs)) commitSync(sync.points.filter(p => p[1] !== abs), sync.end);
          else pinBar(abs);
        }
        e.preventDefault();
        return;
      }
      const t = Number(mark.dataset.t);
      // Can't pass the blue markers either side
      const others = sync.points.filter(p => p[1] !== abs);
      const before = isEnd ? others.filter(p => p[0] < sync.end).pop() : others.filter(p => p[1] < abs).pop();
      const after = isEnd ? null : others.find(p => p[1] > abs);
      const grabbedAt = timeAtPointer(e, box);
      dragging = {
        abs, isEnd, sync, t, moved: false, current: t,
        startX: e.clientX, startY: e.clientY,
        grab: grabbedAt == null ? 0 : t - grabbedAt,   // where on the marker it was grabbed
        min: before ? before[0] + 0.05 : 0,
        max: after ? after[0] - 0.05 : (isEnd || sync.end == null ? Infinity : sync.end - 0.05)
      };
      // Capture on the box, which survives the redraws during the drag
      box.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    box.addEventListener("pointermove", e => {
      if (!dragging) return;
      if (!dragging.moved && Math.abs(e.clientX - dragging.startX) < 4 && Math.abs(e.clientY - dragging.startY) < 4) return;
      dragging.moved = true;
      const t = timeAtPointer(e, box);
      if (t == null) return;
      dragging.current = Math.min(dragging.max, Math.max(dragging.min, t + dragging.grab));
      // Live preview: redraw with the marker at its new place, keeping the drag going
      redrawTimeline(withMoved(dragging.sync, dragging, dragging.current));
      const sel = dragging.isEnd ? ".tl-mark[data-end]" : `.tl-mark[data-abs="${dragging.abs}"]`;
      const moved = box.querySelector(sel);
      if (moved) moved.classList.add("dragging");
    });

    const endDrag = e => {
      if (!dragging) return;
      const d = dragging;
      dragging = null;
      if (e && e.type === "pointerup") { try { box.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ } }
      if (d.moved) {
        const result = withMoved(d.sync, d, Math.round(d.current * 100) / 100);
        commitSync(result.points, result.end);
        return;
      }
    };
    box.addEventListener("pointerup", endDrag);
    box.addEventListener("pointercancel", endDrag);

    const setEnd = panel.querySelector(".tl-set-end");
    if (setEnd) setEnd.addEventListener("click", () => {
      settingEnd = !settingEnd;
      setEnd.classList.toggle("active", settingEnd);
      setEnd.textContent = settingEnd ? "Click the last bar…" : "Set end bar";
      box.classList.toggle("tl-picking-end", settingEnd);
    });

    // Start field: shift every bar and the end by the same amount
    const startField = panel.querySelector(".tl-start");
    if (startField) {
      const apply = () => {
        const sync = editableSync();
        if (!sync || !sync.points.length) return;
        const t = parseStart(startField.value);
        if (t == null) { startField.value = formatStart(sync.points[0][0]); return; }
        const delta = Math.round((t - sync.points[0][0]) * 100) / 100;
        if (!delta) { startField.value = formatStart(sync.points[0][0]); return; }
        const shift = x => Math.round((x + delta) * 100) / 100;
        commitSync(sync.points.map(p => [shift(p[0]), p[1]]), sync.end == null ? null : shift(sync.end));
        startField.value = formatStart(t);
      };
      startField.addEventListener("change", apply);
      startField.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); startField.blur(); }
        if (e.key === "Escape") { const s0 = activeSync(); if (s0) startField.value = formatStart(s0.points[0][0]); startField.blur(); }
      });
    }

    // Zoom changes how many seconds fit on a row
    panel.querySelectorAll(".tl-zoom").forEach(b => b.addEventListener("click", () => {
      pps = Math.min(300, Math.max(8, pps * Number(b.dataset.zoom)));
      redrawTimeline(activeSync());
    }));
  }

  // Markers show a drag cursor only while Alt is held
  const setAlt = on => panel.classList.toggle("tl-alt", on);
  document.addEventListener("keydown", e => { if (e.key === "Alt") setAlt(true); });
  document.addEventListener("keyup", e => { if (e.key === "Alt") setAlt(false); });
  window.addEventListener("blur", () => setAlt(false));

  // Re-wrap the rows when the window size changes
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!dragging && panel.querySelector(".cs-timeline")) redrawTimeline(activeSync());
    }, 150);
  });

  function updatePlayhead(t) {
    const box = panel.querySelector(".cs-timeline");
    const head = box && box.querySelector(".tl-playhead");
    if (!head || t == null) return;
    const row = rowOf(t);
    head.style.display = t >= tlStart && row < tlRows ? "" : "none";
    head.style.left = xIn(t, row) + "px";
    head.style.top = row * ROW_H + 10 + "px";
  }

  // ---------- rendering ----------

  function chartHTML() {
    // One row per part (first time through), each bar showing its chords
    const seen = new Set();
    return chart.sequence.filter(o => !seen.has(o.part) && seen.add(o.part)).map(o => `
      <div class="cs-part" data-part="${o.part}">
        <div class="cs-part-label">${o.part}</div>
        <div class="cs-bars">${o.bars.map((b, i) =>
          `<div class="cs-bar" data-bar="${i}">${b.map((c, ci) => {
            const key = muteKey(o.part, i, ci), muted = isMuted(key);
            return `<span class="cs-chord-name${muted ? " muted" : ""}" data-mute="${key}"
              title="${muted ? "Silenced in Strum along: click to bring back" : "Click to silence this chord in Strum along"}">${escapeHtml(c.chord)}</span>`;
          }).join(" ")}</div>`).join("")}</div>
      </div>`).join("");
  }

  function steadyTitle(sync) {
    const bar = averageBarLength(sync);
    if (!bar) return "Needs at least two markers";
    return "Play every bar at the timeline average (" + bar.toFixed(2) + "s per bar), starting from bar 1";
  }

  function syncHTML() {
    if (!youtubePlayer || !videoID) {
      return `<div class="cs-hint">Play one of this tune's videos to line the chords up with it.</div>`;
    }
    if (tapping) {
      return `
        <div class="cs-hint">As the video plays, <b>click a bar in the chart the moment it starts</b>. Click as many as you like;
          the bars in between are spread evenly. <b>Space</b> marks the next bar instead. Press <b>End</b> when the tune finishes.
          Clicking again part-way through replaces everything after that point.</div>
        <div class="cs-row">
          <button class="cs-tap">Bar starts (Space)</button>
          <button class="cs-end">End</button>
          <button class="cs-done">Done</button>
          <button class="cs-cancel">Cancel</button>
        </div>
        <div class="cs-tap-info"></div>`;
    }
    const s = savedSync();
    if (!s) {
      return `<div class="cs-row"><span class="cs-dim">Not lined up with this video yet.</span>
              <button class="cs-start">Sync chords to video</button></div>`;
    }
    return `
      <div class="cs-row">
        <span class="cs-dim">Synced to this video (${s.points.length} points)</span>
        <button class="cs-start">Re-sync</button>
        <button class="cs-nudge" data-shift="-0.1" title="Chords change too late? Move them earlier">−0.1s</button>
        <button class="cs-nudge" data-shift="0.1" title="Chords change too early? Move them later">+0.1s</button>
        <label class="cs-check"><input type="checkbox" class="cs-strum" ${strumAlong ? "checked" : ""}> Strum along</label>
        <label class="cs-check" title="${steadyTitle(s)}"><input type="checkbox" class="cs-steady" ${steadyTempo ? "checked" : ""}> Steady tempo</label>
        <span class="cs-backing" title="Instrument for Strum along">${BACKINGS.map(([id, label]) =>
          `<button class="cs-backing-btn${backing === id ? " active" : ""}" data-backing="${id}">${label}</button>`).join("")}</span>
        <button class="cs-clear" title="Remove the timing for this video">Clear</button>
      </div>`;
  }

  // Small play/pause + cue at the bottom: they press the main player buttons, so they behave the same
  // Cue sits beside the zoom buttons when the timeline is showing, otherwise here
  function transportHTML(withCue = true) {
    return `<div class="cs-row cs-transport">
      <button class="cs-play" title="Play / pause">${isPlaying() ? "⏸︎" : "⏵︎"}</button><button class="cs-mute" title="Mute / unmute the video">${isVideoMuted() ? "🔇" : "🔊"}</button>
      ${withCue ? `<button class="cs-cue" title="Jump to the cue point">Cue</button>` : ""}
    </div>`;
  }
  function wireTransport() {
    const play = panel.querySelector(".cs-play");
    if (play) play.addEventListener("click", () => document.getElementById("playPauseBtn").click());
    const mute = panel.querySelector(".cs-mute");
    if (mute) mute.addEventListener("click", () => {
      if (!youtubePlayer || !youtubePlayer.mute) return;
      if (isVideoMuted()) youtubePlayer.unMute(); else youtubePlayer.mute();
      mute.textContent = isVideoMuted() ? "🔊" : "🔇"; // the player updates a moment later
      mute._clickedAt = Date.now();
    });
    panel.querySelectorAll(".cs-cue").forEach(cue =>
      cue.addEventListener("click", () => document.getElementById("cueBtn").click()));
  }
  function isVideoMuted() {
    try { return !!(youtubePlayer && youtubePlayer.isMuted && youtubePlayer.isMuted()); }
    catch (e) { return false; }
  }

  function isPlaying() {
    try { return !!(youtubePlayer && youtubePlayer.getPlayerState && youtubePlayer.getPlayerState() === 1); }
    catch (e) { return false; }
  }

  function render() {
    lastShown = "";
    if (!tuneKey || typeof isSetsMode !== "undefined" && isSetsMode) {
      panel.classList.add("hidden");
      return;
    }
    const t = tune();
    chart = parsedChart(t);
    panel.classList.remove("hidden");

    if (!chart) {
      panel.innerHTML = `<div class="cs-row"><span class="cs-dim">No chord chart yet.</span>
        <button class="cs-find">Find chords on thesession.org</button></div><div class="cs-finder"></div>${transportHTML()}`;
      panel.querySelector(".cs-find").addEventListener("click", findOnTheSession);
      wireTransport();
      return;
    }

    const c = t.chordChart;
    const current = activeSync();
    const timelineShown = !!(videoID && youtubePlayer && current && current.points.length);
    panel.innerHTML = `
      <div class="cs-head">
        <span>${c.source === "pasted"
            ? "Chords from pasted ABC"
            : `Chords from <a href="${API}/tunes/${c.tuneId}#setting${c.settingId}" target="_blank" rel="noopener">thesession.org</a>`}
          <span class="cs-dim">· ${escapeHtml(c.name || "")}${c.member ? " · by " + escapeHtml(c.member) : ""}</span></span>
        <button class="cs-change" title="Use chords from another version or source; your timings are kept">Change chords</button>
      </div>
      <div class="cs-finder"></div>
      <div class="cs-now hidden"></div>
      <div class="cs-chart${tapping ? " cs-tapping" : ""}">${chartHTML()}</div>
      <div class="cs-sync">${syncHTML()}</div>
      ${timelineShown ? timelineHTML(activeSync()) : ""}
      ${timelineShown ? "" : transportHTML()}`;

    panel.querySelector(".cs-change").addEventListener("click", findOnTheSession);
    const on = (sel, fn) => panel.querySelectorAll(sel).forEach(el => el.addEventListener("click", fn));
    on(".cs-start", startTapping);
    on(".cs-tap", tapBar);
    if (tapping) {
      panel.querySelectorAll(".cs-bar").forEach(cell => cell.addEventListener("click", () =>
        clickBar(cell.closest(".cs-part").dataset.part, Number(cell.dataset.bar), cell)));
    } else {
      panel.querySelectorAll(".cs-chord-name").forEach(el => el.addEventListener("click", () => toggleMute(el.dataset.mute)));
    }
    on(".cs-end", tapEnd);
    on(".cs-done", () => finishTapping(true));
    on(".cs-cancel", () => finishTapping(false));
    on(".cs-clear", clearSync);
    panel.querySelectorAll(".cs-nudge").forEach(b => b.addEventListener("click", () => nudge(Number(b.dataset.shift))));
    const strum = panel.querySelector(".cs-strum");
    const steady = panel.querySelector(".cs-steady");
    if (steady) steady.addEventListener("change", () => {
      steadyTempo = steady.checked;
      lastShown = ""; // re-place the highlight straight away
    });
    if (strum) strum.addEventListener("change", () => {
      strumAlong = strum.checked;
      if (strumAlong) ChordSound.prepare(chart.chords, backing);
    });
    panel.querySelectorAll(".cs-backing-btn").forEach(b => b.addEventListener("click", () => {
      backing = b.dataset.backing;
      try { localStorage.setItem("tunes.backing", backing); } catch (e) { /* storage blocked */ }
      panel.querySelectorAll(".cs-backing-btn").forEach(x => x.classList.toggle("active", x === b));
      ChordSound.prepare(chart.chords, backing);
      ChordSound.play(chart.chords[0], backing); // a quick taste of the new sound
    }));
    if (tapping) updateTapInfo();
    wireTimeline();
    wireTransport();
  }

  // Not inside the finder, so the user's typing isn't lost
  function renderFinder() {
    const f = panel.querySelector(".cs-finder");
    if (!f) {
      panel.innerHTML = `<div class="cs-finder"></div>`;
    }
  }

  // ---------- live follow ----------

  function tick() {
    const playBtn = panel.querySelector(".cs-play");
    if (playBtn) {
      const icon = isPlaying() ? "⏸︎" : "⏵︎";
      if (playBtn.textContent !== icon) playBtn.textContent = icon;
    }
    const muteBtn = panel.querySelector(".cs-mute");
    if (muteBtn && Date.now() - (muteBtn._clickedAt || 0) > 500) {
      const icon = isVideoMuted() ? "🔇" : "🔊";
      if (muteBtn.textContent !== icon) muteBtn.textContent = icon;
    }
    if (!chart || panel.classList.contains("hidden")) return;
    const sync = playbackSync();
    const player = youtubePlayer;
    const t = player && player.getCurrentTime ? player.getCurrentTime() : null;
    const pos = t == null ? null : positionAt(t, sync);
    const playing = !!(player && player.getPlayerState && player.getPlayerState() === 1);
    updatePlayhead(t);

    const key = pos ? (pos.waiting ? "w" + pos.occurrence : `${pos.occurrence}:${pos.bar}:${pos.chord}`) : "";
    if (key === lastShown) return;
    lastShown = key;

    panel.querySelectorAll(".cs-bar.current, .tl-bar.current").forEach(el => el.classList.remove("current"));
    document.querySelectorAll(".chord-diagram.current").forEach(el => el.classList.remove("current"));
    const now = panel.querySelector(".cs-now");

    if (!pos || pos.waiting) {
      if (now) {
        now.classList.toggle("hidden", !pos);
        if (pos) now.innerHTML = `<span class="cs-dim">Click the next bar as it starts to set the tempo</span>`;
      }
      lastStrummed = null;
      return;
    }

    const cell = panel.querySelector(`.cs-part[data-part="${pos.part}"] .cs-bar[data-bar="${pos.bar}"]`);
    if (cell) cell.classList.add("current");
    const block = panel.querySelector(`.tl-bar[data-abs="${pos.abs}"]`);
    if (block) block.classList.add("current");
    document.querySelectorAll(`.chord-diagram`).forEach(img => {
      if (img.dataset.chord === pos.chord) img.classList.add("current");
    });
    if (now) {
      now.classList.remove("hidden");
      now.innerHTML = `<span class="cs-chord">${escapeHtml(pos.chord || "")}</span>
        <span class="cs-dim">next ${escapeHtml(pos.next || "–")} · ${pos.label} bar ${pos.bar + 1}/${pos.bars}${pos.round > 1 ? " · time " + pos.round : ""}</span>`;
    }

    if (strumAlong && playing && !tapping && pos.chord && pos.beat !== lastStrummed && !pos.muted) ChordSound.play(pos.chord, backing);
    lastStrummed = pos.beat;
  }
  setInterval(function () {
    try { tick(); } catch (e) { /* player was removed mid-check; try again next tick */ }
  }, 50);

  document.addEventListener("keydown", function (e) {
    if (!tapping || e.code !== "Space") return;
    if (e.target.closest("input, textarea, [contenteditable]")) return;
    e.preventDefault();
    tapBar();
  });

  // ---------- hooks called from script.js ----------

  return {
    chartChords,
    // A tune was selected (or deselected with null)
    showTune(key) {
      tuneKey = key;
      videoID = null;
      tapping = null;
      render();
    },
    // The main player loaded a video
    onVideo(id) {
      videoID = id;
      if (tapping) tapping = null;
      render();
    },
    // Live data changed: keep any taps in progress, redraw the rest
    refresh() {
      if (!tuneKey) return;
      if (panel.querySelector(".cs-finder:not(:empty)")) return; // don't interrupt the finder
      if (dragging) return;                                       // or a drag on the timeline
      render();
    }
  };
})();
