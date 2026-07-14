const express = require("express");
const https = require("https");
const http = require("http");
const { pipeline } = require("stream/promises");
const { PassThrough, Readable, Transform } = require("stream");
const { existsSync, mkdirSync, statSync, createReadStream, createWriteStream, readFileSync, writeFileSync, unlinkSync } = require("fs");
const { join } = require("path");
const { createInflateRaw } = require("zlib");
const { File } = require("megajs");

const router = express.Router();

function toReadable(body) {
  if (!body) return null;
  if (body instanceof Readable) return body;
  if (typeof body.getReader === "function") return Readable.fromWeb(body);
  return body;
}

const UPSTREAM_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
  Connection: "keep-alive",
};

const TEMP_DIR = join(process.cwd(), ".tmp", "archives");
const VIDEO_EXTS = [".mp4", ".mkv", ".avi", ".webm", ".mov", ".ts", ".flv", ".wmv", ".m4v"];
const ARCHIVE_EXTS = [".zip", ".rar", ".7z"];
const CHUNK_SIZE = 4 * 1024 * 1024;

const subCache = new Map();
const SUB_CACHE_TTL = 3600000;
function getCachedSub(url) { const e = subCache.get(url); if (e && Date.now() - e.ts < SUB_CACHE_TTL) return e.vtt; subCache.delete(url); return null; }
function setCachedSub(url, vtt) { if (subCache.size > 500) { const oldest = subCache.keys().next().value; subCache.delete(oldest); } subCache.set(url, { vtt, ts: Date.now() }); }

function ensureTempDir() { if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true }); }
function isVideoFile(n) { return VIDEO_EXTS.some(e => n.toLowerCase().endsWith(e)); }
function ct(n) { const e = n.split(".").pop().toLowerCase(); return { mp4: "video/mp4", mkv: "video/mp4", avi: "video/x-msvideo", webm: "video/webm", mov: "video/quicktime" }[e] || "video/mp4"; }
function tempPath(id, fp) { return join(TEMP_DIR, `${id}_${fp.replace(/[^a-zA-Z0-9._-]/g, "_")}`); }
function safeName(s) { return s.replace(/[^a-zA-Z0-9._-]/g, "_"); }

