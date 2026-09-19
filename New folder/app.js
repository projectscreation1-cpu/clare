// ============================================================
// CLARUS Speech Recording — main logic (v2)
// ============================================================

const SENTENCE_SETS = [
  ["please open the door and turn on the light now",
   "she walked slowly to the market to buy some fruit",
   "we all watched a movie together at home last night",
   "he forgot his phone at the office again this morning",
   "the children were playing happily in the garden this morning"],
  ["can you please help me carry these heavy boxes upstairs",
   "my brother is cooking rice and vegetables for our dinner",
   "she quickly finished her homework before going out to play",
   "the weather today is bright warm and very pleasant outside",
   "let us meet at the library after our lunch break today"],
  ["he always wakes up early to go for a morning run",
   "the teacher explained the lesson clearly to all the students",
   "she bought a new dress for the upcoming family wedding",
   "we need to finish this project before the deadline arrives",
   "the dog barked loudly when the stranger knocked the door"],
  ["please remember to bring your umbrella since it might rain",
   "the children enjoyed their trip to the zoo last weekend",
   "he studies every evening to prepare for his final exams",
   "she planted colorful flowers in the garden behind her house",
   "we should leave early today to avoid the heavy traffic jam"],
  ["the chef prepared a delicious meal for all the guests today",
   "my friend called me last night to share good news",
   "the students submitted all their assignments before the given deadline",
   "she practices singing every day to improve her natural voice",
   "the farmer worked hard in the field throughout the whole day"],
  ["he repaired the broken chair using some tools from home",
   "the little baby slept peacefully throughout the entire long night",
   "she decorated the whole house beautifully for the festival celebration",
   "the manager quickly scheduled an important meeting for tomorrow morning",
   "they traveled together to the mountains during the summer vacation"],
  ["the librarian helped me find the book i wanted quickly today",
   "he saved enough money to buy a brand new bicycle",
   "she wrote a long letter to her grandmother living abroad",
   "the players practiced very hard before the important championship match",
   "we enjoyed a peaceful walk along the beach this evening"],
  ["the nurse checked on the patient every hour through the night",
   "he fixed the leaking tap in the kitchen this morning",
   "she taught her younger brother how to ride a bicycle",
   "the artist painted a beautiful scene of the setting sun",
   "they planned a surprise party for their close friend today"],
  ["the coach motivated the team before the final big match",
   "she carefully arranged the books on the wooden library shelf",
   "he answered every single question during the interview with confidence",
   "the workers finished building the new bridge ahead of schedule",
   "we celebrated her birthday with cake and many colorful balloons"],
  ["the pilot announced that the flight would land safely very soon",
   "she cleaned her room before her relatives arrived for dinner",
   "he practiced his speech many times before the school event",
   "the gardener watered all the plants early in the morning",
   "they watched the fireworks together during the new year celebration"]
];

// Which set to use is controlled by the researcher via ?set=1 through ?set=10
// in the shared link (one link per group of 5 participants). Defaults to 1.
function getSentenceSet() {
  const params = new URLSearchParams(window.location.search);
  let n = parseInt(params.get("set"), 10);
  if (!Number.isInteger(n) || n < 1 || n > SENTENCE_SETS.length) n = 1;
  return SENTENCE_SETS[n - 1];
}
const SENTENCES = getSentenceSet();

const RECORD_SECONDS = 12;
const TARGET_WIDTH = 640;
const TARGET_HEIGHT = 480;
const TARGET_FPS = 25;
const MATCH_THRESHOLD = 0.5;
const DISCLAIMER_TEXT = [
  "This recording is exclusively for our project purpose",
  "and will not be used anywhere else.",
  "It is only used for training purposes."
];

const BLOCKED_WORDS = [
  "fuck", "shit", "bitch", "asshole", "bastard", "slut", "whore",
  "rape", "kill you", "cunt", "nigger", "faggot"
];

