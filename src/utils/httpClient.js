const axios = require("axios");
const http = require("http");
const https = require("https");

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 30 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 30 });

const DEFAULT_TIMEOUT = 8000;

const BASE_CONFIG = {
  maxRedirects: 0,
  validateStatus: (s) => (s >= 200 && s < 400) || s === 403,
  httpAgent,
  httpsAgent,
  headers: {
    "User-Agent": DESKTOP_UA,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
  },
};

let _client = null;

function getClient(opts = {}) {
  const wantTimeout = opts.timeout || DEFAULT_TIMEOUT;
  const useCache = !opts.mobile && wantTimeout === DEFAULT_TIMEOUT;

  if (useCache && _client) return _client;

  const client = axios.create({
    ...BASE_CONFIG,
    timeout: wantTimeout,
  });

  if (useCache) _client = client;
  return client;
}

async function followRedirects(url, maxSteps = 10) {
  const steps = [];
  let current = url;
  let cookies = {};
  const client = getClient();

  for (let i = 0; i < maxSteps; i++) {
    try {
      const cookieStr = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");

      const headers = {};
      if (cookieStr) headers.Cookie = cookieStr;

      const res = await client.get(current, { headers });
      const status = res.status;
      const location = res.headers?.location;

      const setCookies = res.headers["set-cookie"];
      if (setCookies) {
        for (const c of setCookies) {
          const [kv] = c.split(";");
          const [k, v] = kv.split("=");
          cookies[k?.trim()] = v?.trim();
        }
      }

      steps.push({ url: current, status, final: !location });

      if (!location) return { finalUrl: current, steps, html: res.data };
      current = location.startsWith("http")
        ? location
        : new URL(location, current).href;
    } catch (err) {
      if (err.response?.headers?.location) {
        current = err.response.headers.location.startsWith("http")
          ? err.response.headers.location
          : new URL(err.response.headers.location, current).href;
        steps.push({ url: current, status: err.response.status, final: false });
        continue;
      }
      steps.push({
        url: current,
        status: "error",
        error: err.message,
        final: true,
      });
      return { finalUrl: current, steps, html: "" };
    }
  }
  return { finalUrl: current, steps, html: "" };
}

module.exports = { getClient, followRedirects };
