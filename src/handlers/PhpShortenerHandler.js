const BaseHandler = require("./BaseHandler");
const { getClient } = require("../utils/httpClient");

const PHP_SHORTENER_HOSTS = ["zovo.ink", "go.zovo.ink", "vuotlink.xyz", "oklink2.online"];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function extractFormFields(html) {
  const fields = {};
  for (const m of html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) {
    fields[m[1]] = m[2];
  }
  for (const m of html.matchAll(/<input[^>]*value="([^"]*)"[^>]*name="([^"]+)"/g)) {
    fields[m[2]] = m[1];
  }
  return fields;
}

function extractFormAction(html, fallbackUrl) {
  const m = html.match(/<form[^>]*id="form-continue"[^>]*action="([^"]+)"/);
  if (m) {
    return m[1].startsWith("http") ? m[1] : new URL(m[1], fallbackUrl).href;
  }
  return fallbackUrl;
}

// Cookie-persisting wrapper around axios for the multi-step CakePHP flow
function createSession(getClientImpl) {
  const client = getClientImpl({ timeout: 20000 });
  let cookies = {};

  const cookieHeader = () =>
    Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");

  const save = (headers) => {
    const setCookies = headers["set-cookie"];
    if (setCookies) {
      for (const c of setCookies) {
        const [kv] = c.split(";");
        const idx = kv.indexOf("=");
        if (idx > 0) cookies[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
      }
    }
  };

  return {
    async get(url, opts = {}) {
      const res = await client.get(url, { ...opts, headers: { ...opts.headers, Cookie: cookieHeader() } });
      save(res.headers);
      return res;
    },
    async post(url, data, opts = {}) {
      const res = await client.post(url, data, { ...opts, headers: { ...opts.headers, Cookie: cookieHeader() } });
      save(res.headers);
      return res;
    },
  };
}

class PhpShortenerHandler extends BaseHandler {
  get name() {
    return "phpshortener";
  }

  canHandle(url) {
    return PHP_SHORTENER_HOSTS.some((h) => url.includes(h));
  }

  async solve(shortUrl) {
    const session = createSession(getClient);
    const origin = new URL(shortUrl).origin;

    const page1 = await session.get(shortUrl);
    const html1 = typeof page1.data === "string" ? page1.data : "";
    const action = extractFormAction(html1, shortUrl);
    const fields1 = extractFormFields(html1);
    if (!fields1["_csrfToken"] && !fields1["_Token[fields]"]) return null;

    const page2 = await session.post(action, new URLSearchParams(fields1).toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: shortUrl,
        Origin: origin,
        "User-Agent": UA,
      },
    });
    const html2 = typeof page2.data === "string" ? page2.data : "";
    let fields2 = extractFormFields(html2);

    // Wait for the ad countdown
    await new Promise((r) => setTimeout(r, 6000));

    const postGo = async (fields, referer) => {
      return session.post(`${origin}/links/go`, new URLSearchParams(fields).toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: referer,
          Origin: origin,
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": UA,
        },
      });
    };

    let res = await postGo(fields2, action);
    let body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);

    if (!fields2["ad_form_data"] || /error/i.test(body.slice(0, 200))) {
      // Try page=3 flow
      const page3Data = { ...fields2, page: "3" };
      const page3 = await session.post(action, new URLSearchParams(page3Data).toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: page2.url || action,
          Origin: origin,
          "User-Agent": UA,
        },
      });
      const html3 = typeof page3.data === "string" ? page3.data : "";
      const fields3 = extractFormFields(html3);
      if (fields3["ad_form_data"]) {
        await new Promise((r) => setTimeout(r, 3000));
        res = await postGo(fields3, action);
        body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      }
    }

    try {
      const json = JSON.parse(body);
      if (json?.status === "success" && json.url) return json.url;
      if (json?.url) return json.url;
    } catch {}

    // Fallback: look for a destination URL embedded in the final page
    const m = body.match(/window\.location(?:\.href)?\s*[=:]\s*["'](https?:\/\/[^"']+)/);
    if (m && !m[1].includes(origin)) return m[1];

    return null;
  }

  async extract($, html, url) {
    // If the page is not the PHP shortener form, bail
    if (!html.includes("form-continue") && !html.includes("links/go")) return null;

    try {
      const dest = await this.solve(url);
      if (dest) return { redirect: dest };
    } catch {}
    return null;
  }
}

module.exports = PhpShortenerHandler;