const audio = document.getElementById("audio");
const libraryGrid = document.getElementById("libraryGrid");
const recentList = document.getElementById("recentList");
const playlistOverview = document.getElementById("playlistOverview");
const playlistSelect = document.getElementById("playlistSelect");
const nowCover = document.getElementById("nowCover");
const nowTitle = document.getElementById("nowTitle");
const nowPlaylist = document.getElementById("nowPlaylist");
const volume = document.getElementById("volume");
const progress = document.getElementById("progress");
const currentTimeEl = document.getElementById("currentTime");
const durationEl = document.getElementById("duration");
const waveform = document.getElementById("waveform");
const waveformWrap = document.getElementById("waveformWrap");
const playhead = document.getElementById("playhead");
const waveTooltip = document.getElementById("waveTooltip");
const searchInput = document.getElementById("searchInput");
const resultCount = document.getElementById("resultCount");

const songFile = document.getElementById("songFile");
const coverFile = document.getElementById("coverFile");
const songName = document.getElementById("songName");
const newPlaylist = document.getElementById("newPlaylist");

const playBtn = document.getElementById("playBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const addSongBtn = document.getElementById("addSongBtn");
const removeSongBtn = document.getElementById("removeSongBtn");
const createPlaylistBtn = document.getElementById("createPlaylistBtn");
const clearStorageBtn = document.getElementById("clearStorageBtn");

const STORAGE_KEY = "glass-player-v1";
const RECENT_LIMIT = 6;

const state = {
  library: [],
  playlists: {},
  recent: [],
  currentIndex: null,
  currentPlaylist: "All Songs",
  objectUrls: new Map(),
  searchQuery: "",
  analyser: null,
  audioCtx: null,
  animationId: null,
  db: null,
  dragTargetPercent: null,
  dragRafId: null
};

const DB_NAME = "music-player-db";
const DB_STORE = "audio";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbPutAudio(id, file) {
  if (!state.db || !file) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put({
      id,
      blob: file,
      type: file.type || "audio/mpeg",
      fileName: file.name || "audio"
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbGetAudio(id) {
  if (!state.db) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function dbDeleteAudio(id) {
  if (!state.db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbClear() {
  if (!state.db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function loadStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    state.playlists = { "All Songs": [] };
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    state.library = parsed.library || [];
    state.playlists = parsed.playlists || { "All Songs": [] };
    state.recent = parsed.recent || [];
    state.currentPlaylist = parsed.currentPlaylist || "All Songs";
  } catch {
    // ignore corrupted storage
  }
  if (!state.playlists["All Songs"]) state.playlists["All Songs"] = [];
}

function saveStorage() {
  const payload = {
    library: state.library.map(song => ({
      id: song.id,
      name: song.name,
      coverData: song.coverData,
      fileName: song.fileName
    })),
    playlists: state.playlists,
    recent: state.recent,
    currentPlaylist: state.currentPlaylist
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function renderPlaylists() {
  playlistSelect.innerHTML = "";
  Object.keys(state.playlists).forEach(name => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (name === state.currentPlaylist) option.selected = true;
    playlistSelect.appendChild(option);
  });

  playlistOverview.innerHTML = "";
  Object.entries(state.playlists).forEach(([name, ids]) => {
    const item = document.createElement("div");
    item.className = "recent-item";
    item.innerHTML = `<strong>${name}</strong><span class="badge">${ids.length}</span>`;
    item.addEventListener("click", () => {
      state.currentPlaylist = name;
      renderAll();
    });
    playlistOverview.appendChild(item);
  });
}

function getFilteredIds() {
  const ids = state.currentPlaylist === "All Songs"
    ? state.library.map(song => song.id)
    : state.playlists[state.currentPlaylist] || [];
  const query = state.searchQuery.toLowerCase();
  if (!query) return ids;
  return ids.filter(id => {
    const song = state.library.find(s => s.id === id);
    if (!song) return false;
    return song.name.toLowerCase().includes(query) || (song.fileName || "").toLowerCase().includes(query);
  });
}

function renderLibrary() {
  libraryGrid.innerHTML = "";
  const ids = getFilteredIds();
  resultCount.textContent = `${ids.length} result${ids.length === 1 ? "" : "s"}`;

  ids.forEach(id => {
    const song = state.library.find(s => s.id === id);
    if (!song) return;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <img src="${song.coverData || ""}" alt="${song.name}" />
      <h4>${song.name}</h4>
      <div class="card-actions">
        <button class="btn primary" data-id="${song.id}">Play</button>
        <span class="badge">${song.fileName || "No file"}</span>
      </div>
    `;
    card.querySelector("button").addEventListener("click", () => playSongById(song.id));
    libraryGrid.appendChild(card);
  });
}

function renderRecent() {
  recentList.innerHTML = "";
  state.recent.forEach(id => {
    const song = state.library.find(s => s.id === id);
    if (!song) return;
    const item = document.createElement("div");
    item.className = "recent-item";
    item.innerHTML = `
      <img src="${song.coverData || ""}" alt="${song.name}" />
      <div>
        <div>${song.name}</div>
        <div class="footer-note">${song.fileName || "No file"}</div>
      </div>
    `;
    item.addEventListener("click", () => playSongById(song.id));
    recentList.appendChild(item);
  });
}

function renderNowPlaying(song) {
  if (!song) {
    nowTitle.textContent = "No song loaded";
    nowPlaylist.textContent = "Select or upload a track";
    nowCover.innerHTML = "<span>Cover</span>";
    currentTimeEl.textContent = "0:00";
    durationEl.textContent = "0:00";
    progress.value = 0;
    setPlayhead(0);
    return;
  }
  nowTitle.textContent = song.name;
  nowPlaylist.textContent = state.currentPlaylist;
  nowCover.innerHTML = `<img src="${song.coverData || ""}" alt="${song.name}" />`;
}

function renderAll() {
  if (!state.playlists["All Songs"]) state.playlists["All Songs"] = [];
  renderPlaylists();
  renderLibrary();
  renderRecent();
  saveStorage();
}

function addRecent(id) {
  state.recent = [id, ...state.recent.filter(item => item !== id)].slice(0, RECENT_LIMIT);
  renderRecent();
  saveStorage();
}

function registerObjectUrl(id, file) {
  if (!file) return null;
  if (state.objectUrls.has(id)) {
    URL.revokeObjectURL(state.objectUrls.get(id));
  }
  const url = URL.createObjectURL(file);
  state.objectUrls.set(id, url);
  return url;
}

function ensureAnalyser() {
  if (state.analyser) return;
  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = state.audioCtx.createMediaElementSource(audio);
  state.analyser = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 256;
  source.connect(state.analyser);
  state.analyser.connect(state.audioCtx.destination);
}

function drawWaveform() {
  const ctx = waveform.getContext("2d");
  const analyser = state.analyser;
  if (!ctx || !analyser) return;

  const resize = () => {
    const rect = waveformWrap.getBoundingClientRect();
    waveform.width = Math.max(300, Math.floor(rect.width * window.devicePixelRatio));
    waveform.height = Math.floor(rect.height * window.devicePixelRatio);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  };

  resize();
  window.addEventListener("resize", resize, { passive: true });

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  const width = waveformWrap.clientWidth;
  const height = waveformWrap.clientHeight;

  const draw = () => {
    state.animationId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, width, height);
    const barWidth = (width / bufferLength) * 2.2;
    let x = 0;
    for (let i = 0; i < bufferLength; i += 2) {
      const value = dataArray[i] / 255;
      const barHeight = Math.max(4, value * height);
      const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
      gradient.addColorStop(0, "rgba(121, 201, 255, 0.9)");
      gradient.addColorStop(1, "rgba(163, 255, 214, 0.4)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x, height - barHeight, barWidth - 1.5, barHeight);
      x += barWidth;
    }
  };

  cancelAnimationFrame(state.animationId);
  draw();
}

function playSongById(id) {
  const song = state.library.find(s => s.id === id);
  if (!song) return;
  state.currentIndex = state.library.findIndex(s => s.id === id);
  if (song.file) {
    const url = registerObjectUrl(song.id, song.file);
    audio.src = url;
    audio.play();
    playBtn.textContent = "Pause";
    ensureAnalyser();
    if (state.audioCtx.state === "suspended") state.audioCtx.resume();
    drawWaveform();
  }
  renderNowPlaying(song);
  addRecent(song.id);
}

function nextSong(direction = 1) {
  if (state.library.length === 0) return;
  const ids = state.currentPlaylist === "All Songs"
    ? state.library.map(song => song.id)
    : state.playlists[state.currentPlaylist] || [];
  if (ids.length === 0) return;

  const currentId = state.currentIndex != null ? state.library[state.currentIndex]?.id : ids[0];
  const currentPosition = ids.indexOf(currentId);
  const nextPosition = (currentPosition + direction + ids.length) % ids.length;
  playSongById(ids[nextPosition]);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function setPlayhead(percent) {
  const clamped = Math.min(100, Math.max(0, percent));
  playhead.style.left = `${clamped}%`;
}

function seekFromClientX(clientX) {
  if (!audio.duration) return;
  const rect = waveformWrap.getBoundingClientRect();
  const percent = ((clientX - rect.left) / rect.width) * 100;
  const clamped = Math.min(100, Math.max(0, percent));
  state.dragTargetPercent = clamped;
  scheduleDragSeek();
}

playBtn.addEventListener("click", () => {
  if (!audio.src) {
    nextSong(0);
    return;
  }
  if (audio.paused) {
    audio.play();
    playBtn.textContent = "Pause";
  } else {
    audio.pause();
    playBtn.textContent = "Play";
  }
});

prevBtn.addEventListener("click", () => nextSong(-1));
nextBtn.addEventListener("click", () => nextSong(1));

volume.addEventListener("input", () => {
  audio.volume = Number(volume.value);
});

progress.addEventListener("input", () => {
  if (!audio.duration) return;
  audio.currentTime = (Number(progress.value) / 100) * audio.duration;
});

audio.addEventListener("timeupdate", () => {
  if (!audio.duration) return;
  const percent = (audio.currentTime / audio.duration) * 100;
  progress.value = percent;
  currentTimeEl.textContent = formatTime(audio.currentTime);
  if (!isDraggingPlayhead) setPlayhead(percent);
});

audio.addEventListener("loadedmetadata", () => {
  durationEl.textContent = formatTime(audio.duration);
});

audio.addEventListener("ended", () => nextSong(1));

addSongBtn.addEventListener("click", async () => {
  if (!songFile.files[0]) return;
  const file = songFile.files[0];
  const cover = coverFile.files[0];
  const name = songName.value.trim() || file.name.replace(/\.[^.]+$/, "");
  const id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  let coverData = "";
  if (cover) {
    coverData = await fileToDataUrl(cover);
  }

  const song = { id, name, file, fileName: file.name, coverData };
  state.library.push(song);
  if (!state.playlists["All Songs"]) state.playlists["All Songs"] = [];
  state.playlists["All Songs"].push(id);

  const selectedPlaylist = playlistSelect.value;
  if (selectedPlaylist && selectedPlaylist !== "All Songs") {
    state.playlists[selectedPlaylist] = state.playlists[selectedPlaylist] || [];
    state.playlists[selectedPlaylist].push(id);
  }

  renderAll();
  await dbPutAudio(id, file);
  songFile.value = "";
  coverFile.value = "";
  songName.value = "";
});

removeSongBtn.addEventListener("click", () => {
  if (state.currentIndex == null) return;
  const song = state.library[state.currentIndex];
  if (!song) return;
  state.library = state.library.filter(s => s.id !== song.id);
  Object.keys(state.playlists).forEach(name => {
    state.playlists[name] = (state.playlists[name] || []).filter(id => id !== song.id);
  });
  state.recent = state.recent.filter(id => id !== song.id);
  state.currentIndex = null;
  audio.pause();
  audio.src = "";
  playBtn.textContent = "Play";
  renderNowPlaying(null);
  renderAll();
  dbDeleteAudio(song.id);
});

createPlaylistBtn.addEventListener("click", () => {
  const name = newPlaylist.value.trim();
  if (!name || state.playlists[name]) return;
  state.playlists[name] = [];
  newPlaylist.value = "";
  state.currentPlaylist = name;
  renderAll();
});

clearStorageBtn.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  state.library = [];
  state.playlists = { "All Songs": [] };
  state.recent = [];
  state.currentIndex = null;
  audio.pause();
  audio.src = "";
  playBtn.textContent = "Play";
  renderNowPlaying(null);
  renderAll();
  dbClear();
});

searchInput.addEventListener("input", () => {
  state.searchQuery = searchInput.value.trim();
  renderLibrary();
});

playlistSelect.addEventListener("change", () => {
  state.currentPlaylist = playlistSelect.value;
  renderAll();
});

let isDraggingPlayhead = false;

waveformWrap.addEventListener("pointerdown", (event) => {
  if (!audio.duration) return;
  isDraggingPlayhead = true;
  waveformWrap.setPointerCapture(event.pointerId);
  seekFromClientX(event.clientX);
});

waveformWrap.addEventListener("pointermove", (event) => {
  if (!isDraggingPlayhead) return;
  seekFromClientX(event.clientX);
});

waveformWrap.addEventListener("pointerup", (event) => {
  if (!isDraggingPlayhead) return;
  isDraggingPlayhead = false;
  waveformWrap.releasePointerCapture(event.pointerId);
});

waveformWrap.addEventListener("pointerleave", () => {
  isDraggingPlayhead = false;
});

waveformWrap.addEventListener("pointermove", (event) => {
  if (!audio.duration) return;
  const rect = waveformWrap.getBoundingClientRect();
  const percent = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
  const time = (percent / 100) * audio.duration;
  waveTooltip.textContent = formatTime(time);
  waveTooltip.style.left = `${percent}%`;
});

function scheduleDragSeek() {
  if (state.dragRafId) return;
  state.dragRafId = requestAnimationFrame(() => {
    state.dragRafId = null;
    if (!audio.duration || state.dragTargetPercent == null) return;
    const percent = state.dragTargetPercent;
    audio.currentTime = (percent / 100) * audio.duration;
    setPlayhead(percent);
  });
}

async function hydrateAudioFiles() {
  if (!state.db) return;
  const promises = state.library.map(async song => {
    if (song.file) return;
    const record = await dbGetAudio(song.id);
    if (!record || !record.blob) return;
    const blob = record.blob;
    const file = new File([blob], record.fileName || song.fileName || "audio", { type: record.type || blob.type });
    song.file = file;
  });
  await Promise.all(promises);
}

function fileToDataUrl(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

async function init() {
  loadStorage();
  try {
    state.db = await openDb();
    await hydrateAudioFiles();
  } catch {
    // ignore db failures
  }
  volume.value = 0.8;
  audio.volume = 0.8;
  renderAll();
  renderNowPlaying(null);
}

init();
