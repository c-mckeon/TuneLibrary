// Firebase config (v8 style)
var firebaseConfig = {
  apiKey: "AIzaSyAZt1pYHQvfBNm2goItl5pFk3h5SqE5rOg",
  authDomain: "tunes-96bdd.firebaseapp.com",
  databaseURL: "https://tunes-96bdd-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "tunes-96bdd",
  storageBucket: "tunes-96bdd.firebasestorage.app",
  messagingSenderId: "806822088652",
  appId: "1:806822088652:web:9cbff3464478b5c48b1769"
};
firebase.initializeApp(firebaseConfig);
var database = firebase.database();

var currentMode = "mandolin";
var selectedTuneKey = null;
var tuneData = {}; // Store fetched tune details for editing
var isSetsMode = false;
var isSelectingSet = false;
var selectedSetTuneKeys = new Set();
var activeSet = null;
var setPlaybackQueue = [];
var setPlaybackIndex = -1;
var setPlaybackTimer = null;
var setYoutubePlayers = [null, null];
var setPlayerReady = [false, false];
var setPreparedQueueIndexes = [-1, -1]; // which queue entry each player has loaded
var setPrimeStage = ["", ""];           // "" | "loading" (muted, waiting to play) | "pausing" (waiting to pause)
var setPrimed = [false, false];         // buffered and paused at the tune's start, ready to go
var setActivePlayerIndex = 0;
var setWaitingForNext = false;          // reached the end before the next tune was loaded
var setOutgoingPauseTimer = null;
var setPrimeTimer = null;
var setSessionToken = 0;                // bumps on every restart so stale callbacks are ignored
var editingTuneLinks = [];

// DOM Elements
var guitarBtn = document.getElementById("guitarBtn");
var mandolinBtn = document.getElementById("mandolinBtn");
var tuneNameInput = document.getElementById("tuneName");
var saveTuneBtn = document.getElementById("saveTune");
var tuneListDiv = document.getElementById("tuneList");
var tuneDetailsContainer = document.getElementById("tuneDetailsContainer");
var tuneDetailsText = document.getElementById("tuneDetails");
var detailsDisplay = document.getElementById("detailsDisplay");
var detailsControls = document.getElementById("detailsControls");
var editControls = document.getElementById("editControls");
var saveDetailsBtn = document.getElementById("saveDetails");
var editDetailsBtn = document.getElementById("editDetailsBtn");
var chordInput = document.getElementById("chordInput");
const nameInput = document.getElementById("nameInput");
const linkInput = document.getElementById("linkInput");
const keyInput = document.getElementById("keyInput");
const typeInput = document.getElementById("typeInput");
const editKnowledgeInput = document.getElementById("knowledgeInput");
const likelyChordsInput = document.getElementById("likelyChordsInput"); // read-only, filled from the key
const chartChordsInput = document.getElementById("chartChordsInput"); // read-only, from the imported chord chart

// Main chords for a key, e.g. "G" -> "G C D Em Am", "Ador" -> "Am G D C Em".
// Accepts free text like "Em", "F#m", "A minor", "D dorian", "Dmix", "G/D".
const NOTE_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
// [semitones above tonic, "m" for minor] in order of how often they turn up
const MODE_CHORDS = {
  major:      [[0, ""], [5, ""], [7, ""], [9, "m"], [2, "m"]],
  minor:      [[0, "m"], [10, ""], [3, ""], [5, "m"], [8, ""], [7, "m"]],
  dorian:     [[0, "m"], [10, ""], [5, ""], [3, ""], [7, "m"]],
  mixolydian: [[0, ""], [10, ""], [5, ""], [7, "m"], [2, "m"]]
};
// Distance from the mode's tonic down to its relative major, for choosing sharps vs flats
const MODE_TO_MAJOR = { major: 0, minor: 3, dorian: 10, mixolydian: 5 };
const FLAT_MAJOR_KEYS = [5, 10, 3, 8, 1, 6]; // F Bb Eb Ab Db Gb

