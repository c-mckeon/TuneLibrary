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
  
  var guitarBtn = document.getElementById("guitarBtn");
  var mandolinBtn = document.getElementById("mandolinBtn");
  var tuneNameInput = document.getElementById("tuneName");
  var knowledgeInput = document.getElementById("knowledge");
  var priorityInput = document.getElementById("priority");
  var saveTuneBtn = document.getElementById("saveTune");
  var tuneListDiv = document.getElementById("tuneList");
  var sortKnowledgeBtn = document.getElementById("sortKnowledge");
  var sortPriorityBtn = document.getElementById("sortPriority");
  var tuneDetailsContainer = document.getElementById("tuneDetailsContainer");
  var tuneDetailsText = document.getElementById("tuneDetails");
  var detailsDisplay = document.getElementById("detailsDisplay");
  var saveDetailsBtn = document.getElementById("saveDetails");
  var editDetailsBtn = document.getElementById("editDetailsBtn");
  
  guitarBtn.addEventListener("click", function () {
    currentMode = "guitar";
    guitarBtn.classList.add("active");
    mandolinBtn.classList.remove("active");
    selectedTuneKey = null;
    tuneDetailsText.value = "";
    detailsDisplay.textContent = "";
    tuneDetailsContainer.classList.add("hidden");
    loadTunes();
  });
  
  mandolinBtn.addEventListener("click", function () {
    currentMode = "mandolin";
    mandolinBtn.classList.add("active");
    guitarBtn.classList.remove("active");
    selectedTuneKey = null;
    tuneDetailsText.value = "";
    detailsDisplay.textContent = "";
    tuneDetailsContainer.classList.add("hidden");
    loadTunes();
  });
  
  saveTuneBtn.addEventListener("click", function () {
    var tuneName = tuneNameInput.value.trim();
    var knowledge = parseInt(knowledgeInput.value);
    // var priority = parseInt(priorityInput.value);
  
  
    var newTune = {
      name: tuneName,
      knowledge: knowledge,
      details: "",
      mode: currentMode
    };
  
    var tunesRef = database.ref("tunes/" + currentMode);
    tunesRef.push(newTune, function (error) {
      if (error) {
        console.error("Error saving tune:", error);
      } else {
        tuneNameInput.value = "";
        knowledgeInput.value = "";
      }
    });
  });
  
  function loadTunes() {
    var tunesRef = database.ref("tunes/" + currentMode);
    tunesRef.on("value", function (snapshot) {
      var tunes = snapshot.val();
      renderTuneList(tunes);
    });
  }
  
  function renderTuneList(tunes) {
    tuneListDiv.innerHTML = "";
    if (tunes) {
        Object.keys(tunes).forEach(function (key) {
            var tune = tunes[key];
            var tuneItem = document.createElement("div");

            // Use a flex container to align the two pieces of text:
            tuneItem.innerHTML = `
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="tune-name">${tune.name}</span>
                <span class="tune-knowledge">Knowledge: ${tune.knowledge}</span>
              </div>
            `;

            tuneItem.setAttribute("data-key", key);
            tuneItem.addEventListener("click", function () {
                selectedTuneKey = key;
                tuneDetailsText.value = tune.details || "";
                detailsDisplay.textContent = tune.details || "";
                tuneDetailsText.classList.add("hidden");
                detailsDisplay.classList.remove("hidden");
                editDetailsBtn.classList.remove("hidden");
                saveDetailsBtn.classList.add("hidden");
                tuneDetailsContainer.classList.remove("hidden");

                // Clear chord diagrams container BEFORE loading new chords
                const chordDiagramsContainer = document.getElementById("chordDiagramsContainer");
                if (chordDiagramsContainer) {
                    chordDiagramsContainer.innerHTML = "";
                    chordDiagramsContainer.classList.remove("hidden");
                }

                // Fetch chords data from Firebase and show chord diagrams
                var tuneRef = database.ref("tunes/" + currentMode + "/" + selectedTuneKey);
                tuneRef.once("value", function(snapshot) {
                    var tuneData = snapshot.val();

                    // Show chord diagrams if chords exist
                    if (tuneData && tuneData.chords) {
                        showChordDiagrams(tuneData.chords);
                    }

                    // Initially hide the chord input field
                    const chordInput = document.getElementById("chordInput");
                    if (chordInput) {
                        chordInput.value = tuneData && tuneData.chords ? tuneData.chords : "";
                        chordInput.classList.add("hidden"); // Keep it hidden initially
                    }
                });
            });

            tuneListDiv.appendChild(tuneItem);
        });
    } else {
        tuneListDiv.textContent = "No tunes found.";
    }
}



  
  // Show the edit fields when the 'Edit' button is clicked
editDetailsBtn.addEventListener("click", function () {
    tuneDetailsText.classList.remove("hidden"); // Show the tune details text area
    chordInput.classList.remove("hidden"); // Show the chord input box
    detailsDisplay.classList.add("hidden"); // Hide the details display
    editDetailsBtn.classList.add("hidden"); // Hide the edit button
    saveDetailsBtn.classList.remove("hidden"); // Show the save button
  });
  
  // Save the tune details and chords when the 'Save' button is clicked
  saveDetailsBtn.addEventListener("click", function () {
    var details = tuneDetailsText.value;
    var chords = chordInput.value; // Get the chords from the input box
  
    if (!selectedTuneKey) {
      alert("No tune selected.");
      return;
    }
  
    var tuneRef = database.ref("tunes/" + currentMode + "/" + selectedTuneKey);
  
    // Update both details and chords in the Firebase record
    tuneRef.update({ 
      details: details,
      chords: chords // Save the chords data
    }, function (error) {
      if (error) {
        console.error("Error updating details:", error);
      } else {
        detailsDisplay.textContent = details; // Update the details display
        tuneDetailsText.classList.add("hidden"); // Hide the edit box
        chordInput.classList.add("hidden"); // Hide the chord input box
        detailsDisplay.classList.remove("hidden"); // Show the details display
        editDetailsBtn.classList.remove("hidden"); // Show the edit button
        saveDetailsBtn.classList.add("hidden"); // Hide the save button
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
