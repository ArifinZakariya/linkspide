let puppeteer = null;
try { puppeteer = require("puppeteer"); } catch {}
let puppeteerExtra = null;
let StealthPlugin = null;
try {
  puppeteerExtra = require("puppeteer-extra");
  StealthPlugin = require("puppeteer-extra-plugin-stealth");
  puppeteerExtra.use(StealthPlugin());
} catch {}
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
];

class GenericOrganic {
  get name() { return "generic-organic"; }
  isAvailable() { return !!puppeteer; }

  detectService(url) {
    for (const svc of SERVICE_MAP) { if (svc.match.test(url)) return svc; }
    return { name: "Unknown", strategy: "auto", fast: false };
  }

  async visit(url, opts = {}) {
    if (!puppeteer) return { success: false, error: "Puppeteer not installed", logs: [] };

    const logs = [];
    const log = (m) => { logs.push(m); console.log("[ORG]", m); };
    let browser = null;
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
      }

      const chromePath = process.env.CHROME_PATH || this._findChrome();
      const launchOpts = {
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--window-size=1366,768", "--disable-blink-features=AutomationControlled"],
      };
      if (chromePath) {
        launchOpts.executablePath = chromePath;
        log("Chrome: " + chromePath);
      } else {
        log("No Chrome found. Set CHROME_PATH or run: npx puppeteer browsers install chrome");
      }
      const launchFn = puppeteerExtra || puppeteer;
      browser = await launchFn.launch(launchOpts);