function parseKey(text) {
  const m = text.trim().match(/^([A-Ga-g])\s*(#|♯|b|♭|s)?\s*(.*)$/);
  if (!m) return null;
  let root = NOTE_SEMITONES[m[1].toUpperCase()];
  if (m[2] === "#" || m[2] === "♯" || m[2] === "s") root += 1;
  if (m[2] === "b" || m[2] === "♭") root -= 1;
  root = (root + 12) % 12;
  // "Em dor" / "Am mix": the m is redundant when a mode name follows
  const rest = m[3].toLowerCase().replace(/[^a-z]/g, "").replace(/^m(?=dor|mix|aeo|min)/, "");
  let mode = "major";
  if (/^dor/.test(rest)) mode = "dorian";
  else if (/^mix/.test(rest)) mode = "mixolydian";
  else if (/^(m$|min|aeo)/.test(rest) || rest === "m") mode = "minor";
  return { root, mode };
}

// Sort position for a key so variants group together ("Bm" = "B min").
// Root from A upwards, then mode; unreadable keys after, empty keys last.
const MODE_ORDER = { major: 0, mixolydian: 1, dorian: 2, minor: 3 };
function keySortValue(keyText) {
  const text = (keyText || "").trim();
  if (!text) return 2000;
  const key = parseKey(text.split(/[\/,&]|\b(?:and|or)\b/i)[0]);
  if (!key) return 1000;
  return ((key.root - 9 + 12) % 12) * 4 + MODE_ORDER[key.mode];
}

function likelyChordsForKey(keyText) {
  const chords = [];
  (keyText || "").split(/[\/,&]|\b(?:and|or)\b/i).forEach(part => {
    const key = parseKey(part);
    if (!key) return;
    const relMajor = (key.root + MODE_TO_MAJOR[key.mode]) % 12;
    // Follow the spelling typed (C# vs Db); otherwise use the key signature
    const accidental = part.trim().slice(1, 2);
    const names = /[#♯s]/.test(accidental) ? SHARP_NAMES
      : /[b♭]/.test(accidental) || FLAT_MAJOR_KEYS.includes(relMajor) ? FLAT_NAMES : SHARP_NAMES;
    MODE_CHORDS[key.mode].forEach(([step, quality]) => {
      const chord = names[(key.root + step) % 12] + quality;
      if (!chords.includes(chord)) chords.push(chord);
    });
  });
  return chords.join(" ");
}
const repertoireLinksEditor = document.getElementById("repertoireLinksEditor");
const addRepertoireLinkBtn = document.getElementById("addRepertoireLinkBtn");
var selectedTuneUrl = "";
const youtubePlayerContainer = document.getElementById("youtubePlayerContainer");
const setYoutubePlayersContainer = document.getElementById("setYoutubePlayers");
const setPlaybackPanel = document.getElementById("setPlaybackPanel");
const loopControls = document.getElementById("loopControls");
const refreshBtn = document.getElementById("refreshbtn");
const setsBtn = document.getElementById("setsBtn");
const addSetBtn = document.getElementById("addSetBtn");
const saveSetBtn = document.getElementById("saveSetBtn");

function updateModeClass() {
  document.body.classList.toggle("mandolin-mode", currentMode === "mandolin");
}

function updateDetailsDisplay() {
  var hasDetails = tuneDetailsText.value.trim() !== "";
  var isEditing = !saveDetailsBtn.classList.contains("hidden");
  detailsDisplay.classList.toggle(
    "hidden",
    currentMode === "mandolin" && !hasDetails && !isEditing
  );
  detailsControls.classList.toggle(
    "hidden",
    currentMode === "mandolin" && !hasDetails && !isEditing
  );
}

mandolinBtn.classList.add("active");
guitarBtn.classList.remove("active");
updateModeClass();


let currentSortMode = 0; // 0=name, 1=type, 2=recently added
const sortModeTitles = ["Sorted by name", "Sorted by type", "Sorted by most recently added"];
const knowledgeHeaders = {
  1: "Next up",
  2: "In progress",
  3: "Outdated",
  4: "Repertoire"
};
const expandedKnowledgeLevels = {
  1: false,
  2: false,
  3: false,
  4: true
};
const sortBtn = document.getElementById("sortbtn");

sortBtn.title = sortModeTitles[0];

sortBtn.addEventListener("click", () => {
  currentSortMode = (currentSortMode + 1) % sortModeTitles.length; // name -> type -> recent
  sortBtn.title = sortModeTitles[currentSortMode];
  loadTunes(); // reload tunes with new sorting
});


// Function to extract YouTube video ID from various YouTube URLs
function getYouTubeVideoID(url) {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;

    if (hostname.includes("youtu.be")) {
      return parsedUrl.pathname.slice(1);
    }
    if (hostname.includes("youtube.com")) {
      if (parsedUrl.pathname === "/watch") {
        return parsedUrl.searchParams.get("v");
      }
      if (parsedUrl.pathname.startsWith("/embed/")) {
        return parsedUrl.pathname.split("/embed/")[1];
      }
      if (parsedUrl.pathname.startsWith("/shorts/")) {
        return parsedUrl.pathname.split("/shorts/")[1];
      }
    }
  } catch (e) {
    console.warn("Invalid YouTube URL:", url);
  }
  return null;
}

// Live data: one listener each for the current mode's tunes and sets.
// The cached values are what everything renders from.
var tunesCache = null;
var setsCache = null;
var tunesLoaded = false;
var setsLoaded = false;
var tunesRef = null;
var setsRef = null;

function subscribeToMode() {
  if (tunesRef) tunesRef.off();
  if (setsRef) setsRef.off();
  tunesCache = null;
  setsCache = null;
  tunesLoaded = false;
  setsLoaded = false;
  loadTunes();

  tunesRef = database.ref("tunes/" + currentMode);
  setsRef = database.ref("sets/" + currentMode);

  tunesRef.on("value", function (snapshot) {
    tunesCache = snapshot.val();
    tunesLoaded = true;
    if (!isSetsMode || isSelectingSet) loadTunes();
    if (pendingShare) openSharedLink();
    if (typeof ChordSync !== "undefined") ChordSync.refresh();
  }, onDatabaseError);

  setsRef.on("value", function (snapshot) {
    setsCache = snapshot.val();
    setsLoaded = true;
    if (isSetsMode && !isSelectingSet) loadTunes();
  }, onDatabaseError);
}

function onDatabaseError(error) {
  console.error("Database error:", error);
  showErrorOnRefreshBtn();
  tuneListDiv.textContent = "Couldn't load tunes: " + (error && error.message);
}

// Callback for writes, so failed saves aren't silent
function reportWriteError(error) {
  if (!error) return;
  console.error("Error saving:", error);
  if (error.code === "PERMISSION_DENIED") {
    passwordInput.classList.remove("hidden");
    passwordInput.focus();
    alert("Enter the password to save changes.");
    return;
  }
  showErrorOnRefreshBtn();
  alert("Couldn't save: " + error.message);
}

// Render the list from the cache
function loadTunes() {
  if (isSetsMode && !isSelectingSet) {
    if (!setsLoaded) {
      tuneListDiv.textContent = "Loading…";
      return;
    }
    renderSets(setsCache);
    return;
  }

  if (!tunesLoaded) {
    tuneListDiv.textContent = "Loading…";
    return;
  }
  renderTuneList(tunesCache);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Sign-in: password only, against a single fixed Firebase email/password account.
// Database rules restrict access to this account. Firebase remembers the session.
const OWNER_EMAIL = "owner@tunes.app";
const passwordInput = document.getElementById("passwordInput");

passwordInput.addEventListener("keydown", function (e) {
  if (e.key !== "Enter" || !passwordInput.value) return;
  firebase.auth().signInWithEmailAndPassword(OWNER_EMAIL, passwordInput.value)
    .then(function () {
      passwordInput.value = "";
    })
    .catch(function (error) {
      console.error("Sign-in failed:", error);
      passwordInput.value = "";
      passwordInput.placeholder = "Wrong";
    });
});

firebase.auth().onAuthStateChanged(function (user) {
  passwordInput.classList.toggle("hidden", !!user);
  subscribeToMode();
});

// Show connection state on the refresh button
database.ref(".info/connected").on("value", function (snapshot) {
  if (snapshot.val() === true) {
    refreshBtn.classList.remove("error");
  } else if (tunesLoaded) {
    refreshBtn.classList.add("error");
  }
});


// ---------- Shareable links ----------
// The address shows what's open, so it can be copied and sent:
//   #<tune key>/2         = that mandolin tune's 2nd play button (opens it and loads the video, paused)
//   #<tune key>           = the tune selected
//   #guitar/<tune key>/2  = the same for a guitar tune (mandolin is the default, so it isn't named)
function setShareHash(key, linkIndex) {
  const mode = currentMode === "mandolin" ? "" : currentMode + "/";
  const hash = key ? `#${mode}${encodeURIComponent(key)}${linkIndex != null ? "/" + (linkIndex + 1) : ""}` : "";
  history.replaceState(null, "", location.pathname + location.search + hash);
}

function parseShareHash() {
  const m = location.hash.match(/^#(?:(guitar|mandolin)\/)?([^/]+)(?:\/(\d+))?$/);
  return m ? { mode: m[1] || "mandolin", key: decodeURIComponent(m[2]), link: m[3] ? Number(m[3]) - 1 : null } : null;
}

// Opened from a shared link: use its instrument from the start
let pendingShare = parseShareHash();
if (pendingShare && pendingShare.mode !== currentMode) {
  currentMode = pendingShare.mode;
  updateModeClass();
  guitarBtn.classList.toggle("active", currentMode === "guitar");
  mandolinBtn.classList.toggle("active", currentMode === "mandolin");
}

// Once the tunes have loaded: open the shared tune, load its video (paused) and scroll to the player
function openSharedLink() {
  const share = pendingShare;
  pendingShare = null;
  if (!share || isSetsMode || !tunesCache || !tunesCache[share.key]) return;
  const findRow = () => tuneListDiv.querySelector(`.tune-item[data-key="${CSS.escape(share.key)}"]`);
  let row = findRow();
  if (!row && repertoireOnly) {
    // Not a repertoire tune: show the in-progress sections too
    showInProgressInput.checked = true;
    repertoireOnly = false;
    loadTunes();
    row = findRow();
  }
  if (!row) return;
  const content = row.closest(".knowledge-content");
  if (content && content.style.display === "none") content.previousElementSibling.click(); // unfold its section
  // Select the tune and load the shared video paused; the backing is switched on as from
  // a yellow play button, so it plays along once they press play
  row.click();
  const links = getTuneLinks(tunesCache[share.key]).filter(link => link.url.trim() !== "").slice(0, 4);
  const link = share.link != null ? links[share.link] : null;
  const videoID = link && getYouTubeVideoID(link.url);
  const playButton = !!videoID;
  if (videoID) {
    setShareHash(share.key, share.link);
    const button = row.querySelector(`.inline-link-btn[data-link-index="${share.link}"]`);
    if (autoBackingInput.checked && button && button.classList.contains("has-timings")) ChordSync.startBacking("piano");
    loadYouTubeAPI(() => createYouTubePlayer(videoID, Number(link.start) || currentCue, false));
  }
  // The player appears once YouTube's script has loaded
  let tries = 0;
  const scrollWhenReady = () => {
    const playerShown = playButton && !youtubePlayerContainer.classList.contains("hidden");
    if (playerShown || ++tries > 20) {
      (playerShown ? youtubePlayerContainer : row).scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setTimeout(scrollWhenReady, 150);
  };
  scrollWhenReady();
}

guitarBtn.addEventListener("click", function () {
  setShareHash(null);
  currentMode = "guitar";
  updateModeClass();
  leaveSetsMode();
  guitarBtn.classList.add("active");
  mandolinBtn.classList.remove("active");
  selectedTuneKey = null;
  ChordSync.showTune(null);
  tuneDetailsContainer.classList.add("hidden");
  subscribeToMode();
});

mandolinBtn.addEventListener("click", function () {
  setShareHash(null);
  currentMode = "mandolin";
  updateModeClass();
  leaveSetsMode();
  mandolinBtn.classList.add("active");
  guitarBtn.classList.remove("active");
  selectedTuneKey = null;
  ChordSync.showTune(null);
  tuneDetailsContainer.classList.add("hidden");
  subscribeToMode();
});

// + button slides the new-tune fields in and out
const newTuneBtn = document.getElementById("newTuneBtn");
const newTuneFields = document.getElementById("newTuneFields");

function setNewTuneOpen(open) {
  newTuneFields.classList.toggle("open", open);
  newTuneBtn.setAttribute("aria-expanded", open ? "true" : "false");
  newTuneBtn.title = open ? "Close" : "Add a tune";
  if (open) {
    tuneNameInput.focus();
  } else {
    tuneNameInput.value = "";
  }
}

newTuneBtn.addEventListener("click", function () {
  setNewTuneOpen(!newTuneFields.classList.contains("open"));
});

tuneNameInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") saveTuneBtn.click();
  if (e.key === "Escape") setNewTuneOpen(false);
});

// Save a new tune
saveTuneBtn.addEventListener("click", function () {
  var tuneName = tuneNameInput.value.trim();
  if (!tuneName) {
    tuneNameInput.focus();
    return;
  }
  var newTune = {
    name: tuneName,
    details: "",
    mode: currentMode
  };
  database.ref("tunes/" + currentMode).push(newTune, function (error) {
    if (error) {
      reportWriteError(error);
    } else {
      setNewTuneOpen(false);
    }
  });
});

// Refresh button: re-subscribe (useful after a dropped connection)
refreshBtn.addEventListener("click", function () {
  console.log("Refreshing tunes list...");
  selectedTuneKey = null;
  ChordSync.showTune(null);
  tuneDetailsContainer.classList.add("hidden");
  subscribeToMode();
});

function updateSetControls() {
  setsBtn.textContent = isSetsMode ? "Repertoire" : "Sets";
  addSetBtn.classList.toggle("hidden", !isSetsMode || isSelectingSet);
  saveSetBtn.classList.toggle("hidden", !isSetsMode || !isSelectingSet);
  // Loop is for single tunes; Edit stays (in a set it shows/hides the set editor)
  document.getElementById("loopBtn").classList.toggle("hidden", isSetsMode);
  document.getElementById("loopFields").classList.toggle("hidden", isSetsMode);
  showInProgressToggle.classList.toggle("hidden", isSetsMode);
  autoBackingToggle.classList.toggle("hidden", isSetsMode);
}

// "Show In-Progress" switch (off by default): when off, only Repertoire is shown
let repertoireOnly = true;
const showInProgressToggle = document.getElementById("showInProgressToggle");
const showInProgressInput = document.getElementById("showInProgressInput");

// "Autoplay Backing" switch (on by default, remembered in this browser): playing a video
// that has chord timings also starts Play along on piano
const autoBackingToggle = document.getElementById("autoBackingToggle");
const autoBackingInput = document.getElementById("autoBackingInput");
try { autoBackingInput.checked = localStorage.getItem("tunes.autoBacking") !== "off"; } catch (e) { /* storage blocked */ }
autoBackingInput.addEventListener("change", function () {
  try { localStorage.setItem("tunes.autoBacking", autoBackingInput.checked ? "on" : "off"); } catch (e) { /* storage blocked */ }
});

showInProgressInput.addEventListener("change", function () {
  repertoireOnly = !showInProgressInput.checked;
  loadTunes();
});

function leaveSetsMode() {
  isSetsMode = false;
  isSelectingSet = false;
  selectedSetTuneKeys.clear();
  activeSet = null;
  destroySetPlayers();
  setPlaybackPanel.classList.add("hidden");
  setEditorButtonState(false);
  tuneDetailsContainer.classList.add("hidden");
  updateSetControls();
}

setsBtn.addEventListener("click", function () {
  if (isSetsMode) {
    leaveSetsMode();
  } else {
    isSetsMode = true;
    isSelectingSet = false;
    selectedSetTuneKeys.clear();
    selectedTuneKey = null;
    ChordSync.showTune(null);
    tuneDetailsContainer.classList.add("hidden");
    updateSetControls();
  }
  loadTunes();
});

addSetBtn.addEventListener("click", function () {
  isSelectingSet = true;
  selectedSetTuneKeys.clear();
  updateSetControls();
  loadTunes();
});

saveSetBtn.addEventListener("click", function () {
  if (selectedSetTuneKeys.size === 0) {
    alert("Select at least one tune for the set.");
    return;
  }

  {
    const tunes = tunesCache || {};
    const setTunes = Array.from(selectedSetTuneKeys)
      .map(key => {
        const tune = tunes[key];
        if (!tune) return null;
        return {
          key: key,
          name: tune.name || "",
          type: tune.type || "",
          links: getTuneLinks(tune)
        };
      })
      .filter(Boolean);
    const tuneNames = setTunes.map(tune => tune.name).filter(Boolean);

    database.ref("sets/" + currentMode).push({
      tunes: setTunes,
      name: tuneNames.join(", ")
    }, function (error) {
      if (error) {
        reportWriteError(error);
        return;
      }
      isSelectingSet = false;
      selectedSetTuneKeys.clear();
      updateSetControls();
      loadTunes();
    });
  }
});

let player; // global player object

function onYouTubeIframeAPIReady() {
  // No need to init now — we'll create players dynamically when a tune is played
}

let youtubePlayer;
let currentCue = 0;

// Load the YouTube IFrame API
function loadYouTubeAPI(callback) {
  if (window.YT && YT.Player) {
    callback();
  } else {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);
    window.onYouTubeIframeAPIReady = callback;
  }
}

function createYouTubePlayer(videoID, cueTime = 0, autoplay = true, onReadyCallback = null) {
youtubePlayerContainer.innerHTML = `
  <div id="ytPlayer" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></div>
`;
youtubePlayerContainer.classList.remove("hidden");

  const playerVars = {
    autoplay: autoplay ? 1 : 0,
    playsinline: 1
  };
  // Not autoplaying: start the video at the cue point when played, without seeking now
  // (seeking an unstarted video makes YouTube start playing it)
  if (!autoplay && cueTime > 0) playerVars.start = Math.floor(cueTime);
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    playerVars.origin = window.location.origin;
  }

  youtubePlayer = new YT.Player("ytPlayer", {
    height: "315",
    width: "600",
    videoId: videoID,
    playerVars: playerVars,
    events: {
      onReady: (event) => {
        if (autoplay) {
          youtubePlayer.seekTo(cueTime, true);
          youtubePlayer.playVideo();
        }
        document.getElementById("cueInput").value = currentCue;
        markActiveSpeed(1);
        ChordSync.onVideo(videoID);
        if (onReadyCallback) onReadyCallback();
      },
      onStateChange: onPlayerStateChange // Listen to state changes
    }
  });
}

function playSetLink(tuneIndex, linkIndex) {
  if (!activeSet || !activeSet.tunes[tuneIndex]) return;

  setPlaybackQueue = [activeSet.tunes[tuneIndex].links[linkIndex]];
  startSetPlayback();
}

function playSelectedSet() {
  if (!activeSet) return;

  setPlaybackQueue = activeSet.tunes
    .map(tune => tune.links.find(link => link.selected === true))
    .filter(link => link && getYouTubeVideoID(link.url));

  if (setPlaybackQueue.length === 0) {
    alert("Select a version for at least one tune.");
    return;
  }

  startSetPlayback();
}

// ---------- Set playback: two players that hand off gaplessly ----------
// Both players are created once, before the first tune starts, so no YouTube player ever boots
// while music is playing (booting one makes the playing video stutter). While a tune plays, the
// idle player is "primed" with the next one: loaded muted, allowed to actually start (so it
// buffers), then paused at the tune's start. At the handoff the primed player is unmuted and
// started a moment early to cover YouTube's start-up delay, and the outgoing player is paused
// exactly at its end point.
const SET_HANDOFF_LEAD = 0.15; // seconds (real time) to start the next tune before this one ends
const SET_PRIME_DELAY = 1500;  // ms to wait after a tune starts/ends before priming the next one

function setLinkStart(link) {
  return Number(link.start) || 0;
}

// End point in video seconds: the link's end, or the end of the video
function setLinkEnd(player, link) {
  if (link.end === "" || link.end === undefined) {
    return typeof player.getDuration === "function" ? player.getDuration() : 0;
  }
  return Number(link.end);
}

// Real seconds until the player reaches the link's end point, allowing for playback speed
function setRemainingSeconds(player, link) {
  const end = setLinkEnd(player, link);
  if (!end || typeof player.getCurrentTime !== "function") return Infinity;
  const rate = (typeof player.getPlaybackRate === "function" && player.getPlaybackRate()) || 1;
  return Math.max(0, (end - player.getCurrentTime()) / rate);
}

function destroySetPlayers() {
  setSessionToken++;
  clearInterval(setPlaybackTimer);
  clearTimeout(setOutgoingPauseTimer);
  clearTimeout(setPrimeTimer);
  setPlaybackTimer = null;
  setWaitingForNext = false;
  setYoutubePlayers.forEach((setPlayer, index) => {
    if (setPlayer && typeof setPlayer.destroy === "function") setPlayer.destroy();
    setYoutubePlayers[index] = null;
    setPlayerReady[index] = false;
    setPreparedQueueIndexes[index] = -1;
    setPrimeStage[index] = "";
    setPrimed[index] = false;
  });
  document.getElementById("setYoutubePlayerA").innerHTML = "";
  document.getElementById("setYoutubePlayerB").innerHTML = "";
  setYoutubePlayersContainer.classList.add("hidden");
  document.getElementById("playPauseBtn").textContent = "⏵︎";
}

function createSetPlayer(playerIndex, queueIndex, onReady) {
  const container = document.getElementById(playerIndex === 0 ? "setYoutubePlayerA" : "setYoutubePlayerB");
  container.innerHTML = `<div id="setYtPlayer${playerIndex}" class="set-youtube-player-frame"></div>`;

  setYoutubePlayers[playerIndex] = new YT.Player(`setYtPlayer${playerIndex}`, {
    height: "100%",
    width: "100%",
    videoId: getYouTubeVideoID(setPlaybackQueue[queueIndex].url), // cued only; nothing plays yet
    playerVars: { autoplay: 0, playsinline: 1, rel: 0, origin: window.location.origin },
    events: {
      onReady: () => {
        setPlayerReady[playerIndex] = true;
        onReady();
      },
      onStateChange: event => handleSetPlayerState(playerIndex, event),
      onError: event => {
        console.warn("Set player", playerIndex, "error", event.data);
        if (playerIndex === setActivePlayerIndex) handOffToNextSetTune();
      }
    }
  });
}

function startSetPlayback() {
  if (setPlaybackQueue.length === 0) return;

  destroySetPlayers();
  const token = setSessionToken;
  setPlaybackIndex = 0;
  setActivePlayerIndex = 0;
  setYoutubePlayersContainer.classList.remove("hidden");

  loadYouTubeAPI(() => {
    if (token !== setSessionToken) return;
    const playersNeeded = setPlaybackQueue.length > 1 ? 2 : 1;
    let readyCount = 0;
    let started = false;
    const begin = () => {
      if (started || token !== setSessionToken) return;
      started = true;
      startFirstSetTune();
    };

    // Boot both players up front, then start; give up waiting for the second after a few seconds
    // (if it turns up late, it's primed as soon as it's ready)
    createSetPlayer(0, 0, () => { if (++readyCount >= playersNeeded) begin(); });
    if (playersNeeded === 2) {
      createSetPlayer(1, 1, () => {
        if (started) primeNextSetTune();
        else if (++readyCount >= playersNeeded) begin();
      });
      setTimeout(() => { if (setPlayerReady[0]) begin(); }, 6000);
    }
  });
}

function startFirstSetTune() {
  const player = setYoutubePlayers[0];
  const link = setPlaybackQueue[0];
  setPreparedQueueIndexes[0] = 0;
  player.unMute();
  player.loadVideoById({ videoId: getYouTubeVideoID(link.url), startSeconds: setLinkStart(link) });
  player.setPlaybackRate(currentSpeed);
  watchActiveSetPlayer();
  setPrimeTimer = setTimeout(primeNextSetTune, SET_PRIME_DELAY);
}

// Load the next tune into the idle player, muted, so it buffers before it's needed
function primeNextSetTune() {
  const nextIndex = setPlaybackIndex + 1;
  if (nextIndex >= setPlaybackQueue.length) return;

  const idle = 1 - setActivePlayerIndex;
  const player = setYoutubePlayers[idle];
  if (!player || !setPlayerReady[idle]) return;
  if (setPreparedQueueIndexes[idle] === nextIndex && (setPrimed[idle] || setPrimeStage[idle])) return;

  const link = setPlaybackQueue[nextIndex];
  setPreparedQueueIndexes[idle] = nextIndex;
  setPrimed[idle] = false;
  setPrimeStage[idle] = "loading";
  player.mute();
  player.loadVideoById({ videoId: getYouTubeVideoID(link.url), startSeconds: setLinkStart(link) });
}

function handleSetPlayerState(playerIndex, event) {
  const player = setYoutubePlayers[playerIndex];
  const state = event.data;

  if (playerIndex !== setActivePlayerIndex) {
    const link = setPlaybackQueue[setPreparedQueueIndexes[playerIndex]];
    if (setPrimeStage[playerIndex] === "loading" && state === YT.PlayerState.PLAYING) {
      // It's buffering for real now; stop it and wait for the pause before rewinding
      setPrimeStage[playerIndex] = "pausing";
      player.pauseVideo();
    } else if (setPrimeStage[playerIndex] === "pausing" && state === YT.PlayerState.PAUSED) {
      // Paused, so seeking keeps it paused: rewind to the tune's start and it's ready
      if (link) player.seekTo(setLinkStart(link), true);
      setPrimeStage[playerIndex] = "";
      setPrimed[playerIndex] = true;
      if (setWaitingForNext) {
        setWaitingForNext = false;
        handOffToNextSetTune();
      }
    } else if (setPrimed[playerIndex] && state === YT.PlayerState.PLAYING) {
      player.pauseVideo(); // a primed player should never run on its own
    }
    return;
  }

  onPlayerStateChange(event); // keep the play/pause icon in step
  if (state === YT.PlayerState.ENDED) handOffToNextSetTune(); // video ran out before the end point
}

function handOffToNextSetTune() {
  const outgoing = setYoutubePlayers[setActivePlayerIndex];
  const outgoingLink = setPlaybackQueue[setPlaybackIndex];
  const remaining = outgoing && outgoingLink ? setRemainingSeconds(outgoing, outgoingLink) : 0;
  const nextIndex = setPlaybackIndex + 1;
  clearInterval(setPlaybackTimer);

  // Last tune: just stop at its end point
  if (nextIndex >= setPlaybackQueue.length) {
    clearTimeout(setOutgoingPauseTimer);
    setOutgoingPauseTimer = setTimeout(() => outgoing && outgoing.pauseVideo(), Math.min(remaining, 5) * 1000);
    return;
  }

  const idle = 1 - setActivePlayerIndex;
  const next = setYoutubePlayers[idle];
  if (!next || !setPlayerReady[idle] || setPreparedQueueIndexes[idle] !== nextIndex) {
    // Next tune isn't even loading: hold at this tune's end and start as soon as it's primed
    setWaitingForNext = true;
    if (outgoing) outgoing.pauseVideo();
    primeNextSetTune();
    return;
  }

  // Still priming (slow connection): rewind to its start and go anyway rather than wait
  if (!setPrimed[idle]) {
    setPrimeStage[idle] = "";
    next.seekTo(setLinkStart(setPlaybackQueue[nextIndex]), true);
  }
  setPrimed[idle] = false;
  next.setPlaybackRate(currentSpeed);
  next.unMute();
  next.playVideo();

  // Pause the outgoing tune exactly at its end point, then prime it with the tune after next
  clearTimeout(setOutgoingPauseTimer);
  setOutgoingPauseTimer = setTimeout(() => {
    if (outgoing) {
      outgoing.pauseVideo();
      outgoing.mute();
    }
    clearTimeout(setPrimeTimer);
    setPrimeTimer = setTimeout(primeNextSetTune, SET_PRIME_DELAY);
  }, Math.min(remaining, 5) * 1000);

  setActivePlayerIndex = idle;
  setPlaybackIndex = nextIndex;
  watchActiveSetPlayer();
}

// Check the playing tune often, and start the handoff just before its end point
function watchActiveSetPlayer() {
  clearInterval(setPlaybackTimer);
  setPlaybackTimer = setInterval(() => {
    const player = setYoutubePlayers[setActivePlayerIndex];
    const link = setPlaybackQueue[setPlaybackIndex];
    if (!player || !link || typeof player.getPlayerState !== "function") return;
    if (player.getPlayerState() !== YT.PlayerState.PLAYING) return; // paused or buffering: hold

    if (setRemainingSeconds(player, link) <= SET_HANDOFF_LEAD) handOffToNextSetTune();
  }, 40);
}


function setupPlayPauseButton() {
  const playPauseBtn = document.getElementById("playPauseBtn");
  if (!playPauseBtn) return;

  playPauseBtn.addEventListener("click", () => {
    // Nothing playing yet: start the set, or open the selected tune's first link
    const noSetPlayer = activeSet && !setYoutubePlayers[setActivePlayerIndex];
    const noTunePlayer = !activeSet && youtubePlayerContainer.classList.contains("hidden");
    if (noSetPlayer) {
      playSelectedSet();
      return;
    }
    if (noTunePlayer) {
      playSelectedTuneLink();
      return;
    }

    const player = activePlayer();
    if (!player || typeof player.getPlayerState !== "function") return;

    if (player.getPlayerState() === YT.PlayerState.PLAYING) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  });
}

// Space plays / pauses (instead of scrolling the page), except while typing
// or while syncing chords, where Space marks the next bar
document.addEventListener("keydown", function (e) {
  if (e.code !== "Space" || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
  if (typeof ChordSync !== "undefined" && ChordSync.isTapping()) return;
  e.preventDefault();
  if (document.activeElement && document.activeElement.tagName === "BUTTON") document.activeElement.blur(); // don't also press the focused button
  document.getElementById("playPauseBtn").click();
});

// The player the controls act on: the playing set video while a set is open, otherwise the tune video
function activePlayer() {
  return activeSet ? setYoutubePlayers[setActivePlayerIndex] : youtubePlayer;
}

function onPlayerStateChange(event) {
  const playPauseBtn = document.getElementById("playPauseBtn");
  if (!playPauseBtn) return;

  switch (event.data) {
    case YT.PlayerState.PLAYING:
      playPauseBtn.textContent = "⏸︎"; // Pause symbol
      break;
    case YT.PlayerState.PAUSED:
    case YT.PlayerState.ENDED:
    case YT.PlayerState.UNSTARTED:
      playPauseBtn.textContent = "⏵︎"; // Play symbol
      break;
  }
}



// Speed buttons
var currentSpeed = 1;

function markActiveSpeed(speed) {
  currentSpeed = speed;
  document.querySelectorAll(".speed-btn").forEach(btn => {
    btn.classList.toggle("active", parseFloat(btn.dataset.speed) === speed);
  });
}

function setupSpeedControls() {
  document.querySelectorAll(".speed-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const speed = parseFloat(btn.dataset.speed);
      // In a set, apply to both set players so the next tune keeps the speed
      const players = activeSet ? setYoutubePlayers : [youtubePlayer];
      players.forEach(player => {
        if (player && player.setPlaybackRate) player.setPlaybackRate(speed);
      });
      markActiveSpeed(speed);
    });
  });
}

