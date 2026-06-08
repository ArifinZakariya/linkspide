let currentMode = "organic";
let resultUrl = null;

function setMode(m) {
  currentMode = m;
  document.querySelectorAll(".mode-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.mode === m);
  });
}

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
    '<span class="tag tag-speed">' + currentMode + '</span>' +
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

async function resolve() {
  const url = el("urlInput").value.trim();
  if (!url) { el("urlInput").focus(); return; }

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

  const endpoint = currentMode === "organic" ? "/api/organic" : "/api/resolve";
  const body = currentMode === "organic"
    ? {url, action:"auto"}
    : {url};

  appendLog("Mode: " + currentMode.toUpperCase());
  setProgress(30);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body)
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

el("urlInput").addEventListener("keydown", e => { if (e.key === "Enter") resolve(); });

el("urlInput").addEventListener("input", async () => {
  const url = el("urlInput").value.trim();
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