function httpsGet(url, headers = {}) {
  const mod = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { headers: { "User-Agent": "Mozilla/5.0", ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location, headers).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.setTimeout(300000, () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}

async function decompressToFile(compressedBuf, destPath) {
  const src = new PassThrough();
  const dst = createWriteStream(destPath);
  const inflate = createInflateRaw();
  const p = pipeline(src, inflate, dst);
  src.end(compressedBuf);
  await p;
}

// ===== URL Helpers =====
function getPixeldrainId(url) {
  try { const p = new URL(url); if (!p.hostname.includes("pixeldrain.com")) return null; const parts = p.pathname.split("/"); const i = parts.indexOf("u"); return (i !== -1 && parts[i + 1]) ? parts[i + 1] : null; } catch { return null; }
}
function getGoogleDriveId(url) {
  try {
    const p = new URL(url);
    if (!p.hostname.includes("google.com")) return null;
    const patterns = [/\/file\/d\/([a-zA-Z0-9_-]+)/, /\/download\?id=([a-zA-Z0-9_-]+)/, /id=([a-zA-Z0-9_-]+)/, /\/d\/([a-zA-Z0-9_-]+)/];
    for (const pat of patterns) { const m = (p.pathname + p.search).match(pat); if (m) return m[1]; }
    return null;
  } catch { return null; }
}
function isMegaUrl(url) {
  try { const p = new URL(url); return p.hostname.includes("mega.nz") || p.hostname.includes("mega.co.nz"); } catch { return false; }
}
function isDirectUrl(url) {
  try { const p = new URL(url); const path = p.pathname.toLowerCase(); return ARCHIVE_EXTS.some(e => path.endsWith(e)); } catch { return false; }
}
function resolveDownloadUrl(url) {
  if (isMegaUrl(url)) return null;
  const pdId = getPixeldrainId(url);
  if (pdId) return `https://pixeldrain.com/api/file/${pdId}`;
  const gdId = getGoogleDriveId(url);
  if (gdId) return `https://drive.usercontent.google.com/download?id=${gdId}&export=download&confirm=t`;
  return url;
}
function serviceId(url) {
  const pd = getPixeldrainId(url); if (pd) return `pd_${pd}`;
  const gd = getGoogleDriveId(url); if (gd) return `gd_${gd}`;
  if (isMegaUrl(url)) return `mega_${Buffer.from(url).toString("base64url").slice(0, 40)}`;
  if (isDirectUrl(url)) return `direct_${Buffer.from(url).toString("base64url").slice(0, 40)}`;
  return `raw_${Buffer.from(url).toString("base64url").slice(0, 40)}`;
}
function isVideoUrl(url) {
  try {
    const p = new URL(url);
    const ext = p.pathname.match(/\.(mp4|mkv|avi|webm|mov|ts)$/i);
    return !!ext;
  } catch { return false; }
}

// ===== Stream Route =====
function getPixelDrainUrl(id) { return `https://pixeldrain.com/api/file/${id}`; }
function getGoogleDriveDirectUrl(url) {
  let fileId = null;
  const patterns = [/\/file\/d\/([a-zA-Z0-9_-]+)/, /id=([a-zA-Z0-9_-]+)/, /\/d\/([a-zA-Z0-9_-]+)/];
  for (const p of patterns) { const m = url.match(p); if (m) { fileId = m[1]; break; } }
  if (!fileId) return null;
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
}

function isBuzzHeavierUrl(url) { try { const p = new URL(url); return p.hostname.includes("buzzheavier.com"); } catch { return false; } }
async function getBuzzHeavierInfo(url) {
  const parsed = new URL(url);
  const pathParts = parsed.pathname.replace(/^\/+/, "").split("/");
  const fileId = pathParts[0];
  if (!fileId) return null;
  const res = await fetch(`https://buzzheavier.com/${fileId}`, { headers: { "User-Agent": UPSTREAM_HEADERS["User-Agent"], Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow" });
  if (res.status === 403) return { error: "cloudflare_blocked", message: "BuzzHeavier blocked by Cloudflare." };
  if (!res.ok) throw new Error("Failed to fetch page: " + res.status);
  const html = await res.text();
  if (html.includes("cf-turnstile") || html.includes("Security verification")) return { error: "cloudflare_blocked", message: "BuzzHeavier blocked by Cloudflare." };
  const nameMatch = html.match(/<p class="file-name">([^<]+)<\/p>/);
  const fileName = nameMatch ? nameMatch[1] : "video.mp4";
  const dlMatch = html.match(/hx-get="(\/[^"]+\/download\?t=[^"]+)"/);
  if (!dlMatch) throw new Error("Download link not found");
  const downloadPath = dlMatch[1].replace(/&amp;/g, "&");
  const downloadUrl = `https://buzzheavier.com${downloadPath}`;
  const sizeMatch = html.match(/<span class="size">([^<]+)<\/span>/);
  const sizeStr = sizeMatch ? sizeMatch[1] : "0";
  let size = 0;
  const sizeNum = parseFloat(sizeStr);
  if (sizeStr.includes("GB")) size = Math.round(sizeNum * 1024 * 1024 * 1024);
  else if (sizeStr.includes("MB")) size = Math.round(sizeNum * 1024 * 1024);
  else if (sizeStr.includes("KB")) size = Math.round(sizeNum * 1024);
  else size = parseInt(sizeStr) || 0;
  return { fileName, downloadUrl, size };
}

async function handleBuzzHeavierStream(url, req) {
  const info = await getBuzzHeavierInfo(url);
  if (!info) throw new Error("Could not get file info");
  if (info.error) throw new Error(info.message);
  const ext = info.fileName.split(".").pop().toLowerCase();
  const contentType = ext === "mkv" ? "video/mp4" : ext === "webm" ? "video/webm" : "video/mp4";
  const range = req.headers["range"];
  const fetchHeaders = { "User-Agent": UPSTREAM_HEADERS["User-Agent"], Accept: "*/*", Referer: "https://buzzheavier.com/" };
  if (range) fetchHeaders["Range"] = range;
  const upstreamRes = await fetch(info.downloadUrl, { headers: fetchHeaders, redirect: "follow" });
  if (!upstreamRes.ok && upstreamRes.status !== 206) throw new Error("Upstream returned " + upstreamRes.status);
  const respHeaders = new Headers();
  respHeaders.set("Access-Control-Allow-Origin", "*");
  respHeaders.set("Accept-Ranges", "bytes");
  respHeaders.set("Cache-Control", "public, max-age=3600");
  let ctHeader = upstreamRes.headers.get("content-type") || contentType;
  if (ctHeader.includes("x-matroska") || ctHeader.includes("mkv")) ctHeader = "video/mp4";
  respHeaders.set("Content-Type", ctHeader);
  const cl = upstreamRes.headers.get("content-length");
  if (cl) respHeaders.set("Content-Length", cl);
  const cr = upstreamRes.headers.get("content-range");
  if (cr) respHeaders.set("Content-Range", cr);
  let status = upstreamRes.status;
  if (range && upstreamRes.status === 206) status = 206;
  return { status, headers: respHeaders, body: toReadable(upstreamRes.body) };
}

async function getMegaFileInfo(url) {
  try {
    const file = File.fromURL(url);
    await file.loadAttributes();
    return { name: file.name || "video.mp4", size: file.size || 0, key: file.key, downloadId: file.downloadId };
  } catch (e) { throw new Error("Failed to load Mega file: " + e.message); }
}

async function handleMegaStream(url, req) {
  const file = File.fromURL(url);
  await file.loadAttributes();
  const fileName = file.name || "video.mp4";
  const fileSize = file.size || 0;
  const ext = fileName.split(".").pop().toLowerCase();
  const contentType = ext === "mkv" ? "video/mp4" : ext === "webm" ? "video/webm" : "video/mp4";
  const range = req.headers["range"];
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    const downloadStream = file.download({ start, end });
    return { status: 206, headers: { "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes", "Content-Type": contentType, "Content-Length": chunkSize.toString(), "Content-Range": `bytes ${start}-${end}/${fileSize}`, "Cache-Control": "public, max-age=3600" }, body: downloadStream };
  }
  const downloadStream = file.download();
  return { status: 200, headers: { "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes", "Content-Type": contentType, "Content-Length": fileSize.toString(), "Cache-Control": "public, max-age=3600" }, body: downloadStream };
}

async function getSendNowDirectUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname;
  if (!host.includes("send.now") && !host.includes("send.cm")) return null;
  const fileId = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!fileId) return null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UPSTREAM_HEADERS["User-Agent"], Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow" });
    if (res.status === 403) return { error: "captcha_required", message: "Link protected by Cloudflare." };
    const html = await res.text();
    if (html.includes("Download Challenge") || html.includes("cf-turnstile")) return { error: "captcha_required", message: "Link requires Cloudflare captcha." };
    const opMatch = html.match(/name="op"\s+value="download(\d+)"/);
    if (opMatch) {
      const opValue = `download${opMatch[1]}`;
      const postRes = await fetch(url, { method: "POST", headers: { "User-Agent": UPSTREAM_HEADERS["User-Agent"], "Content-Type": "application/x-www-form-urlencoded", Referer: url, Origin: parsed.origin }, body: `op=${opValue}&id=${fileId}&rand=&referer=&method_free=&method_premium=`, redirect: "follow" });
      if (postRes.ok) {
        const ctHeader = postRes.headers.get("content-type") || "";
        if (ctHeader.includes("video") || ctHeader.includes("octet-stream")) return postRes.url || url;
        const postHtml = await postRes.text();
        const dlMatch = postHtml.match(/href="(https?:\/\/[^"]+\.(mp4|mkv|avi|webm|mov|ts)[^"]*)"/i);
        if (dlMatch) return dlMatch[1];
      }
    }
    return url;
  } catch { return url; }
}

async function resolveFinalUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("Invalid URL"); }
  const host = parsed.hostname;
  if (host.includes("pixeldrain.com")) {
    const pathParts = parsed.pathname.split("/");
    const idx = pathParts.indexOf("u");
    if (idx !== -1 && pathParts[idx + 1]) return getPixelDrainUrl(pathParts[idx + 1]);
    return url;
  }
  if (host.includes("drive.google.com") || host.includes("drive.usercontent.google.com")) {
    const direct = getGoogleDriveDirectUrl(url);
    if (direct) return direct;
    return url;
  }
  if (host.includes("send.now") || host.includes("send.cm")) {
    const result = await getSendNowDirectUrl(url);
    if (result && typeof result === "object" && result.error) throw new Error(result.message);
    return result || url;
  }
  return url;
}