// Cue button
function setupCueButton() {
  document.getElementById("cueBtn").addEventListener("click", () => {
    const player = activePlayer();
    if (player && player.seekTo) {
      player.seekTo(currentCue, true);
    }
  });

  document.getElementById("skipBackBtn").addEventListener("click", () => {
    const player = activePlayer();
    if (player && player.getCurrentTime && player.seekTo) {
      const newTime = Math.max(0, player.getCurrentTime() - 8);
      player.seekTo(newTime, true);
    }
  });

  const cueInput = document.getElementById("cueInput");
  cueInput.value = currentCue;

  cueInput.addEventListener("change", () => {
    currentCue = parseFloat(cueInput.value) || 0;

    if (selectedTuneKey && !activeSet) {
      // Save cue to Firebase
      database.ref(`tunes/${currentMode}/${selectedTuneKey}/cue`).set(currentCue, reportWriteError);
    }
  });
}

let loopEnabled = false;
let loopStart = 0;
let loopEnd = 0;
let loopActive = false;
let loopInterval = null;
let isWaitingToLoop = false;

function setupLoopControls() {
  const loopBtn = document.getElementById("loopBtn");
  const loopStartInput = document.getElementById("loopInputstart");
  const loopEndInput = document.getElementById("loopInputend");
  const loopDelayInput = document.getElementById("loopDelayInput");

  loopBtn.addEventListener("click", function () {
    loopActive = !loopActive;
    loopBtn.classList.toggle("active", loopActive);
    document.getElementById("loopFields").classList.toggle("open", loopActive);
    editControls.classList.toggle("tucked", loopActive);
    if (loopActive && !loopStartInput.value) loopStartInput.focus();

    if (loopActive) {
      loopInterval = setInterval(() => {
        if (
          youtubePlayer &&
          youtubePlayer.getCurrentTime &&
          !isWaitingToLoop
        ) {
          const currentTime = youtubePlayer.getCurrentTime();
          const loopStart = parseFloat(loopStartInput.value) || 0;
          const loopEnd = parseFloat(loopEndInput.value) || 0;
          const delay = parseFloat(loopDelayInput.value) || 0;

          if (loopEnd > loopStart && currentTime >= loopEnd) {
            isWaitingToLoop = true;

            // Pause if delay is > 0
            if (delay > 0 && youtubePlayer.pauseVideo) {
              youtubePlayer.pauseVideo();
            }

            setTimeout(() => {
              youtubePlayer.seekTo(loopStart, true);
              if (delay > 0 && youtubePlayer.playVideo) {
                youtubePlayer.playVideo();
              }
              isWaitingToLoop = false;
            }, delay * 1000);
          }
        }
      }, 200);
    } else {
      clearInterval(loopInterval);
      loopInterval = null;
      isWaitingToLoop = false;
    }
  });
}


