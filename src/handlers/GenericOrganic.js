const { load } = require("cheerio");
const { getClient, followRedirects } = require("../utils/httpClient");

const SERVICE_MAP = [
  { name: "OUO", match: /ouo\.(io|press)/, strategy: "ouo", fast: true },
  { name: "TPI", match: /tpi\.(li|ac)|srtam\.com/, strategy: "token-decode", fast: true },
  { name: "Linkvertise", match: /linkvertise\.com/, strategy: "linkvertise", fast: false },
  { name: "ShrinkMe", match: /shrinkme\.io/, strategy: "countdown-click", fast: false },
  { name: "Shorte.st", match: /shorte\.st|sh\.st/, strategy: "countdown-click", fast: false },
  { name: "Adf.ly", match: /adf\.ly/, strategy: "countdown-click", fast: false },
  { name: "GPLinks", match: /gplinks?\.(com|co|net)|mitly\.us|cutp\.in|fc\.lc|za\.gl|tnlink\.in/, strategy: "countdown-form", fast: false },
  { name: "Adtival", match: /pndk\.to|urlwebsite\.com/, strategy: "livewire", fast: false },
  { name: "Safelinku", match: /tutwuri\.id|khaddavi\.net/, strategy: "livewire", fast: false },
];

class GenericOrganic {
  get name() { return "generic-organic"; }

  detectService(url) {
    for (const svc of SERVICE_MAP) { if (svc.match.test(url)) return svc; }
    return { name: "Unknown", strategy: "auto", fast: false };
  }

  async visit(url, opts = {}) {
    const logs = [];
    const log = (m) => { logs.push(m); console.log("[ORG]", m); };
    const t0 = Date.now();

    try {
      const service = this.detectService(url);
      log("Service: " + service.name);

      if (service.strategy === "token-decode") {
        const httpResult = await this._fastHttpDecode(url, log);
        if (httpResult) {
          log("FAST HTTP decode: " + (Date.now() - t0) + "ms");
          return { success: true, url: httpResult, service: service.name, logs, time: Date.now() - t0 };
        }
      }

      if (service.name === "OUO") {
        const fbcResult = await this._tryFbcRedirect(url, log);
        if (fbcResult) {
          log("FBC redirect: " + (Date.now() - t0) + "ms -> " + fbcResult);
          return { success: true, url: fbcResult, service: service.name, logs, time: Date.now() - t0 };
        }
        return { success: false, error: "OUO bypass failed - Cloudflare or no link found", logs, time: Date.now() - t0 };
      }

      log("Fetching via HTTP...");
      const { finalUrl, html } = await followRedirects(url);
      log("Final URL: " + finalUrl);

      if (!html) {
        return { success: false, error: "No HTML response", logs, time: Date.now() - t0 };
      }

      const title = this._title(html);
      log("Title: " + title);

      if (this._isCloudflare(title)) {
        log("Cloudflare detected");
        return { success: false, error: "Cloudflare challenge detected", logs, time: Date.now() - t0 };
      }

      const strategy = service.strategy === "auto" ? this._detectStrategy(html) : service.strategy;
      log("Strategy: " + strategy);

      const result = await this._runHttp(strategy, finalUrl, html, log);
      const elapsed = Date.now() - t0;

      if (result) {
        log("DONE " + elapsed + "ms -> " + result);
        return { success: true, url: result, service: service.name, logs, time: elapsed };
      }

      return { success: false, error: "Failed", logs, time: elapsed };

    } catch (err) {
      log("Error: " + err.message);
      return { success: false, error: err.message, logs, time: Date.now() - t0 };
    }
  }

  async _tryFbcRedirect(url, log) {
    try {
      const code = url.match(/ouo\.(io|press)\/([A-Za-z0-9]+)/)?.[2];
      if (!code) return null;

      const client = getClient({ timeout: 8000 });
      const fbcUrl = `https://ouo.io/fbc/${code}`;
      log("Trying FBC: " + fbcUrl);

      const res = await client.get(fbcUrl, {
        maxRedirects: 5,
        validateStatus: (s) => s < 400 || s === 301 || s === 302 || s === 303,
      });

      const loc = res.headers?.location;
      if (loc && !loc.includes("ouo.io")) {
        return loc.startsWith("http") ? loc : new URL(loc, fbcUrl).href;
      }

      const body = typeof res.data === "string" ? res.data : "";

      const jsRedirect = body.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)/);
      if (jsRedirect && !jsRedirect[1].includes("ouo.io")) {
        return jsRedirect[1];
      }

