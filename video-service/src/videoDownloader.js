const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Resolve yt-dlp binary. Allow override via env for portability.
const YTDLP = process.env.YTDLP_PATH || "yt-dlp";

// Cookies file path for platforms that require authentication.
// Set via env COOKIES_FILE or default to /app/cookies.txt in container.
const COOKIES_FILE = process.env.COOKIES_FILE || "/app/cookies.txt";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const SUPPORTED = [
  { name: "YouTube", host: /(^|\.)(youtube\.com|youtu\.be)$/i, needsAuth: false },
  { name: "TikTok", host: /(^|\.)tiktok\.com$/i, needsAuth: false },
  { name: "Instagram", host: /(^|\.)instagram\.com$/i, needsAuth: true },
  { name: "Facebook", host: /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/i, needsAuth: true },
  { name: "X (Twitter)", host: /(^|\.)(x\.com|twitter\.com)$/i, needsAuth: true },
];

function hasCookies() {
  try { return fs.existsSync(COOKIES_FILE); } catch { return false; }
}

function detectPlatform(rawUrl) {
  let host;
  try {
    host = new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  const match = SUPPORTED.find((p) => p.host.test(host));
  return match || null;
}

function isShorts(rawUrl) {
  return /youtube\.com\/shorts\//i.test(rawUrl) || /\/shorts\//i.test(rawUrl);
}

function runYtDlp(args, { timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeout);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        return reject(new Error("yt-dlp tidak ditemukan di server."));
      }
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return reject(new Error("Proses timeout"));
      if (code !== 0) {
        const msg = stderr.split("\n").filter(Boolean).pop() || "yt-dlp gagal";
        return reject(new Error(msg.replace(/^ERROR:\s*/i, "")));
      }
      resolve(stdout);
    });
  });
}

function baseArgs(platform) {
  const args = ["--no-playlist", "--no-warnings", "--user-agent", UA];
  if (hasCookies()) {
    args.push("--cookies", COOKIES_FILE);
  }
  return args;
}

function buildQualities(info) {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const seen = new Map();

  for (const f of formats) {
    if (!f.height) continue;
    if (f.vcodec === "none") continue;
    const h = f.height;
    if (!seen.has(h)) {
      seen.set(h, {
        quality: `${h}p`,
        height: h,
        format: `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`,
        ext: "mp4",
        fps: f.fps || null,
      });
    }
  }

  let qualities = Array.from(seen.values()).sort((a, b) => b.height - a.height);

  qualities.push({
    quality: "Audio (MP3)",
    height: 0,
    format: "bestaudio/best",
    ext: "mp3",
    audioOnly: true,
  });

  if (qualities.length === 1) {
    qualities.unshift({
      quality: "Best",
      height: 9999,
      format: "best[ext=mp4]/best",
      ext: "mp4",
    });
  }

  return qualities;
}

async function getInfo(rawUrl) {
  const platform = detectPlatform(rawUrl);
  if (!platform) {
    throw new Error("Platform tidak didukung.");
  }

  if (platform.needsAuth && !hasCookies()) {
    throw new Error(
      `${platform.name} memerlukan cookies. Upload cookies.txt ke server terlebih dahulu.`
    );
  }

  const args = [...baseArgs(platform), "--dump-single-json", rawUrl];
  const out = await runYtDlp(args, { timeout: 45000 });

  let info;
  try {
    info = JSON.parse(out);
  } catch {
    throw new Error("Gagal membaca metadata video");
  }

  return {
    platform: platform.name,
    shorts: isShorts(rawUrl),
    id: info.id,
    title: info.title || info.id || "video",
    uploader: info.uploader || info.channel || info.uploader_id || null,
    duration: info.duration || null,
    thumbnail: info.thumbnail || null,
    qualities: buildQualities(info),
  };
}

function streamDownload(rawUrl, { format, audioOnly }, res) {
  const platform = detectPlatform(rawUrl);
  if (!platform) {
    res.status(400).json({ error: "Platform tidak didukung" });
    return;
  }

  if (platform.needsAuth && !hasCookies()) {
    res.status(400).json({
      error: `${platform.name} memerlukan cookies. Upload cookies.txt ke server.`,
    });
    return;
  }

  const tmpFile = path.join(os.tmpdir(), `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const fileExt = audioOnly ? "mp3" : "mp4";
  const mime = audioOnly ? "audio/mpeg" : "video/mp4";
  const safeName = `${platform.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}.${fileExt}`;

  const args = [...baseArgs(platform), "-o", tmpFile];

  if (audioOnly) {
    args.push("-f", format || "bestaudio/best");
    args.push("--extract-audio", "--audio-format", "mp3");
  } else {
    args.push("-f", format || "best");
    args.push("--merge-output-format", "mp4");
  }

  args.push(rawUrl);

  const child = spawn(YTDLP, args, { windowsHide: true });
  let stderr = "";
  let responded = false;

  child.stderr.on("data", (d) => (stderr += d.toString()));

  child.on("error", (err) => {
    if (responded) return;
    responded = true;
    const msg = err.code === "ENOENT" ? "yt-dlp tidak ditemukan di server" : err.message;
    if (!res.headersSent) res.status(500).json({ error: msg });
    else res.end();
    cleanup();
  });

  child.on("close", (code) => {
    if (responded) return;
    if (code !== 0) {
      responded = true;
      const msg = stderr.split("\n").filter(Boolean).pop() || "Download gagal";
      if (!res.headersSent) res.status(500).json({ error: msg.replace(/^ERROR:\s*/i, "") });
      else res.end();
      cleanup();
      return;
    }

    const stat = fs.statSync(tmpFile);
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);

    const stream = fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on("end", cleanup);
    stream.on("error", () => { res.end(); cleanup(); });
  });

  function cleanup() {
    try { fs.unlinkSync(tmpFile); } catch {}
  }

  res.on("close", () => {
    if (!child.killed) child.kill("SIGKILL");
    cleanup();
  });
}

module.exports = { detectPlatform, isShorts, getInfo, streamDownload, SUPPORTED, hasCookies };