// ---- State ----
let mediaStream = null;
let combinedRecordStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let currentIndex = 0;
let timerInterval = null;
let timeLeft = RECORD_SECONDS;
let isRecording = false;
let lastBlob = null;
let actualTrackSettings = null;
let speechRecognizer = null;
let liveTranscript = "";
let speechRecognitionError = null;
let lastVerification = null;
let qualityRafId = null;
let lastQuality = { allOk: false };
let countdownActive = false;

let participant = { name: "", rollNo: "", skinTone: "", gender: "" };

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

// ============================================================
// Sentence / profanity verification (unchanged from before)
// ============================================================
function normalizeWords(text) {
  return text.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
}
function sentenceSimilarity(expected, heard) {
  const expectedWords = normalizeWords(expected);
  const heardWords = new Set(normalizeWords(heard));
  if (expectedWords.length === 0) return 0;
  const matched = expectedWords.filter(w => heardWords.has(w)).length;
  return matched / expectedWords.length;
}
function containsBlockedWord(text) {
  const words = normalizeWords(text);
  const joined = " " + words.join(" ") + " ";
  return BLOCKED_WORDS.find(w => {
    if (w.includes(" ")) return joined.includes(" " + w + " ");
    return words.some(word => word.startsWith(w));
  }) || null;
}
function startSpeechRecognition() {
  liveTranscript = "";
  speechRecognitionError = null;
  if (!SpeechRecognitionAPI) return;
  speechRecognizer = new SpeechRecognitionAPI();
  speechRecognizer.continuous = true;
  speechRecognizer.interimResults = true;
  speechRecognizer.lang = "en-US";
  speechRecognizer.onresult = (event) => {
    let finalText = "";
    for (let i = 0; i < event.results.length; i++) finalText += event.results[i][0].transcript + " ";
    liveTranscript = finalText.trim();
  };
  speechRecognizer.onerror = (event) => {
    if (event.error !== "no-speech") speechRecognitionError = event.error;
  };
  try { speechRecognizer.start(); } catch (e) { /* ignore */ }
}
function stopSpeechRecognition() {
  if (speechRecognizer) { try { speechRecognizer.stop(); } catch (e) { /* ignore */ } }
}
function verifyRecording(expectedSentence) {
  if (!SpeechRecognitionAPI) return { status: "unsupported", transcript: "", similarity: null };
  if (speechRecognitionError && liveTranscript.trim().length < 3) {
    return { status: "technical_error", transcript: liveTranscript, similarity: null, errorType: speechRecognitionError };
  }
  const blocked = containsBlockedWord(liveTranscript);
  if (blocked) return { status: "blocked", transcript: liveTranscript, similarity: null };
  const similarity = sentenceSimilarity(expectedSentence, liveTranscript);
  return { status: similarity >= MATCH_THRESHOLD ? "pass" : "fail", transcript: liveTranscript, similarity };
}

// ============================================================
// Screen helpers
// ============================================================
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ============================================================
// Screen 1: Setup
// ============================================================
const fullNameEl = document.getElementById("fullName");
const rollNoEl = document.getElementById("rollNo");
const skinToneEl = document.getElementById("skinTone");
const genderEl = document.getElementById("gender");
const consentEl = document.getElementById("consent");
const btnStart = document.getElementById("btnStart");
const setupError = document.getElementById("setupError");

function validateSetup() {
  const ok = fullNameEl.value.trim().length > 1 && rollNoEl.value.trim().length > 1 &&
             skinToneEl.value !== "" && genderEl.value !== "" && consentEl.checked;
  btnStart.disabled = !ok;
}
[fullNameEl, rollNoEl, skinToneEl, genderEl, consentEl].forEach(el => {
  el.addEventListener("input", validateSetup);
  el.addEventListener("change", validateSetup);
});