// Render tune list
function renderTuneList(tunes) {
  tuneListDiv.innerHTML = "";

  if (!tunes) {
    tuneListDiv.textContent = "No tunes found.";
    return;
  }

  if (isSelectingSet) {
    renderSetSelection(tunes);
    return;
  }

  // 1) Convert to array [ [key, tune], ... ]
  let tunesArray = Object.entries(tunes);

  // 2) Sort within each knowledge section (the sections themselves group by knowledge)
  const byName = (a, b) =>
    (a[1].name || "").toLowerCase().localeCompare((b[1].name || "").toLowerCase());

  if (currentSortMode === 0) {
    // Name only
    tunesArray.sort(byName);
  } else if (currentSortMode === 2) {
    // Most recently added first. Firebase push keys are time-ordered,
    // so a plain (non-locale) key comparison gives creation order.
    tunesArray.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  } else {
    // Type, then key (tunes without a key last), then name
    tunesArray.sort((a, b) => {
      const typeCmp = (a[1].type || "").toLowerCase().localeCompare((b[1].type || "").toLowerCase());
      if (typeCmp !== 0) return typeCmp;
      const sortA = keySortValue(a[1].key), sortB = keySortValue(b[1].key);
      if (sortA !== sortB) return sortA - sortB;
      // Unreadable keys share one value, so order those by their text
      if (sortA === 1000) {
        const rawCmp = a[1].key.trim().toLowerCase().localeCompare(b[1].key.trim().toLowerCase());
        if (rawCmp !== 0) return rawCmp;
      }
      return byName(a, b);
    });
  }

  // 3) Group tunes by knowledge level
  const groupedTunes = {
    1: [],
    2: [],
    3: [],
    4: []
  };

  tunesArray.forEach(([key, tune]) => {
    const knowledge = parseInt(tune.knowledge) || 1; // Default to level 1 if no knowledge level
    if (knowledge >= 1 && knowledge <= 4) {
      groupedTunes[knowledge].push([key, tune]);
    } else {
      // If somehow outside 1-4 range, put in level 1
      groupedTunes[1].push([key, tune]);
    }
  });

  // 4) Render grouped tunes
  if (repertoireOnly && groupedTunes[4].length === 0) {
    tuneListDiv.textContent = "No repertoire tunes yet. Turn on \"Show In-Progress\" to see the rest.";
  }

  // Collapsible sections, Repertoire first (levels 1-3 shown only with "Show In-Progress")
  for (let level = 4; level >= 1 && (level === 4 || !repertoireOnly); level--) {
    if (groupedTunes[level].length > 0) {
      const section = document.createElement("div");
      const isExpanded = expandedKnowledgeLevels[level];
      section.className = `knowledge-section level-${level}`;
      section.classList.toggle("collapsed", !isExpanded);

      const header = document.createElement("div");
      header.className = "knowledge-header";
      header.innerHTML = `<svg class="toggle-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg><span class="header-label">${knowledgeHeaders[level]}</span><span class="header-count">${groupedTunes[level].length}</span>`;
      header.addEventListener("click", function() {
        const content = this.nextElementSibling;
        const expand = content.style.display === "none";
        content.style.display = expand ? "block" : "none";
        section.classList.toggle("collapsed", !expand);
        expandedKnowledgeLevels[level] = expand;
      });

      const content = document.createElement("div");
      content.className = "knowledge-content";
      content.style.display = isExpanded ? "block" : "none";

      groupedTunes[level].forEach(([key, tune]) => {
        const tuneItem = createTuneItem(key, tune);
        content.appendChild(tuneItem);
      });

      section.appendChild(header);
      section.appendChild(content);
      tuneListDiv.appendChild(section);
    }
  }

  console.log("Tune list rendered (mode:", currentSortMode, ")");
}

