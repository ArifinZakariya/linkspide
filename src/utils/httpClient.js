const axios = require("axios");
const { load } = require("cheerio");

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

function getClient(opts = {}) {
  const ua = opts.mobile ? MOBILE_UA : DESKTOP_UA;
  return axios.create({
    timeout: 20000,
    maxRedirects: 0,
    validateStatus: (s) => (s >= 200 && s < 400) || s === 403,
    headers: {
      "User-Agent": ua,
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
    ...opts,
  });
}

async function followRedirects(url, maxSteps = 10) {
  const steps = [];
  let current = url;
  let cookies = {};

  for (let i = 0; i < maxSteps; i++) {
    try {
      const client = getClient();
      const cookieStr = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
      if (cookieStr) client.defaults.headers.Cookie = cookieStr;

      const res = await client.get(current);
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