btnStart.addEventListener("click", async () => {
  participant = { name: fullNameEl.value.trim(), rollNo: rollNoEl.value.trim(), skinTone: skinToneEl.value, gender: genderEl.value };
  setupError.textContent = "";
  btnStart.disabled = true;
  btnStart.textContent = "Loading camera and quality-check model…";
  try {
    await initCamera();
    await window.FaceQuality.init();
    showScreen("screen-camera-check");
    startQualityLoop();
  } catch (err) {
    setupError.textContent = "Setup failed: " + err.message + ". Please allow camera permission and reload the page.";
    btnStart.disabled = false;
    btnStart.textContent = "Start Recording";
  }
});

// ============================================================
// Camera init
// ============================================================
async function initCamera() {
  if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
  mediaStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { exact: TARGET_WIDTH }, height: { exact: TARGET_HEIGHT }, frameRate: { ideal: TARGET_FPS } },
    audio: true
  });
  const videoTrack = mediaStream.getVideoTracks()[0];
  actualTrackSettings = videoTrack.getSettings();
  document.getElementById("previewVideo").srcObject = mediaStream;
  document.getElementById("recordVideo").srcObject = mediaStream;
}

// ============================================================
// Live quality-check loop (runs continuously on both camera-check and record screens)
// ============================================================
const checkPerson = document.getElementById("checkPerson");
const checkLight = document.getElementById("checkLight");
const checkStable = document.getElementById("checkStable");
const checkPerson2 = document.getElementById("checkPerson2");
const checkLight2 = document.getElementById("checkLight2");
const checkStable2 = document.getElementById("checkStable2");
const btnReady = document.getElementById("btnReady");
const btnRecord = document.getElementById("btnRecord");

function setCheckState(el, ok) {
  el.classList.remove("pending", "ok", "bad");
  el.classList.add(ok ? "ok" : "bad");
}

function startQualityLoop() {
  function loop() {
    // Use whichever video element belongs to the currently visible screen —
    // both show the same mediaStream, but are separate <video> elements.
    const onCameraCheck = document.getElementById("screen-camera-check").classList.contains("active");
    const onRecordScreen = document.getElementById("screen-record").classList.contains("active");
    const videoEl = onCameraCheck ? document.getElementById("previewVideo")
                  : onRecordScreen ? document.getElementById("recordVideo")
                  : null;

    if (videoEl && videoEl.readyState >= 2) {
      const q = window.FaceQuality.analyze(videoEl, performance.now());
      lastQuality = q;
      setCheckState(checkPerson, q.oneFace);
      setCheckState(checkLight, q.lightingOk);
      setCheckState(checkStable, q.stable);
      setCheckState(checkPerson2, q.oneFace);
      setCheckState(checkLight2, q.lightingOk);
      setCheckState(checkStable2, q.stable);
      btnReady.disabled = !q.allOk;
      if (!isRecording && !countdownActive) btnRecord.disabled = !q.allOk;
    }
    qualityRafId = requestAnimationFrame(loop);
  }
  loop();
}

btnReady.addEventListener("click", () => {
  currentIndex = 0;
  showScreen("screen-record");
  loadSentence(currentIndex);
});

// ============================================================
// Screen 3: Recording flow
// ============================================================
const sentenceText = document.getElementById("sentenceText");
const progressLabel = document.getElementById("progressLabel");
const progressFill = document.getElementById("progressFill");
const timerDisplay = document.getElementById("timerDisplay");
const afterRecord = document.getElementById("afterRecord");
const uploadStatus = document.getElementById("uploadStatus");
const btnRedo = document.getElementById("btnRedo");
const btnNext = document.getElementById("btnNext");
const recordError = document.getElementById("recordError");
const verifyBanner = document.getElementById("verifyBanner");
const verifyMessage = document.getElementById("verifyMessage");
const countdownOverlay = document.getElementById("countdownOverlay");
const countdownNumber = document.getElementById("countdownNumber");
const recordCanvas = document.getElementById("recordCanvas");
const recordVideo = document.getElementById("recordVideo");

