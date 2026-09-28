// Firebase config (v8 style)
var firebaseConfig = {
  apiKey: "AIzaSyAZt1pHQvfBNm2goItl5pFk3h5SqE5rOg",
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
var setPreparedQueueIndexes = [-1, -1];
var setActivePlayerIndex = 0;
var setPendingTransition = false;
var editingTuneLinks = [];

// DOM Elements
var guitarBtn = document.getElementById("guitarBtn");
var mandolinBtn = document.getElementById("mandolinBtn");
var tuneNameInput = document.getElementById("tuneName");
var knowledgeInput = document.getElementById("knowledge");
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
const repertoireLinksEditor = document.getElementById("repertoireLinksEditor");
const addRepertoireLinkBtn = document.getElementById("addRepertoireLinkBtn");
var clickLinkBtn = document.getElementById("clicklink");
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


let currentSortMode = 0; // 0=knowledge, 1=name, 2=type
const knowledgeHeaders = {
  1: "Next up",
  2: "In progress",
  3: "Outdated",
  4: "Repertoire"
};
const expandedKnowledgeLevels = {
  1: false,
  2: false,
  3: false
};
const sortBtn = document.getElementById("sortbtn");

sortBtn.addEventListener("click", () => {
  currentSortMode = (currentSortMode + 1) % 3; // cycle 0->1->2->0
  console.log("Sort mode changed to", currentSortMode);
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

// Mode toggle / load tunes
function loadTunes() {
  if (isSetsMode && !isSelectingSet) {
    database.ref("sets/" + currentMode).once("value", function (snapshot) {
      renderSets(snapshot.val());
    });
    return;
  }

  var tunesRef = database.ref("tunes/" + currentMode);
  tunesRef.once("value", function (snapshot) {
    var tunes = snapshot.val();
    renderTuneList(tunes);
  });
}


guitarBtn.addEventListener("click", function () {
  currentMode = "guitar";
  updateModeClass();
  leaveSetsMode();
  guitarBtn.classList.add("active");
  mandolinBtn.classList.remove("active");
  selectedTuneKey = null;
  tuneDetailsContainer.classList.add("hidden");
  loadTunes();
});

mandolinBtn.addEventListener("click", function () {
  currentMode = "mandolin";
  updateModeClass();
  leaveSetsMode();
  mandolinBtn.classList.add("active");
  guitarBtn.classList.remove("active");
  selectedTuneKey = null;
  tuneDetailsContainer.classList.add("hidden");
  loadTunes();
});

// Save a new tune
saveTuneBtn.addEventListener("click", function () {
  var tuneName = tuneNameInput.value.trim();
  var newTune = {
    name: tuneName,
    details: "",
    mode: currentMode
  };
  database.ref("tunes/" + currentMode).push(newTune, function (error) {
    if (error) {
      console.error("Error saving tune:", error);
    } else {
      tuneNameInput.value = "";
      knowledgeInput.value = "";
    }
  });
});

// Refresh button functionality
refreshBtn.addEventListener("click", function () {
  console.log("Refreshing tunes list...");
  selectedTuneKey = null;
  tuneDetailsContainer.classList.add("hidden");
  loadTunes();
});

function updateSetControls() {
  setsBtn.textContent = isSetsMode ? "Repertoire" : "Sets";
  addSetBtn.classList.toggle("hidden", !isSetsMode || isSelectingSet);
  saveSetBtn.classList.toggle("hidden", !isSetsMode || !isSelectingSet);
  loopControls.classList.toggle("hidden", isSetsMode);
}

function leaveSetsMode() {
  isSetsMode = false;
  isSelectingSet = false;
  selectedSetTuneKeys.clear();
  activeSet = null;
  destroySetPlayers();
  setPlaybackPanel.classList.add("hidden");
  editControls.classList.remove("hidden");
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

  database.ref("tunes/" + currentMode).once("value", function (snapshot) {
    const tunes = snapshot.val() || {};
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
        console.error("Error saving set:", error);
        return;
      }
      isSelectingSet = false;
      selectedSetTuneKeys.clear();
      updateSetControls();
      loadTunes();
    });
  });
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
        youtubePlayer.seekTo(cueTime, true);
        if (autoplay) youtubePlayer.playVideo();
        setupSpeedControls();
        setupCueButton();
        setupPlayPauseButton();  // Setup your play/pause button events here
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

function destroySetPlayers() {
  clearInterval(setPlaybackTimer);
  setPlaybackTimer = null;
  setPendingTransition = false;
  setYoutubePlayers.forEach((setPlayer, index) => {
    if (setPlayer && typeof setPlayer.destroy === "function") setPlayer.destroy();
    setYoutubePlayers[index] = null;
    setPlayerReady[index] = false;
    setPreparedQueueIndexes[index] = -1;
  });
  document.getElementById("setYoutubePlayerA").innerHTML = "";
  document.getElementById("setYoutubePlayerB").innerHTML = "";
  setYoutubePlayersContainer.classList.add("hidden");
}

function prepareSetPlayer(playerIndex, queueIndex, autoplay) {
  const link = setPlaybackQueue[queueIndex];
  if (!link) return;

  const playerContainer = document.getElementById(playerIndex === 0 ? "setYoutubePlayerA" : "setYoutubePlayerB");
  if (setYoutubePlayers[playerIndex] && typeof setYoutubePlayers[playerIndex].destroy === "function") {
    setYoutubePlayers[playerIndex].destroy();
  }
  playerContainer.innerHTML = `<div id="setYtPlayer${playerIndex}" class="set-youtube-player-frame"></div>`;
  setYoutubePlayers[playerIndex] = null;
  setPlayerReady[playerIndex] = false;
  setPreparedQueueIndexes[playerIndex] = queueIndex;

  const videoID = getYouTubeVideoID(link.url);
  if (!videoID) return;

  setYoutubePlayers[playerIndex] = new YT.Player(`setYtPlayer${playerIndex}`, {
    height: "100%",
    width: "100%",
    videoId: videoID,
    playerVars: { autoplay: 0, playsinline: 1, origin: window.location.origin },
    events: {
      onReady: event => {
        setPlayerReady[playerIndex] = true;
        event.target.seekTo(Number(link.start) || 0, true);
        if (autoplay) {
          event.target.playVideo();
        } else {
          event.target.pauseVideo();
        }
        if (setPendingTransition && playerIndex !== setActivePlayerIndex) {
          setPendingTransition = false;
          advanceSetPlayback();
        }
      },
      onStateChange: event => {
        if (playerIndex === setActivePlayerIndex && event.data === YT.PlayerState.ENDED) {
          advanceSetPlayback();
        }
      }
    }
  });
}

function watchActiveSetPlayer() {
  clearInterval(setPlaybackTimer);
  setPlaybackTimer = setInterval(() => {
    const player = setYoutubePlayers[setActivePlayerIndex];
    const link = setPlaybackQueue[setPlaybackIndex];
    if (!player || !link || typeof player.getCurrentTime !== "function") return;

    const currentTime = player.getCurrentTime();
    const duration = typeof player.getDuration === "function" ? player.getDuration() : 0;
    const endTime = link.end === "" || link.end === undefined ? duration : Number(link.end);
    if (!endTime) return;

    const nextIndex = setPlaybackIndex + 1;
    const nextPlayerIndex = setActivePlayerIndex === 0 ? 1 : 0;
    if (
      nextIndex < setPlaybackQueue.length &&
      setPreparedQueueIndexes[nextPlayerIndex] !== nextIndex &&
      endTime - currentTime <= 10
    ) {
      prepareSetPlayer(nextPlayerIndex, nextIndex, false);
    }

    if (currentTime >= endTime) advanceSetPlayback();
  }, 100);
}

function advanceSetPlayback() {
  if (setPendingTransition) return;
  const nextIndex = setPlaybackIndex + 1;
  if (nextIndex >= setPlaybackQueue.length) {
    clearInterval(setPlaybackTimer);
    return;
  }

  const nextPlayerIndex = setActivePlayerIndex === 0 ? 1 : 0;
  if (!setPlayerReady[nextPlayerIndex]) {
    setPendingTransition = true;
    clearInterval(setPlaybackTimer);
    return;
  }

  setActivePlayerIndex = nextPlayerIndex;
  setPlaybackIndex = nextIndex;
  setYoutubePlayers[setActivePlayerIndex].playVideo();
  watchActiveSetPlayer();
}

function startSetPlayback() {
  if (setPlaybackQueue.length === 0) return;

  destroySetPlayers();
  setPlaybackIndex = 0;
  setActivePlayerIndex = 0;
  setYoutubePlayersContainer.classList.remove("hidden");
  loadYouTubeAPI(() => {
    prepareSetPlayer(0, 0, true);
    watchActiveSetPlayer();
  });
}


function setupPlayPauseButton() {
  const playPauseBtn = document.getElementById("playPauseBtn");
  if (!playPauseBtn) return;

  playPauseBtn.addEventListener("click", () => {
    if (!youtubePlayer || typeof youtubePlayer.getPlayerState !== "function") return;

    const state = youtubePlayer.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
      youtubePlayer.pauseVideo();
    } else {
      youtubePlayer.playVideo();
    }
  });
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
function setupSpeedControls() {
  document.querySelectorAll(".speed-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const speed = parseFloat(btn.dataset.speed);
      if (youtubePlayer && youtubePlayer.setPlaybackRate) {
        youtubePlayer.setPlaybackRate(speed);
      }
    });
  });
}

