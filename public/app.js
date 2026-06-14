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
  const tabs = ["bypass", "video", "barcode"];
  const map = {
    bypass: { tab: "tabBypass", panel: "panelBypass" },
    video: { tab: "tabVideo", panel: "panelVideo" },
    barcode: { tab: "tabBarcode", panel: "panelBarcode" },
  };
  tabs.forEach((t) => {
    const active = t === name;
    el(map[t].tab).classList.toggle("active", active);
    el(map[t].panel).classList.toggle("hidden", !active);
  });
}

// ===== Video Downloader =====
function fmtDuration(sec) {
  if (!sec && sec !== 0) return "";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function setVideoStatus(msg, type = "") {
  const s = el("videoStatus");
  if (!msg) { s.classList.add("hidden"); return; }
  s.textContent = msg;
  s.className = "status " + type;
  s.classList.remove("hidden");
}

let videoDownloadBase = "";

async function fetchVideo() {
  let url = normalizeUrl(el("videoInput").value);
  if (!url) { el("videoInput").focus(); return; }
  el("videoInput").value = url;

  const btn = el("fetchBtn");
  btn.disabled = true;
  btn.querySelector(".btn-text").textContent = "Memuat...";
  hide("videoResult");
  hide("videoPlatformBadge");
  setVideoStatus("Mengambil info video...", "loading");
  videoDownloadBase = "";

  try {
    const r = await fetch("/api/video/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || "Gagal mengambil video");

    el("videoPlatformName").textContent = d.platform + (d.shorts ? " · Shorts" : "");
    show("videoPlatformBadge");

    el("videoThumb").src = d.thumbnail || "";
    el("videoThumb").style.display = d.thumbnail ? "block" : "none";
    el("videoTitle").textContent = d.title || "Tanpa judul";
    el("videoUploader").textContent = d.uploader || "";
    el("videoDuration").textContent = d.duration ? fmtDuration(d.duration) : "";

    el("videoTags").innerHTML =
      '<span class="tag tag-service">' + d.platform + '</span>' +
      (d.shorts ? '<span class="tag tag-speed">Shorts</span>' : '') +
      '<span class="tag tag-steps">' + d.qualities.length + ' format</span>';

    videoDownloadBase = d.downloadBase || "";
    renderQualities(url, d.qualities);
    show("videoResult");
    setVideoStatus("", "");
  } catch (e) {
    setVideoStatus(e.message, "error");
  } finally {
    btn.disabled = false;
    btn.querySelector(".btn-text").textContent = "Cari";
  }
}

function renderQualities(url, qualities) {
  const list = el("qualityList");
  list.innerHTML = "";
  const base = videoDownloadBase || "/api/video/download";
  qualities.forEach((q) => {
    const params = new URLSearchParams({
      url,
      format: q.format,
      ext: q.ext || "mp4",
      audio: q.audioOnly ? "1" : "0"
    });
    const a = document.createElement("a");
    a.className = "quality-item" + (q.audioOnly ? " audio" : "");
    a.href = base + "?" + params.toString();
    a.setAttribute("download", "");
    a.innerHTML =
      '<span class="q-name">' + q.quality +
      (q.fps && q.fps > 30 ? ' <span class="q-fps">' + q.fps + 'fps</span>' : '') +
      '</span>' +
      '<span class="q-ext">' + (q.ext || "mp4").toUpperCase() + '</span>' +
      '<span class="q-dl"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg></span>';
    a.addEventListener("click", () => {
      setVideoStatus("Download dimulai... (proses di server bisa butuh beberapa detik)", "loading");
      setTimeout(() => setVideoStatus("", ""), 6000);
    });
    list.appendChild(a);
  });
}

el("videoInput").addEventListener("keydown", e => { if (e.key === "Enter") fetchVideo(); });

el("urlInput").addEventListener("keydown", e => { if (e.key === "Enter") resolve(); });

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

// ===== Barcode Generator =====
let bcType = "qrcode";

const BC_HINTS = {
  qrcode: "Teks/URL bebas, mendukung karakter apa saja.",
  CODE128: "Mendukung huruf, angka, dan simbol.",
  EAN13: "Wajib 12 atau 13 digit angka.",
  UPC: "Wajib 11 atau 12 digit angka.",
  CODE39: "Huruf kapital, angka, dan - . $ / + % spasi.",
  ITF14: "Wajib 13 atau 14 digit angka.",
};

function setBarcodeStatus(msg, type = "") {
  const s = el("barcodeStatus");
  if (!msg) { s.classList.add("hidden"); return; }
  s.textContent = msg;
  s.className = "status " + type;
  s.classList.remove("hidden");
}

function setBarcodeType(type) {
  bcType = type;
  document.querySelectorAll(".bc-type").forEach((b) => {
    b.classList.toggle("active", b.dataset.type === type);
  });
  el("bcHint").textContent = BC_HINTS[type] || "";
  const input = el("barcodeInput");
  const numeric = ["EAN13", "UPC", "ITF14"].includes(type);
  input.placeholder = numeric ? "Ketik angka..." : "Ketik teks atau angka...";
  if (numeric && !/^\d+$/.test(input.value)) {
    input.value = type === "EAN13" ? "590123412345" : type === "UPC" ? "12345678901" : "1234567890123";
  }
  generateBarcode();
}

function generateBarcode() {
  const value = el("barcodeInput").value.trim();
  const fg = el("bcFg").value;
  const bg = el("bcBg").value;
  const size = parseInt(el("bcSize").value, 10);
  const preview = el("bcPreview");

  if (!value) {
    setBarcodeStatus("Masukkan teks atau angka dulu", "error");
    hide("barcodeResult");
    return;
  }

  try {
    if (bcType === "qrcode") {
      if (typeof QRCode === "undefined") throw new Error("Library QR belum termuat");
      preview.innerHTML = "";
      new QRCode(preview, {
        text: value,
        width: size,
        height: size,
        colorDark: fg,
        colorLight: bg,
        correctLevel: QRCode.CorrectLevel.M,
      });
      setBarcodeStatus("", "");
      show("barcodeResult");
    } else {
      if (typeof JsBarcode === "undefined") throw new Error("Library barcode belum termuat");
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, value, {
        format: bcType,
        lineColor: fg,
        background: bg,
        width: Math.max(1, Math.round(size / 128)),
        height: Math.round(size * 0.5),
        displayValue: true,
        margin: 12,
        fontSize: 16,
      });
      preview.innerHTML = "";
      preview.appendChild(canvas);
      setBarcodeStatus("", "");
      show("barcodeResult");
    }
  } catch (e) {
    setBarcodeStatus(e.message || "Format tidak valid untuk input ini", "error");
    hide("barcodeResult");
  }
}

function getBarcodeCanvas() {
  return el("bcPreview").querySelector("canvas");
}

function downloadBarcode() {
  const canvas = getBarcodeCanvas();
  if (!canvas) { setBarcodeStatus("Belum ada barcode", "error"); return; }
  try {
    const link = document.createElement("a");
    link.download = "barcode-" + bcType.toLowerCase() + "-" + Date.now() + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch {
    setBarcodeStatus("Gagal mengunduh", "error");
  }
}

function copyBarcode() {
  const canvas = getBarcodeCanvas();
  if (!canvas) { setBarcodeStatus("Belum ada barcode", "error"); return; }
  canvas.toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setBarcodeStatus("Tersalin ke clipboard!", "organic");
      setTimeout(() => setBarcodeStatus("", ""), 2000);
    } catch {
      setBarcodeStatus("Browser tidak mendukung copy gambar", "error");
    }
  });
}

el("barcodeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") generateBarcode(); });
el("barcodeInput").addEventListener("input", generateBarcode);
["bcFg", "bcBg", "bcSize"].forEach((id) => el(id).addEventListener("input", generateBarcode));

// Initial render
el("bcHint").textContent = BC_HINTS.qrcode;
