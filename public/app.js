let resultUrl = null;

const API_BASE = window.API_BASE || "";

function el(id) { return document.getElementById(id); }
function show(id) { el(id).classList.remove("hidden"); }
function hide(id) { el(id).classList.add("hidden"); }

function setStatus(msg, type = "") {
  const s = el("status");
  s.textContent = msg;
  s.className = "status " + type;
}

function appendLog(msg) {
  const log = el("logSteps");
  const d = document.createElement("div");
  d.className = "log-entry";
  d.innerHTML = '<span class="log-dot"></span><span class="log-msg">' + msg + '</span>';
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

function addStep(text, state = "active") {
  const c = el("progressSteps");
  const d = document.createElement("div");
  d.className = "progress-step " + state;
  d.innerHTML = (state === "done" ? "&#10003;" : state === "err" ? "&#10007;" : "&#9679;") + " " + text;
  c.appendChild(d);
}

function setProgress(pct) {
  el("progressFill").style.width = pct + "%";
}

function showResult(url) {
  resultUrl = url;
  el("finalUrl").textContent = url;
  el("resultTags").innerHTML =
    '<span class="tag tag-service">' + el("detectedName").textContent + '</span>' +
    '<span class="tag tag-speed">organic</span>' +
    '<span class="tag tag-steps">' + el("progressSteps").children.length + ' steps</span>';
  show("result");
}

function copyResult() {
  if (!resultUrl) return;
  navigator.clipboard.writeText(resultUrl).then(() => {
    const b = document.querySelector(".copy-btn");
    b.textContent = "Copied!";
    setTimeout(() => { b.textContent = "Copy"; }, 2000);
  });
}

function normalizeUrl(raw) {
  let url = raw.trim();
  if (url && !/^[a-zA-Z]+:\/\//.test(url)) url = "https://" + url;
  return url;
}

async function resolve() {
  let url = normalizeUrl(el("urlInput").value);
  if (!url) { el("urlInput").focus(); return; }
  el("urlInput").value = url;

  const btn = el("resolveBtn");
  btn.disabled = true;
  btn.querySelector(".btn-text").textContent = "Bypassing...";
  hide("result"); hide("logs");
  show("progress");
  el("progressSteps").innerHTML = "";
  setProgress(0);

  setStatus("Mendeteksi service...", "loading");
  addStep("Deteksi URL");
  setProgress(10);

  try {
    const r = await fetch(API_BASE + "/api/check", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({url})
    });
    const d = await r.json();
    if (!d.valid) throw new Error("URL tidak valid");
    el("detectedName").textContent = d.service;
    show("detectedBadge");
    setProgress(20);
  } catch(e) {
    setStatus(e.message, "error");
    btn.disabled = false;
    btn.querySelector(".btn-text").textContent = "Bypass";
    return;
  }

  show("logs");
  el("logSteps").innerHTML = "";
  const t0 = Date.now();

  appendLog("Mode: ORGANIC");
  setProgress(30);

  try {
    const res = await fetch(API_BASE + "/api/organic", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({url})
    });
    const data = await res.json();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    el("logsTime").textContent = elapsed + "s";

    if (data.success) {
      setProgress(100);
      addStep("Selesai", "done");
      setStatus("Bypass berhasil! (" + elapsed + "s)", "organic");
      showResult(data.resolved || data.url);
      el("statSpeed").textContent = elapsed + "s";
    } else {
      setProgress(60);
      addStep("Gagal", "err");
      setStatus(data.error || "Gagal memproses", "error");
      appendLog(data.error || "Unknown error");
    }
  } catch(e) {
    setStatus("Koneksi error", "error");
    appendLog(e.message);
    addStep("Error", "err");
  } finally {
    btn.disabled = false;
    btn.querySelector(".btn-text").textContent = "Bypass";
  }
}

// ===== Tabs =====
function switchTab(name) {
  const tabs = ["bypass", "stream"];
  const map = {
    bypass: { tab: "tabBypass", panel: "panelBypass" },
    stream: { tab: "tabStream", panel: "panelStream" },
  };
  tabs.forEach((t) => {
    const active = t === name;
    el(map[t].tab).classList.toggle("active", active);
    el(map[t].panel).classList.toggle("hidden", !active);
  });
}

