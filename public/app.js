let resultUrl = null;

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
    const r = await fetch("/api/check", {
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
    const res = await fetch("/api/organic", {
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
      applySubtitleTrack(`/api/stream/subtitle?url=${encoded}`);
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
  if (!subUrl) { el("subToggleBtn").textContent = "No sub"; return; }
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
  el("subToggleBtn").textContent = "Toggle";
}

async function loadSubtitle() {
  const subUrl = el("subUrlInput").value.trim();
  if (!subUrl) return;
  showSubStatus("Loading subtitle...", "ok");
  try {
    applySubtitleTrack(`/api/stream/subtitle?url=${encodeURIComponent(subUrl)}`);
    showSubStatus("Subtitle loaded", "ok");
  } catch (e) { showSubStatus("Failed: " + e.message, "error"); }
}

function toggleSubtitles() {
  const video = el("streamVideo");
  if (!video) return;
  for (let i = 0; i < video.textTracks.length; i++) {
    video.textTracks[i].mode = video.textTracks[i].mode === "showing" ? "hidden" : "showing";
  }
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
    const metaRes = await fetch(`/api/stream/metadata?url=x&title=${encodeURIComponent(t)}`);
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
        const srtUrl = `/api/stream/subtitle?url=${encodeURIComponent(convertWyzieUrl(best.url, best.format))}`;
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
let subPage = 0;
const SUB_PAGE_SIZE = 20;

function renderSubResults(subs, reset = true) {
  const container = el("subResults");
  if (reset) {
    container.innerHTML = "";
    allSubResults = subs;
    subPage = 0;
  }
  show("subResults");
  const start = subPage * SUB_PAGE_SIZE;
  const end = Math.min(start + SUB_PAGE_SIZE, allSubResults.length);
  const slice = allSubResults.slice(start, end);
  slice.forEach((sub, i) => {
    const idx = start + i;
    const btn = document.createElement("button");
    btn.className = "sub-result-chip" + (idx === 0 ? " auto-loaded" : "");
    btn.innerHTML =
      (sub.flagUrl ? `<img src="${sub.flagUrl}" alt="" class="flag-icon">` : '') +
      `<span class="sub-lang-name">${sub.display}</span>` +
      (sub.release ? `<span class="sub-release">${sub.release}</span>` : '') +
      `<span class="sub-source">${sub.source}</span>` +
      `<span class="sub-format">${sub.format}</span>` +
      (sub.isHearingImpaired ? '<span class="hi-tag">HI</span>' : '') +
      (idx === 0 ? '<span class="auto-tag">AUTO</span>' : '');
    btn.onclick = () => loadWyzieSub(sub);
    container.appendChild(btn);
  });
  const existingBtn = container.querySelector(".load-more-btn");
  if (existingBtn) existingBtn.remove();
  if (end < allSubResults.length) {
    const loadMore = document.createElement("button");
    loadMore.className = "load-more-btn";
    loadMore.innerHTML = `Load More <span class="load-more-count">${allSubResults.length - end} remaining</span>`;
    loadMore.onclick = () => { subPage++; renderSubResults(allSubResults, false); };
    container.appendChild(loadMore);
  }
}

function convertWyzieUrl(url, format) {
  if (!url) return url;
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
    const srtUrl = `/api/stream/subtitle?url=${encodeURIComponent(downloadUrl)}`;
    applySubtitleTrack(srtUrl);
    showSubStatus(`Loaded: ${sub.display} (${sub.release})`, "ok");
  } catch (e) {
    showSubStatus("Failed: " + e.message, "error");
  }
}

async function detectUrlType(url) {
  if (isArchiveLink(url)) return "archive";
  try {
    const res = await fetch(`/api/stream/archive?url=${encodeURIComponent(url)}&action=info`);
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
    const res = await fetch(`/api/stream/archive?url=${encodeURIComponent(archiveUrl)}&action=list`);
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
      const encoded = encodeURIComponent(archiveUrl);
      const encodedFile = encodeURIComponent(JSON.stringify(file));
      setStreamUrl(`/api/stream/archive?url=${encoded}&action=stream&file=${encodedFile}`);
      document.querySelectorAll(".archive-item").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    };
    list.appendChild(btn);
  });
}

function setStreamUrl(url) {
  const video = el("streamVideo");
  video.src = url;
  show("playerWrapper");
  video.onloadedmetadata = () => {
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = "showing";
    }
  };
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
    const proxyUrl = `/api/stream/stream?url=${encoded}`;
    const res = await fetch(`/api/stream/stream?url=${encoded}`, { method: "HEAD" });
    if (!res.ok) throw new Error(`Cannot fetch video (HTTP ${res.status})`);
    setStreamUrl(proxyUrl);
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
      const res = await fetch(`/api/stream/search?q=${encodeURIComponent(val)}&lang=${lang}`);
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
        const srtUrl = `/api/stream/subtitle?url=${encodeURIComponent(convertWyzieUrl(best.url, best.format))}`;
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
      const r = await fetch("/api/check", {
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