function loadSentence(index) {
  sentenceText.textContent = SENTENCES[index];
  progressLabel.textContent = `Sentence ${index + 1} of ${SENTENCES.length}`;
  progressFill.style.width = `${(index / SENTENCES.length) * 100}%`;
  afterRecord.classList.add("hidden");
  verifyBanner.classList.add("hidden");
  btnRecord.textContent = "Start Recording";
  btnRecord.classList.remove("recording");
  btnRecord.disabled = !lastQuality.allOk;
  timerDisplay.textContent = `${RECORD_SECONDS.toFixed(1)}s`;
  recordError.textContent = "";
  lastBlob = null;
  lastVerification = null;
}

btnRecord.addEventListener("click", () => {
  if (!isRecording && !countdownActive) runCountdownThenRecord();
});

function runCountdownThenRecord() {
  countdownActive = true;
  btnRecord.disabled = true;
  let n = 3;
  countdownNumber.textContent = String(n);
  countdownOverlay.classList.remove("hidden");
  const interval = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(interval);
      countdownOverlay.classList.add("hidden");
      countdownActive = false;
      startRecording();
    } else {
      countdownNumber.textContent = String(n);
    }
  }, 800);
}

// ---- Canvas compositing: draws live video + burned-in disclaimer onto recordCanvas ----
let drawRafId = null;
function startDrawLoop() {
  recordCanvas.width = TARGET_WIDTH;
  recordCanvas.height = TARGET_HEIGHT;
  const ctx = recordCanvas.getContext("2d");
  function draw() {
    ctx.drawImage(recordVideo, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    // Semi-transparent bar + disclaimer text, burned into the recorded pixels
    const barHeight = 54;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, TARGET_HEIGHT - barHeight, TARGET_WIDTH, barHeight);
    ctx.fillStyle = "#ffffff";
    ctx.font = "12px -apple-system, sans-serif";
    ctx.textAlign = "center";
    DISCLAIMER_TEXT.forEach((line, i) => {
      ctx.fillText(line, TARGET_WIDTH / 2, TARGET_HEIGHT - barHeight + 16 + i * 14);
    });
    drawRafId = requestAnimationFrame(draw);
  }
  draw();
}
function stopDrawLoop() {
  if (drawRafId) cancelAnimationFrame(drawRafId);
}

function startRecording() {
  recordedChunks = [];
  isRecording = true;
  timeLeft = RECORD_SECONDS;
  btnRecord.textContent = "Recording…";
  btnRecord.classList.add("recording");
  timerDisplay.textContent = `${timeLeft.toFixed(1)}s`;

  startDrawLoop();
  const canvasStream = recordCanvas.captureStream(TARGET_FPS);
  combinedRecordStream = new MediaStream([...canvasStream.getVideoTracks(), ...mediaStream.getAudioTracks()]);

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
  mediaRecorder = new MediaRecorder(combinedRecordStream, { mimeType, videoBitsPerSecond: 400000, audioBitsPerSecond: 64000 });
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = onRecordingStopped;
  mediaRecorder.start();
  startSpeechRecognition();

  timerInterval = setInterval(() => {
    timeLeft -= 0.1;
    if (timeLeft <= 0) { timerDisplay.textContent = "0.0s"; stopRecording(); }
    else timerDisplay.textContent = `${timeLeft.toFixed(1)}s`;
  }, 100);
}

function stopRecording() {
  clearInterval(timerInterval);
  isRecording = false;
  stopSpeechRecognition();
  stopDrawLoop();
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
}