async function proxyRequest(req, targetUrl) {
  const range = req.headers["range"];
  const fetchHeaders = { ...UPSTREAM_HEADERS };
  if (range) fetchHeaders["Range"] = range;
  const res = await fetch(targetUrl, { headers: fetchHeaders, redirect: "follow" });
  if (!res.ok && res.status !== 206) return { status: res.status, headers: {}, body: null, error: `Upstream returned ${res.status}` };
  const respHeaders = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600", "Accept-Ranges": "bytes" };
  let ctHeader = res.headers.get("content-type") || "video/mp4";
  if (ctHeader.includes("x-matroska") || ctHeader.includes("mkv")) ctHeader = "video/mp4";
  respHeaders["Content-Type"] = ctHeader;
  const cl = res.headers.get("content-length");
  if (cl) respHeaders["Content-Length"] = cl;
  const cr = res.headers.get("content-range");
  if (cr) respHeaders["Content-Range"] = cr;
  let status = 200;
  if (range && res.status === 206) status = 206;
  else status = res.status;
  return { status, headers: respHeaders, body: toReadable(res.body) };
}

// HEAD /api/stream/stream — lightweight, no body streaming
router.all("/stream", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: "Missing url parameter" });
  const isHead = req.method === "HEAD";
  if (isMegaUrl(targetUrl)) {
    try {
      if (isHead) {
        const info = await getMegaFileInfo(targetUrl);
        const ext = info.name.split(".").pop().toLowerCase();
        const contentType = ext === "mkv" ? "video/mp4" : ext === "webm" ? "video/webm" : "video/mp4";
        res.set({ "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes", "Content-Type": contentType, "Content-Length": info.size.toString(), "Cache-Control": "public, max-age=3600" });
        return res.status(200).end();
      }
      const result = await handleMegaStream(targetUrl, req);
      res.set(result.headers);
      result.body.pipe(res);
    } catch (e) { return res.status(500).json({ error: "Mega error: " + e.message }); }
    return;
  }
  if (isBuzzHeavierUrl(targetUrl)) {
    try {
      const result = await handleBuzzHeavierStream(targetUrl, req);
      res.set(result.headers);
      if (isHead) return res.status(200).end();
      result.body.pipe(res);
    } catch (e) { return res.status(500).json({ error: "BuzzHeavier error: " + e.message }); }
    return;
  }
  let resolved;
  try { resolved = await resolveFinalUrl(targetUrl); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const r = await fetch(resolved, { method: isHead ? "HEAD" : "GET", headers: { ...UPSTREAM_HEADERS, ...(req.headers["range"] ? { Range: req.headers["range"] } : {}) }, redirect: "follow", signal: controller.signal });
    clearTimeout(timeout);
    const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600", "Accept-Ranges": "bytes" };
    let ct = r.headers.get("content-type") || "video/mp4";
    if (ct.includes("x-matroska") || ct.includes("mkv")) ct = "video/mp4";
    headers["Content-Type"] = ct;
    const cl = r.headers.get("content-length");
    if (cl) headers["Content-Length"] = cl;
    const cr = r.headers.get("content-range");
    if (cr) headers["Content-Range"] = cr;
    let status = isHead ? 200 : r.status;
    if (!isHead && req.headers["range"] && r.status === 206) status = 206;
    res.set(headers);
    if (isHead || !r.body) return res.status(status).end();
    toReadable(r.body).pipe(res.status(status));
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: "Proxy error: " + e.message });
  }
});

// OPTIONS /api/stream/stream
router.options("/stream", (req, res) => {
  res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Allow-Headers": "Range" });
  res.status(200).end();
});

