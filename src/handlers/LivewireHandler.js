const { getClient } = require("../utils/httpClient");
const { load } = require("cheerio");
const BaseHandler = require("./BaseHandler");

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
      const res = await client.get(url, {
        maxRedirects: 5,
      });

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

      const ajaxUrl = finalUrl;
      const setLinkUrl = finalUrl.replace(/\/+$/, "") + "/setLink";

      const [ajaxResult, apiResult] = await Promise.allSettled([
        client.get(ajaxUrl, {
          maxRedirects: 3,
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "text/html, */*; q=0.01",
            "Referer": url,
          },
        }),
        client.post(setLinkUrl, "", {
          maxRedirects: 3,
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/json",
            "Referer": finalUrl,
          },
          timeout: 5000,
        }),
      ]);

      for (const result of [ajaxResult, apiResult]) {
        if (result.status === "fulfilled") {
          const body = typeof result.value.data === "string" ? result.value.data : JSON.stringify(result.value.data || "");
          const found = this._extractFromHtml(body);
          if (found) {
            log?.("Extracted from parallel request: " + found);
            return { success: true, url: found };
          }
        }
      }

      log?.("Could not extract destination link");
      return { success: false, error: "Could not extract destination link", elapsed: Date.now() - t0 };
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