// ===== LINK STREAMING =====
const WYZIE_KEY = "wyzie-61f7quy31m8al8ll5m09l9lazhlvrd07";
let streamHistory = [];
let subTrackKey = 0;
let suggestDebounce = null;

function isArchiveExt(name) {
  const n = (name || "").toLowerCase();
  return n.endsWith(".zip") || n.endsWith(".rar") || n.endsWith(".7z");
}
function isArchiveLink(url) {
  try { const p = new URL(url); return isArchiveExt(p.pathname); } catch { return false; }
}

function showStreamError(msg) {
  const e = el("streamError");
  e.textContent = msg;
  show("streamError");
}
function hideStreamError() { hide("streamError"); }

function showSubStatus(msg, type) {
  const s = el("streamSubStatus");
  s.textContent = msg;
  s.className = "sub-status " + (type || "ok");
  show("streamSubStatus");
}
function hideSubStatus() { hide("streamSubStatus"); }

function showSubSearchStatus(msg, type, loading) {
  const s = el("subSearchStatus");
  s.innerHTML = (loading ? '<span class="spinner-anim"></span> ' : '') + msg;
  s.className = "sub-status " + (type || "ok");
  show("subSearchStatus");
}

function guessSubtitleUrl(videoUrl) {
  try {
    const u = new URL(videoUrl);
    const ext = u.pathname.match(/\.(mp4|mkv|avi|webm|mov|ts)$/i);
    if (!ext) return null;
    return `${u.origin}${u.pathname.substring(0, u.pathname.length - ext[0].length)}.srt`;
  } catch { return null; }
}

function getPixelDrainSubUrls(videoUrl) {
  try {
    const u = new URL(videoUrl);
    if (!u.hostname.includes("pixeldrain.com")) return [];
    const parts = u.pathname.split("/");
    const idx = parts.indexOf("u");
    if (idx === -1 || !parts[idx + 1]) return [];
    const id = parts[idx + 1];
    return [
      `https://pixeldrain.com/api/file/${id}.srt`,
      `https://pixeldrain.com/api/file/${id}.vtt`,
      `https://pixeldrain.com/api/file/${id}.ass`,
    ];
  } catch { return []; }
}

async function tryAutoSubtitle(videoUrl) {
  const candidates = [guessSubtitleUrl(videoUrl), ...getPixelDrainSubUrls(videoUrl)].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const encoded = encodeURIComponent(candidate);
      applySubtitleTrack(`${API_BASE}/api/stream/subtitle?url=${encoded}`);
      showSubStatus(`Subtitle found: ${candidate.split("/").pop()}`);
      return true;
    } catch {}
  }
  return false;
}

function applySubtitleTrack(subUrl) {
  const video = el("streamVideo");
  const existing = video.querySelector("track");
  if (existing) existing.remove();
  if (!subUrl) { el("subToggleBtn").textContent = "CC"; return; }
  const track = document.createElement("track");
  subTrackKey++;
  track.src = subUrl;
  track.kind = "subtitles";
  track.srcLang = "en";
  track.label = "Subtitles";
  track.default = true;
  track.onerror = function() {
    const btn = el("subToggleBtn");
    if (btn && btn.textContent !== "No sub") {
      showSubStatus("Failed to load subtitle", "error");
    }
  };
  track.onload = function() {
    showSubStatus("Subtitle ready", "ok");
  };
  video.appendChild(track);
  video.textTracks[video.textTracks.length - 1].mode = "showing";
  el("subToggleBtn").textContent = "CC ON";
}

async function loadSubtitle() {
  const subUrl = el("subUrlInput").value.trim();
  if (!subUrl) return;
  showSubStatus("Loading subtitle...", "ok");
  try {
    applySubtitleTrack(`${API_BASE}/api/stream/subtitle?url=${encodeURIComponent(subUrl)}`);
    showSubStatus("Subtitle loaded", "ok");
  } catch (e) { showSubStatus("Failed: " + e.message, "error"); }
}

