const video = document.getElementById("video");
const trolley = document.querySelector(".trolley");
const kindLever = document.getElementById("kind-lever");
const evilLever = document.getElementById("evil-lever");

let trolleyProgress = 0; // 0..100
let _prevTrolleyProgress = 0; // used to detect movement start/stop

// Sound manager: background choochoo loop + overlay cries/smile clips
const soundManager = (function () {
  const audioFolder = "assets/audio";
  const backgroundFile = "choochoo.mp3";
  const occasionalFiles = ["smile.mp3"]; // played rarely below/above midpoint
  const happyTune = "behappy.mp3";
  const cries = [
    "pleasesmile1.mp3",
    "pleasesmile2.mp3",
    "wifen4kids.mp3",
    "dontwannadie.mp3",
  ];

  let audioCtx = null;
  let bgAudio = null;
  let bgSource = null;
  let bgPanNode = null;
  let bgGainNode = null;
  let overlayTimer = null;
  let playing = false;
  let currentProgress = 0; // 0..100

  function ensureCtx() {
    if (!audioCtx)
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function startBackgroundLoop() {
    try {
      if (bgAudio) return;
      bgAudio = new Audio(`${audioFolder}/${backgroundFile}`);
      bgAudio.loop = true;
      bgAudio.crossOrigin = "anonymous";
      bgAudio.volume = 0.7;

      ensureCtx();
      try {
        bgSource = audioCtx.createMediaElementSource(bgAudio);
        bgPanNode = audioCtx.createStereoPanner();
        bgPanNode.pan.value = (Math.random() * 2 - 1) * 0.5; // gentle pan
        bgGainNode = audioCtx.createGain();
        bgGainNode.gain.value = 0.6;
        bgSource
          .connect(bgPanNode)
          .connect(bgGainNode)
          .connect(audioCtx.destination);
      } catch (e) {
        // fallback: don't use nodes
        bgSource = null;
      }

      const tryPlay = () => {
        bgAudio.play().catch(() => {
          if (audioCtx && audioCtx.state === "suspended") {
            audioCtx.resume().then(() => bgAudio.play().catch(() => {}));
          }
        });
      };
      tryPlay();
    } catch (e) {
      console.warn("soundManager: failed to start background loop", e);
    }
  }

  function stopBackgroundLoop() {
    try {
      if (bgAudio) {
        bgAudio.pause();
        bgAudio.src = "";
        bgAudio = null;
      }
      if (bgSource) {
        try {
          bgSource.disconnect();
        } catch (e) {}
        bgSource = null;
      }
      if (bgPanNode) {
        try {
          bgPanNode.disconnect();
        } catch (e) {}
        bgPanNode = null;
      }
      if (bgGainNode) {
        try {
          bgGainNode.disconnect();
        } catch (e) {}
        bgGainNode = null;
      }
    } catch (e) {
      // ignore
    }
  }

  function playOverlay(file) {
    if (!file) return;
    const audio = new Audio(`${audioFolder}/${file}`);
    audio.crossOrigin = "anonymous";
    // make it frantic: small variation in speed
    audio.playbackRate = 1 + Math.random() * 0.6; // 1.0 .. 1.6
    const vol = 0.7 + Math.random() * 0.6;

    ensureCtx();
    try {
      const src = audioCtx.createMediaElementSource(audio);
      const pan = audioCtx.createStereoPanner();
      pan.pan.value = (Math.random() * 2 - 1) * 0.95; // wide pan
      const gain = audioCtx.createGain();
      gain.gain.value = Math.min(1.0, vol);
      src.connect(pan).connect(gain).connect(audioCtx.destination);
    } catch (e) {
      // fallback: no nodes
    }

    audio.play().catch(() => {
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().then(() => audio.play().catch(() => {}));
      }
    });
    // no need to keep reference; audio element will be GC'd after playing
  }

  function scheduleOverlayLoop() {
    if (overlayTimer) return; // already scheduled

    const runOnce = () => {
      if (!playing) {
        overlayTimer = null;
        return;
      }

      // decide which overlays to play depending on progress
      const p = Math.random();
      if (currentProgress > 50) {
        // halfway+: keep choochoo loop running (already) and add cries frequently
        if (p < 0.75) {
          // play a cry
          const cry = cries[Math.floor(Math.random() * cries.length)];
          playOverlay(cry);
        } else if (p < 0.9) {
          // sometimes play the smile clip
          playOverlay(occasionalFiles[0]);
        }
        // schedule next sooner
        const next = 250 + Math.random() * 900;
        overlayTimer = setTimeout(runOnce, next);
      } else {
        // below halfway: chug choochoo loop; occasionally play smile
        if (p < 0.12) {
          playOverlay(occasionalFiles[0]);
        }
        const next = 1000 + Math.random() * 3000;
        overlayTimer = setTimeout(runOnce, next);
      }
    };

    runOnce();
  }

  function stopOverlayLoop() {
    if (overlayTimer) {
      clearTimeout(overlayTimer);
      overlayTimer = null;
    }
  }

  return {
    start() {
      if (playing) return;
      playing = true;
      ensureCtx();
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
      startBackgroundLoop();
      scheduleOverlayLoop();
    },
    stop() {
      if (!playing) return;
      playing = false;
      stopOverlayLoop();
      stopBackgroundLoop();
      if (audioCtx && audioCtx.state === "running") {
        audioCtx.suspend().catch(() => {});
      }
    },
    isPlaying() {
      return !!playing;
    },
    // allow external code to inform sound manager about trolley progress
    setProgress(p) {
      currentProgress = Math.max(0, Math.min(100, p || 0));
      // if we're already playing, ensure overlay is scheduled
      if (playing && !overlayTimer) scheduleOverlayLoop();
    },
  };
})();

