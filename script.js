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

var currentMode = "guitar";
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



// Mode toggle
function loadTunes() {
  var tunesRef = database.ref("tunes/" + currentMode);
  tunesRef.on("value", function (snapshot) {
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

// Render tune list
function renderTuneList(tunes) {
  tuneListDiv.innerHTML = "";

  if (tunes) {
    Object.keys(tunes).forEach(function (key) {
      const tune = tunes[key];

      // Determine base background color based on knowledge
      const knowledge = parseInt(tune.knowledge);
      let bgColor = "#fff"; // default white
      if (knowledge === 1) {
        bgColor = "#fdd"; // light red
      } else if (knowledge === 2) {
        bgColor = "#ffd"; // light yellow
      } else if (knowledge >= 3) {
        bgColor = "#dfd"; // light green
      }

      // If this is the currently selected tune, override with blue highlight
      const isSelected = selectedTuneKey === key;
      if (isSelected) {
        bgColor = "#cce5ff"; // light blue
      }

      const tuneItem = document.createElement("div");
      tuneItem.style.display = "flex";
      tuneItem.style.justifyContent = "flex-start";
      tuneItem.style.gap = "20px";
      tuneItem.style.padding = "5px 10px";
      tuneItem.style.borderBottom = "1px solid #eee";
      tuneItem.style.cursor = "pointer";
      tuneItem.style.backgroundColor = bgColor;

      tuneItem.innerHTML = `
        <div style="flex: 2; text-align: left;">${tune.name || ""}</div>
        <div style="flex: 1; text-align: left;">${tune.key || ""}</div>
        <div style="flex: 1; text-align: left;">${tune.type || ""}</div>
      `;

      tuneItem.setAttribute("data-key", key);

      tuneItem.addEventListener("click", function () {
        selectedTuneKey = key;
            // Clear chord diagrams immediately
           document.getElementById("chordDiagramsContainer").innerHTML = "";

        tuneDetailsText.value = tune.details || "";
        detailsDisplay.textContent = tune.details || "";
        tuneDetailsText.classList.add("hidden");
        detailsDisplay.classList.remove("hidden");
        editDetailsBtn.classList.remove("hidden");
        saveDetailsBtn.classList.add("hidden");
        tuneDetailsContainer.classList.remove("hidden");

            // Show or hide the Link button
    if (tune.link && tune.link.trim() !== "") {
      clickLinkBtn.classList.remove("hidden");
      clickLinkBtn.dataset.url = tune.link.trim();
  } else {
      clickLinkBtn.classList.add("hidden");
      clickLinkBtn.dataset.url = "";
  }

  youtubePlayerContainer.classList.add("hidden");
  youtubePlayerContainer.innerHTML = "";
        

        // Fetch full tune data
        database.ref(`tunes/${currentMode}/${selectedTuneKey}`).once("value", function (snapshot) {
          const data = snapshot.val() || {};
          tuneData[selectedTuneKey] = data;

          chordInput.value = data.chords || "";
          chordInput.classList.add("hidden");

          if (data.chords) {
            showChordDiagrams(data.chords);
          }
        });

        // Re-render list to update selection highlighting
        renderTuneList(tunes);
      });

      tuneListDiv.appendChild(tuneItem);
    });
  } else {
    tuneListDiv.textContent = "No tunes found.";
  }
}

// clickLinkBtn.addEventListener("click", function () {
//  const url = this.dataset.url;
//  if (url) {
//      window.open(url, "_blank");
//  }
// });


clickLinkBtn.addEventListener("click", function () {
  const url = this.dataset.url;
  if (!url) return;

  // Function to extract YouTube video ID from various YouTube URLs
  function getYouTubeVideoID(url) {
      const regExp = /^.*(?:youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
      const match = url.match(regExp);
      return (match && match[1].length === 11) ? match[1] : null;
  }

  const videoID = getYouTubeVideoID(url);
  if (videoID) {
      // Embed YouTube iframe player
      youtubePlayerContainer.innerHTML = `
        <iframe 
          width="560" height="315" 
          src="https://www.youtube.com/embed/${videoID}?autoplay=1" 
          frameborder="0" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
          allowfullscreen>
        </iframe>`;
      youtubePlayerContainer.classList.remove("hidden");
  } else {
      // Not a valid YouTube URL — fallback: open in new tab
      window.open(url, "_blank");
  }
});



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