function renderSetSelection(tunes) {
  const section = document.createElement("div");
  section.className = "knowledge-section sets-section";

  const header = document.createElement("div");
  header.className = "knowledge-header level-4-header";
  header.textContent = "Select tunes for new set";
  section.appendChild(header);

  Object.entries(tunes)
    .sort((a, b) => {
      const typeCompare = (a[1].type || "").toLowerCase().localeCompare((b[1].type || "").toLowerCase());
      if (typeCompare !== 0) return typeCompare;
      return (a[1].name || "").toLowerCase().localeCompare((b[1].name || "").toLowerCase());
    })
    .forEach(([key, tune]) => {
      const tuneItem = createTuneItem(key, tune);
      tuneItem.classList.toggle("set-selected", selectedSetTuneKeys.has(key));
      section.appendChild(tuneItem);
    });

  tuneListDiv.appendChild(section);
}

function renderSets(sets) {
  tuneListDiv.innerHTML = "";
  const section = document.createElement("div");
  section.className = "knowledge-section sets-section";

  const header = document.createElement("div");
  header.className = "knowledge-header level-4-header";
  header.textContent = "Sets";
  section.appendChild(header);

  if (!sets) {
    const empty = document.createElement("div");
    empty.className = "sets-content";
    empty.textContent = "No sets saved.";
    section.appendChild(empty);
  } else {
    Object.entries(sets).forEach(([setKey, savedSet]) => {
      const set = { ...savedSet, key: setKey };
      const setItem = document.createElement("div");
      setItem.className = "sets-content";
      setItem.dataset.setKey = set.key;
      setItem.classList.toggle("selected", !!activeSet && activeSet.key === set.key);

      const setName = document.createElement("span");
      setName.className = "set-name";
      setName.textContent = set.name || (set.tunes || []).map(tune => typeof tune === "object" ? tune.name : tune).join(", ");
      setItem.appendChild(setName);

      const playSetButton = document.createElement("button");
      playSetButton.className = "inline-link-btn set-play-button";
      playSetButton.type = "button";
      playSetButton.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5"/><path d="M6.3 5v6L11 8z" fill="currentColor" stroke="none"/></svg>';
      playSetButton.title = "Play set from the start";
      playSetButton.addEventListener("click", function (event) {
        event.stopPropagation();
        renderSetPlayback(set, tunesCache || {});
        playSelectedSet();
      });
      setItem.appendChild(playSetButton);

      setItem.addEventListener("click", function () {
        renderSetPlayback(set, tunesCache || {});
      });
      section.appendChild(setItem);
    });
  }

  tuneListDiv.appendChild(section);
}

function getTuneLinks(tune) {
  if (Array.isArray(tune.links)) {
    return tune.links.map(link => ({
      url: link.url || "",
      start: Number(link.start) || 0,
      end: link.end === "" || link.end === undefined ? "" : Number(link.end) || 0,
      selected: link.selected === true
    }));
  }
  if (tune.link) {
    return [{ url: tune.link, start: Number(tune.cue) || 0, end: "" }];
  }
  return [];
}

function playTuneLink(link) {
  const videoID = getYouTubeVideoID(link.url);
  if (!videoID) return;
  loadYouTubeAPI(() => {
    createYouTubePlayer(videoID, Number(link.start) || 0);
  });
}