// Happy music manager: plays behappy.mp3 on loop while the user is smiling
const happyManager = (function () {
  const src = "assets/audio/behappy.mp3";
  let audio = null;
  return {
    start() {
      try {
        if (audio) return;
        audio = new Audio(src);
        audio.loop = true;
        audio.crossOrigin = "anonymous";
        audio.volume = 0.85;
        // try to play and resume AudioContext if needed
        audio.play().catch(() => {
          if (window.AudioContext || window.webkitAudioContext) {
            const ctx = new (window.AudioContext ||
              window.webkitAudioContext)();
            if (ctx.state === "suspended") ctx.resume().catch(() => {});
            // we don't connect this audio into ctx to keep it simple
            audio.play().catch(() => {});
          }
        });
      } catch (e) {
        console.warn("happyManager.start failed", e);
      }
    },
    stop() {
      try {
        if (!audio) return;
        audio.pause();
        audio.src = "";
        audio = null;
      } catch (e) {
        // ignore
      }
    },
    isPlaying() {
      return !!audio;
    },
  };
})();

// Game over manager: plays dontwannadie.mp3 and shows black overlay with Try Again button
const gameOverManager = (function () {
  const src = "assets/audio/scream.mp3";
  let audio = null;
  let overlay = null;

  function createOverlay() {
    if (overlay) return overlay;

    overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      backgroundColor: "#000",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      opacity: "0",
      transition: "opacity 2s ease-in",
      zIndex: "10000",
      pointerEvents: "none",
    });

    const button = document.createElement("button");
    Object.assign(button.style, {
      padding: "15px 30px",
      fontSize: "24px",
      backgroundColor: "#fff",
      color: "#000",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      opacity: "0",
      transform: "scale(0.95)",
      transition: "opacity 0.3s ease-out, transform 0.3s ease-out",
      marginTop: "20px",
    });
    button.textContent = "Try Again";
    button.addEventListener("click", () => window.location.reload());

    overlay.appendChild(button);
    document.body.appendChild(overlay);

    // Force reflow for transitions
    overlay.offsetHeight;
    overlay.style.opacity = "1";
    overlay.style.pointerEvents = "all";

    // Fade in button after overlay
    setTimeout(() => {
      button.style.opacity = "1";
      button.style.transform = "scale(1)";
    }, 800);

    return overlay;
  }

  return {
    play() {
      // Create and show overlay
      createOverlay();

      // Stop other sounds
      try {
        soundManager.stop();
      } catch (e) {}
      try {
        happyManager.stop();
      } catch (e) {}

      // Play game over sound
      try {
        if (audio) return;
        audio = new Audio(src);
        audio.play().catch(() => {});
      } catch (e) {
        console.warn("gameOverManager.play failed", e);
      }
    },
    isActive() {
      return !!overlay;
    },
  };
})();

// Direction settings (change these to control trolley movement)
const DIRECTION_X = 1; // 1 = right, -1 = left, 0 = no horizontal movement
const DIRECTION_Y = 0.65; // 1 = down, -1 = up, 0 = no vertical movement
const START_X = 0; // starting X position in pixels
const START_Y = 50; // starting Y position in pixels

function clamp(min, value, max) {
  return Math.max(min, Math.min(max, value));
}

function setTrolleyProgress(percent) {
  const clamped = clamp(0, percent, 100);
  const startedMoving = clamped > _prevTrolleyProgress;
  const wasGameOver = trolleyProgress >= 85; // check if we were already at the end
  trolleyProgress = clamped;
  updateTrolleyPosition();

  // Check for game over
  if (trolleyProgress >= 85 && !wasGameOver && !gameOverManager.isActive()) {
    try {
      gameOverManager.play();
    } catch (e) {}
    return;
  }

  // Only update sounds if we haven't reached game over
  if (!gameOverManager.isActive()) {
    // inform sound manager about progress so overlays change behavior
    try {
      soundManager.setProgress(trolleyProgress);
    } catch (e) {}

    if (startedMoving) {
      try {
        soundManager.start();
      } catch (e) {}
    }
  }

  _prevTrolleyProgress = trolleyProgress;
}

