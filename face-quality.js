// ============================================================
// CLARUS face-quality.js — MediaPipe Face Landmarker (WASM),
// exposed to the classic script app.js via window.FaceQuality
// ============================================================

import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const LIGHT_THRESHOLD_MIN = 60;   // average brightness (0-255) below this = too dark
const LIGHT_THRESHOLD_MAX = 235;  // above this = blown out / too bright
const STABLE_MOVEMENT_PX = 22;    // max allowed nose-tip movement between frames, in pixels
                                    // (loosened from 6px -- that was too strict for a
                                    // handheld phone camera, where natural hand shake
                                    // alone could exceed it and permanently block "Steady")
const STABLE_HISTORY_FRAMES = 5;  // how many recent frames must all be steady (was 8 --
                                    // shortened so a brief stray frame doesn't reset progress)

let landmarker = null;
let offscreenCanvas = null;
let offscreenCtx = null;
let noseHistory = []; // recent {x, y} pixel positions of the nose tip

async function init() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numFaces: 3 // detect up to 3, so we can tell "exactly 1" apart from "2 or more"
  });
  offscreenCanvas = document.createElement("canvas");
  offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });
}

function computeBrightness(videoEl, bbox) {
  if (offscreenCanvas.width !== videoEl.videoWidth || offscreenCanvas.height !== videoEl.videoHeight) {
    offscreenCanvas.width = videoEl.videoWidth;
    offscreenCanvas.height = videoEl.videoHeight;
  }
  offscreenCtx.drawImage(videoEl, 0, 0);
  const x = Math.max(0, Math.floor(bbox.minX));
  const y = Math.max(0, Math.floor(bbox.minY));
  const w = Math.min(offscreenCanvas.width - x, Math.ceil(bbox.maxX - bbox.minX));
  const h = Math.min(offscreenCanvas.height - y, Math.ceil(bbox.maxY - bbox.minY));
  if (w <= 0 || h <= 0) return null;
  const data = offscreenCtx.getImageData(x, y, w, h).data;
  let sum = 0;
  const step = 4 * 4; // sample every 4th pixel for speed
  let count = 0;
  for (let i = 0; i < data.length; i += step) {
    // standard luminance approximation
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    count++;
  }
  return count > 0 ? sum / count : null;
}

function updateStability(nosePx) {
  noseHistory.push(nosePx);
  if (noseHistory.length > STABLE_HISTORY_FRAMES) noseHistory.shift();
  if (noseHistory.length < STABLE_HISTORY_FRAMES) return false; // not enough history yet
  let maxMove = 0;
  for (let i = 1; i < noseHistory.length; i++) {
    const dx = noseHistory[i].x - noseHistory[i - 1].x;
    const dy = noseHistory[i].y - noseHistory[i - 1].y;
    maxMove = Math.max(maxMove, Math.sqrt(dx * dx + dy * dy));
  }
  return maxMove <= STABLE_MOVEMENT_PX;
}

function resetStability() {
  noseHistory = [];
}

/**
 * Analyze one video frame. Returns:
 * { faceCount, oneFace, lightingOk, stable, allOk, brightness }
 */
function analyze(videoEl, timestampMs) {
  if (!landmarker) return { faceCount: 0, oneFace: false, lightingOk: false, stable: false, allOk: false, brightness: null };

  const result = landmarker.detectForVideo(videoEl, timestampMs);
  const faceCount = result.faceLandmarks ? result.faceLandmarks.length : 0;
  const oneFace = faceCount === 1;

  if (!oneFace) {
    resetStability();
    return { faceCount, oneFace: false, lightingOk: false, stable: false, allOk: false, brightness: null };
  }

  const landmarks = result.faceLandmarks[0];
  const w = videoEl.videoWidth, h = videoEl.videoHeight;

  // Bounding box from all 478 landmarks, in pixel coordinates
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of landmarks) {
    const px = p.x * w, py = p.y * h;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const bbox = { minX, maxX, minY, maxY };

  const brightness = computeBrightness(videoEl, bbox);
  const lightingOk = brightness !== null && brightness >= LIGHT_THRESHOLD_MIN && brightness <= LIGHT_THRESHOLD_MAX;

  // Nose tip is landmark index 1 in MediaPipe's 478-point face mesh
  const nose = landmarks[1];
  const nosePx = { x: nose.x * w, y: nose.y * h };
  const stable = updateStability(nosePx);

  const allOk = oneFace && lightingOk && stable;
  return { faceCount, oneFace, lightingOk, stable, allOk, brightness };
}

window.FaceQuality = { init, analyze, resetStability };
