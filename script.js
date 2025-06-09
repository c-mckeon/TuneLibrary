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
var saveDetailsBtn = document.getElementById("saveDetails");
var editDetailsBtn = document.getElementById("editDetailsBtn");
var chordInput = document.getElementById("chordInput");
const nameInput = document.getElementById("nameInput");
const linkInput = document.getElementById("linkInput");
const keyInput = document.getElementById("keyInput");
const typeInput = document.getElementById("typeInput");
const editKnowledgeInput = document.getElementById("knowledgeInput");
var clickLinkBtn = document.getElementById("clicklink");
const youtubePlayerContainer = document.getElementById("youtubePlayerContainer");
const refreshBtn = document.getElementById("refreshbtn");


mandolinBtn.classList.add("active");
guitarBtn.classList.remove("active");


let currentSortMode = -1; // 0=knowledge, 1=name, 2=type
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
  var tunesRef = database.ref("tunes/" + currentMode);
  tunesRef.once("value", function (snapshot) {
    var tunes = snapshot.val();
    renderTuneList(tunes);
  });
}


guitarBtn.addEventListener("click", function () {
  currentMode = "guitar";
  guitarBtn.classList.add("active");
  mandolinBtn.classList.remove("active");
  selectedTuneKey = null;
  tuneDetailsContainer.classList.add("hidden");
  loadTunes();
});

mandolinBtn.addEventListener("click", function () {
  currentMode = "mandolin";
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

function createYouTubePlayer(videoID, cueTime = 0) {
youtubePlayerContainer.innerHTML = `
  <div id="ytPlayer" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></div>
`;
youtubePlayerContainer.classList.remove("hidden");


  youtubePlayer = new YT.Player("ytPlayer", {
    height: "315",
    width: "600",
    videoId: videoID,
    playerVars: {
      autoplay: 1,
    },
    events: {
      onReady: (event) => {
        youtubePlayer.seekTo(cueTime, true);
        youtubePlayer.playVideo();
        setupSpeedControls();
        setupCueButton();
        setupPlayPauseButton();  // Setup your play/pause button events here
      },
      onStateChange: onPlayerStateChange // Listen to state changes
    }
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

  // 3) Render each tune
  tunesArray.forEach(function ([key, tune]) {
    const hasLink = tune.link && tune.link.trim() !== "";

    // Determine background color
    const knowledge = parseInt(tune.knowledge) || 0;
    let bgColor = "#fff";
    if (knowledge === 1) bgColor = "#fdd";
    else if (knowledge === 2) bgColor = "#ffd";
    else if (knowledge >= 3) bgColor = "#dfd";
    if (selectedTuneKey === key) bgColor = "#cce5ff";

    // Row container
    const tuneItem = document.createElement("div");
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
      <div style="flex: 0 0 30px; text-align: center;">
        ${hasLink
          ? `<button
               class="inline-link-btn"
               title="Play video"
               style="background:none;border:none;cursor:pointer;padding:0;font-size:16px;"
               data-url="${tune.link.trim()}"
               data-key="${key}">▶️</button>`
          : `<span style="display:inline-block;width:24px;"></span>`}
      </div>
    `;

    // Row click handler
    tuneItem.addEventListener("click", function (e) {
      if (e.target.classList.contains("inline-link-btn")) return;

      selectedTuneKey = key;
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
      detailsDisplay.classList.remove("hidden");
      editDetailsBtn.classList.remove("hidden");
      saveDetailsBtn.classList.add("hidden");
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
          renderTuneList(tunes);
        });
    });

    // Inline play button handler
    if (hasLink) {
      const btn = tuneItem.querySelector(".inline-link-btn");
      btn.addEventListener("click", function (e) {
        e.stopPropagation();

        // Select this tune row
        const row = document.querySelector(`[data-key="${this.dataset.key}"]`);
        if (row) row.click();

        // Play via YouTube IFrame API
        const url = this.dataset.url;
        const videoID = getYouTubeVideoID(url);
        if (videoID) {
          loadYouTubeAPI(() => {
            createYouTubePlayer(videoID, currentCue);
          });
        } else {
          window.open(url, "_blank");
        }
      });
    }

    tuneListDiv.appendChild(tuneItem);
  });

  console.log("Tune list rendered (mode:", currentSortMode, ")");
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
  linkInput.classList.remove("hidden");
  keyInput.classList.remove("hidden");
  typeInput.classList.remove("hidden");
  editKnowledgeInput.classList.remove("hidden");

  detailsDisplay.classList.add("hidden");
  editDetailsBtn.classList.add("hidden");
  saveDetailsBtn.classList.remove("hidden");

  // Pre-fill edit fields
  var tune = tuneData[selectedTuneKey] || {};
  tuneDetailsText.value = tune.details || "";
  chordInput.value = tune.chords || "";
  nameInput.value = tune.name || "";
  linkInput.value = tune.link || "";
  keyInput.value = tune.key || "";
  typeInput.value = tune.type || "";
  editKnowledgeInput.value = tune.knowledge || "";
});

// Save edited details
saveDetailsBtn.addEventListener("click", function () {
  var details = tuneDetailsText.value;
  var chords = chordInput.value;
  var name = nameInput.value;
  var link = linkInput.value;
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
      key: keyVal,
      type: type,
      knowledge: knowledge
  }, function (error) {
      if (error) {
          console.error("Error updating tune:", error);
      } else {
          detailsDisplay.textContent = details;
          tuneDetailsText.classList.add("hidden");
          chordInput.classList.add("hidden");
          nameInput.classList.add("hidden");
          linkInput.classList.add("hidden");
          keyInput.classList.add("hidden");
          typeInput.classList.add("hidden");
          editKnowledgeInput.classList.add("hidden");

          detailsDisplay.classList.remove("hidden");
          editDetailsBtn.classList.remove("hidden");
          saveDetailsBtn.classList.add("hidden");
      }
  });
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