function updateTrolleyPosition() {
  if (!trolley) return;
  const trackWidth = window.innerWidth;
  const trackHeight = window.innerHeight;
  const trolleyWidth = trolley.getBoundingClientRect().width || 0;
  const trolleyHeight = trolley.getBoundingClientRect().height || 0;
  // Calculate max travel distance in each direction
  const maxTravelX =
    DIRECTION_X > 0 ? trackWidth - trolleyWidth - START_X : START_X;
  const maxTravelY =
    DIRECTION_Y > 0 ? trackHeight - trolleyHeight - START_Y : START_Y;
  // Calculate current position based on progress and direction
  const x =
    START_X + Math.round((trolleyProgress / 100) * maxTravelX * DIRECTION_X);
  const y =
    START_Y + Math.round((trolleyProgress / 100) * maxTravelY * DIRECTION_Y);
  trolley.style.left = x + "px";
  trolley.style.top = y + "px";
}

window.addEventListener("resize", updateTrolleyPosition);

// Check if face-api is available and load models
if (typeof faceapi === "undefined") {
  console.error(
    "face-api.js not loaded! Make sure face-api.min.js loads before script.js"
  );
} else {
  Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri("./models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("./models"),
    faceapi.nets.faceRecognitionNet.loadFromUri("./models"),
    faceapi.nets.faceExpressionNet.loadFromUri("./models"),
  ])
    .then(() => {
      startVideo();
    })
    .catch((e) => {
      console.error(
        "Failed to load models - make sure ./models directory exists with model files",
        e
      );
    });
}

async function startVideo() {
  try {
    const stream = await (navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia
      ? navigator.mediaDevices.getUserMedia({ video: {} })
      : new Promise((resolve, reject) => {
          const legacy =
            navigator.getUserMedia ||
            navigator.webkitGetUserMedia ||
            navigator.mozGetUserMedia;
          if (!legacy) return reject(new Error("getUserMedia not supported"));
          legacy.call(navigator, { video: {} }, resolve, reject);
        }));
    if (!video) {
      console.error("Video element not found in DOM");
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
  } catch (err) {
    console.error("Error starting video stream", err);
  }
}

if (!video) {
  console.error("Video element not found; cannot attach play handler");
}

video &&
  video.addEventListener("play", () => {
    // Wait for video to have valid dimensions
    const waitForVideo = setInterval(() => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        clearInterval(waitForVideo);
        startDetection();
      }
    }, 100);
  });

function startDetection() {
  const canvas = faceapi.createCanvasFromMedia(video);
  document.body.append(canvas);
  const displaySize = { width: video.width, height: video.height };
  faceapi.matchDimensions(canvas, displaySize);

  setInterval(async () => {
    const detections = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceExpressions();
    const resizedDetections = faceapi.resizeResults(detections, displaySize);
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    faceapi.draw.drawDetections(canvas, resizedDetections);
    faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);
    faceapi.draw.drawFaceExpressions(canvas, resizedDetections);

    const firstDetection = detections[0];

    if (firstDetection && firstDetection.expressions) {
      const happyScore = firstDetection.expressions.happy || 0;
      // Move trolley when NOT smiling (stops when you smile)
      if (happyScore < 0.5) {
        // Not smiling: red background, trolley moves, show evil lever
        document.body.style.backgroundColor = "red";
        if (kindLever) kindLever.classList.add("hidden");
        if (evilLever) evilLever.classList.remove("hidden");
        // ensure happy music is stopped when not smiling
        try {
          happyManager.stop();
        } catch (e) {}
        const step = 0.32;
        setTrolleyProgress(trolleyProgress + step);
      } else {
        // Smiling: white background, trolley stops, show kind lever
        document.body.style.backgroundColor = "white";
        if (kindLever) kindLever.classList.remove("hidden");
        if (evilLever) evilLever.classList.add("hidden");
        // stop frantic sounds and start happy music when the user smiles
        try {
          soundManager.stop();
        } catch (e) {}
        try {
          happyManager.start();
        } catch (e) {}
      }
    } else {
      // No face detected, keep moving with red background, show evil lever
      document.body.style.backgroundColor = "red";
      if (kindLever) kindLever.classList.add("hidden");
      if (evilLever) evilLever.classList.remove("hidden");
      try {
        happyManager.stop();
      } catch (e) {}
      const step = 0.32;
      setTrolleyProgress(trolleyProgress + step);
    }
  }, 100);
}

// Initialize position once DOM is ready
updateTrolleyPosition();
