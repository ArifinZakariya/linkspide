const express = require("express");
const videoDownloader = require("./videoDownloader");
const instagramApi = require("./instagramApi");
const facebookApi = require("./facebookApi");
const https = require("https");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const os = require("os");

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

    const platform = videoDownloader.detectPlatform(parsed.href);

    // For Instagram, try direct API first (bypasses yt-dlp IP blocking)
    if (platform && platform.name === "Instagram") {
      try {
        const igInfo = await withTimeout(instagramApi.getReelInfo(parsed.href), API_TIMEOUT);
        return res.json({ success: true, ...igInfo });
      } catch (igErr) {
        // Fall through to yt-dlp if IG API fails
        console.log(`Instagram API failed, trying yt-dlp: ${igErr.message}`);
      }
    }

    // For Facebook, try direct API first (bypasses yt-dlp IP blocking)
    if (platform && platform.name === "Facebook") {
      try {
        const fbInfo = await withTimeout(facebookApi.getVideoInfo(parsed.href), API_TIMEOUT);
        return res.json({ success: true, ...fbInfo });
      } catch (fbErr) {
        console.log(`Facebook API failed, trying yt-dlp: ${fbErr.message}`);
      }
    }

    const info = await withTimeout(videoDownloader.getInfo(parsed.href), API_TIMEOUT);
    res.json({ success: true, ...info });
  } catch (err) {
    const msg = err.message?.includes("timeout") ? "Request timed out" : err.message;
    res.status(500).json({ success: false, error: msg });
  }
});

// Video download (stream)
app.get("/api/video/download", async (req, res) => {
  const { url, format, audio } = req.query;
  if (!url) return res.status(400).json({ error: "URL is required" });

  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: "Invalid URL" }); }

  const platform = videoDownloader.detectPlatform(parsed.href);

  // For Instagram/Facebook, try direct API download first
  if (platform && (platform.name === "Instagram" || platform.name === "Facebook") && (!format || format === "best")) {
    try {
      let videoUrl = null;
      let referer = "";
      if (platform.name === "Instagram") {
        const igInfo = await instagramApi.getReelInfo(parsed.href);
        videoUrl = igInfo.videoUrl;
        referer = "https://www.instagram.com/";
      } else {
        const fbInfo = await facebookApi.getVideoInfo(parsed.href);
        videoUrl = fbInfo.videoUrl;
        referer = "https://www.facebook.com/";
      }

      if (videoUrl) {
        const cookies = platform.name === "Instagram"
          ? instagramApi.parseCookies(COOKIES_FILE)
          : facebookApi.parseCookies(COOKIES_FILE);
        const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
        const parsedVideo = new URL(videoUrl);
        const safeName = `${platform.name.toLowerCase()}-${Date.now()}.mp4`;

        const doRequest = (reqUrl, depth = 0) => {
          if (depth > 5) { res.status(500).json({ error: "Too many redirects" }); return; }
          const reqUrlParsed = new URL(reqUrl);
          const proxyReq = https.request({
            hostname: reqUrlParsed.hostname,
            path: reqUrlParsed.pathname + reqUrlParsed.search,
            method: "GET",
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15",
              "Cookie": cookieStr,
              "Referer": referer,
            },
          }, (proxyRes) => {
            if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
              doRequest(proxyRes.headers.location, depth + 1);
              return;
            }
            res.setHeader("Content-Type", "video/mp4");
            res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
            proxyRes.pipe(res);
          });
          proxyReq.on("error", () => res.status(500).json({ error: "Download failed" }));
          proxyReq.end();
        };

        doRequest(videoUrl);
        return;
      }
    } catch (e) {
      console.log(`${platform.name} direct download failed, trying yt-dlp: ${e.message}`);
    }
  }

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
