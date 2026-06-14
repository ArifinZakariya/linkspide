const { spawn } = require("child_process");

// Resolve yt-dlp binary. Allow override via env for portability.
const YTDLP = process.env.YTDLP_PATH || "yt-dlp";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const SUPPORTED = [
  { name: "YouTube", host: /(^|\.)(youtube\.com|youtu\.be)$/i },
  { name: "TikTok", host: /(^|\.)tiktok\.com$/i },
  { name: "Instagram", host: /(^|\.)instagram\.com$/i },
  { name: "Facebook", host: /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/i },
  { name: "X (Twitter)", host: /(^|\.)(x\.com|twitter\.com)$/i },
  { name: "Threads", host: /(^|\.)threads\.(net|com)$/i },
];

function detectPlatform(rawUrl) {
  let host;
  try {
    host = new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  const match = SUPPORTED.find((p) => p.host.test(host));
  return match ? match.name : null;
}

function isShorts(rawUrl) {
  return /youtube\.com\/shorts\//i.test(rawUrl) || /\/shorts\//i.test(rawUrl);
}

// Run yt-dlp and collect stdout. Rejects on non-zero exit.
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
        return reject(
          new Error("yt-dlp tidak ditemukan di server. Pastikan yt-dlp terpasang.")
        );
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

function baseArgs() {
  return ["--no-playlist", "--no-warnings", "--user-agent", UA];
}

// Build a list of friendly quality options from yt-dlp formats.
function buildQualities(info) {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const seen = new Map();

  for (const f of formats) {
    if (!f.height) continue;
    if (f.vcodec === "none") continue; // audio only
    const h = f.height;
    if (!seen.has(h)) {
      seen.set(h, {
        quality: `${h}p`,
        height: h,
        format: `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`,
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
      format: "best",
      ext: "mp4",
    });
  }

  return qualities;
}

async function getInfo(rawUrl) {
  const platform = detectPlatform(rawUrl);
  if (!platform) {
    throw new Error(
      "Platform tidak didukung. Gunakan link YouTube, TikTok, Instagram, Facebook, X, atau Threads."
    );
  }

  const args = [...baseArgs(), "--dump-single-json", rawUrl];
  const out = await runYtDlp(args, { timeout: 45000 });

  let info;
  try {
    info = JSON.parse(out);
  } catch {
    throw new Error("Gagal membaca metadata video");
  }

  return {
    platform,
    shorts: isShorts(rawUrl),
    id: info.id,
    title: info.title || info.id || "video",
    uploader: info.uploader || info.channel || info.uploader_id || null,
    duration: info.duration || null,
    thumbnail: info.thumbnail || null,
    qualities: buildQualities(info),
  };
}

// Stream a download directly to the HTTP response.
function streamDownload(rawUrl, { format, audioOnly }, res) {
  const platform = detectPlatform(rawUrl);
  if (!platform) {
    res.status(400).json({ error: "Platform tidak didukung" });
    return;
  }

  const args = [...baseArgs(), "-o", "-"]; // output to stdout

  if (audioOnly) {
    args.push("-f", format || "bestaudio/best");
    args.push("--extract-audio", "--audio-format", "mp3");
  } else {
    args.push("-f", format || "best");
    args.push("--merge-output-format", "mp4");
  }

  args.push(rawUrl);

  const safeName = `${platform.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
  const fileExt = audioOnly ? "mp3" : "mp4";
  const mime = audioOnly ? "audio/mpeg" : "video/mp4";

  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}.${fileExt}"`);

  const child = spawn(YTDLP, args, { windowsHide: true });
  let stderr = "";
  let responded = false;

  child.stdout.pipe(res);
  child.stderr.on("data", (d) => (stderr += d.toString()));

  child.on("error", (err) => {
    if (responded) return;
    responded = true;
    if (!res.headersSent) {
      const msg = err.code === "ENOENT" ? "yt-dlp tidak ditemukan di server" : err.message;
      res.status(500).json({ error: msg });
    } else {
      res.end();
    }
  });

  child.on("close", (code) => {
    if (code !== 0 && !res.headersSent && !responded) {
      responded = true;
      const msg = stderr.split("\n").filter(Boolean).pop() || "Download gagal";
      res.status(500).json({ error: msg.replace(/^ERROR:\s*/i, "") });
    } else {
      res.end();
    }
  });

  res.on("close", () => {
    if (!child.killed) child.kill("SIGKILL");
  });
}

module.exports = { detectPlatform, isShorts, getInfo, streamDownload, SUPPORTED };
