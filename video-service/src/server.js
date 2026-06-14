const express = require("express");
const videoDownloader = require("./videoDownloader");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3002;
const API_TIMEOUT = 60000;
const COOKIES_FILE = process.env.COOKIES_FILE || "/app/cookies.txt";

// CORS: allow the main app (Vercel) to call this service.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timeout (" + ms + "ms)")), ms)
    ),
  ]);
}

// Health check + cookies status
app.get("/health", (req, res) => {
  const cookies = videoDownloader.hasCookies();
  res.json({
    status: "ok",
    service: "video",
    platforms: videoDownloader.SUPPORTED.map((s) => ({
      name: s.name,
      needsAuth: s.needsAuth,
    })),
    cookies,
  });
});

// Upload cookies.txt (text content in JSON body)
app.put("/api/cookies", (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== "string") {
    return res.status(400).json({ error: "content (Netscape cookies text) is required" });
  }
  try {
    fs.writeFileSync(COOKIES_FILE, content, "utf-8");
    res.json({ success: true, message: "Cookies saved", path: COOKIES_FILE });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check cookies status
app.get("/api/cookies", (req, res) => {
  const exists = videoDownloader.hasCookies();
  res.json({ exists, path: COOKIES_FILE });
});

// Video info
app.post("/api/video/info", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: "Invalid URL" }); }

    const info = await withTimeout(videoDownloader.getInfo(parsed.href), API_TIMEOUT);
    res.json({ success: true, ...info });
  } catch (err) {
    const msg = err.message?.includes("timeout") ? "Request timed out" : err.message;
    res.status(500).json({ success: false, error: msg });
  }
});

// Video download (stream)
app.get("/api/video/download", (req, res) => {
  const { url, format, audio } = req.query;
  if (!url) return res.status(400).json({ error: "URL is required" });

  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: "Invalid URL" }); }

  videoDownloader.streamDownload(
    parsed.href,
    { format, audioOnly: audio === "1" || audio === "true" },
    res
  );
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Video service running on port ${PORT}`);
  console.log(`Cookies file: ${COOKIES_FILE} (${videoDownloader.hasCookies() ? "found" : "not found"})`);
});
