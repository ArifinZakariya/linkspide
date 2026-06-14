const { getClient } = require("../utils/httpClient");
const { load } = require("cheerio");
const BaseHandler = require("./BaseHandler");

const PUPPETEER_SERVICE_URL = process.env.PUPPETEER_SERVICE_URL || "";

async function callPuppeteerService(url, timeout = 30000) {
  if (!PUPPETEER_SERVICE_URL) return null;
  try {
    const client = getClient({ timeout: timeout + 5000 });
    const res = await client.post(`${PUPPETEER_SERVICE_URL}/api/bypass`, {
      url,
      strategy: "livewire",
      timeout,
    }, {
      headers: { "Content-Type": "application/json" },
    });
    return res.data;
  } catch (err) {
    console.log("[PUPPETEER-SERVICE]", err.message);
    return null;
  }
}

class LivewireHandler extends BaseHandler {
  get name() { return "livewire"; }

  canHandle(url) {
    try {
      const h = new URL(url).hostname;
      return /pndk\.to|tutwuri\.id|datapendidikan\.com|urlwebsite\.com|khaddavi\.net/.test(h);
    } catch { return false; }
  }

  async extract($, html, url) {
    const hasLivewire = html.includes("Livewire") || html.includes("livewire") || html.includes("wire:initial-data");
    if (!hasLivewire) return null;
    return { livewire: true, url };
  }

  async solve(url, log) {
    const t0 = Date.now();
    try {
      const client = getClient({ timeout: 10000 });

      log?.("Fetching: " + url);
      const res = await client.get(url, { maxRedirects: 5 });

      const html = typeof res.data === "string" ? res.data : "";
      const finalUrl = res.request?.res?.responseUrl || url;

      if (!html.includes("Livewire") && !html.includes("livewire") && !html.includes("wire:initial-data")) {
        log?.("Redirected to non-Livewire page: " + finalUrl);
        if (finalUrl !== url && finalUrl.startsWith("http")) {
          return { success: true, url: finalUrl };
        }
      }

      const extracted = this._extractFromHtml(html);
      if (extracted) {
        log?.("Extracted from HTML: " + extracted);
        return { success: true, url: extracted };
      }

      if (PUPPETEER_SERVICE_URL) {
        log?.("Calling Puppeteer service...");
        const result = await callPuppeteerService(finalUrl);
        if (result && result.success && result.url) {
          log?.("Puppeteer service returned: " + result.url);
          return { success: true, url: result.url };
        }
        log?.("Puppeteer service failed: " + (result?.error || "unknown"));
      }

      log?.("Could not extract destination link");
      return { success: false, error: "Could not extract destination link (set PUPPETEER_SERVICE_URL for JS-based bypass)", elapsed: Date.now() - t0 };
    } catch (err) {
      log?.("Error: " + err.message);
      return { success: false, error: err.message };
    }
  }

  _extractFromHtml(html) {
    const b64Match = html.match(/aHR0cHM6Ly9[A-Za-z0-9+\/=]+/g);
    if (b64Match) {
      for (const b of b64Match) {
        try {
          const decoded = Buffer.from(b, "base64").toString("utf-8");
          if (decoded.startsWith("http") && !decoded.includes("cekresi") && !decoded.includes("datapendidikan")) {
            return decoded;
          }
        } catch {}
      }
    }

    const jsRedirect = html.match(/window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)/);
    if (jsRedirect && !jsRedirect[1].includes("pndk.to") && !jsRedirect[1].includes("tutwuri.id")) {
      return jsRedirect[1];
    }

    const dataUrl = html.match(/data-url\s*=\s*["'](https?:\/\/[^"']+)/);
    if (dataUrl) return dataUrl[1];

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
}

module.exports = new LivewireHandler();
