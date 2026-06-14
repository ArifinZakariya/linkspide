const https = require("https");
const http = require("http");
const { URL } = require("url");
const fs = require("fs");

const COOKIES_FILE = process.env.COOKIES_FILE || "/app/cookies.txt";

const IG_UA =
  "Instagram 282.0.0.27.98 (iPhone13,3; iOS 16_6; en_US; en-US; scale=3.00; 1170x2532; 458229258)";

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

function extractShortcode(url) {
  const m = url.match(/instagram\.com\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

function igRequest(urlStr, cookies) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const mod = url.protocol === "https:" ? https : http;
    const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");

    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        "User-Agent": IG_UA,
        "Accept": "*/*",
        "Accept-Language": "en-US",
        "Cookie": cookieStr,
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
      },
    };

    const req = mod.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error("Invalid JSON response")); }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

async function getReelInfo(url) {
  const cookies = parseCookies(COOKIES_FILE);
  if (!cookies || !cookies.sessionid) {
    throw new Error("Instagram memerlukan cookies yang valid.");
  }

  const shortcode = extractShortcode(url);
  if (!shortcode) {
    throw new Error("Tidak bisa extract shortcode dari URL Instagram.");
  }

  // Try mobile API first
  const apiUrl = `https://i.instagram.com/api/v1/media/${shortcode}/info/`;

  let data;
  try {
    data = await igRequest(apiUrl, cookies);
  } catch (e) {
    throw new Error(`Instagram API error: ${e.message}`);
  }

  if (!data || !data.items || !data.items.length) {
    throw new Error("Instagram returned empty response. Cookies mungkin expired.");
  }

  const item = data.items[0];
  const videoUrl =
    item.video_versions && item.video_versions[0] ? item.video_versions[0].url : null;
  const imageUrl =
    item.image_versions2 && item.image_versions2.candidates
      ? item.image_versions2.candidates[0].url
      : null;

  const title =
    item.caption && item.caption.text
      ? item.caption.text.slice(0, 100)
      : item.code || "Instagram Reel";
  const uploader =
    item.user && item.user.username ? item.user.username : null;

  return {
    platform: "Instagram",
    id: item.id || shortcode,
    title,
    uploader,
    duration: item.video_duration || null,
    thumbnail: imageUrl,
    videoUrl,
    imageUrl,
    qualities: [
      {
        quality: "Best",
        height: item.video_versions ? item.video_versions[0].height : 720,
        format: "best",
        ext: "mp4",
        needsDownload: true,
      },
    ],
  };
}

module.exports = { getReelInfo, parseCookies, extractShortcode };