      const page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 768 });
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
        Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      });

      log("Loading...");
      const navError = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(e => e);
      if (navError) {
        log("Nav error: " + navError.message);
      }
      await this._wait(2000, 3000);

      let cur = page.url();
      log("Current URL: " + cur);

      if (cur.includes("chrome-error://")) {
        log("Chrome error page detected, aborting browser");
        return { success: false, error: "Chrome cannot reach the URL", logs, time: Date.now() - t0 };
      }

      let html = await page.content();
      let title = this._title(html);

      if (this._isCloudflare(title)) {
        log("Cloudflare, waiting...");
        for (let i = 0; i < 8; i++) {
          await this._wait(2000, 3000);
          html = await page.content();
          title = this._title(html);
          cur = page.url();
          if (cur.includes("chrome-error://")) {
            log("Chrome error during CF wait");
            return { success: false, error: "Chrome cannot reach the URL", logs, time: Date.now() - t0 };
          }
          if (!this._isCloudflare(title)) { log("CF passed!"); break; }
        }
      }

      const strategy = service.strategy === "auto" ? this._detectStrategy(html) : service.strategy;
      log("Strategy: " + strategy);

      const result = await this._run(page, strategy, url, html, log);
      const elapsed = Date.now() - t0;

      if (result) {
        log("DONE " + elapsed + "ms -> " + result);
        return { success: true, url: result, service: service.name, logs, time: elapsed };
      }

      return { success: false, error: "Failed", logs, time: elapsed };

    } catch (err) {
      log("Error: " + err.message);
      return { success: false, error: err.message, logs, time: Date.now() - t0 };
    } finally {
      if (browser) try { await browser.close(); } catch {}
    }
  }

  async _tryFbcRedirect(url, log) {
    try {
      const code = url.match(/ouo\.(io|press)\/([A-Za-z0-9]+)/)?.[2];
      if (!code) return null;

      const client = getClient();
      const fbcUrl = `https://ouo.io/fbc/${code}`;
      log("Trying FBC: " + fbcUrl);

      try {
        await client.get(url, { maxRedirects: 5 });
      } catch {}

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

  // FAST HTTP: Decode token without Puppeteer
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

  async _run(page, strategy, url, html, log) {
    switch (strategy) {
      case "ouo": return this._ouo(page, url, log);
      case "token-decode": return this._tokenDecode(page, url, html, log);
      case "linkvertise": return this._linkvertise(page, url, html, log);
      case "countdown-click": return this._countdownClick(page, url, html, log);
      case "countdown-form": return this._countdownForm(page, url, html, log);
      default: return this._auto(page, url, html, log);
    }
  }

  async _ouo(page, url, log) {
    let cur = page.url();
    if (cur.includes("chrome-error://")) return null;

    log("Submitting form directly via JavaScript...");
    await page.evaluate(() => {
      const f = document.querySelector("form");
      if (f) f.submit();
    });

    try {
      await page.waitForFunction(
        () => {
          const u = window.location.href;
          return u.includes("/go/") || !u.includes("ouo.io") || u.includes("chrome-error://");
        },
        { timeout: 15000 }
      );
    } catch {}
    await this._wait(2000, 3000);

    cur = page.url();
    log("Step1: " + cur);

    if (cur.includes("chrome-error://")) return null;

    if (cur.includes("/go/")) {
      let html2 = await page.content();
      let title2 = this._title(html2);
      log("Page2 title: " + title2);

      if (this._isCloudflare(title2)) {
        log("CF on page2, waiting...");
        for (let i = 0; i < 6; i++) {
          await this._wait(2000, 3000);
          html2 = await page.content();
          title2 = this._title(html2);
          cur = page.url();
          if (cur.includes("chrome-error://")) return null;
          if (!this._isCloudflare(title2)) break;
        }
      }

      if (cur.includes("/go/")) {
        log("Submitting form on page2...");
        await this._wait(1000, 2000);
        await page.evaluate(() => {
          const f = document.querySelector("form");
          if (f) f.submit();
        });

        try {
          await page.waitForFunction(
            () => {
              const u = window.location.href;
              return !u.includes("/go/") || u.includes("chrome-error://");
            },
            { timeout: 15000 }
          );
        } catch {}
        await this._wait(2000, 3000);

        cur = page.url();
        log("Step2: " + cur);
      }
    }

    let result = this._finalUrl(page);
    if (result && !this._isShortlink(result)) return result;

    const htmlFinal = await page.content();
    const b64 = this._extractB64(htmlFinal);
    if (b64) return b64;

    const jsRedirect = htmlFinal.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)/);
    if (jsRedirect && !this._isShortlink(jsRedirect[1])) return jsRedirect[1];

    return this._finalUrl(page);
  }

  async _tokenDecode(page, url, html, log) {
    // Try decode from current HTML
    let decoded = this._decodeFromHtml(html);
    if (decoded) { log("Decode from page"); return decoded; }

    // Click button and try again
    await this._click(page);
    await this._wait(1000, 2000);

    const html2 = await page.content();
    decoded = this._decodeFromHtml(html2);
    if (decoded) { log("Decode after click"); return decoded; }

    // Wait for turnstile then try
    await this._wait(3000, 5000);
    const html3 = await page.content();
    decoded = this._decodeFromHtml(html3);
    if (decoded) { log("Decode after wait"); return decoded; }

    // Submit form
    await page.evaluate(() => { const f = document.querySelector("form"); if (f) f.submit(); });
    await this._navWait(page, 8000);

    const html4 = await page.content();
    decoded = this._decodeFromHtml(html4);
    if (decoded) { log("Decode after submit"); return decoded; }

    return this._finalUrl(page);
  }

  async _linkvertise(page, url, html, log) {
    const target = html.match(/targetUrl["\s:=]+["']?(https?:\/\/[^"'\s&]+)/i);
    if (target) return target[1];

    const api = html.match(/\/api\/v1\/dynamic\/links\/([a-zA-Z0-9]+)/);
    if (api) {
      try {
        const r = await page.evaluate(async (id) => {
          const res = await fetch("https://linkvertise.com/api/v1/dynamic/links/" + id + "?r=&u=");
          return res.json();
        }, api[1]);
        if (r?.data?.targetUrl) return r.data.targetUrl;
      } catch {}
    }

    await this._waitCountdown(page, 10000);
    await this._click(page);
    await this._wait(2000, 3000);
    return this._finalUrl(page);
  }

  async _countdownClick(page, url, html, log) {
    await this._waitCountdown(page, 10000);
    await this._click(page);
    await this._wait(2000, 3000);

    let r = this._finalUrl(page);
    if (r) return r;

    const h = await page.content();
    r = this._extractB64(h);
    if (r) return r;

    await this._click(page);
    await this._wait(2000, 3000);
    return this._finalUrl(page);
  }

  async _countdownForm(page, url, html, log) {
    await this._waitCountdown(page, 10000);
    await this._click(page);
    await this._wait(2000, 3000);

    let r = this._finalUrl(page);
    if (r && !this._isShortlink(r)) return r;

    await page.evaluate(() => { const f = document.querySelector("form"); if (f) f.submit(); });
    await this._navWait(page, 10000);
    await this._wait(2000, 3000);

    r = this._finalUrl(page);
    if (r) return r;

    const h = await page.content();
    r = this._extractB64(h);
    if (r) return r;

    await this._click(page);
    await this._wait(2000, 3000);
    return this._finalUrl(page);
  }

  async _auto(page, url, html, log) {
    const $ = load(html);
    const form = $("form").first();
    if (form.length) {
      const token = form.find('input[name="token"], input[name="_token"]').val() || "";
      const decoded = this._decodeToken(token);
      if (decoded) return decoded;

      const action = form.attr("action") || "";
      if (action.includes("/go/")) return this._ouo(page, url, log);
    }

    const b64 = this._extractB64(html);
    if (b64) return b64;

    return this._countdownClick(page, url, html, log);
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

  _finalUrl(page) {
    try {
      const u = page.url();
      if (u.startsWith("http") && !this._isShortlink(u)) return u;
    } catch {}
    try {
      for (const p of page.browser().pages()) {
        try {
          const u = p.url();
          if (u && u !== "about:blank" && !this._isShortlink(u) && u.startsWith("http")) return u;
        } catch {}
      }
    } catch {}
    return null;
  }

  async _click(page) {
    try {
      const sels = ["#btn-main:not(.disabled)", 'button:not(.disabled):not([disabled]):not([type="hidden"])', '[class*="btn-main"]', 'button[type="submit"]'];
      for (const s of sels) {
        try {
          const el = await page.$(s);
          if (el && await el.isIntersectingViewport().catch(() => false)) { await this._wait(100, 300); await el.click(); return true; }
        } catch {}
      }
      return await page.evaluate(() => {
        for (const b of document.querySelectorAll("button, a")) {
          const t = (b.textContent || "").toLowerCase();
          if (!b.disabled && !b.classList.contains("disabled") && ["continue", "skip", "proceed", "get link", "i'm a human", "verify", "go"].some(k => t.includes(k))) { b.click(); return true; }
        }
        return false;
      });
    } catch { return false; }
  }

  async _waitCountdown(page, timeout) {
    const s = Date.now();
    while (Date.now() - s < timeout) {
      try {
        const d = await page.evaluate(() => {
          const b = document.querySelector('#btn-main, [class*="btn-main"], button[type="submit"]');
          return b ? (b.classList.contains("disabled") || b.disabled) : null;
        });
        if (d === false) { await this._wait(200, 400); return true; }
        if (d === null) return false;
      } catch {}
      await this._wait(500, 800);
    }
    return false;
  }

  async _navWait(page, timeout) {
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout }).catch(() => {});
  }

  _detectStrategy(html) {
    if (html.includes("/go/") && html.includes("_token")) return "ouo";
    if (html.includes('name="token"') && html.includes("aHR0cHM6Ly9")) return "token-decode";
    return "countdown-click";
  }

  _isCloudflare(t) { return t.includes("Just a moment") || t.includes("Checking") || t.includes("Attention"); }
  _isShortlink(u) { return /ouo\.(io|press)|linkvertise|shrinkme|shorte\.st|sh\.st|adf\.ly|bc\.vc|gplinks?|safelinku|exe\.io|tei\.ai|tpi\.(li|ac)|advertisingcamps/.test(u); }
  _title(h) { return h.match(/<title>(.*?)<\/title>/i)?.[1] || ""; }
  _wait(a, b) { return new Promise(r => setTimeout(r, Math.floor(Math.random() * (b - a) + a))); }

  _findChrome() {
    const fs = require("fs");
    const paths = [
      // Linux
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      // Windows
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
      // macOS
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      // Puppeteer cache
      process.env.HOME + "/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome",
      process.env.HOME + "/.cache/puppeteer/chrome/win64-*/chrome-win64/chrome.exe",
    ];
    for (const p of paths) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {}
    }
    // Try glob for puppeteer cache
    try {
      const glob = require("child_process").execSync(
        'find ~/.cache/puppeteer/chrome -name "chrome" -o -name "chrome.exe" 2>/dev/null | head -1',
        { encoding: "utf-8" }
      ).trim();
      if (glob) return glob;
    } catch {}
    return null;
  }
}

module.exports = new GenericOrganic();