function toggleSubtitles() {
  const video = el("streamVideo");
  if (!video) return;
  let showing = false;
  for (let i = 0; i < video.textTracks.length; i++) {
    video.textTracks[i].mode = video.textTracks[i].mode === "showing" ? "hidden" : "showing";
    if (video.textTracks[i].mode === "showing") showing = true;
  }
  el("subToggleBtn").textContent = showing ? "CC ON" : "CC OFF";
}

async function searchWyzie(imdbId, lang) {
  if (!imdbId) return [];
  try {
    const params = new URLSearchParams({ id: imdbId, key: WYZIE_KEY, source: "all" });
    if (lang) params.set("language", lang);
    const res = await fetch(`https://sub.wyzie.io/search?${params}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function searchByTitle() {
  const t = el("titleInput").value.trim();
  if (!t) return;
  const lang = el("subLangSelect").value;
  showSubSearchStatus("Searching...", "ok", true);
  el("subResults").innerHTML = "";
  try {
    const metaRes = await fetch(`${API_BASE}/api/stream/metadata?url=x&title=${encodeURIComponent(t)}`);
    const meta = await metaRes.json();
    if (meta.imdbId) {
      el("imdbBadge").textContent = meta.imdbId;
      show("imdbBadge");
      el("movieTitle").textContent = meta.title || t;
      show("movieInfo");
      const results = await searchWyzie(meta.imdbId, lang);
      let finalResults = results;
      if (results.length === 0 && lang !== "en") {
        finalResults = await searchWyzie(meta.imdbId, "en");
        if (finalResults.length > 0) showSubSearchStatus(`Found ${finalResults.length} subtitle(s) (English)`, "ok", false);
      }
      if (finalResults.length > 0) {
        renderSubResults(finalResults);
        showSubSearchStatus(`Found ${finalResults.length} subtitle(s) for ${meta.title || t}`, "ok", false);
        const best = finalResults[0];
        showSubStatus(`Loading: ${best.display}...`, "ok");
        const srtUrl = `${API_BASE}/api/stream/subtitle?url=${encodeURIComponent(convertWyzieUrl(best.url, best.format))}`;
        applySubtitleTrack(srtUrl);
        showSubStatus(`Auto-loaded: ${best.display}`, "ok");
      } else {
        showSubSearchStatus("No subtitles found", "error", false);
      }
    } else {
      showSubSearchStatus("Could not find IMDB ID for this title", "error", false);
    }
  } catch (e) {
    showSubSearchStatus("Search failed: " + e.message, "error", false);
  }
}

let allSubResults = [];

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderSubResults(subs, reset = true) {
  const container = el("subResults");
  if (reset) {
    container.innerHTML = "";
    allSubResults = subs;
  }
  show("subResults");
  allSubResults.forEach((sub, idx) => {
    const btn = document.createElement("button");
    btn.className = "sub-result-chip" + (idx === 0 ? " auto-loaded" : "");
    const name = sub.fileName || sub.display || "Subtitle";
    btn.innerHTML =
      (sub.flagUrl ? `<img src="${sub.flagUrl}" alt="" class="flag-icon">` : '') +
      `<span class="sub-lang-name">${esc(name)}</span>` +
      `<span class="sub-lang-tag">${esc(sub.display)}</span>` +
      (sub.release ? `<span class="sub-release">${esc(sub.release)}</span>` : '') +
      `<span class="sub-source">${sub.source}</span>` +
      `<span class="sub-format">${sub.format}</span>` +
      (sub.isHearingImpaired ? '<span class="hi-tag">HI</span>' : '') +
      (idx === 0 ? '<span class="auto-tag">AUTO</span>' : '');
    btn.onclick = () => loadWyzieSub(sub);
    container.appendChild(btn);
  });
}

function convertWyzieUrl(url, format) {  if (!url) return url;
  const vrfMatch = url.match(/vrf-([a-f0-9]+)/i);
  const fileIdMatch = url.match(/\/file\/(\d+)/);
  if (vrfMatch && fileIdMatch) {
    const fmt = (format || "srt").toLowerCase();
    return `https://sub.wyzie.io/c/${vrfMatch[1]}/id/${fileIdMatch[1]}?format=${fmt}`;
  }
  return url;
}

async function loadWyzieSub(sub) {
  showSubStatus(`Loading: ${sub.display}...`, "ok");
  try {
    const downloadUrl = convertWyzieUrl(sub.url, sub.format);
    if (!downloadUrl) throw new Error("No download URL");
    const srtUrl = `${API_BASE}/api/stream/subtitle?url=${encodeURIComponent(downloadUrl)}`;
    applySubtitleTrack(srtUrl);
    showSubStatus(`Loaded: ${sub.display} (${sub.release})`, "ok");
  } catch (e) {
    showSubStatus("Failed: " + e.message, "error");
  }
}

async function detectUrlType(url) {
  if (isArchiveLink(url)) return "archive";
  try {
    const res = await fetch(`${API_BASE}/api/stream/archive?url=${encodeURIComponent(url)}&action=info`);
    if (!res.ok) return "video";
    const info = await res.json();
    if (isArchiveExt(info.name)) return "archive";
    return "video";
  } catch { return "video"; }
}

async function loadArchiveContents(archiveUrl) {
  el("archiveLoading").innerHTML = '<span class="spinner-anim"></span><span>Loading archive contents...</span>';
  show("archiveLoading");
  el("archiveList").innerHTML = "";
  try {
    const res = await fetch(`${API_BASE}/api/stream/archive?url=${encodeURIComponent(archiveUrl)}&action=list`);
    if (!res.ok) throw new Error("Failed to load archive");
    const data = await res.json();
    renderArchiveFiles(data.files || [], archiveUrl);
    hide("archiveLoading");
  } catch (e) {
    hide("archiveLoading");
    showStreamError("Failed to load archive: " + e.message);
  }
}

function renderArchiveFiles(files, archiveUrl) {
  const list = el("archiveList");
  list.innerHTML = "";
  show("archiveFiles");
  files.forEach((file, i) => {
    const btn = document.createElement("button");
    btn.className = "archive-item";
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    const ext = (file.name.split(".").pop() || "").toUpperCase();
    btn.innerHTML =
      '<span class="archive-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></span>' +
      `<span class="archive-name">${file.name}</span>` +
      `<span class="archive-size">${ext} &middot; ${sizeMB} MB</span>`;
    btn.onclick = () => {
      playArchiveFile(archiveUrl, file);
      document.querySelectorAll(".archive-item").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    };
    list.appendChild(btn);
  });
}

function hevcSupported() {
  try {
    return !!(window.MediaSource &&
      (MediaSource.isTypeSupported('video/mp4; codecs="hev1.1.6.L120.90"') ||
       MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L120.90"') ||
       MediaSource.isTypeSupported('video/mp4; codecs="hev1.1.6.L150.90"') ||
       MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L150.90"')));
  } catch { return false; }
}

async function playArchiveFile(archiveUrl, file) {
  const encoded = encodeURIComponent(archiveUrl);
  const encodedFile = encodeURIComponent(JSON.stringify(file));
  let codec = "other";
  try {
    const r = await fetch(`${API_BASE}/api/stream/archive?url=${encoded}&action=codec&file=${encodedFile}`);
    const d = await r.json();
    codec = d.codec || "other";
  } catch {}
  if (codec === "hevc") {
    setStreamUrl(`${API_BASE}/api/stream/archive?url=${encoded}&action=hls&file=${encodedFile}&codec=${hevcSupported() ? "hevc" : "h264"}`, true);
  } else {
    setStreamUrl(`${API_BASE}/api/stream/archive?url=${encoded}&action=stream&file=${encodedFile}`);
  }
}

function destroyHls() {
  if (window._hls) { try { window._hls.destroy(); } catch {} window._hls = null; }
}

function setStreamUrl(url, isHls = false) {
  const video = el("streamVideo");
  destroyHls();
  let retried = false;
  show("playerWrapper");
  el("centerOverlay").classList.remove("hidden-overlay");
  el("playerLoader").classList.remove("hidden-overlay");
  el("curTime").textContent = "0:00";
  el("durTime").textContent = "0:00";
  el("seekBar").value = 0;
  el("playerControls").classList.add("visible");

  video.onloadedmetadata = () => {
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = "showing";
    }
  };

  if (isHls) {
    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 45, maxMaxBufferLength: 60, backBufferLength: 30, fragLoadingTimeOut: 120000, manifestLoadingTimeOut: 10000, manifestLoadingMaxRetry: 2 });
      window._hls = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (e, data) => {
        if (data.fatal) {
          if (!retried && url.indexOf("codec=hevc") !== -1) {
            retried = true;
            try { hls.destroy(); } catch {}
            window._hls = null;
            setStreamUrl(url.replace("codec=hevc", "codec=h264"), true);
            return;
          }
          showStreamError("HLS error: " + data.details);
        }
      });
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.play().catch(() => {});
      return;
    }
  }

  video.src = url;
}

