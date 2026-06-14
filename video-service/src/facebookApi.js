const https = require("https");
const { URL } = require("url");
const fs = require("fs");

const COOKIES_FILE = process.env.COOKIES_FILE || "/app/cookies.txt";

function parseCookies(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const cookies = {};
    for (const line of raw.split("\n")) {
      if (line.startsWith("#") || !line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length >= 7) {
        cookies[parts[5]] = parts[6];
      }
    }
    return cookies;
  } catch {
    return null;
  }
}

function extractVideoId(url) {
  // /reel/123456 or /watch/?v=123456 or /video/123456
  let m = url.match(/facebook\.com\/(?:reel|video)\/(\d+)/i);
  if (m) return m[1];
  m = url.match(/facebook\.com\/watch\/\?.*?v=(\d+)/i);
  if (m) return m[1];
  return null;
}

function fbRequest(urlStr, cookies) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");

    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Cookie": cookieStr,
      },
    };

    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve({ redirect: res.headers.location, data });
          return;
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        resolve({ data, status: res.statusCode });
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

function resolveFbUrl(shareUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(shareUrl);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36",
      },
    };

    const req = https.request(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(res.headers.location);
      } else {
        resolve(shareUrl);
      }
      res.resume();
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

async function getVideoInfo(url) {
  const cookies = parseCookies(COOKIES_FILE);
  if (!cookies || !cookies.c_user) {
    throw new Error("Facebook memerlukan cookies yang valid.");
  }

  // Resolve share URLs to direct URLs
  let resolvedUrl = url;
  if (url.includes("/share/")) {
    try {
      resolvedUrl = await resolveFbUrl(url);
    } catch {}
  }

  const videoId = extractVideoId(resolvedUrl);
  if (!videoId) {
    throw new Error("Tidak bisa extract video ID dari URL Facebook.");
  }

  // Try mobile watch page to extract video data
  const mobileUrl = `https://m.facebook.com/watch/?v=${videoId}`;
  let resp;
  try {
    resp = await fbRequest(mobileUrl, cookies);
  } catch (e) {
    throw new Error(`Facebook API error: ${e.message}`);
  }

  const html = resp.data;

  // Try to extract video URL from page source
  let videoUrl = null;
  let title = null;
  let thumbnail = null;

  // Method 1: Look for playability_status in page data
  const playMatch = html.match(/"playable_url":\s*"([^"]+)"/);
  if (playMatch) {
    videoUrl = playMatch[1].replace(/\\u0025/g, "%").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  }

  // Method 2: SD URL
  if (!videoUrl) {
    const sdMatch = html.match(/"sd_src_no_ratelimit":\s*"([^"]+)"/) ||
                    html.match(/"sd_src":\s*"([^"]+)"/);
    if (sdMatch) {
      videoUrl = sdMatch[1].replace(/\\u0025/g, "%").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    }
  }

  // Method 3: Look for video URL in meta tags
  if (!videoUrl) {
    const ogVideo = html.match(/property="og:video:content_url"\s+content="([^"]+)"/);
    if (ogVideo) {
      videoUrl = ogVideo[1];
    }
  }

  // Extract title
  const titleMatch = html.match(/property="og:title"\s+content="([^"]+)"/) ||
                     html.match(/<title>([^<]+)<\/title>/);
  if (titleMatch) {
    title = titleMatch[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  }

  // Extract thumbnail
  const thumbMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
  if (thumbMatch) {
    thumbnail = thumbMatch[1];
  }

  if (!videoUrl) {
    throw new Error("Facebook video URL tidak ditemukan. Cookies mungkin expired.");
  }

  return {
    platform: "Facebook",
    id: videoId,
    title: title || `Facebook Video ${videoId}`,
    uploader: null,
    duration: null,
    thumbnail,
    videoUrl,
    formats: [
      {
        quality: "Best",
        height: 720,
        format: "best",
        ext: "mp4",
        needsDownload: true,
      },
    ],
  };
}

module.exports = { getVideoInfo, parseCookies, extractVideoId };