      const b64Match = body.match(/aHR0cHM6Ly9[A-Za-z0-9+\/=]+/);
      if (b64Match) {
        try {
          const decoded = Buffer.from(b64Match[0], "base64").toString("utf-8");
          if (decoded.startsWith("http") && !decoded.includes("ouo.io")) {
            return decoded;
          }
        } catch {}
      }

      const $ = load(body);
      const destLink = $("a[href]").filter(function () {
        const h = $(this).attr("href") || "";
        return h.startsWith("http") && !h.includes("ouo.io") && !h.includes("google") && !h.includes("facebook");
      }).first().attr("href");
      if (destLink) return destLink;

    } catch (err) {
      log("FBC error: " + err.message);
      if (err.response?.headers?.location) {
        const loc = err.response.headers.location;
        if (!loc.includes("ouo.io")) {
          return loc.startsWith("http") ? loc : new URL(loc, url).href;
        }
      }
    }
    return null;
  }

  async _fastHttpDecode(url, log) {
    try {
      const { html } = await followRedirects(url);
      if (!html || html.includes("Just a moment")) return null;

      const $ = load(html);
      const token = $('input[name="token"]').val() || $('input[name="_token"]').val() || "";

      if (token) {
        const decoded = this._decodeToken(token);
        if (decoded) { log("HTTP decode OK"); return decoded; }
      }

      const b64 = this._extractB64(html);
      if (b64) { log("HTTP B64 OK"); return b64; }
    } catch {}
    return null;
  }

  async _runHttp(strategy, url, html, log) {
    switch (strategy) {
      case "ouo": return this._ouoHttp(url, html, log);
      case "token-decode": return this._tokenDecodeHttp(url, html, log);
      case "linkvertise": return this._linkvertiseHttp(url, html, log);
      case "countdown-click": return this._countdownClickHttp(url, html, log);
      case "countdown-form": return this._countdownFormHttp(url, html, log);
      case "livewire": return this._livewireHttp(url, html, log);
      default: return this._autoHttp(url, html, log);
    }
  }

  async _ouoHttp(url, html, log) {
    const b64 = this._extractB64(html);
    if (b64) return b64;

    const jsRedirect = html.match(/window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)/);
    if (jsRedirect && !jsRedirect[1].includes("ouo.io")) return jsRedirect[1];

    return null;
  }

  async _tokenDecodeHttp(url, html, log) {
    const decoded = this._decodeFromHtml(html);
    if (decoded) { log("Decode from page"); return decoded; }

    return this._extractB64(html);
  }

  async _linkvertiseHttp(url, html, log) {
    const target = html.match(/targetUrl["\s:=]+["']?(https?:\/\/[^"'\s&]+)/i);
    if (target) return target[1];

    const api = html.match(/\/api\/v1\/dynamic\/links\/([a-zA-Z0-9]+)/);
    if (api) {
      try {
        const client = getClient({ timeout: 6000 });
        const res = await client.get(`https://linkvertise.com/api/v1/dynamic/links/${api[1]}?r=&u=`, {
          headers: { Referer: url },
        });
        if (res.data?.data?.targetUrl) return res.data.data.targetUrl;
      } catch {}
    }

    const b64 = this._extractB64(html);
    if (b64) return b64;

    return null;
  }

  async _countdownClickHttp(url, html, log) {
    const b64 = this._extractB64(html);
    if (b64) return b64;

    const jsRedirect = html.match(/window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)/);
    if (jsRedirect && !this._isShortlink(jsRedirect[1])) return jsRedirect[1];

    return null;
  }

  async _countdownFormHttp(url, html, log) {
    const $ = load(html);
    const form = $('form').first();
    if (form.length) {
      const action = form.attr("action");
      if (action) {
        const postUrl = action.startsWith("http") ? action : new URL(action, url).href;
        const formData = {};
        form.find('input').each(function () {
          const name = $(this).attr("name");
          const value = $(this).val();
          if (name) formData[name] = value || "";
        });
        const extracted = await this._submitAndExtract(postUrl, formData, url, log);
        if (extracted) return extracted;
      }
    }

    const b64 = this._extractB64(html);
    if (b64) return b64;

    return null;
  }

  async _livewireHttp(url, html, log) {
    const extracted = this._extractB64(html);
    if (extracted) return extracted;

    const jsRedirect = html.match(/window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)/);
    if (jsRedirect && !this._isShortlink(jsRedirect[1])) return jsRedirect[1];

    const $ = load(html);
    const link = $("a[href]").filter(function () {
      const h = $(this).attr("href") || "";
      return h.startsWith("http") &&
        !h.includes("pndk.to") &&
        !h.includes("tutwuri.id") &&
        !h.includes("datapendidikan.com") &&
        !h.includes("urlwebsite.com") &&
        !h.includes("khaddavi.net") &&
        !h.includes("google") &&
        !h.includes("facebook");
    }).first().attr("href");
    if (link) return link;

    return null;
  }

  async _autoHttp(url, html, log) {
    const $ = load(html);
    const form = $("form").first();
    if (form.length) {
      const token = form.find('input[name="token"], input[name="_token"]').val() || "";
      const decoded = this._decodeToken(token);
      if (decoded) return decoded;
    }

    const b64 = this._extractB64(html);
    if (b64) return b64;

    return this._countdownClickHttp(url, html, log);
  }

  async _submitAndExtract(action, formData, referer, log) {
    try {
      const client = getClient({ timeout: 8000 });
      const postUrl = action.startsWith("http") ? action : new URL(action, referer).href;
      const res = await client.post(postUrl,
        new URLSearchParams(formData).toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: referer,
            Origin: new URL(referer).origin,
          },
          maxRedirects: 5,
        }
      );
      const body = typeof res.data === "string" ? res.data : "";

      const jsRedirect = body.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)/);
      if (jsRedirect && !this._isShortlink(jsRedirect[1])) return jsRedirect[1];

      const b64 = body.match(/aHR0cHM6Ly9[A-Za-z0-9+\/=]+/);
      if (b64) {
        try {
          const decoded = Buffer.from(b64[0], "base64").toString("utf-8");
          if (decoded.startsWith("http") && !this._isShortlink(decoded)) return decoded;
        } catch {}
      }

      const $ = load(body);
      const link = $("a[href]").filter(function () {
        const h = $(this).attr("href") || "";
        return h.startsWith("http") && !h.includes("ouo.io") && !h.includes("google");
      }).first().attr("href");
      if (link) return link;
    } catch (err) {
      if (err.response?.headers?.location) {
        return err.response.headers.location;
      }
      log("Submit error: " + err.message);
    }
    return null;
  }

  _decodeFromHtml(html) {
    const $ = load(html);
    const token = $('input[name="token"]').val() || $('input[name="_token"]').val() || "";
    if (token) {
      const d = this._decodeToken(token);
      if (d) return d;
    }
    return this._extractB64(html);
  }

  _decodeToken(token) {
    if (!token || token.length < 20) return null;
    try {
      const b64 = token.match(/aHR0cHM6Ly9[A-Za-z0-9+\/=]+/);
      if (b64) {
        const d = Buffer.from(b64[0], "base64").toString("utf-8");
        if (d.startsWith("http")) return d;
      }
      const m = token.match(/([A-Za-z0-9+\/]{40,}={0,2})/);
      if (m) {
        const d = Buffer.from(m[1], "base64").toString("utf-8");
        const u = d.match(/https?:\/\/[^\s"'<>]+/);
        if (u) return u[0];
      }
    } catch {}
    return null;
  }

  _extractB64(html) {
    const b64 = html.match(/aHR0cHM6Ly9[A-Za-z0-9+\/=]+/g);
    if (!b64) return null;
    const seen = new Set();
    for (const b of b64) {
      if (seen.has(b)) continue;
      seen.add(b);
      try {
        const d = Buffer.from(b, "base64").toString("utf-8");
        if (d.startsWith("http") && !this._isShortlink(d)) return d;
      } catch {}
    }
    return null;
  }

  _detectStrategy(html) {
    if (html.includes("/go/") && html.includes("_token")) return "ouo";
    if (html.includes('name="token"') && html.includes("aHR0cHM6Ly9")) return "token-decode";
    if (html.includes("Livewire") || html.includes("livewire") || html.includes("wire:initial-data")) return "livewire";
    return "countdown-click";
  }

  _isCloudflare(t) { return t.includes("Just a moment") || t.includes("Checking") || t.includes("Attention"); }
  _isShortlink(u) { return /ouo\.(io|press)|linkvertise|shrinkme|shorte\.st|sh\.st|adf\.ly|bc\.vc|gplinks?|safelinku|exe\.io|tei\.ai|tpi\.(li|ac)|advertisingcamps|cekresi\.me|insurance\./.test(u); }
  _title(h) { return h.match(/<title>(.*?)<\/title>/i)?.[1] || ""; }
}

module.exports = new GenericOrganic();