async function handleStream() {
  const urlInput = el("streamUrlInput");
  let url = normalizeUrl(urlInput.value);
  if (!url) { urlInput.focus(); return; }
  urlInput.value = url;
  hideStreamError();
  el("streamError").classList.add("hidden");
  el("subResults").innerHTML = "";
  hide("subResults");
  el("archiveList").innerHTML = "";
  hide("archiveFiles");

  const btn = el("streamBtn");
  btn.disabled = true;
  btn.querySelector(".btn-text").textContent = "Loading...";

  try {
    if (isArchiveLink(url)) {
      await loadArchiveContents(url);
      btn.disabled = false;
      btn.querySelector(".btn-text").textContent = "Stream";
      return;
    }
    const type = await detectUrlType(url);
    if (type === "archive") {
      await loadArchiveContents(url);
      btn.disabled = false;
      btn.querySelector(".btn-text").textContent = "Stream";
      return;
    }
    const encoded = encodeURIComponent(url);
    const proxyUrl = `${API_BASE}/api/stream/stream?url=${encoded}`;
    const res = await fetch(`${API_BASE}/api/stream/stream?url=${encoded}`, { method: "HEAD" });
    if (!res.ok) throw new Error(`Cannot fetch video (HTTP ${res.status})`);
    let codec = "other";
    try {
      const cr = await fetch(`${API_BASE}/api/stream/stream?url=${encoded}&action=codec`);
      const cd = await cr.json();
      codec = cd.codec || "other";
    } catch {}
    if (codec === "hevc") {
      setStreamUrl(`${API_BASE}/api/stream/stream?url=${encoded}&action=hls&codec=${hevcSupported() ? "hevc" : "h264"}`, true);
    } else {
      setStreamUrl(proxyUrl);
    }
    streamHistory = [{ url, time: new Date().toLocaleTimeString() }, ...streamHistory.filter(h => h.url !== url)].slice(0, 10);
    renderHistory();
    const subUrl = el("subUrlInput").value.trim();
    if (subUrl) {
      await loadSubtitle();
    } else {
      await tryAutoSubtitle(url);
    }
  } catch (e) {
    showStreamError(e.message || "Failed to load video");
  } finally {
    btn.disabled = false;
    btn.querySelector(".btn-text").textContent = "Stream";
  }
}

