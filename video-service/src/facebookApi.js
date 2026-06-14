const https = require("https");
const { URL } = require("url");
const fs = require("fs");

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
  let m = url.match(/facebook\.com\/(?:reel|video)\/(\d+)/i);
  if (m) return m[1];
  m = url.match(/facebook\.com\/watch\/\?.*?v=(\d+)/i);
  if (m) return m[1];
  return null;
}

function httpsGet(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...headers,
      },
    };

    const req = https.request(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith("/")) loc = `https://${url.hostname}${loc}`;
        res.resume();
        resolve({ redirect: loc, data: "" });
        return;
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ data, status: res.statusCode }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

function resolveFbUrl(shareUrl, cookies) {
  return new Promise((resolve, reject) => {
    const url = new URL(shareUrl);
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1",
    };
    if (cookies) {
      headers["Cookie"] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    }
    const opts = { hostname: url.hostname, path: url.pathname + url.search, method: "GET", headers };

    const req = https.request(opts, (res) => {
      console.log(`FB resolve: status=${res.statusCode} location=${res.headers.location || "none"}`);
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith("/")) loc = `https://${url.hostname}${loc}`;
        resolve(loc);
      } else {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const m = data.match(/property="og:url"\s+content="([^"]+)"/);
          if (m) { resolve(m[1]); return; }
          const m2 = data.match(/href="(https:\/\/www\.facebook\.com\/(?:reel|video)\/\d+)"/);
          if (m2) { resolve(m2[1]); return; }
          resolve(shareUrl);
        });
      }
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

function extractVideoUrl(html) {
  let m;

  m = html.match(/hd_src_no_ratelimit["':\s]*["']?(https[^"'\s,}]+)/i);
  if (m) return unescapeFb(m[1]);

  m = html.match(/"hd_src":\s*"([^"]+)"/i);
  if (m) return unescapeFb(m[1]);

  m = html.match(/hd_src["':\s]*["']?(https[^"'\s,}]+)/i);
  if (m) return unescapeFb(m[1]);

  m = html.match(/sd_src_no_ratelimit["':\s]*["']?(https[^"'\s,}]+)/i);
  if (m) return unescapeFb(m[1]);

  m = html.match(/"sd_src":\s*"([^"]+)"/i);
  if (m) return unescapeFb(m[1]);

  m = html.match(/sd_src["':\s]*["']?(https[^"'\s,}]+)/i);
  if (m) return unescapeFb(m[1]);

  m = html.match(/"playable_url":\s*\{[^}]*"uri":\s*"([^"]+)"/i);
  if (m) return unescapeFb(m[1]);

  m = html.match(/property="og:video:content_url"\s+content="([^"]+)"/i);
  if (m) return m[1];

  m = html.match(/(https?:\/\/video\.[^"'\s]+)/i);
  if (m) return unescapeFb(m[1]);

  return null;
}

function unescapeFb(str) {
  return str
    .replace(/\\u0025/g, "%")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\\u003C/g, "<")
    .replace(/\\u003E/g, ">");
}

async function getVideoInfo(url) {
  let videoId = null;
  let isShareUrl = url.includes("/share/");

  videoId = extractVideoId(url);

  const cookiesFile = process.env.COOKIES_FILE || "/app/cookies.txt";
  let cookies = null;
  try { cookies = parseCookies(cookiesFile); } catch {}

  if (!videoId && isShareUrl) {
    // Try resolving with www.facebook.com
    try {
      const resolvedUrl = await resolveFbUrl(url, cookies);
      console.log(`FB resolve result: ${resolvedUrl}`);
      videoId = extractVideoId(resolvedUrl);
    } catch (e) {
      console.log(`FB resolve failed: ${e.message}`);
    }
    // Try mbasic.facebook.com as fallback
    if (!videoId) {
      try {
        const mbasicUrl = url.replace("www.facebook.com", "mbasic.facebook.com").replace("facebook.com", "mbasic.facebook.com");
        const resolvedUrl = await resolveFbUrl(mbasicUrl, cookies);
        console.log(`FB mbasic resolve result: ${resolvedUrl}`);
        videoId = extractVideoId(resolvedUrl);
      } catch (e) {
        console.log(`FB mbasic resolve failed: ${e.message}`);
      }
    }
  }

  if (videoId) {
    const embedUrl = `https://www.facebook.com/plugins/video.php?href=https://www.facebook.com/reel/${videoId}&show_text=false&width=560`;
    return await fetchFromEmbed(embedUrl, videoId);
  }

  throw new Error("Tidak bisa extract video ID dari URL Facebook.");
}

async function fetchFromEmbed(embedUrl, videoId) {
  let resp;
  try {
    resp = await httpsGet(embedUrl);
  } catch (e) {
    throw new Error(`Facebook embed error: ${e.message}`);
  }

  const html = resp.data;

  const videoUrl = extractVideoUrl(html);
  if (!videoUrl) {
    throw new Error("Facebook video URL tidak ditemukan dari embed page.");
  }

  let title = null;
  const titleMatch = html.match(/property="og:title"\s+content="([^"]+)"/) ||
                     html.match(/<title>([^<]+)<\/title>/);
  if (titleMatch) {
    title = titleMatch[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  }

  let thumbnail = null;
  const thumbMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
  if (thumbMatch) {
    thumbnail = thumbMatch[1];
  }

  if (!videoId) {
    const idMatch = html.match(/\/reel\/(\d+)/) || html.match(/\/video\/(\d+)/);
    if (idMatch) videoId = idMatch[1];
  }

  return {
    platform: "Facebook",
    id: videoId,
    title: title || `Facebook Video ${videoId || "unknown"}`,
    uploader: null,
    duration: null,
    thumbnail,
    videoUrl,
    qualities: [
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