// ===== Subtitle Route =====
function srtToVtt(srt) {
  let vtt = "WEBVTT\n\n";
  const blocks = srt.trim().replace(/\r\n/g, "\n").split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 2) continue;
    let timeLineIndex = -1;
    for (let i = 0; i < lines.length; i++) { if (lines[i].includes("-->")) { timeLineIndex = i; break; } }
    if (timeLineIndex === -1) continue;
    const timeLine = lines[timeLineIndex].replace(/,/g, ".").replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, "$1.$2");
    const text = lines.slice(timeLineIndex + 1).join("\n");
    vtt += `${timeLine}\n${text}\n\n`;
  }
  return vtt;
}
function assToVtt(ass) {
  let vtt = "WEBVTT\n\n";
  const lines = ass.replace(/\r\n/g, "\n").split("\n");
  let inEvents = false;
  for (const line of lines) {
    if (line.trim() === "[Events]") { inEvents = true; continue; }
    if (line.trim().startsWith("[") && inEvents) { inEvents = false; continue; }
    if (!inEvents) continue;
    if (!line.startsWith("Dialogue:")) continue;
    const parts = line.substring(9).split(",");
    if (parts.length < 10) continue;
    const startTime = assTimeToVtt(parts[1].trim());
    const endTime = assTimeToVtt(parts[2].trim());
    const text = parts.slice(9).join(",").replace(/\\N/g, "\n").replace(/\\n/g, "\n").replace(/\{[^}]*\}/g, "").trim();
    if (text) vtt += `${startTime} --> ${endTime}\n${text}\n\n`;
  }
  return vtt;
}
function assTimeToVtt(time) {
  const match = time.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
  if (!match) return "00:00:00.000";
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3]}.${match[4]}0`;
}
function detectFormat(filename, contentType) {
  const lower = (filename || "").toLowerCase();
  const ctHeader = (contentType || "").toLowerCase();
  if (lower.endsWith(".vtt") || ctHeader.includes("webvtt")) return "vtt";
  if (lower.endsWith(".srt")) return "srt";
  if (lower.endsWith(".ass") || lower.endsWith(".ssa")) return "ass";
  if (lower.includes("format=ass") || lower.includes("format=ssa")) return "ass";
  if (lower.includes("format=srt")) return "srt";
  if (lower.includes("format=vtt")) return "vtt";
  if (ctHeader.includes("srt")) return "srt";
  if (ctHeader.includes("ass") || ctHeader.includes("ssa")) return "ass";
  return "srt";
}

router.get("/subtitle", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: "Missing url parameter" });
  try {
    const cached = getCachedSub(targetUrl);
    if (cached) {
      res.set({ "Content-Type": "text/vtt; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" });
      return res.send(cached);
    }
    let text = "", contentType = "";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const fetchRes = await fetch(targetUrl, { signal: controller.signal, redirect: "follow", headers: { "User-Agent": UPSTREAM_HEADERS["User-Agent"], Accept: "*/*", "Accept-Language": "en-US,en;q=0.9", Referer: "https://sub.wyzie.io/" } });
      clearTimeout(timeout);
      if (!fetchRes.ok) return res.status(fetchRes.status).json({ error: `Failed to fetch subtitle: HTTP ${fetchRes.status}` });
      contentType = fetchRes.headers.get("content-type") || "";
      text = await fetchRes.text();
    } catch (fetchErr) {
      const r = await httpsGet(targetUrl, { "User-Agent": UPSTREAM_HEADERS["User-Agent"], Accept: "*/*", Referer: "https://sub.wyzie.io/" });
      if (r.status >= 400) return res.status(r.status).json({ error: `Failed to fetch subtitle: HTTP ${r.status}` });
      contentType = r.headers["content-type"] || "";
      text = r.body.toString("utf8");
    }
    if (!text || text.length < 5) return res.status(404).json({ error: "Empty subtitle file" });
    const format = detectFormat(targetUrl, contentType);
    let vtt;
    if (format === "vtt") vtt = text.trim().startsWith("WEBVTT") ? text : "WEBVTT\n\n" + text;
    else if (format === "srt") vtt = srtToVtt(text);
    else if (format === "ass") vtt = assToVtt(text);
    else vtt = srtToVtt(text);
    setCachedSub(targetUrl, vtt);
    res.set({ "Content-Type": "text/vtt; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" });
    res.send(vtt);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.options("/subtitle", (req, res) => {
  res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" });
  res.status(200).end();
});

// ===== Search Route =====
const TMDB_KEY = "f900914252a3227681b9679045282002";
const WYZIE_KEY = "wyzie-61f7quy31m8al8ll5m09l9lazhlvrd07";

async function searchTMDBSuggestions(query) {
  const results = [];
  try {
    const res = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}&include_adult=false&page=1`);
    const data = await res.json();
    if (!data.results) return [];
    for (const r of data.results.slice(0, 8)) {
      if (r.media_type !== "movie" && r.media_type !== "tv") continue;
      results.push({ title: r.title || r.name, year: (r.release_date || r.first_air_date || "").substring(0, 4), type: r.media_type, tmdbId: r.id, overview: (r.overview || "").substring(0, 120), poster: r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : null });
    }
  } catch {}
  return results;
}
async function getImdbId(tmdbId, type) {
  try {
    const ep = type === "movie" ? "movie" : "tv";
    const res = await fetch(`https://api.themoviedb.org/3/${ep}/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=external_ids`);
    const detail = await res.json();
    return detail.external_ids?.imdb_id || null;
  } catch { return null; }
}
async function checkSubtitles(imdbId) {
  if (!imdbId) return { available: false, count: 0, langBreakdown: [] };
  try {
    const params = new URLSearchParams({ id: imdbId, key: WYZIE_KEY, source: "all" });
    const res = await fetch(`https://sub.wyzie.io/search?${params}`);
    const data = await res.json();
    if (!Array.isArray(data)) return { available: false, count: 0, langBreakdown: [] };
    const count = data.length;
    const langMap = {};
    for (const s of data) { const l = s.display || s.language || "unknown"; if (!langMap[l]) langMap[l] = { lang: l, count: 0 }; langMap[l].count++; }
    const langBreakdown = Object.values(langMap).sort((a, b) => b.count - a.count);
    return { available: count > 0, count, langBreakdown };
  } catch { return { available: false, count: 0, langBreakdown: [] }; }
}

