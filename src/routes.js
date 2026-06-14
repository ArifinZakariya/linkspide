const express = require("express");
const { resolveUrl } = require("./handlers/bypassEngine");
const { identifyShortener } = require("./handlers/registry");
const genericOrganic = require("./handlers/GenericOrganic");
const videoDownloader = require("./services/videoDownloader");

const router = express.Router();

const API_TIMEOUT = 30000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timeout (" + ms + "ms)")), ms)
    ),
  ]);
}

router.post("/resolve", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: "Invalid URL" }); }

    const shortener = identifyShortener(parsed.href);
    const result = await withTimeout(resolveUrl(parsed.href, 15), API_TIMEOUT);

    res.json({
      original: parsed.href,
      resolved: result.resolved,
      success: !result.error,
      shortener: shortener || "Unknown",
      depth: result.depth,
      chain: result.chain,
      cloudflare: result.cloudflare || false,
      error: result.error || null,
    });
  } catch (err) {
    const msg = err.message?.includes("timeout") ? "Request timed out" : err.message;
    res.status(500).json({ error: msg });
  }
});

router.post("/organic", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: "Invalid URL" }); }

    const result = await withTimeout(genericOrganic.visit(parsed.href), API_TIMEOUT);

    res.json({
      original: parsed.href,
      resolved: result.url || null,
      success: result.success,
      service: result.service || null,
      method: result.method || null,
      logs: result.logs,
      error: result.error || null,
    });
  } catch (err) {
    const msg = err.message?.includes("timeout") ? "Request timed out" : err.message;
    res.status(500).json({ error: msg });
  }
});

router.post("/check", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });
  try {
    let valid = false;
    try { new URL(url); valid = true; } catch {}
    const shortener = identifyShortener(url);
    const service = genericOrganic.detectService(url);
    res.json({ url, valid, known: !!shortener, service: shortener || service?.name || "Unknown", shortener: shortener || "Unknown", detectedService: service?.name || "Unknown" });
  } catch { res.status(400).json({ error: "Invalid URL" }); }
});

// ---- Video Download ----
// In production (e.g. Vercel) yt-dlp can't run, so proxy to a dedicated
// service (Fly.io) via VIDEO_SERVICE_URL. Locally it falls back to yt-dlp.
const VIDEO_SERVICE_URL = (process.env.VIDEO_SERVICE_URL || "").replace(/\/$/, "");

router.post("/video/info", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: "Invalid URL" }); }

    if (VIDEO_SERVICE_URL) {
      const r = await withTimeout(
        fetch(`${VIDEO_SERVICE_URL}/api/video/info`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: parsed.href }),
        }),
        API_TIMEOUT
      );
      const data = await r.json();
      data.downloadBase = VIDEO_SERVICE_URL + "/api/video/download";
      return res.status(r.status).json(data);
    }

    const info = await withTimeout(videoDownloader.getInfo(parsed.href), API_TIMEOUT);
    res.json({ success: true, ...info, downloadBase: "" });
  } catch (err) {
    const msg = err.message?.includes("timeout") ? "Request timed out" : err.message;
    res.status(500).json({ success: false, error: msg });
  }
});

router.get("/video/download", (req, res) => {
  const { url, format, ext, audio } = req.query;
  if (!url) return res.status(400).json({ error: "URL is required" });

  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: "Invalid URL" }); }

  if (VIDEO_SERVICE_URL) {
    // Redirect the browser to download straight from the video service,
    // avoiding payload/time limits on the main (serverless) host.
    const qs = new URLSearchParams({
      url: parsed.href,
      format: format || "",
      audio: audio || "0",
    });
    return res.redirect(302, `${VIDEO_SERVICE_URL}/api/video/download?${qs.toString()}`);
  }

  videoDownloader.streamDownload(
    parsed.href,
    { format, ext, audioOnly: audio === "1" || audio === "true" },
    res
  );
});

module.exports = router;