// Cue button
function setupCueButton() {
  document.getElementById("cueBtn").addEventListener("click", () => {
    if (youtubePlayer && youtubePlayer.seekTo) {
      youtubePlayer.seekTo(currentCue, true);
    }
  });

  document.getElementById("skipBackBtn").addEventListener("click", () => {
    if (youtubePlayer && youtubePlayer.getCurrentTime && youtubePlayer.seekTo) {
      const currentTime = youtubePlayer.getCurrentTime();
      const newTime = Math.max(0, currentTime - 5);
      youtubePlayer.seekTo(newTime, true);
    }
  });

  const cueInput = document.getElementById("cueInput");
  cueInput.value = currentCue;

  cueInput.addEventListener("change", () => {
    currentCue = parseFloat(cueInput.value) || 0;

    if (selectedTuneKey) {
      // Save cue to Firebase
      database.ref(`tunes/${currentMode}/${selectedTuneKey}/cue`).set(currentCue);
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
    loopBtn.style.backgroundColor = loopActive ? "#cce5ff" : "";

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

  // 2) Conditionally sort
  if (currentSortMode === 0) {
    // Composite: knowledge ↓, name ↑, type ↑
    tunesArray.sort((a, b) => {
      const [ , ta ] = a;
      const [ , tb ] = b;

      const ka = parseInt(ta.knowledge) || 0;
      const kb = parseInt(tb.knowledge) || 0;
      if (kb !== ka) return kb - ka;

      const na = (ta.name || "").toLowerCase();
      const nb = (tb.name || "").toLowerCase();
      if (na !== nb) return na.localeCompare(nb);

      const taType = (ta.type || "").toLowerCase();
      const tbType = (tb.type || "").toLowerCase();
      return taType.localeCompare(tbType);
    });
  } else if (currentSortMode === 1) {
    // Name only
    tunesArray.sort((a, b) =>
      (a[1].name || "").toLowerCase().localeCompare((b[1].name || "").toLowerCase())
    );

} else if (currentSortMode === 2) {
  // Sort by type, with ties broken by knowledge descending
  tunesArray.sort((a, b) => {
    const typeA = (a[1].type || "").toLowerCase();
    const typeB = (b[1].type || "").toLowerCase();
    const typeCmp = typeA.localeCompare(typeB);
    if (typeCmp !== 0) {
      return typeCmp;           // different types
    }
    // same type → compare knowledge descending
    const ka = parseInt(a[1].knowledge) || 0;
    const kb = parseInt(b[1].knowledge) || 0;
    return kb - ka;
  });
}

// if currentSortMode === -1, skip sorting => Firebase order

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
  // Level 4 first (always expanded)
  if (groupedTunes[4].length > 0) {
    const section = document.createElement("div");
    section.className = "knowledge-section level-4";

    const header = document.createElement("div");
    header.className = "knowledge-header level-4-header";
    header.textContent = `${knowledgeHeaders[4]} (${groupedTunes[4].length} tunes)`;

    section.appendChild(header);

    groupedTunes[4].forEach(([key, tune]) => {
      const tuneItem = createTuneItem(key, tune);
      section.appendChild(tuneItem);
    });

    tuneListDiv.appendChild(section);
  }

  // Levels 1-3: collapsible sections in descending order
  for (let level = 3; level >= 1; level--) {
    if (groupedTunes[level].length > 0) {
      const section = document.createElement("div");
      section.className = "knowledge-section";

      const header = document.createElement("div");
      header.className = "knowledge-header";
      const isExpanded = expandedKnowledgeLevels[level];
      header.innerHTML = `<span class="toggle-icon">${isExpanded ? '▼' : '▶'}</span> ${knowledgeHeaders[level]} (${groupedTunes[level].length} tunes)`;
      header.addEventListener("click", function() {
        const content = this.nextElementSibling;
        const icon = this.querySelector(".toggle-icon");
        if (content.style.display === "none") {
          content.style.display = "block";
          icon.textContent = "▼";
          expandedKnowledgeLevels[level] = true;
        } else {
          content.style.display = "none";
          icon.textContent = "▶";
          expandedKnowledgeLevels[level] = false;
        }
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

      const setName = document.createElement("span");
      setName.className = "set-name";
      setName.textContent = set.name || (set.tunes || []).map(tune => typeof tune === "object" ? tune.name : tune).join(", ");
      setItem.appendChild(setName);

      const playSetButton = document.createElement("button");
      playSetButton.className = "set-play-button";
      playSetButton.type = "button";
      playSetButton.textContent = "▶";
      playSetButton.title = "Play set from the start";
      playSetButton.addEventListener("click", function (event) {
        event.stopPropagation();
        database.ref("tunes/" + currentMode).once("value", function (snapshot) {
          renderSetPlayback(set, snapshot.val() || {});
          playSelectedSet();
        });
      });
      setItem.appendChild(playSetButton);

      setItem.addEventListener("click", function () {
        database.ref("tunes/" + currentMode).once("value", function (snapshot) {
          renderSetPlayback(set, snapshot.val() || {});
        });
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
  setPlaybackQueue = [];
  setPlaybackIndex = -1;
  setPlaybackPanel.innerHTML = "";
  setPlaybackPanel.classList.remove("hidden");
  tuneDetailsContainer.classList.remove("hidden");
  setYoutubePlayersContainer.classList.remove("hidden");
  editControls.classList.add("hidden");
  detailsControls.classList.add("hidden");
  detailsDisplay.classList.add("hidden");

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
      database.ref(`sets/${currentMode}/${set.key}/name`).set(set.name);
    }
    document.querySelectorAll(".sets-content").forEach(setItem => {
      if (setItem.dataset.setKey === set.key) {
        const setName = setItem.querySelector(".set-name");
        if (setName) setName.textContent = set.name;
      }
    });
  });
  const playSetButton = document.createElement("button");
  playSetButton.type = "button";
  playSetButton.textContent = "Play set";
  playSetButton.addEventListener("click", playSelectedSet);
  setActions.appendChild(renameSetButton);
  setActions.appendChild(setNameInput);
  setActions.appendChild(playSetButton);
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

function syncSetSelections() {
  if (!activeSet || !activeSet.key) return;
  database.ref(`sets/${currentMode}/${activeSet.key}/tunes`).set(activeSet.tunes);
}

// Helper function to create a tune item
function createTuneItem(key, tune) {
  const tuneLinks = getTuneLinks(tune).filter(link => link.url.trim() !== "").slice(0, 4);
  const hasLink = tuneLinks.length > 0;

  // Determine background color
  const knowledge = parseInt(tune.knowledge) || 0;
  let bgColor = "#fff";
  if (knowledge === 1) bgColor = "#fdd";
  else if (knowledge === 2) bgColor = "#ffd";
  else if (knowledge >= 3) bgColor = "#dfd";
  if (selectedTuneKey === key) bgColor = "#cce5ff";

  // Row container
  const tuneItem = document.createElement("div");
  tuneItem.className = "tune-item";
  tuneItem.setAttribute("data-key", key);
  tuneItem.style.cssText = `
    display: flex; justify-content: flex-start; align-items: center;
    gap: 20px; padding: 5px 10px; border-bottom: 1px solid #eee;
    cursor: pointer; background-color: ${bgColor};
  `;

  // Inner HTML
  tuneItem.innerHTML = `
    <div style="flex: 2; text-align: left;">${tune.name || ""}</div>
    <div style="flex: 1; text-align: left;">${tune.key || ""}</div>
    <div style="flex: 1; text-align: left;">${tune.type || ""}</div>
    <div class="inline-link-buttons">
      ${tuneLinks.map((link, index) => `<button class="inline-link-btn available" title="Play saved link ${index + 1}" data-link-index="${index}" data-key="${key}">▶️</button>`).join("")}
    </div>
  `;

  // Row click handler
  tuneItem.addEventListener("click", function (e) {
    if (e.target.classList.contains("inline-link-btn")) return;

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
    activeSet = null;
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

    // Show/hide main link button
    if (hasLink) {
      clickLinkBtn.classList.remove("hidden");
      clickLinkBtn.dataset.url = tune.link.trim();
    } else {
      clickLinkBtn.classList.add("hidden");
      clickLinkBtn.dataset.url = "";
    }

    // Fetch full tune data (including cue)
    database
      .ref(`tunes/${currentMode}/${selectedTuneKey}`)
      .once("value", function (snapshot) {
        const data = snapshot.val() || {};
        tuneData[selectedTuneKey] = data;

        // Chords
        chordInput.value = data.chords || "";
        chordInput.classList.add("hidden");
        if (data.chords) showChordDiagrams(data.chords);

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
  });

  // Inline play button handler
  if (hasLink) {
    tuneItem.querySelectorAll(".inline-link-btn.available").forEach(btn => {
      btn.addEventListener("click", function (e) {
      e.stopPropagation();

      // Select this tune row
      const row = document.querySelector(`[data-key="${this.dataset.key}"]`);
      if (row) row.click();

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


// Main play button (below details pane)
clickLinkBtn.addEventListener("click", function () {
  const url = this.dataset.url;
  if (!url) return;

  const videoID = getYouTubeVideoID(url);
if (videoID) {
  loadYouTubeAPI(() => {
    createYouTubePlayer(videoID, currentCue);
  });
}
 else {
    window.open(url, "_blank");
  }
});


// Initial load
loadTunes();




// Edit fields
editDetailsBtn.addEventListener("click", function () {
  tuneDetailsText.classList.remove("hidden");
  chordInput.classList.remove("hidden");
  nameInput.classList.remove("hidden");
  linkInput.classList.add("hidden");
  repertoireLinksEditor.classList.remove("hidden");
  addRepertoireLinkBtn.classList.remove("hidden");
  keyInput.classList.remove("hidden");
  typeInput.classList.remove("hidden");
  editKnowledgeInput.classList.remove("hidden");

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
      knowledge: knowledge
  }, function (error) {
      if (error) {
          console.error("Error updating tune:", error);
      } else {
          detailsDisplay.textContent = details;
          tuneData[selectedTuneKey] = {
            ...(tuneData[selectedTuneKey] || {}),
            details, chords, name, link, links, key: keyVal, type, knowledge
          };
          finishEditingTune();
          if (onComplete) onComplete();
      }
  });
}

// Save edited details
saveDetailsBtn.addEventListener("click", function () {
  saveEditedTune();
});

  

  
  
  loadTunes();
  










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












function showChordDiagrams(chords) {
    const chordDiagramsContainer = document.getElementById("chordDiagramsContainer");
    chordDiagramsContainer.innerHTML = ""; // Clear previous diagrams

    const chordList = chords.split(" ");

    chordList.forEach(function(chord) {
        const img = new Image();
        img.src = "assets/guitar/" + chord + ".png";
        img.alt = chord;
        img.classList.add("chord-diagram");

        img.onload = function() {
            chordDiagramsContainer.appendChild(img);
        };

        // Do nothing on error (skip the missing image)
        img.onerror = function() {
            console.warn("Missing diagram for chord:", chord);
        };
    });

    chordDiagramsContainer.classList.remove("hidden");
}


setupLoopControls();
setupPlayPauseButton();


function showErrorOnRefreshBtn() {
  const refreshBtn = document.getElementById("refreshbtn");
  if (!refreshBtn) return;

  refreshBtn.style.backgroundColor = "#f5b3c2";

  setTimeout(() => {
    refreshBtn.style.backgroundColor = "";
  }, 10000);
}

function checkConnection() {
  if (!navigator.onLine) {
    showErrorOnRefreshBtn();
  }
}

// Run check immediately on page load
checkConnection();

// Also listen for going offline after load
window.addEventListener('offline', () => {
  console.log('You are offline');
  showErrorOnRefreshBtn();
});

// Optional: clear red when back online
window.addEventListener('online', () => {
  console.log('Back online');
  const refreshBtn = document.getElementById("refreshbtn");
  if (refreshBtn) refreshBtn.style.backgroundColor = "";
});