router.get("/search", async (req, res) => {
  const q = req.query.q;
  const lang = req.query.lang || "id";
  if (!q || q.length < 2) return res.json({ results: [] });
  const tmdbResults = await searchTMDBSuggestions(q);
  const enriched = await Promise.all(tmdbResults.map(async (r) => {
    const imdbId = await getImdbId(r.tmdbId, r.type);
    const subInfo = await checkSubtitles(imdbId);
    return { ...r, imdbId, ...subInfo };
  }));
  res.json({ results: enriched });
});

// ===== Metadata Route =====
function parseFilename(filename) {
  let name = filename.replace(/\.[^.]+$/, "").replace(/\[.*?\]/g, "").replace(/\(.*?\)/g, "").replace(/_/g, " ").trim().replace(/^[\s.\-]+/, "").replace(/[\s.\-]+$/, "");
  let season = null, episode = null;
  const sXXeXX = name.match(/S(\d{1,2})[\.\-]?E(\d{1,2})/i);
  const sXXdotYY = name.match(/S(\d{1,2})[\.\-](\d{1,2})/i);
  const epMatch = name.match(/(?:EP?|E)[\.\-]?(\d{1,4})/i);
  if (sXXeXX) { season = parseInt(sXXeXX[1]); episode = parseInt(sXXeXX[2]); name = name.substring(0, sXXeXX.index).replace(/[\s.\-]+$/, "").trim(); }
  else if (sXXdotYY) { season = parseInt(sXXdotYY[1]); episode = parseInt(sXXdotYY[2]); name = name.substring(0, sXXdotYY.index).replace(/[\s.\-]+$/, "").trim(); }
  else if (epMatch) { episode = parseInt(epMatch[1]); name = name.substring(0, epMatch.index).replace(/[\s.\-]+$/, "").trim(); }
  const resMatch = name.match(/[\.\s]?(240|360|480|720|1080|2160)p/i);
  if (resMatch) name = name.substring(0, resMatch.index).replace(/[\s.\-]+$/, "").trim();
  const codecMatch = name.match(/[\.\s]?(x264|x265|hevc|avc|aac|mp3|flac)/i);
  if (codecMatch) name = name.substring(0, codecMatch.index).replace(/[\s.\-]+$/, "").trim();
  return { title: name, season, episode };
}
async function getFilenameFromUrl(videoUrl) {
  try {
    if (videoUrl.includes("pixeldrain.com")) {
      const idMatch = videoUrl.match(/\/u\/([a-zA-Z0-9]+)/);
      if (idMatch) {
        const infoRes = await fetch(`https://pixeldrain.com/api/file/${idMatch[1]}/info`);
        const info = await infoRes.json();
        if (info.success && info.name) return info.name;
      }
    }
    const u = new URL(videoUrl);
    const pathParts = u.pathname.split("/").filter(Boolean);
    const last = pathParts[pathParts.length - 1];
    if (last && /\.\w{2,5}$/.test(last)) return decodeURIComponent(last);
  } catch {}
  return null;
}
async function searchTMDB(title, season, episode) {
  const cleaned = title.replace(/[:\-–—]/g, " ").replace(/\s+/g, " ").trim();
  const queries = [title];
  if (cleaned !== title) queries.push(cleaned);

  async function searchTV() {
    for (const q of queries) {
      try {
        const res = await fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}&include_adult=false`);
        const data = await res.json();
        if (!data.results || data.results.length === 0) continue;
        let best = null;
        for (const r of data.results) { if (r.vote_count < 1) continue; if (season && r.number_of_seasons && r.number_of_seasons < season) continue; best = r; break; }
        if (!best && data.results.length > 0) best = data.results[0];
        if (!best) continue;
        const detailRes = await fetch(`https://api.themoviedb.org/3/tv/${best.id}?api_key=${TMDB_KEY}&append_to_response=external_ids`);
        const detail = await detailRes.json();
        const imdbId = detail.external_ids?.imdb_id;
        if (imdbId) {
          let matchedEp = null;
          if (season && episode && detail.seasons) { const s = detail.seasons.find((s) => s.season_number === season); if (s) matchedEp = `${s.name || `Season ${season}`} - Episode ${episode}`; }
          return { title: detail.name || best.name, imdbId, tmdbId: best.id, type: "tv", season, episode, matchedEp, overview: detail.overview || "" };
        }
      } catch {}
    }
    return null;
  }

  async function searchMovie() {
    try {
      const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&include_adult=false`);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const movie = data.results.find((r) => r.vote_count > 0) || data.results[0];
        const detailRes = await fetch(`https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_KEY}&append_to_response=external_ids`);
        const detail = await detailRes.json();
        const imdbId = detail.external_ids?.imdb_id;
        if (imdbId) return { title: detail.title || movie.title, imdbId, tmdbId: movie.id, type: "movie", season: null, episode: null, matchedEp: null, overview: detail.overview || "" };
      }
    } catch {}
    return null;
  }

  const [tvResult, movieResult] = await Promise.all([searchTV(), searchMovie()]);
  return tvResult || movieResult;
}

router.get("/metadata", async (req, res) => {
  const videoUrl = req.query.url;
  const manualTitle = req.query.title;
  if (!videoUrl && !manualTitle) return res.status(400).json({ error: "url or title required" });
  let filename = null, season = null, episode = null, title = manualTitle;
  if (videoUrl && !manualTitle) {
    filename = await getFilenameFromUrl(videoUrl);
    if (filename) { const parsed = parseFilename(filename); title = parsed.title; season = parsed.season; episode = parsed.episode; }
  }
  if (!title || title.length < 1) return res.json({ filename, title: null, imdbId: null, season, episode });
  const result = await searchTMDB(title, season, episode);
  if (!result) return res.json({ filename, title, imdbId: null, season, episode });
  res.json({ filename, ...result });
});

// ===== Archive Route =====
function readCDFromBuffer(buf) {
  const hex = buf.toString("hex");
  let pos = -1;
  for (let i = hex.length - 22; i >= Math.max(0, hex.length - 65536); i -= 2) { if (hex.substring(i, i + 8) === "504b0506") { pos = i / 2; break; } }
  if (pos === -1) throw new Error("Not a valid zip");
  const cdSize = buf.readUInt32LE(pos + 12), cdOff = buf.readUInt32LE(pos + 16), entries = buf.readUInt16LE(pos + 10);
  const cd = buf.subarray(cdOff, cdOff + cdSize);
  const files = []; let p = 0;
  for (let i = 0; i < entries && p < cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const comp = cd.readUInt16LE(p + 10), uSize = cd.readUInt32LE(p + 24), cSize = cd.readUInt32LE(p + 20);
    const nLen = cd.readUInt16LE(p + 28), eLen = cd.readUInt16LE(p + 30), cLen = cd.readUInt16LE(p + 32);
    const off = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nLen);
    if (!name.endsWith("/")) files.push({ name: name.split("/").pop(), path: name, size: uSize, compSize: cSize, compMethod: comp, localHeaderOffset: off });
    p += 46 + nLen + eLen + cLen;
  }
  return files.filter(f => isVideoFile(f.name));
}

async function readCDFromUrl(url) {
  try {
    const dlUrl = resolveDownloadUrl(url);
    const r = await httpsGet(dlUrl, { Range: "bytes=-65536" });
    const buf = r.body;
    if (buf.length < 22) throw new Error("too small");
    const hex = buf.toString("hex");
    let pos = -1;
    for (let i = hex.length - 22; i >= Math.max(0, hex.length - 65536); i -= 2) { if (hex.substring(i, i + 8) === "504b0506") { pos = i / 2; break; } }
    if (pos === -1) throw new Error("No CD found");
    const cdSize = buf.readUInt32LE(pos + 12), cdOff = buf.readUInt32LE(pos + 16), entries = buf.readUInt16LE(pos + 10);
    const r2 = await httpsGet(dlUrl, { Range: `bytes=${cdOff}-${cdOff + cdSize - 1}` });
    const cd = r2.body;
    const files = []; let p = 0;
    for (let i = 0; i < entries && p < cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const comp = cd.readUInt16LE(p + 10), uSize = cd.readUInt32LE(p + 24), cSize = cd.readUInt32LE(p + 20);
      const nLen = cd.readUInt16LE(p + 28), eLen = cd.readUInt16LE(p + 30), cLen = cd.readUInt16LE(p + 32);
      const off = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nLen);
      if (!name.endsWith("/")) files.push({ name: name.split("/").pop(), path: name, size: uSize, compSize: cSize, compMethod: comp, localHeaderOffset: off });
      p += 46 + nLen + eLen + cLen;
    }
    return files.filter(f => isVideoFile(f.name));
  } catch { return null; }
}

async function readCDFromMega(url) {
  const file = File.fromURL(url);
  await file.loadAttributes();
  const size = file.size;
  if (!size || size < 65536) throw new Error("File too small");
  const stream = file.download({ start: size - 65536, end: size - 1 });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buf = Buffer.concat(chunks);
  const hex = buf.toString("hex");
  let pos = -1;
  for (let i = hex.length - 22; i >= Math.max(0, hex.length - 65536); i -= 2) { if (hex.substring(i, i + 8) === "504b0506") { pos = i / 2; break; } }
  if (pos === -1) throw new Error("Not a valid zip");
  const cdSize = buf.readUInt32LE(pos + 12), cdOff = buf.readUInt32LE(pos + 16), entries = buf.readUInt16LE(pos + 10);
  const cdStream = file.download({ start: cdOff, end: cdOff + cdSize - 1 });
  const cdChunks = [];
  for await (const chunk of cdStream) cdChunks.push(chunk);
  const cd = Buffer.concat(cdChunks);
  const files = []; let p = 0;
  for (let i = 0; i < entries && p < cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const comp = cd.readUInt16LE(p + 10), uSize = cd.readUInt32LE(p + 24), cSize = cd.readUInt32LE(p + 20);
    const nLen = cd.readUInt16LE(p + 28), eLen = cd.readUInt16LE(p + 30), cLen = cd.readUInt16LE(p + 32);
    const off = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nLen);
    if (!name.endsWith("/")) files.push({ name: name.split("/").pop(), path: name, size: uSize, compSize: cSize, compMethod: comp, localHeaderOffset: off });
    p += 46 + nLen + eLen + cLen;
  }
  return files.filter(f => isVideoFile(f.name));
}

async function megaPartialDownload(url, off, len) {
  const file = File.fromURL(url);
  await file.loadAttributes();
  const stream = file.download({ start: off, end: off + len - 1 });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function readCDWithFallback(url, id) {
  if (isMegaUrl(url)) return await readCDFromMega(url);
  const files = await readCDFromUrl(url);
  if (files) return files;
  const tp = await downloadToTemp(url, id);
  const fd = readFileSync(tp);
  return readCDFromBuffer(fd);
}

async function downloadToTemp(url, id) {
  ensureTempDir();
  const tp = join(TEMP_DIR, `${safeName(id)}_full.zip`);
  if (existsSync(tp)) return tp;
  const pdId = getPixeldrainId(url);
  if (pdId) { const r = await httpsGet(`https://pixeldrain.com/api/file/${pdId}`); writeFileSync(tp, r.body); return tp; }
  const gdId = getGoogleDriveId(url);
  if (gdId) { const directUrl = `https://drive.usercontent.google.com/download?id=${gdId}&export=download&confirm=t`; const r = await httpsGet(directUrl); writeFileSync(tp, r.body); return tp; }
  if (isMegaUrl(url)) {
    const file = File.fromURL(url);
    await file.loadAttributes();
    const stream = file.download();
    const ws = createWriteStream(tp);
    await pipeline(stream, ws);
    return tp;
  }
  const r = await httpsGet(url);
  writeFileSync(tp, r.body);
  return tp;
}

