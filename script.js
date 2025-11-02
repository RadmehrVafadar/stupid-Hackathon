const video = document.getElementById("video");
const trolley = document.querySelector(".trolley");

let trolleyProgress = 0; // 0..100
let _prevTrolleyProgress = 0; // used to detect movement start/stop

// Sound manager: plays frantic, panned, random sounds from assets/audio when trolley moves
const soundManager = (function () {
  const audioFolder = "assets/audio";
  // local filenames found in the repository; if you add/remove files, update this list
  const files = [
    "wifen4kids.mp3",
    "smile.mp3",
    "pleasesmile2.mp3",
    "pleasesmile1.mp3",
    "choochoo.mp3",
  ];

  let audioCtx = null;
  let currentAudio = null;
  let playing = false;
  let currentSource = null;

  function ensureCtx() {
    if (!audioCtx)
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function cleanupCurrent() {
    try {
      if (currentAudio) {
        currentAudio.onended = null;
        currentAudio.pause();
        currentAudio.src = "";
        currentAudio = null;
      }
      if (currentSource) {
        try {
          currentSource.disconnect();
        } catch (e) {}
        currentSource = null;
      }
    } catch (e) {
      // ignore
    }
  }

  function playRandom() {
    if (!playing) return;
    const file = files[Math.floor(Math.random() * files.length)];
    cleanupCurrent();

    const audio = new Audio(`${audioFolder}/${file}`);
    audio.crossOrigin = "anonymous";
    // make it frantic: speed it up a bit
    audio.playbackRate = 1 + Math.random() * 0.8; // 1.0 .. 1.8
    // small variation in volume
    const vol = 0.7 + Math.random() * 0.6; // 0.7 .. 1.3 (we'll cap later)

    ensureCtx();
    // create nodes
    try {
      const src = audioCtx.createMediaElementSource(audio);
      const pan = audioCtx.createStereoPanner();
      pan.pan.value = (Math.random() * 2 - 1) * 0.9; // -0.9 .. +0.9
      const gain = audioCtx.createGain();
      gain.gain.value = Math.min(1.0, vol);
      src.connect(pan).connect(gain).connect(audioCtx.destination);
      currentSource = src;
    } catch (e) {
      // Some browsers disallow createMediaElementSource until user gesture; fall back to plain audio element
      currentSource = null;
    }

    currentAudio = audio;
    // Play and ensure AudioContext resumed if needed
    const tryPlay = () => {
      audio.play().catch(() => {
        // resume and retry once
        if (audioCtx && audioCtx.state === "suspended") {
          audioCtx.resume().then(() => audio.play().catch(() => {}));
        }
      });
    };

    // small random delay between sounds to make it chaotic
    audio.onended = () => {
      if (!playing) return;
      setTimeout(playRandom, 50 + Math.random() * 300);
    };

    tryPlay();
  }

  return {
    start() {
      if (playing) return;
      playing = true;
      ensureCtx();
      if (audioCtx.state === "suspended") {
        // resuming may require a user gesture; we'll try to resume when playing
        audioCtx.resume().catch(() => {});
      }
      playRandom();
    },
    stop() {
      if (!playing) return;
      playing = false;
      cleanupCurrent();
      if (audioCtx && audioCtx.state === "running") {
        // suspend to be polite to the system
        audioCtx.suspend().catch(() => {});
      }
    },
    isPlaying() {
      return !!playing;
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
  // detect movement start: progress increased compared to previous tick
  const startedMoving = clamped > _prevTrolleyProgress;
  trolleyProgress = clamped;
  updateTrolleyPosition();

  if (startedMoving) {
    // start frantic sounds when trolley starts moving
    try {
      soundManager.start();
    } catch (e) {
      /* ignore */
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

// Check if face-api is available
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
        // Not smiling: red background, trolley moves
        document.body.style.backgroundColor = "red";
        const step = 0.125;
        setTrolleyProgress(trolleyProgress + step);
      } else {
        // Smiling: white background, trolley stops
        document.body.style.backgroundColor = "white";
        // stop frantic sounds when the user smiles
        try {
          soundManager.stop();
        } catch (e) {
          /* ignore */
        }
      }
    } else {
      // No face detected, keep moving with red background
      document.body.style.backgroundColor = "red";
      const step = 0.5;
      setTrolleyProgress(trolleyProgress + step);
    }
  }, 100);
}

// Initialize position once DOM is ready
updateTrolleyPosition();
