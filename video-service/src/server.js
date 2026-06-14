const express = require("express");
const videoDownloader = require("./videoDownloader");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3002;
const API_TIMEOUT = 60000;

// CORS: allow the main app (Vercel) to call this service.
// Set ALLOWED_ORIGIN to your frontend origin, or leave unset for "*".
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "video", platforms: videoDownloader.SUPPORTED.map((s) => s.name) });
});

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
});