function renderRepertoireLinksEditor(tune) {
  editingTuneLinks = getTuneLinks(tune);
  if (editingTuneLinks.length === 0) {
    editingTuneLinks.push({ url: "", start: 0, end: "" });
  }
  repertoireLinksEditor.innerHTML = "";
  editingTuneLinks.forEach((link, index) => {
    repertoireLinksEditor.appendChild(createRepertoireLinkRow(link, index));
  });
}

function createRepertoireLinkRow(link, index) {
  const row = document.createElement("div");
  row.className = "repertoire-link-row";

  const playButton = document.createElement("button");
  playButton.textContent = "Play";
  playButton.type = "button";
  playButton.addEventListener("click", () => playTuneLink(editingTuneLinks[index]));

  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.placeholder = "YouTube link";
  urlInput.value = link.url || "";
  urlInput.addEventListener("input", () => { editingTuneLinks[index].url = urlInput.value.trim(); });

  const startInput = document.createElement("input");
  startInput.type = "number";
  startInput.min = "0";
  startInput.step = "0.1";
  startInput.placeholder = "Start";
  startInput.value = link.start || 0;
  startInput.addEventListener("input", () => { editingTuneLinks[index].start = Number(startInput.value) || 0; });

  const endInput = document.createElement("input");
  endInput.type = "number";
  endInput.min = "0";
  endInput.step = "0.1";
  endInput.placeholder = "End";
  endInput.value = link.end;
  endInput.addEventListener("input", () => { editingTuneLinks[index].end = endInput.value === "" ? "" : Number(endInput.value) || 0; });

  row.appendChild(playButton);
  row.appendChild(urlInput);
  row.appendChild(startInput);
  row.appendChild(endInput);
  return row;
}

function getSetTunes(set, repertoire) {
  const savedTunes = Array.isArray(set.tunes) ? set.tunes : Object.values(set.tunes || {});
  return savedTunes.map(savedTune => {
    if (typeof savedTune === "object") {
      const links = getTuneLinks(savedTune);
      if (savedTune.selectedLinkIndex !== undefined && links[savedTune.selectedLinkIndex]) {
        links[savedTune.selectedLinkIndex].selected = true;
      }
      return {
        key: savedTune.key || "",
        name: savedTune.name || "Unnamed tune",
        type: savedTune.type || "",
        links: links
      };
    }

    const match = Object.entries(repertoire).find(([, tune]) => tune.name === savedTune);
    return match
      ? { key: match[0], name: match[1].name || savedTune, type: match[1].type || "", links: getTuneLinks(match[1]) }
      : { key: "", name: savedTune, type: "", links: [] };
  });
}

function renderSetPlayback(set, repertoire) {
  destroySetPlayers();
  clearInterval(setPlaybackTimer);
  if (youtubePlayer && typeof youtubePlayer.destroy === "function") {
    youtubePlayer.destroy();
    youtubePlayer = null;
  }
  youtubePlayerContainer.innerHTML = "";
  youtubePlayerContainer.classList.add("hidden");
  activeSet = set;
  activeSet.tunes = getSetTunes(set, repertoire);
  document.querySelectorAll(".sets-content").forEach(item => {
    item.classList.toggle("selected", item.dataset.setKey === set.key);
  });
  setPlaybackQueue = [];
  setPlaybackIndex = -1;
  setPlaybackPanel.innerHTML = "";
  setPlaybackPanel.classList.remove("hidden");
  tuneDetailsContainer.classList.remove("hidden");
  detailsControls.classList.add("hidden");
  detailsDisplay.classList.add("hidden");
  // The set editor (rename + links) starts hidden; the bar's Edit button toggles it
  setPlaybackPanel.classList.remove("editing");
  setEditorButtonState(false);

  const defaultSetName = set.name || activeSet.tunes.map(tune => tune.name).filter(Boolean).join(", ");
  set.name = defaultSetName;
  const setActions = document.createElement("div");
  setActions.className = "set-playback-actions";

  const renameSetButton = document.createElement("button");
  renameSetButton.type = "button";
  renameSetButton.textContent = "Rename";

  const setNameInput = document.createElement("input");
  setNameInput.type = "text";
  setNameInput.className = "set-name-input";
  setNameInput.classList.add("hidden");
  setNameInput.value = defaultSetName;
  setNameInput.placeholder = "Set name";
  renameSetButton.addEventListener("click", function () {
    renameSetButton.classList.add("hidden");
    setNameInput.classList.remove("hidden");
    setNameInput.focus();
  });
  setNameInput.addEventListener("blur", function () {
    setNameInput.classList.add("hidden");
    renameSetButton.classList.remove("hidden");
  });
  setNameInput.addEventListener("input", function () {
    set.name = setNameInput.value;
    if (set.key) {
      database.ref(`sets/${currentMode}/${set.key}/name`).set(set.name, reportWriteError);
    }
    document.querySelectorAll(".sets-content").forEach(setItem => {
      if (setItem.dataset.setKey === set.key) {
        const setName = setItem.querySelector(".set-name");
        if (setName) setName.textContent = set.name;
      }
    });
  });
  setActions.appendChild(renameSetButton);
  setActions.appendChild(setNameInput);
  setPlaybackPanel.appendChild(setActions);

  activeSet.tunes.forEach((tune, tuneIndex) => {
    const tuneBlock = document.createElement("div");
    tuneBlock.className = "set-tune-block";

    const tuneHeader = document.createElement("div");
    tuneHeader.className = "set-tune-header";
    tuneHeader.textContent = tune.type ? `${tune.name} (${tune.type})` : tune.name;
    tuneBlock.appendChild(tuneHeader);

    const linksContainer = document.createElement("div");
    linksContainer.className = "set-links";
    tune.links.forEach((link, linkIndex) => {
      linksContainer.appendChild(createSetLinkRow(tuneIndex, linkIndex, link));
    });

    const addLinkButton = document.createElement("button");
    addLinkButton.textContent = "Add link";
    addLinkButton.addEventListener("click", function () {
      tune.links.push({ url: "", start: 0, end: "" });
      linksContainer.appendChild(createSetLinkRow(tuneIndex, tune.links.length - 1, tune.links[tune.links.length - 1]));
    });

    tuneBlock.appendChild(linksContainer);
    tuneBlock.appendChild(addLinkButton);
    setPlaybackPanel.appendChild(tuneBlock);
  });

  // Delete set: first press slides out "Are you sure?", which does the delete
  const deleteRow = document.createElement("div");
  deleteRow.className = "set-delete-row";
  const deleteSetButton = document.createElement("button");
  deleteSetButton.type = "button";
  deleteSetButton.className = "danger-btn";
  deleteSetButton.textContent = "Delete set";
  const confirmSlide = document.createElement("span");
  confirmSlide.className = "confirm-slide";
  const confirmDeleteButton = document.createElement("button");
  confirmDeleteButton.type = "button";
  confirmDeleteButton.className = "danger-btn danger-solid";
  confirmDeleteButton.textContent = "Are you sure?";
  deleteSetButton.addEventListener("click", function () {
    confirmSlide.classList.toggle("open");
  });
  confirmDeleteButton.addEventListener("click", deleteActiveSet);
  confirmSlide.appendChild(confirmDeleteButton);
  deleteRow.appendChild(deleteSetButton);
  deleteRow.appendChild(confirmSlide);
  setPlaybackPanel.appendChild(deleteRow);
}