async function getServiceInfo(url) {
  const pdId = getPixeldrainId(url);
  if (pdId) {
    const r = await httpsGet(`https://pixeldrain.com/api/file/${pdId}/info`);
    const d = JSON.parse(r.body.toString());
    return { name: d.name, size: d.size, mimeType: d.mime_type, type: "pixeldrain" };
  }
  const gdId = getGoogleDriveId(url);
  if (gdId) {
    const directUrl = `https://drive.usercontent.google.com/download?id=${gdId}&export=download&confirm=t`;
    const r = await httpsGet(directUrl, { Range: "bytes=0-0" });
    const contentType = r.headers["content-type"] || "";
    const cd = r.headers["content-disposition"] || "";
    let name = "download";
    const fnMatch = cd.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
    if (fnMatch) name = decodeURIComponent(fnMatch[1].replace(/"/g, ""));
    const cl = parseInt(r.headers["content-range"]?.split("/")[1] || r.headers["content-length"] || "0", 10);
    return { name, size: cl, mimeType: contentType, type: "gdrive" };
  }
  if (isMegaUrl(url)) {
    const file = File.fromURL(url);
    await file.loadAttributes();
    return { name: file.name || "archive.zip", size: file.size || 0, mimeType: "application/zip", type: "mega" };
  }
  const r = await httpsGet(url, { Range: "bytes=0-0" });
  const cl = parseInt(r.headers["content-length"] || "0", 10);
  const name = url.split("/").pop().split("?")[0] || "archive.zip";
  return { name, size: cl, mimeType: r.headers["content-type"] || "application/zip", type: "direct" };
}

async function getDataStartFromUrl(url, off) {
  const r = await httpsGet(url, { Range: `bytes=${off}-${off + 29}` });
  return off + 30 + r.body.readUInt16LE(26) + r.body.readUInt16LE(28);
}

async function getDataStartFromMega(url, off) {
  const buf = await megaPartialDownload(url, off, 30);
  return off + 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
}

const RANGE_CHUNK_SIZE = 4 * 1024 * 1024;

function createRangeReadStream(url, startByte, endByte) {
  const passthrough = new PassThrough();
  (async () => {
    try {
      let pos = startByte;
      while (pos <= endByte) {
        const chunkEnd = Math.min(pos + RANGE_CHUNK_SIZE - 1, endByte);
        const r = await httpsGet(url, { Range: `bytes=${pos}-${chunkEnd}` });
        if (!r.body || r.body.length === 0) break;
        if (!passthrough.write(r.body)) await new Promise(r => passthrough.once("drain", r));
        pos += r.body.length;
      }
      passthrough.end();
    } catch (e) {
      passthrough.destroy(e);
    }
  })();
  passthrough.on("error", () => {});
  return passthrough;
}

function createMegaRangeReadStream(url, startByte, endByte) {
  const passthrough = new PassThrough();
  (async () => {
    try {
      let pos = startByte;
      while (pos <= endByte) {
        const chunkEnd = Math.min(pos + RANGE_CHUNK_SIZE - 1, endByte);
        const buf = await megaPartialDownload(url, pos, chunkEnd - pos + 1);
        if (!buf || buf.length === 0) break;
        if (!passthrough.write(buf)) await new Promise(r => passthrough.once("drain", r));
        pos += buf.length;
      }
      passthrough.end();
    } catch (e) {
      passthrough.destroy(e);
    }
  })();
  passthrough.on("error", () => {});
  return passthrough;
}

async function createStreamingResponse(url, file, rangeHeader) {
  const dlUrl = resolveDownloadUrl(url);
  const ds = isMegaUrl(url)
    ? await getDataStartFromMega(url, file.localHeaderOffset)
    : await getDataStartFromUrl(dlUrl, file.localHeaderOffset);
  const uncompSize = file.size;
  const contentType = ct(file.name || file.path);

  if (rangeHeader && file.compMethod === 0) {
    const [a, b] = rangeHeader.replace(/bytes=/, "").split("-").map(Number);
    const start = a || 0, end = b || uncompSize - 1;
    if (isMegaUrl(url)) {
      const body = await megaPartialDownload(url, ds + start, end - start + 1);
      return { status: 206, headers: { "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes", "Content-Type": contentType, "Content-Length": (end - start + 1).toString(), "Content-Range": `bytes ${start}-${end}/${uncompSize}` }, body };
    }
    const r = await httpsGet(dlUrl, { Range: `bytes=${ds + start}-${ds + end}` });
    return { status: 206, headers: { "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes", "Content-Type": contentType, "Content-Length": (end - start + 1).toString(), "Content-Range": `bytes ${start}-${end}/${uncompSize}` }, body: r.body };
  }

  if (file.compMethod === 0) {
    if (isMegaUrl(url)) {
      const body = await megaPartialDownload(url, ds, file.compSize);
      return { status: 200, headers: { "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes", "Content-Type": contentType, "Content-Length": file.compSize.toString() }, body };
    }
    const r = await httpsGet(dlUrl, { Range: `bytes=${ds}-${ds + file.compSize - 1}` });
    return { status: 200, headers: { "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes", "Content-Type": contentType, "Content-Length": file.compSize.toString() }, body: r.body };
  }

  const src = isMegaUrl(url)
    ? createMegaRangeReadStream(url, ds, ds + file.compSize - 1)
    : createRangeReadStream(dlUrl, ds, ds + file.compSize - 1);
  const inflate = createInflateRaw();
  inflate.on("error", () => {});
  src.pipe(inflate);
  return { status: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": contentType, "Content-Length": uncompSize.toString(), "Accept-Ranges": "none" }, body: inflate };
}

const progressMap = new Map();

async function ensureExtracted(url, id, file) {
  ensureTempDir();
  const tp = tempPath(id, file.path);
  if (existsSync(tp)) return tp;
  const progKey = `${id}_${file.path}`;
  progressMap.set(progKey, { downloaded: 0, total: file.compSize, phase: "downloading" });
  if (isMegaUrl(url)) {
    const ds = await getDataStartFromUrl(url, file.localHeaderOffset);
    const compressedPath = tp + ".compressed";
    const fileObj = File.fromURL(url);
    await fileObj.loadAttributes();
    const megaStream = fileObj.download({ start: ds, end: ds + file.compSize - 1 });
    const ws = createWriteStream(compressedPath);
    await pipeline(megaStream, ws);
    progressMap.set(progKey, { downloaded: file.compSize, total: file.compSize, phase: "decompressing" });
    const compressed = readFileSync(compressedPath);
    unlinkSync(compressedPath);
    if (file.compMethod === 0) writeFileSync(tp, compressed);
    else if (file.compMethod === 8) await decompressToFile(compressed, tp);
    else throw new Error("Unsupported compMethod: " + file.compMethod);
    progressMap.delete(progKey);
    return tp;
  }
  const dlUrl = resolveDownloadUrl(url);
  const ds = await getDataStartFromUrl(dlUrl, file.localHeaderOffset);
  const compressedPath = tp + ".compressed";
  const mod = dlUrl.startsWith("https") ? https : http;
  await new Promise((resolve, reject) => {
    const req = mod.get(dlUrl, { headers: { Range: `bytes=${ds}-${ds + file.compSize - 1}`, "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(res.headers.location, { Range: `bytes=${ds}-${ds + file.compSize - 1}` }).then(async r => {
          if (file.compMethod === 0) writeFileSync(tp, r.body);
          else if (file.compMethod === 8) await decompressToFile(r.body, tp);
          progressMap.delete(progKey);
          resolve();
        }).catch(reject);
        return;
      }
      const ws = createWriteStream(compressedPath);
      let downloaded = 0;
      res.on("data", (chunk) => { downloaded += chunk.length; progressMap.set(progKey, { downloaded, total: file.compSize, phase: "downloading" }); });
      res.pipe(ws);
      ws.on("finish", () => resolve());
      ws.on("error", reject);
    });
    req.setTimeout(300000, () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
  if (existsSync(compressedPath)) {
    progressMap.set(progKey, { downloaded: file.compSize, total: file.compSize, phase: "decompressing" });
    const compressed = readFileSync(compressedPath);
    unlinkSync(compressedPath);
    if (file.compMethod === 0) writeFileSync(tp, compressed);
    else if (file.compMethod === 8) await decompressToFile(compressed, tp);
    else throw new Error("Unsupported compMethod: " + file.compMethod);
    progressMap.delete(progKey);
  }
  return tp;
}

router.get("/archive", async (req, res) => {
  const url = req.query.url;
  const action = req.query.action || "list";
  const filePath = req.query.file;
  const range = req.headers["range"];
  if (!url) return res.status(400).json({ error: "Missing url" });
  const id = serviceId(url);
  try {
    if (action === "info") {
      const info = await getServiceInfo(url);
      return res.json(info);
    }
    if (action === "list") {
      const info = await getServiceInfo(url);
      const name = (info.name || "").toLowerCase();
      if (!ARCHIVE_EXTS.some(e => name.endsWith(e))) return res.status(400).json({ error: "Not an archive" });
      const files = await readCDWithFallback(url, id);
      return res.json({ archiveName: info.name, totalSize: info.size, totalFiles: files.length, files });
    }
    if (action === "stream") {
      if (!filePath) return res.status(400).json({ error: "Missing file" });
      const file = JSON.parse(filePath);
      const tp = tempPath(id, file.path);
      const contentType = ct(file.name || file.path);
      const corsHeaders = { "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes", "Content-Type": contentType, "Cache-Control": "public, max-age=3600" };

      if (existsSync(tp)) {
        const s = statSync(tp);
        if (range) {
          const [a, b] = range.replace(/bytes=/, "").split("-").map(Number);
          const start = a || 0, end = b != null ? b : s.size - 1;
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${s.size}`);
          res.setHeader("Content-Length", (end - start + 1).toString());
          Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
          return createReadStream(tp, { start, end }).pipe(res);
        }
        res.setHeader("Content-Length", s.size.toString());
        Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
        return createReadStream(tp).pipe(res);
      }

      const result = await createStreamingResponse(url, file, range);
      if (result.error) return res.status(500).json({ error: result.error });
      const isRangeResponse = result.status === 206;
      res.statusCode = result.status;
      Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
      res.setHeader("Cache-Control", "public, max-age=3600");
      if (Buffer.isBuffer(result.body)) return res.send(result.body);
      if (result.body) {
        result.body.pipe(res);
        result.body.on("error", () => {});
        return;
      }
      return res.end();
    }
    if (action === "progress") {
      if (!filePath) return res.status(400).json({ error: "Missing file" });
      const file = JSON.parse(filePath);
      const progKey = `${id}_${file.path}`;
      const prog = progressMap.get(progKey);
      if (!prog) {
        const tp = tempPath(id, file.path);
        if (existsSync(tp)) return res.json({ ready: true, size: statSync(tp).size });
        return res.json({ ready: false, phase: "idle" });
      }
      return res.json({ ready: false, ...prog });
    }
    res.status(400).json({ error: "Invalid action" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.options("/archive", (req, res) => {
  res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Range" });
  res.status(200).end();
});

module.exports = router;