function onRecordingStopped() {
  lastBlob = new Blob(recordedChunks, { type: "video/webm" });
  btnRecord.textContent = "Start Recording";
  btnRecord.classList.remove("recording");

  setTimeout(() => {
    lastVerification = verifyRecording(SENTENCES[currentIndex]);

    if (lastVerification.status === "blocked") {
      verifyBanner.className = "verify-banner fail";
      verifyMessage.textContent = "This recording could not be accepted — inappropriate language was detected. Please re-record, saying only the sentence shown above.";
      verifyBanner.classList.remove("hidden");
      afterRecord.classList.add("hidden");
      btnRecord.disabled = !lastQuality.allOk;
      return;
    }
    if (lastVerification.status === "fail") {
      verifyBanner.className = "verify-banner fail";
      verifyMessage.textContent = "We couldn't confirm you said the sentence shown above (it sounded different). Please try again, speaking clearly.";
      verifyBanner.classList.remove("hidden");
      afterRecord.classList.add("hidden");
      btnRecord.disabled = !lastQuality.allOk;
      return;
    }
    if (lastVerification.status === "technical_error") {
      verifyBanner.className = "verify-banner warn";
      verifyMessage.textContent = "We couldn't check this recording due to a connection issue (not a problem with what you said). It will be uploaded and reviewed manually. You may continue, or re-record if you'd like to try again.";
      verifyBanner.classList.remove("hidden");
    } else if (lastVerification.status === "unsupported") {
      verifyBanner.className = "verify-banner warn";
      verifyMessage.textContent = "Note: your browser doesn't support automatic sentence checking. This recording will be uploaded and manually reviewed instead. For automatic checking, please use Chrome or Edge.";
      verifyBanner.classList.remove("hidden");
    } else {
      verifyBanner.classList.add("hidden");
    }

    afterRecord.classList.remove("hidden");
    uploadRecording(lastBlob);
  }, 400);
}

// ============================================================
// Upload to Supabase Storage
// ============================================================
function sanitize(str) { return str.trim().replace(/[^a-zA-Z0-9]+/g, "_"); }

async function uploadRecording(blob) {
  uploadStatus.textContent = "Uploading…";
  uploadStatus.className = "upload-status";
  btnNext.disabled = true;
  btnRedo.disabled = true;

  const folder = `${sanitize(participant.rollNo)}_${sanitize(participant.name)}`;
  const fileName = `${String(currentIndex + 1).padStart(2, "0")}.webm`;
  const path = `${folder}/${fileName}`;

  const fileOptions = {
    contentType: "video/webm",
    upsert: true,
    metadata: {
      name: participant.name, rollNo: participant.rollNo, skinTone: participant.skinTone, gender: participant.gender,
      sentenceIndex: String(currentIndex + 1), sentenceText: SENTENCES[currentIndex],
      sentenceSetNumber: String((SENTENCE_SETS.indexOf(SENTENCES)) + 1),
      requestedWidth: String(TARGET_WIDTH), requestedHeight: String(TARGET_HEIGHT), requestedFps: String(TARGET_FPS),
      actualWidth: String(actualTrackSettings.width || ""), actualHeight: String(actualTrackSettings.height || ""),
      actualFps: String(actualTrackSettings.frameRate || ""), recordedAtISO: new Date().toISOString(),
      verificationStatus: lastVerification ? lastVerification.status : "unknown",
      verificationTranscript: lastVerification ? lastVerification.transcript : "",
      verificationSimilarity: lastVerification && lastVerification.similarity !== null ? lastVerification.similarity.toFixed(2) : "",
      verificationErrorType: lastVerification && lastVerification.errorType ? lastVerification.errorType : "",
      faceQualityBrightness: lastQuality && lastQuality.brightness !== null ? String(Math.round(lastQuality.brightness)) : ""
    }
  };

  const { data, error } = await supabaseClient.storage.from("recordings").upload(path, blob, fileOptions);

  if (error) {
    uploadStatus.textContent = "Upload failed: " + error.message + ". You can try again with Re-record, or check your internet connection.";
    uploadStatus.className = "upload-status error";
    btnRedo.disabled = false;
  } else {
    uploadStatus.textContent = "Uploaded successfully.";
    uploadStatus.className = "upload-status success";
    btnNext.disabled = false;
    btnRedo.disabled = false;
  }
}

btnRedo.addEventListener("click", () => loadSentence(currentIndex));

btnNext.addEventListener("click", () => {
  currentIndex++;
  if (currentIndex >= SENTENCES.length) {
    progressFill.style.width = "100%";
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    if (qualityRafId) cancelAnimationFrame(qualityRafId);
    showScreen("screen-done");
  } else {
    loadSentence(currentIndex);
  }
});