function renderHistory() {
  if (streamHistory.length === 0) { hide("streamHistory"); return; }
  const ul = el("historyList");
  ul.innerHTML = "";
  show("streamHistory");
  streamHistory.forEach((h) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="history-url">${h.url}</span><span class="history-time">${h.time}</span>`;
    li.onclick = () => { el("streamUrlInput").value = h.url; handleStream(); };
    ul.appendChild(li);
  });
}

// ===== Event Listeners =====
el("urlInput").addEventListener("keydown", e => { if (e.key === "Enter") resolve(); });
el("streamUrlInput").addEventListener("keydown", e => { if (e.key === "Enter") handleStream(); });
el("subUrlInput").addEventListener("keydown", e => { if (e.key === "Enter") loadSubtitle(); });

el("titleInput").addEventListener("input", () => {
  const val = el("titleInput").value;
  if (suggestDebounce) clearTimeout(suggestDebounce);
  if (!val || val.length < 2) { hide("suggestDropdown"); return; }
  suggestDebounce = setTimeout(async () => {
    const lang = el("subLangSelect").value;
    try {
      const res = await fetch(`${API_BASE}/api/stream/search?q=${encodeURIComponent(val)}&lang=${lang}`);
      const data = await res.json();
      renderSuggestions(data.results || []);
    } catch { hide("suggestDropdown"); }
  }, 350);
});

el("titleInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && el("suggestDropdown").classList.contains("hidden")) searchByTitle();
});

function renderSuggestions(results) {
  const dd = el("suggestDropdown");
  dd.innerHTML = "";
  if (results.length === 0) {
    dd.innerHTML = '<div class="suggest-empty">No results</div>';
  } else {
    results.forEach((item) => {
      const btn = document.createElement("button");
      btn.className = "suggest-item";
      btn.innerHTML =
        (item.poster ? `<img src="${item.poster}" alt="" class="suggest-poster">` : '') +
        '<div class="suggest-info">' +
          `<span class="suggest-title">${item.title}</span>` +
          `<span class="suggest-meta">${item.year} &middot; ${item.type === "tv" ? "TV Series" : "Movie"}</span>` +
          (item.langBreakdown && item.langBreakdown.length > 0 ?
            `<span class="suggest-langs">${item.langBreakdown.slice(0, 4).map(l => `<span class="suggest-lang-tag">${l.lang} (${l.count})</span>`).join('')}</span>` : '') +
        '</div>' +
        '<div class="suggest-sub-info">' +
          (item.available ?
            `<span class="suggest-sub-available">${item.count} sub${item.count > 1 ? 's' : ''}</span>` :
            '<span class="suggest-sub-none">No subs</span>') +
        '</div>';
      btn.onclick = () => selectSuggestion(item);
      dd.appendChild(btn);
    });
  }
  show("suggestDropdown");
}

function selectSuggestion(item) {
  el("titleInput").value = item.title;
  hide("suggestDropdown");
  if (item.imdbId) {
    el("imdbBadge").textContent = item.imdbId;
    show("imdbBadge");
    el("movieTitle").textContent = item.title;
    show("movieInfo");
    searchWyzie(item.imdbId, el("subLangSelect").value).then((results) => {
      if (results.length > 0) {
        renderSubResults(results);
        showSubSearchStatus(`Found ${results.length} subtitle(s) for ${item.title}`, "ok", false);
        const best = results[0];
        showSubStatus(`Loading: ${best.display}...`, "ok");
        const srtUrl = `${API_BASE}/api/stream/subtitle?url=${encodeURIComponent(convertWyzieUrl(best.url, best.format))}`;
        applySubtitleTrack(srtUrl);
        showSubStatus(`Auto-loaded: ${best.display}`, "ok");
      } else {
        showSubSearchStatus("No subtitles found", "error", false);
      }
    });
  }
}

document.addEventListener("mousedown", (e) => {
  const dd = el("suggestDropdown");
  const ti = el("titleInput");
  if (dd && ti && !dd.contains(e.target) && !ti.contains(e.target)) hide("suggestDropdown");
});

el("subSizeSlider").addEventListener("input", (e) => {
  el("subSizeValue").textContent = e.target.value + "%";
  const video = el("streamVideo");
  if (video) video.style.setProperty("--sub-scale", e.target.value / 100);
});

const streamVideo = el("streamVideo");
if (streamVideo) {
  streamVideo.style.setProperty("--sub-scale", 1);
  streamVideo.addEventListener("fullscreenchange", () => {
    const slider = el("subSizeSlider");
    if (slider) streamVideo.style.setProperty("--sub-scale", slider.value / 100);
  });
}

el("urlInput").addEventListener("input", async () => {
  const url = normalizeUrl(el("urlInput").value);
  if (url.length > 10) {
    try {
    const r = await fetch(API_BASE + "/api/check", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({url})
      });
      const d = await r.json();
      if (d.valid) {
        el("detectedName").textContent = d.service;
        show("detectedBadge");
      } else {
        hide("detectedBadge");
      }
    } catch {}
  } else {
    hide("detectedBadge");
  }
});

// ===== Custom Player =====
function fmtTime(s) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ":" + String(sec).padStart(2, "0");
}

function initCustomPlayer() {
  const video = el("streamVideo");
  const box = el("playerBox");
  const playBtn = el("playBtn");
  const bigPlayBtn = el("bigPlayBtn");
  const seekBar = el("seekBar");
  const curTime = el("curTime");
  const durTime = el("durTime");
  const volSlider = el("volSlider");
  const muteBtn = el("muteBtn");
  const speedSelect = el("speedSelect");
  const fsBtn = el("fsBtn");
  const pipBtn = el("pipBtn");
  const controls = el("playerControls");
  const loader = el("playerLoader");
  const centerOverlay = el("centerOverlay");
  let hideTimer = null;

  function showControls(force) {
    controls.classList.add("visible");
    clearTimeout(hideTimer);
    if (!video.paused && !force) {
      hideTimer = setTimeout(() => {
        controls.classList.remove("visible");
      }, 2600);
    }
  }

  function setCenterOverlay() {
    centerOverlay.classList.toggle("hidden-overlay", !video.paused && !video.ended);
  }

  function setPlayIcon() {
    playBtn.innerHTML = video.paused
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
    bigPlayBtn.innerHTML = video.paused
      ? '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
      : '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  }

  function togglePlay() {
    if (video.paused || video.ended) { video.play(); centerOverlay.classList.add("hidden-overlay"); }
    else video.pause();
  }

  playBtn.addEventListener("click", togglePlay);
  bigPlayBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePlay(); });
  centerOverlay.addEventListener("click", () => togglePlay());
  box.addEventListener("click", (e) => {
    if (e.target === box || e.target === video) togglePlay();
  });

  video.addEventListener("play", () => { setPlayIcon(); loader.classList.add("hidden-overlay"); setCenterOverlay(); showControls(); });
  video.addEventListener("pause", () => { setPlayIcon(); setCenterOverlay(); showControls(true); });
  video.addEventListener("ended", () => { setPlayIcon(); centerOverlay.classList.remove("hidden-overlay"); showControls(true); });

  video.addEventListener("loadedmetadata", () => {
    seekBar.max = Math.floor(video.duration || 0);
    durTime.textContent = fmtTime(video.duration);
  });
  video.addEventListener("durationchange", () => {
    seekBar.max = Math.floor(video.duration || 0);
    durTime.textContent = fmtTime(video.duration);
  });
  video.addEventListener("timeupdate", () => {
    if (!seekBar.hasAttribute("data-scrub")) seekBar.value = Math.floor(video.currentTime || 0);
    curTime.textContent = fmtTime(video.currentTime);
  });
  seekBar.addEventListener("input", () => { if (video.duration) video.currentTime = Number(seekBar.value); });
  seekBar.addEventListener("change", () => { seekBar.removeAttribute("data-scrub"); });
  seekBar.addEventListener("pointerdown", () => seekBar.setAttribute("data-scrub", "1"));

  volSlider.addEventListener("input", () => {
    video.volume = Number(volSlider.value) / 100;
    video.muted = Number(volSlider.value) === 0;
    setMuteIcon();
  });
  muteBtn.addEventListener("click", () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) { video.volume = 0.5; volSlider.value = 50; }
    setMuteIcon();
  });
  function setMuteIcon() {
    muteBtn.innerHTML = video.muted || video.volume === 0
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>';
  }

  speedSelect.addEventListener("change", () => { video.playbackRate = Number(speedSelect.value); });

  fsBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) { box.requestFullscreen().catch(() => {}); }
    else document.exitFullscreen();
  });
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) { controls.classList.add("visible"); setCenterOverlay(); }
  });

  pipBtn.addEventListener("click", async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await video.requestPictureInPicture();
    } catch (e) {}
  });

  box.addEventListener("mousemove", () => showControls());
  box.addEventListener("mouseleave", () => {
    if (!video.paused) { controls.classList.remove("visible"); }
  });

  video.addEventListener("waiting", () => loader.classList.remove("hidden-overlay"));
  video.addEventListener("playing", () => loader.classList.add("hidden-overlay"));
  video.addEventListener("canplay", () => loader.classList.add("hidden-overlay"));

  document.addEventListener("keydown", (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    if (e.code === "ArrowRight") video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
    if (e.code === "ArrowLeft") video.currentTime = Math.max(0, video.currentTime - 5);
    if (e.code === "KeyM") muteBtn.click();
    if (e.code === "KeyF") fsBtn.click();
  });

  setPlayIcon();
  setMuteIcon();
  showControls(true);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initCustomPlayer);
else initCustomPlayer();