function formatSetTime(seconds) {
  if (seconds === "" || seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return "";
  const totalSeconds = Number(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds - minutes * 60;
  const displaySeconds = Number.isInteger(remainingSeconds) ? String(remainingSeconds) : remainingSeconds.toFixed(1).replace(/\.0$/, "");
  return `${minutes}:${displaySeconds.padStart(2, "0")}`;
}

function parseSetTime(value) {
  const trimmedValue = value.trim();
  if (!trimmedValue) return "";
  if (trimmedValue.includes(":")) {
    const parts = trimmedValue.split(":");
    if (parts.length !== 2) return NaN;
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    return Number.isFinite(minutes) && Number.isFinite(seconds) ? minutes * 60 + seconds : NaN;
  }
  return Number(trimmedValue);
}

function setupSetTimeInput(input, getValue, setValue) {
  input.type = "text";
  input.inputMode = "decimal";
  input.addEventListener("focus", () => {
    input.value = formatSetTime(getValue());
  });
  input.addEventListener("input", () => {
    const seconds = parseSetTime(input.value);
    if (seconds !== "" && Number.isFinite(seconds)) {
      setValue(seconds);
      syncSetSelections();
    }
  });
  input.addEventListener("blur", () => {
    const seconds = parseSetTime(input.value);
    if (seconds === "" || Number.isFinite(seconds)) {
      setValue(seconds);
      input.value = seconds === "" ? "" : String(seconds);
      syncSetSelections();
    }
  });
}

function createSetLinkRow(tuneIndex, linkIndex, link) {
  const row = document.createElement("div");
  row.className = "set-link-row";
  row.dataset.tuneIndex = tuneIndex;

  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.placeholder = "YouTube link";
  urlInput.value = link.url || "";
  urlInput.addEventListener("input", () => {
    activeSet.tunes[tuneIndex].links[linkIndex].url = urlInput.value.trim();
    syncSetSelections();
  });

  const selectInput = document.createElement("input");
  selectInput.type = "checkbox";
  selectInput.title = "Use this version in Play set";
  selectInput.checked = link.selected === true;
  selectInput.addEventListener("change", () => {
    const tuneLinks = activeSet.tunes[tuneIndex].links;
    if (selectInput.checked) {
      tuneLinks.forEach((tuneLink, index) => {
        tuneLink.selected = index === linkIndex;
      });
      setPlaybackPanel.querySelectorAll(`.set-link-row[data-tune-index="${tuneIndex}"] input[type="checkbox"]`).forEach((checkbox, index) => {
        checkbox.checked = index === linkIndex;
      });
    } else {
      tuneLinks[linkIndex].selected = false;
    }
    syncSetSelections();
  });

  const startInput = document.createElement("input");
  startInput.className = "set-time-input";
  startInput.placeholder = "Start (s)";
  startInput.value = String(link.start || 0);
  setupSetTimeInput(
    startInput,
    () => activeSet.tunes[tuneIndex].links[linkIndex].start,
    seconds => { activeSet.tunes[tuneIndex].links[linkIndex].start = seconds === "" ? 0 : seconds; }
  );

  const endInput = document.createElement("input");
  endInput.className = "set-time-input";
  endInput.placeholder = "End";
  endInput.value = link.end === "" ? "" : String(link.end);
  setupSetTimeInput(
    endInput,
    () => activeSet.tunes[tuneIndex].links[linkIndex].end,
    seconds => { activeSet.tunes[tuneIndex].links[linkIndex].end = seconds; }
  );

  const playButton = document.createElement("button");
  playButton.textContent = "Play";
  playButton.addEventListener("click", () => playSetLink(tuneIndex, linkIndex));

  row.appendChild(selectInput);
  row.appendChild(urlInput);
  row.appendChild(startInput);
  row.appendChild(endInput);
  row.appendChild(playButton);
  return row;
}

// Edit button in a set: "Save" (darker) while the editor is open, "Edit" otherwise
function setEditorButtonState(editing) {
  editDetailsBtn.classList.toggle("open", editing);
  editDetailsBtn.textContent = editing ? "Save" : "Edit";
}

function deleteActiveSet() {
  if (!activeSet || !activeSet.key) return;

  database.ref(`sets/${currentMode}/${activeSet.key}`).remove(function (error) {
    if (error) {
      reportWriteError(error);
      return;
    }
    activeSet = null;
    destroySetPlayers();
    setPlaybackPanel.classList.add("hidden");
    setPlaybackPanel.classList.remove("editing");
    setEditorButtonState(false);
    tuneDetailsContainer.classList.add("hidden");
  });
}

function syncSetSelections() {
  if (!activeSet || !activeSet.key) return;
  database.ref(`sets/${currentMode}/${activeSet.key}/tunes`).set(activeSet.tunes, reportWriteError);
}

// Helper function to create a tune item
function createTuneItem(key, tune) {
  const tuneLinks = getTuneLinks(tune).filter(link => link.url.trim() !== "").slice(0, 4);
  const hasLink = tuneLinks.length > 0;

  // A link has backing timings when the tune has a chord chart and a sync saved for that video
  function hasChordTimings(tune, link) {
    const sync = tune.chordChart && tune.chordChart.abc && tune.chordSync && tune.chordSync[getYouTubeVideoID(link.url)];
    return !!(sync && ((sync.points && sync.points.length) || (sync.taps && sync.taps.length)));
  }

  // Knowledge level shown as a small dot; selection as a highlight
  const knowledge = parseInt(tune.knowledge) || 0;

  // Row container
  const tuneItem = document.createElement("div");
  tuneItem.className = `tune-item knowledge-${Math.min(knowledge, 4)}`;
  tuneItem.classList.toggle("selected", selectedTuneKey === key);
  tuneItem.setAttribute("data-key", key);

  // Inner HTML
  tuneItem.innerHTML = `
    <span class="knowledge-dot" title="Knowledge ${knowledge || "not set"}"></span>
    <div class="tune-name">${escapeHtml(tune.name || "")}</div>
    <div class="tune-key">${escapeHtml(tune.key || "")}</div>
    <div class="tune-type">${escapeHtml(tune.type || "")}</div>
    <div class="inline-link-buttons">
      ${tuneLinks.map((link, index) => `<button class="inline-link-btn available${hasChordTimings(tune, link) ? " has-timings" : ""}" title="Play saved link ${index + 1}${hasChordTimings(tune, link) ? " (chord timings saved)" : ""}" data-link-index="${index}" data-key="${key}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5"/><path d="M6.3 5v6L11 8z" fill="currentColor" stroke="none"/></svg></button>`).join("")}
    </div>
  `;

  // Row click handler
  tuneItem.addEventListener("click", function (e) {
    if (e.target.closest(".inline-link-btn")) return;

    if (isSelectingSet) {
      if (selectedSetTuneKeys.has(key)) {
        selectedSetTuneKeys.delete(key);
      } else {
        selectedSetTuneKeys.add(key);
      }
      tuneItem.classList.toggle("set-selected", selectedSetTuneKeys.has(key));
      return;
    }

    if (!saveDetailsBtn.classList.contains("hidden") && selectedTuneKey && selectedTuneKey !== key) {
      saveEditedTune(() => tuneItem.click());
      return;
    }

    selectedTuneKey = key;
    setShareHash(key);
    activeSet = null;
    setEditorButtonState(false);
    destroySetPlayers();
    setPlaybackPanel.classList.add("hidden");
    document.getElementById("chordDiagramsContainer").innerHTML = "";

    // Destroy existing YouTube player
    if (player && typeof player.destroy === "function") {
      player.destroy();
      player = null;
    }
    youtubePlayerContainer.innerHTML = "";
    youtubePlayerContainer.classList.add("hidden");

    // Populate details
    tuneDetailsText.value = tune.details || "";
    detailsDisplay.textContent = tune.details || "";
    tuneDetailsText.classList.add("hidden");
    saveDetailsBtn.classList.add("hidden");
    updateDetailsDisplay();
    editDetailsBtn.classList.remove("hidden");
    tuneDetailsContainer.classList.remove("hidden");

    // First link: what the play button opens when no video is showing yet
    selectedTuneUrl = hasLink ? tuneLinks[0].url.trim() : "";

    // Full tune data (including cue) from the live cache
    const data = (tunesCache && tunesCache[key]) || {};
    tuneData[selectedTuneKey] = data;

    // Chords
    chordInput.value = data.chords || "";
    chordInput.classList.add("hidden");
    showTuneChords(data);
    ChordSync.showTune(key);

    // Cue input
    if (data.cue !== undefined) {
      currentCue = data.cue;
      document.getElementById("cueInput").value = currentCue;
    } else {
      currentCue = 0;
      document.getElementById("cueInput").value = "";
    }

    // Re-render list to update highlights
    loadTunes();
  });

  // Inline play button handler
  if (hasLink) {
    tuneItem.querySelectorAll(".inline-link-btn.available").forEach(btn => {
      btn.addEventListener("click", function (e) {
      e.stopPropagation();

      // Select this tune row
      const row = document.querySelector(`[data-key="${this.dataset.key}"]`);
      if (row) row.click();

      setShareHash(this.dataset.key, Number(this.dataset.linkIndex));

      // A video with chord timings: start the piano backing too
      if (autoBackingInput.checked && this.classList.contains("has-timings")) ChordSync.startBacking("piano");

      // Play via YouTube IFrame API
      const link = tuneLinks[Number(this.dataset.linkIndex)];
      const url = link.url;
      const videoID = getYouTubeVideoID(url);
      if (videoID) {
        loadYouTubeAPI(() => {
          createYouTubePlayer(videoID, Number(link.start) || currentCue);
        });
      } else {
        window.open(url, "_blank");
      }
      });
    });
  }

  return tuneItem;
}


// Random button: play a random link from a random repertoire (knowledge 4) tune
document.getElementById("randomBtn").addEventListener("click", function () {
  {
    const tunes = tunesCache || {};
    const candidates = Object.entries(tunes)
      .filter(([, tune]) => parseInt(tune.knowledge) === 4)
      .map(([key, tune]) => [key, getTuneLinks(tune).filter(link => getYouTubeVideoID(link.url))])
      .filter(([, links]) => links.length > 0);

    if (candidates.length === 0) {
      alert("No repertoire tunes with YouTube links.");
      return;
    }

    const [key, links] = candidates[Math.floor(Math.random() * candidates.length)];
    const link = links[Math.floor(Math.random() * links.length)];

    if (isSetsMode) leaveSetsMode();
    renderTuneList(tunes);
    const row = tuneListDiv.querySelector(`.tune-item[data-key="${key}"]`);
    if (row) row.click();

    playTuneLink(link);
  }
});

// Open the selected tune's first link (used by the play button when no video is showing)
function playSelectedTuneLink() {
  const url = selectedTuneUrl;
  if (!url) return;

  const videoID = getYouTubeVideoID(url);
  if (videoID) {
    loadYouTubeAPI(() => {
      createYouTubePlayer(videoID, currentCue);
    });
  } else {
    window.open(url, "_blank");
  }
}





// Edit fields
editDetailsBtn.addEventListener("click", function () {
  // In a set, Edit shows the set editor and becomes Save; Save closes it
  // (set changes are written as you make them; Save writes once more to be sure)
  if (activeSet) {
    const editing = setPlaybackPanel.classList.toggle("editing");
    setEditorButtonState(editing);
    if (!editing) syncSetSelections();
    return;
  }

  tuneDetailsText.classList.remove("hidden");
  chordInput.classList.remove("hidden");
  nameInput.classList.remove("hidden");
  linkInput.classList.add("hidden");
  repertoireLinksEditor.classList.remove("hidden");
  addRepertoireLinkBtn.classList.remove("hidden");
  keyInput.classList.remove("hidden");
  typeInput.classList.remove("hidden");
  editKnowledgeInput.classList.remove("hidden");
  likelyChordsInput.classList.remove("hidden");
  chartChordsInput.classList.remove("hidden");

  detailsDisplay.classList.add("hidden");
  detailsControls.classList.add("hidden");
  editDetailsBtn.classList.add("hidden");
  saveDetailsBtn.classList.remove("hidden");

  // Pre-fill edit fields
  var tune = tuneData[selectedTuneKey] || {};
  tuneDetailsText.value = tune.details || "";
  chordInput.value = tune.chords || "";
  nameInput.value = tune.name || "";
  linkInput.value = tune.link || "";
  renderRepertoireLinksEditor(tune);
  keyInput.value = tune.key || "";
  typeInput.value = tune.type || "";
  editKnowledgeInput.value = tune.knowledge || "";
  likelyChordsInput.value = likelyChordsForKey(keyInput.value);
  // Live copy, so a chart imported after the tune was opened still shows
  chartChordsInput.value = ChordSync.chartChords((tunesCache && tunesCache[selectedTuneKey]) || tune).join(" ");
});

keyInput.addEventListener("input", function () {
  likelyChordsInput.value = likelyChordsForKey(keyInput.value);
});

addRepertoireLinkBtn.addEventListener("click", function () {
  const newLink = { url: "", start: 0, end: "" };
  editingTuneLinks.push(newLink);
  repertoireLinksEditor.appendChild(createRepertoireLinkRow(newLink, editingTuneLinks.length - 1));
});

function finishEditingTune() {
  editDetailsBtn.classList.remove("hidden");
  saveDetailsBtn.classList.add("hidden");
  tuneDetailsText.classList.add("hidden");
  chordInput.classList.add("hidden");
  nameInput.classList.add("hidden");
  linkInput.classList.add("hidden");
  repertoireLinksEditor.classList.add("hidden");
  addRepertoireLinkBtn.classList.add("hidden");
  keyInput.classList.add("hidden");
  typeInput.classList.add("hidden");
  editKnowledgeInput.classList.add("hidden");
  likelyChordsInput.classList.add("hidden");
  chartChordsInput.classList.add("hidden");
  updateDetailsDisplay();
}

function saveEditedTune(onComplete) {
  var details = tuneDetailsText.value;
  var chords = chordInput.value;
  var name = nameInput.value;
  var links = editingTuneLinks.filter(link => link.url.trim() !== "");
  var link = links.length > 0 ? links[0].url : "";
  var keyVal = keyInput.value;
  var type = typeInput.value;
  var knowledge = editKnowledgeInput.value;
  var likelyChords = likelyChordsForKey(keyVal);

  if (!selectedTuneKey) {
      alert("No tune selected.");
      return;
  }

  database.ref(`tunes/${currentMode}/${selectedTuneKey}`).update({
      details: details,
      chords: chords,
      name: name,
      link: link,
      links: links,
      key: keyVal,
      type: type,
      knowledge: knowledge,
      likelyChords: likelyChords
  }, function (error) {
      if (error) {
          reportWriteError(error);
      } else {
          detailsDisplay.textContent = details;
          tuneData[selectedTuneKey] = {
            ...(tuneData[selectedTuneKey] || {}),
            details, chords, name, link, links, key: keyVal, type, knowledge, likelyChords
          };
          finishEditingTune();
          showTuneChords(tuneData[selectedTuneKey]);
          if (onComplete) onComplete();
      }
  });
}

// Save edited details
saveDetailsBtn.addEventListener("click", function () {
  saveEditedTune();
});

  











let scrollInterval = null;

const startScrollBtn = document.getElementById("startScrollBtn");
const stopScrollBtn = document.getElementById("stopScrollBtn");
const scrollSpeedInput = document.getElementById("scrollSpeed");
const container = document.getElementById("detailsDisplay");

// Helper function to (re)start autoscroll with the current speed settings.
function setAutoScroll() {
    const speed = parseInt(scrollSpeedInput.value); // 1 (slow) to 10 (fast)
    const intervalMs = 500 / speed; // Higher speed = shorter interval
    const scrollStep = 0.5 + speed / 10; // Pixels per scroll step

    // Clear any existing interval before creating a new one.
    clearInterval(scrollInterval);
    scrollInterval = setInterval(() => {
        if ((container.scrollTop + container.clientHeight) >= container.scrollHeight) {
            stopAutoScroll();
        } else {
            container.scrollTop += scrollStep;
        }
    }, intervalMs);
}

startScrollBtn.addEventListener("click", () => {
    setAutoScroll();
    startScrollBtn.disabled = true;
    stopScrollBtn.disabled = false;
});

// When the slider is changed, update the autoscroll if it's active.
scrollSpeedInput.addEventListener("input", () => {
    if (scrollInterval) {
        setAutoScroll();
    }
});

function stopAutoScroll() {
    clearInterval(scrollInterval);
    scrollInterval = null;
    startScrollBtn.disabled = false;
    stopScrollBtn.disabled = true;
}


stopScrollBtn.addEventListener("click", stopAutoScroll);


const scrollToTopBtn = document.getElementById("scrollToTopBtn");

scrollToTopBtn.addEventListener("click", () => {
    const container = document.getElementById("detailsDisplay");

    // Scroll to the top
    container.scrollTop = 0;

    // Stop autoscroll if active
    stopAutoScroll();

});












// Show the tune's own chords, or fall back to the chords likely for its key
function showTuneChords(tune) {
    const own = (tune.chords || "").trim();
    if (own) return showChordDiagrams(own);
    const chartChords = ChordSync.chartChords(tune);
    if (chartChords.length) return showChordDiagrams(chartChords.join(" "));
    showChordDiagrams(likelyChordsForKey(tune.key) || tune.likelyChords, "Likely chords");
}

function showChordDiagrams(chords, label) {
    const chordDiagramsContainer = document.getElementById("chordDiagramsContainer");
    chordDiagramsContainer.innerHTML = ""; // Clear previous diagrams

    // Split on spaces/commas; files use "s" for sharps (F#m -> Fsm.png)
    const chordList = (chords || "").split(/[\s,]+/).filter(Boolean);
    if (chordList.length === 0) {
        chordDiagramsContainer.classList.add("hidden");
        return;
    }

    if (label) {
        const caption = document.createElement("div");
        caption.className = "chord-diagrams-label";
        caption.textContent = label;
        chordDiagramsContainer.appendChild(caption);
    }

    // Added in order straight away; each stays hidden until it loads, and is dropped if missing
    chordList.forEach(function(chord) {
        const img = new Image();
        img.alt = chord;
        img.classList.add("chord-diagram");
        img.style.visibility = "hidden";
        img.dataset.chord = chord;
        img.onload = function() { img.style.visibility = ""; };
        // No diagram for e.g. Am9: try Am7, then Am, before giving up
        const candidates = ChordChart.fallbacks(chord);
        let tryIndex = 0;
        const tryNext = function () {
            const name = candidates[tryIndex++];
            if (!name) {
                console.warn("Missing diagram for chord:", chord);
                img.remove();
                return;
            }
            if (name !== chord) img.title = chord + " (diagram shows " + name + ")";
            img.src = "assets/" + currentMode + "/" + name.replace("#", "s") + ".png";
        };
        img.onerror = tryNext;
        tryNext();
        img.title = "Click to hear " + chord;
        img.addEventListener("click", function () {
            if (!ChordSound.play(chord, currentMode)) return;
            img.classList.remove("strummed");
            void img.offsetWidth; // restart the animation on repeat clicks
            img.classList.add("strummed");
        });
        chordDiagramsContainer.appendChild(img);
    });

    // 7 or 8 chords: shrink the diagrams so they all fit on one line
    const diagramCount = chordDiagramsContainer.querySelectorAll(".chord-diagram").length;
    const oneLine = diagramCount >= 7 && diagramCount <= 8;
    chordDiagramsContainer.classList.toggle("one-line", oneLine);
    chordDiagramsContainer.style.setProperty("--diagrams", oneLine ? diagramCount : "");
    chordDiagramsContainer.classList.remove("hidden");
}


// Player controls are wired once; they act on whichever youtubePlayer is current
setupLoopControls();
setupPlayPauseButton();
setupSpeedControls();
setupCueButton();


function showErrorOnRefreshBtn() {
  const refreshBtn = document.getElementById("refreshbtn");
  if (!refreshBtn) return;

  refreshBtn.classList.add("error");

  setTimeout(() => {
    refreshBtn.classList.remove("error");
  }, 10000);
}

