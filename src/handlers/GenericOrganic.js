const { load } = require("cheerio");
const { getClient, followRedirects } = require("../utils/httpClient");

const PUPPETEER_SERVICE_URL = process.env.PUPPETEER_SERVICE_URL || "";
const EZSOLVER_URL = (process.env.EZSOLVER_URL || process.env.EZSOLVER_SERVICE_URL || "http://127.0.0.1:8191").replace(/\/$/, "");
const TPI_FAST_URL = (process.env.TPI_FAST_URL || "http://127.0.0.1:8194").replace(/\/$/, "");
const TPI_SERVICE_URL = (process.env.TPI_SERVICE_URL || "http://127.0.0.1:8192").replace(/\/$/, "");
const HTTP_BYPASS_URL = (process.env.HTTP_BYPASS_URL || "http://127.0.0.1:8193").replace(/\/$/, "");

async function solveViaHttpBypass(url, log) {
  try {
    const client = getClient({ timeout: 40000 });
    log(`Trying HTTP bypass (cloudscraper) -> ${HTTP_BYPASS_URL}/bypass`);
    const r = await client.post(`${HTTP_BYPASS_URL}/bypass`, { url, timeout: 30 }, {
      headers: { "Content-Type": "application/json" },
      timeout: 35000,
    });
    if (r.data?.destination && r.data.destination.startsWith("http")) {
      log(`HTTP bypass success (${r.data.elapsed}s) -> ${r.data.destination}`);
      return r.data.destination;
    }
    log(`HTTP bypass no destination: ${JSON.stringify(r.data).slice(0,400)}`);
  } catch (e) {
    log(`HTTP bypass error: ${e.message}`);
  }
  return null;
}

async function solveViaTpiFast(url, log) {
  try {
    const client = getClient({ timeout: 160000 });
    log(`Trying TPI Fast (nodriver+CDP) -> ${TPI_FAST_URL}/bypass`);
    const r = await client.post(`${TPI_FAST_URL}/bypass`, { url, timeout: 150 }, {
      headers: { "Content-Type": "application/json" },
      timeout: 155000,
    });
    if (r.data?.destination && r.data.destination.startsWith("http")) {
      log(`TPI Fast success (${r.data.elapsed}s) -> ${r.data.destination}`);
      return r.data.destination;
    }
    log(`TPI Fast no destination: ${JSON.stringify(r.data).slice(0,400)}`);
  } catch (e) {
    log(`TPI Fast error: ${e.message}`);
  }
  return null;
}

async function solveViaTpiService(url, log) {
  try {
    const client = getClient({ timeout: 130000 });
    log(`Trying TPI Service (nodriver) -> ${TPI_SERVICE_URL}/bypass`);
    const r = await client.post(`${TPI_SERVICE_URL}/bypass`, { url, timeout: 120 }, {
      headers: { "Content-Type": "application/json" },
      timeout: 125000,
    });
    if (r.data?.destination && r.data.destination.startsWith("http")) {
      log(`TPI Service success (${r.data.elapsed}s) -> ${r.data.destination}`);
      return r.data.destination;
    }
    log(`TPI Service no destination: ${JSON.stringify(r.data).slice(0,400)}`);
  } catch (e) {
    log(`TPI Service error: ${e.message}`);
  }
  return null;
}

async function solveViaEzSolver(url, sitekey, log) {
  try {
    const client = getClient({ timeout: 55000 });
    log(`Trying EzSolver (unlimited free) -> ${EZSOLVER_URL}/solve sitekey=${sitekey}`);
    const r = await client.post(`${EZSOLVER_URL}/solve`, { sitekey, siteurl: url, timeout: 45 }, { headers: { "Content-Type": "application/json" }, timeout: 50000 });
    if (r.data?.token && r.data.token.length > 10) {
      log(`EzSolver success tokenLen=${r.data.token.length} elapsed=${r.data.elapsed}s`);
      return r.data.token;
    }
    log(`EzSolver no token: ${JSON.stringify(r.data).slice(0,400)}`);
  } catch (e) {
    log(`EzSolver error: ${e.message}`);
  }
  return null;
}

function runNodriverBypass(url, log) {
  const fs = require("fs");
  const path = require("path");
  const { spawn } = require("child_process");

  const script = path.join(__dirname, "..", "..", "bypass_nodriver.py");
  if (!fs.existsSync(script)) {
    log("bypass_nodriver.py not found");
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    log(`Running nodriver bypass for ${url}...`);
    const proc = spawn("python", [script, url], {
      timeout: 160000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      const output = stdout + "\n" + stderr;

      const m1 = output.match(/SUCCESS\s*\([\d.]+s\):\s*(https?:\/\/\S+)/);
      if (m1 && !/taboola\.com|advertisingcamps\.com|hai8g\.com|warlessstarved\.com/i.test(m1[1])) {
        log(`Nodriver SUCCESS: ${m1[1]}`);
        resolve(m1[1]);
        return;
      }

      const m2 = output.match(/DESTINATION[^:]*:\s*(https?:\/\/\S+)/);
      if (m2 && !/taboola\.com|advertisingcamps\.com|hai8g\.com|warlessstarved\.com/i.test(m2[1])) {
        log(`Nodriver DESTINATION: ${m2[1]}`);
        resolve(m2[1]);
        return;
      }

      log("Nodriver: no valid destination found" + (code !== 0 ? ` (exit ${code})` : ""));
      resolve(null);
    });

    proc.on("error", (e) => {
      log(`Nodriver error: ${e.message}`);
      resolve(null);
    });
  });
}

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

async function solveViaVercelPuppeteer(url, log, timeout = 25000) {
  // Direct puppeteer-core + @sparticuz/chromium for Vercel (no external service)
  // Handles SFL (cloudflare + khaddavi chain) and TPI/OII (Turnstile)
  let browser = null;
  try {
    let puppeteer, chromium;
    try {
      puppeteer = require("puppeteer-core");
      chromium = require("@sparticuz/chromium");
    } catch (e) {
      log("Vercel puppeteer not installed: " + e.message);
      return null;
    }
    log("Launching Vercel puppeteer-core (chromium)...");
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
    log("Goto " + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    // Wait for Cloudflare challenge to pass
    for (let i = 0; i < 10; i++) {
      const title = await page.title().catch(() => "");
      if (!/Just a moment/.test(title)) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    log("Page loaded: " + (await page.title().catch(() => "")));

    const isSfl = /sfl\.(gl|link)/i.test(url);
    const isTpi = /tpi\.(li|ac)|oii\.la|clksz\.com|clk\.sh|srtam\.com/i.test(url);

    if (isSfl) {
      // SFL: extract form and run khaddavi chain via browser fetch
      await page.waitForSelector("form", { timeout: 5000 }).catch(() => {});
      const formData = await page.evaluate(() => {
        const form = document.querySelector("form");
        if (!form) return null;
        const data = {};
        form.querySelectorAll("input[name]").forEach(el => { data[el.name] = el.value || ""; });
        return { action: form.action, data };
      });
      if (formData && formData.action) {
        log("SFL form found, running khaddavi chain via browser...");
        // Use page.evaluate to do the API chain with browser cookies
        const result = await page.evaluate(async (formInfo) => {
          try {
            // Get XSRF token from cookie
            const getCookie = (name) => {
              const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
              return m ? decodeURIComponent(m[2]) : "";
            };
            const xsrf = getCookie("XSRF-TOKEN");
            if (!xsrf) return { error: "no xsrf" };
            // Generate dummy fingerprint hash (same as Node)
            const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(Date.now() + "-" + Math.random())).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,"0")).join(""));
            const u = "#" + btoa(hash);
            const token = xsrf.slice(0, 128 - u.length) + u;
            const headers = { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };
            const sess = await fetch("/api/session", { method: "POST", headers, body: JSON.stringify({ _token: token }) }).then(r => r.json());
            if (!sess || sess.captcha) return { error: "captcha", sess };
            const verify = await fetch("/api/verify", { method: "POST", headers, body: JSON.stringify({ _a: 0 }) }).then(r => r.json());
            const go = await fetch("/api/go", { method: "POST", headers, body: JSON.stringify({ key: Math.floor(Math.random()*1000), size: "1200.800", ado: null }) }).then(r => r.json());
            return { go: go.url, sess, verify };
          } catch (e) { return { error: e.message }; }
        }, formData);
        log("Browser chain result: " + JSON.stringify(result).slice(0,500));
        if (result && result.go && result.go.startsWith("http")) {
          // Fetch ready/go page via browser
          await page.goto(result.go, { waitUntil: "domcontentloaded", timeout: 10000 });
          const final = await page.evaluate(() => {
            const m = document.documentElement.innerHTML.match(/window\.location\.href\s*=\s*["']([^"']+)["']/);
            return m ? m[1].replace(/\\\//g, "/") : null;
          });
          if (final && final.startsWith("http")) return final;
          return result.go; // fallback to ready url, will be resolved via SflHandler
        }
      }
      // Fallback: look for ready/go link directly in page
      const jsRedir = await page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const m = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/);
        return m ? m[1].replace(/\\\//g, "/") : null;
      });
      if (jsRedir && jsRedir.startsWith("http") && !/sfl\.(gl|link)/i.test(jsRedir)) return jsRedir;
    }

    if (isTpi) {
      // TPI/OII: solve Turnstile via browser interaction (best effort, 15s)
      log("TPI/OII: trying Turnstile solve via browser...");
      for (let i = 0; i < 15; i++) {
        const token = await page.evaluate(() => {
          const el = document.querySelector('[name="cf-turnstile-response"]');
          if (el && el.value && el.value.length > 10) return el.value;
          if (typeof turnstile !== "undefined") { try { const r = turnstile.getResponse(); if (r && r.length > 10) return r; } catch {} }
          return "";
        });
        if (token && token.length > 10) {
          log("Turnstile token found, submitting...");
          const apiResult = await page.evaluate(async (tok) => {
            const form = document.querySelector("form");
            if (!form) return null;
            const data = {};
            form.querySelectorAll("input[name]").forEach(el => { data[el.name] = el.value || ""; });
            data["cf-turnstile-response"] = tok;
            data["g-recaptcha-response"] = tok;
            const body = new URLSearchParams(data).toString();
            try {
              const r = await fetch("/links/go", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" }, body });
              const t = await r.text();
              return { status: r.status, text: t.slice(0,2000) };
            } catch (e) { return { error: e.message }; }
          }, token);
          log("TPI API result: " + JSON.stringify(apiResult).slice(0,500));
          if (apiResult && apiResult.text) {
            try { const j = JSON.parse(apiResult.text); if (j.url && j.url.startsWith("http")) return j.url; } catch {}
          }
          break;
        }
        // Try clicking Turnstile iframe
        try {
          for (const frame of page.frames()) {
            const fu = frame.url();
            if (/challenges\.cloudflare\.com/.test(fu)) {
              await frame.click("input[type=checkbox]").catch(()=>{});
              await frame.click("body").catch(()=>{});
            }
          }
        } catch {}
        await new Promise(r => setTimeout(r, 1000));
      }
      // Fallback: try to extract destination directly from page after solve attempt
      const dest = await page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const b64s = html.match(/aHR0cHM6Ly9[A-Za-z0-9+\/=]+/g) || [];
        for (const b of b64s) { try { const d = atob(b); if (d.startsWith("http") && !/tpi\.(li|ac)|oii\.la/i.test(d)) return d; } catch {} }
        return null;
      });
      if (dest) return dest;
    }

    // Generic fallback: look for any http link that is not shortlink
    const generic = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const m = html.match(/window\.location\.href\s*=\s*["'](https?:\/\/[^"']+)["']/);
      if (m && !/tpi\.(li|ac)|oii\.la|sfl\.(gl|link)|ouo|linkvertise/i.test(m[1])) return m[1];
      return null;
    });
    if (generic) return generic;

    return null;
  } catch (e) {
    log("Vercel puppeteer error: " + e.message);
    return null;
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

const SERVICE_MAP = [
  { name: "OUO", match: /ouo\.(io|press)/, strategy: "ouo", fast: true },
  { name: "TPI", match: /tpi\.(li|ac)|srtam\.com|oii\.la|clksz\.com|clk\.sh|srnky\.com|move2link\.co/, strategy: "tpi", fast: true },
  { name: "Linkvertise", match: /linkvertise\.com|link-target\.net|link-center\.net|link-hub\.net|direct-link\.net/, strategy: "linkvertise", fast: false },
  { name: "PhpShortener", match: /zovo\.ink|vuotlink\.xyz|oklink2\.online/, strategy: "phpshortener", fast: false },
  { name: "ShrinkMe", match: /shrinkme\.(io|click)|shrinke\.me/, strategy: "shrinkme", fast: false },
  { name: "Shorte.st", match: /shorte\.st|sh\.st/, strategy: "countdown-click", fast: false },
  { name: "Adf.ly", match: /adf\.ly/, strategy: "countdown-click", fast: false },
  { name: "GPLinks", match: /gplinks?\.(com|co|net)|mitly\.us|cutp\.in|fc\.lc|za\.gl|tnlink\.in/, strategy: "countdown-form", fast: false },
  { name: "Adtival", match: /pndk\.to|urlwebsite\.com/, strategy: "livewire", fast: false },
  { name: "Safelinku", match: /tutwuri\.id|khaddavi\.net|safelinku\.(com|net)/, strategy: "livewire", fast: false },
  { name: "KhaddaviForm", match: /sfl\.(gl|link)|khaddavi\.net|safelinku\.(com|net)/, strategy: "form-submit", fast: false },
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

      if (service.strategy === "tpi") {
        const tpiResult = await this._tpiHttp(url, log);
        if (tpiResult) {
          log("TPI HTTP: " + (Date.now() - t0) + "ms -> " + tpiResult);
          return { success: true, url: tpiResult, service: service.name, logs, time: Date.now() - t0 };
        }

        // Primary: TPI Fast (nodriver + CDP clicks)
        const tpiFastResult = await solveViaTpiFast(url, log);
        if (tpiFastResult) {
          log("TPI Fast: " + (Date.now() - t0) + "ms -> " + tpiFastResult);
          return { success: true, url: tpiFastResult, service: service.name, logs, time: Date.now() - t0 };
        }

        // Fallback: old nodriver TPI Service
        const tpiServiceResult = await solveViaTpiService(url, log);
        if (tpiServiceResult) {
          log("TPI Service: " + (Date.now() - t0) + "ms -> " + tpiServiceResult);
          return { success: true, url: tpiServiceResult, service: service.name, logs, time: Date.now() - t0 };
        }

        // Fallback to Puppeteer if available
        if (PUPPETEER_SERVICE_URL) {
          log("TPI HTTP failed, trying Puppeteer TPI solver...");
          const tpiPpResult = await this._tpiPuppeteer(url, log);
          if (tpiPpResult) {
            log("Puppeteer TPI: " + (Date.now() - t0) + "ms -> " + tpiPpResult);
            return { success: true, url: tpiPpResult, service: service.name, logs, time: Date.now() - t0 };
          }
          log("Puppeteer TPI failed");
        }

        // Final fallback: direct nodriver bypass (spawns bypass_nodriver.py)
        log("All TPI services failed, trying direct nodriver bypass...");
        const nodriverResult = await runNodriverBypass(url, log);
        if (nodriverResult) {
          log("Nodriver bypass: " + (Date.now() - t0) + "ms -> " + nodriverResult);
          return { success: true, url: nodriverResult, service: service.name, logs, time: Date.now() - t0 };
        }

        return { success: false, error: "TPI bypass failed - all methods exhausted", logs, time: Date.now() - t0 };
      }

      if (service.name === "OUO") {
        const fbcResult = await this._tryFbcRedirect(url, log);
        if (fbcResult) {
          log("FBC redirect: " + (Date.now() - t0) + "ms -> " + fbcResult);
          return { success: true, url: fbcResult, service: service.name, logs, time: Date.now() - t0 };
        }
        if (PUPPETEER_SERVICE_URL) {
          log("FBC failed, calling Puppeteer OUO solver...");
          const ppResult = await this._ouoPuppeteer(url, log);
          if (ppResult) {
            log("Puppeteer OUO: " + (Date.now() - t0) + "ms -> " + ppResult);
            return { success: true, url: ppResult, service: service.name, logs, time: Date.now() - t0 };
          }
        }
        return { success: false, error: "OUO bypass failed - Cloudflare or no link found", logs, time: Date.now() - t0 };
      }

      log("Fetching via HTTP...");
      const { finalUrl, html } = await followRedirects(url);
      log("Final URL: " + finalUrl);

      if (!html) {
        // Check if it's a WAF/Cloudflare block that returned empty html due to error handling
        if (/sfl\.(gl|link)|khaddavi\.net|safelinku/i.test(url)) {
          // Try domain fallback: sfl.link -> sfl.gl (same alias db) if original was sfl.link
          if (/sfl\.link/i.test(url)) {
            const altUrl = url.replace(/sfl\.link/i, "sfl.gl");
            log(`No HTML for sfl.link, trying fallback -> ${altUrl}`);
            try {
              const altResult = await this.visit(altUrl);
              if (altResult && altResult.success) {
                log(`Fallback success via sfl.gl -> ${altResult.url}`);
                return { ...altResult, logs: [...logs, ...altResult.logs] };
              }
            } catch {}
          }
          if (PUPPETEER_SERVICE_URL) {
            log("No HTML but sfl/khaddavi link -> trying Puppeteer");
            const ppFallback = await this._genericPuppeteer(url, log);
            if (ppFallback) return { success: true, url: ppFallback, service: service.name, logs, time: Date.now() - t0 };
          }
        }
        return { success: false, error: "No HTML response", logs, time: Date.now() - t0 };
      }

      const title = this._title(html);
      log("Title: " + title);

      // Detect WAF/Cloudflare/ Human Verification
      const isWaf = html.includes("Human Verification") || html.includes("gokuProps") || html.includes("AwsWaf") || html.includes("captcha-container") || html.includes("x-amzn-waf");
      if (this._isCloudflare(title) || isWaf) {
        log(isWaf ? "WAF/Human Verification detected" : "Cloudflare detected");
        if (/shrinkme\.click|shrinke\.me/.test(url)) {
          log("Trying Python bypass service for shrinkme...");
          const pyResult = await this._shrinkmeHttp(url, log);
          if (pyResult) {
            return { success: true, url: pyResult, service: service.name, logs, time: Date.now() - t0 };
          }
        }
        // For sfl.* Cloudflare (Vercel IP flagged) - try cloudscraper / direct SFL handler before Puppeteer
        if (/sfl\.(gl|link)/i.test(url)) {
          log("Cloudflare on sfl, trying cloudscraper & direct SFL handler bypass...");
          // Try cloudscraper to get the initial form html without Cloudflare block
          try {
            const cloudscraper = require("cloudscraper");
            log("Fetching sfl via cloudscraper...");
            const csHtml = await cloudscraper.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } });
            if (csHtml && csHtml.includes("redirect.php")) {
              log("cloudscraper got form html, running SFL handler...");
              const SflHandler = require("./SflHandler");
              const sfl = new SflHandler();
              const $cs = load(csHtml);
              const found = await sfl.extract($cs, csHtml, url);
              if (found && found.redirect) {
                log("cloudscraper SFL success -> " + found.redirect);
                return { success: true, url: found.redirect, service: service.name, logs, time: Date.now() - t0 };
              }
              // Also try GenericOrganic's _formSubmitHttp with the cloudscraper html
              const csResult = await this._formSubmitHttp(url, csHtml, log);
              if (csResult) {
                log("cloudscraper _formSubmitHttp success -> " + csResult);
                return { success: true, url: csResult, service: service.name, logs, time: Date.now() - t0 };
              }
            } else {
              log("cloudscraper did not return form html");
            }
          } catch (e) {
            log("cloudscraper error: " + e.message);
          }
          // Try direct SFL handler bypass even with Cloudflare html (may fallback to sfl.gl)
          try {
            const SflHandler = require("./SflHandler");
            const sfl = new SflHandler();
            const $tmp = load(html);
            const found2 = await sfl.extract($tmp, html, url);
            if (found2 && found2.redirect) {
              log("Direct SFL handler success -> " + found2.redirect);
              return { success: true, url: found2.redirect, service: service.name, logs, time: Date.now() - t0 };
            }
          } catch (e) {
            log("Direct SFL error: " + e.message);
          }
          log("Trying Puppeteer for sfl/khaddavi WAF...");
        }
        const ppResult = await this._genericPuppeteer(url, log);
        if (ppResult) {
          log("Puppeteer generic solver: " + (Date.now() - t0) + "ms -> " + ppResult);
          return { success: true, url: ppResult, service: service.name, logs, time: Date.now() - t0 };
        }
        return { success: false, error: isWaf ? "WAF challenge detected - use Puppeteer (set PUPPETEER_SERVICE_URL) or try local bypass" : "Cloudflare challenge detected - Vercel IP flagged, retry locally or set PUPPETEER_SERVICE_URL / deploy to hnd1 region", logs, time: Date.now() - t0 };
      }

      const strategy = service.strategy === "auto" ? this._detectStrategy(html) : service.strategy;
      log("Strategy: " + strategy);

      const result = await this._runHttp(strategy, finalUrl, html, log);
      const elapsed = Date.now() - t0;

      if (result) {
        log("DONE " + elapsed + "ms -> " + result);
        return { success: true, url: result, service: service.name, logs, time: elapsed };
      }

      if (PUPPETEER_SERVICE_URL) {
        log("HTTP strategy failed, trying Puppeteer solver...");
        const ppResult = service.name === "TPI"
          ? await this._tpiPuppeteer(url, log)
          : await this._genericPuppeteer(url, log);
        if (ppResult) {
          log("Puppeteer solver: " + (Date.now() - t0) + "ms -> " + ppResult);
          return { success: true, url: ppResult, service: service.name, logs, time: Date.now() - t0 };
        }
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

  async _ouoPuppeteer(url, log) {
    try {
      const client = getClient({ timeout: 80000 });
      const res = await client.post(
        `${PUPPETEER_SERVICE_URL}/api/ouo`,
        { url, timeout: 75000 },
        { headers: { "Content-Type": "application/json" }, timeout: 75000 }
      );
      if (res.data?.success && res.data?.url) {
        return res.data.url;
      }
      log("Puppeteer OUO failed: " + JSON.stringify(res.data));
      return null;
    } catch (err) {
      log("Puppeteer OUO error: " + err.message);
      return null;
    }
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
      case "tpi": return this._tpiHttp(url, log);
      case "token-decode": return this._tokenDecodeHttp(url, html, log);
      case "linkvertise": return this._linkvertiseHttp(url, html, log);
      case "countdown-click": return this._countdownClickHttp(url, html, log);
      case "countdown-form": return this._countdownFormHttp(url, html, log);
      case "livewire": return this._livewireHttp(url, html, log);
      case "shrinkme": return this._shrinkmeHttp(url, log);
      case "phpshortener": return this._phpShortenerHttp(url, log);
      case "form-submit": return this._formSubmitHttp(url, html, log);
      default: return this._autoHttp(url, html, log);
    }
  }

  async _tpiHttp(url, log) {
    try {
      // Check HARDCODED destinations first (known aliases bypass captcha)
      const alias = url.match(/tpi\.(li|ac)\/([A-Za-z0-9]+)/)?.[2];
      if (alias) {
        const TpiHandler = require("./TpiHandler");
        const HARDCODED = TpiHandler.HARDCODED || {};
        if (HARDCODED[alias]) {
          log("TPI HARDCODED: " + HARDCODED[alias]);
          return HARDCODED[alias];
        }
      }

      const { html } = await followRedirects(url);
      if (!html) return null;

      const AD_RE = /taboola\.com|advertisingcamps\.com|hai8g\.com|warlessstarved\.com|peccaryentraps\.com|cloudfront\.net|googletagmanager\.com|googlesyndication\.com|rvpaste\.com|shrinkearn\.com|shrinkbixby\.com|etextpad\.com|reviewfoxy\.com|tvi\.la/i;
      const isAd = (u) => AD_RE.test(u);

      // Try token decode first - may contain destination
      const tokenMatch = html.match(/name="token" value="([^"]+)"/);
      if (tokenMatch) {
        const decoded = this._decodeToken(tokenMatch[1]);
        if (decoded && !isAd(decoded) && !this._isShortlink(decoded)) {
          log("TPI token decode: " + decoded);
          return decoded;
        }
      }

      // Base64 fallback before ad links - check if page already contains destination
      const b64 = this._extractB64(html);
      if (b64 && !isAd(b64)) {
        log("TPI base64 URL: " + b64);
        return b64;
      }

      // For TPI, onclick and banner anchors are always ads - do not treat as destination
      // They would lead to ad pages (hai8g, rvpaste etc). Destination is only available after captcha.
      const onclickMatch = html.match(/onclick\s*=\s*["']window\.open\s*\(\s*['"]([^'"]+)['"]/);
      if (onclickMatch) {
        log("TPI onclick found (ad, skipping): " + onclickMatch[1]);
      }
      const linkMatches = [...html.matchAll(/<a[^>]*href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*target\s*=\s*["']_blank["']/g)];
      if (linkMatches.length) {
        log("TPI found " + linkMatches.length + " banner links (ads, skipping): " + linkMatches.map(m=>m[1]).join(", "));
      }

      // No destination found via HTTP - try EzSolver with cookies from page
      log("TPI HTTP found no valid destination - trying EzSolver...");
      try {
        const { html: freshHtml, cookies: pageCookies } = await followRedirects(url);
        const skMatch = freshHtml?.match(/data-sitekey=["']([^"']+)/) || freshHtml?.match(/turnstile_site_key["']\s*:\s*["']([^"']+)/);
        const sitekey = skMatch?.[1] || "0x4AAAAAABpMIvjgfpDTfgEj";
        const ezToken = await solveViaEzSolver(url, sitekey, log);
        if (ezToken) {
          log("EzSolver token obtained, submitting form with page cookies...");
          const { getClient } = require("../utils/httpClient");
          const client = getClient({ timeout: 15000 });

          const tokenVal = freshHtml?.match(/name="token" value="([^"]+)"/)?.[1] || "";
          const aliasVal = freshHtml?.match(/name="alias" value="([^"]+)"/)?.[1] || url.split('/').pop();
          const c_dVal = freshHtml?.match(/name="c_d" value="([^"]+)"/)?.[1] || "";
          const c_tVal = freshHtml?.match(/name="c_t" value="([^"]+)"/)?.[1] || "";

          const cookieHeader = pageCookies ? Object.entries(pageCookies).map(([k,v])=>`${k}=${v}`).join("; ") : "";

          const params = new URLSearchParams({
            token: tokenVal, alias: aliasVal, c_d: c_dVal, c_t: c_tVal,
            ad_type: "2", visit_token: "", url: url,
            "cf-turnstile-response": ezToken, "g-recaptcha-response": ezToken,
          });

          const AD_RE2 = /taboola\.com|advertisingcamps\.com|hai8g\.com|warlessstarved\.com/i;
          const origin = new URL(url).origin;
          const endpoints = [
            `${origin}/links/go`,
            "https://shrinkearn.com/links/go",
            "https://clk.sh/links/go",
            "https://srnky.com/links/go",
            "https://tpi.li/links/go",
            "https://clk.sh/links/go",
          ];

          for (const ep of endpoints) {
            try {
              const headers = {
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": url, "Origin": origin,
                "X-Requested-With": "XMLHttpRequest",
              };
              if (cookieHeader) headers["Cookie"] = cookieHeader;
              const r = await client.post(ep, params.toString(), { headers });
              const data = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
              if (data?.url && data.url.startsWith("http") && !AD_RE2.test(data.url)) {
                log(`EzSolver API success via ${ep} -> ${data.url}`);
                return data.url;
              }
            } catch {}
          }
          log("EzSolver token obtained but API did not return destination");
        }
      } catch(e) { log(`EzSolver attempt error: ${e.message}`); }
      log("TPI HTTP found no valid destination - requires captcha solve");
      return null;
    } catch (err) {
      log("TPI HTTP error: " + err.message);
      return null;
    }
  }

  async _resolveRedirectPage(url, log) {
    try {
      const { html } = await followRedirects(url);
      if (!html) return null;

      // Meta refresh
      const metaRefresh = html.match(/http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["'][^"']*url=([^"'\s;]+)/i)
        || html.match(/content\s*=\s*["'][^"']*url=([^"'\s;]+)/i);
      if (metaRefresh && metaRefresh[1].startsWith('http')) {
        log("Meta refresh: " + metaRefresh[1]);
        const { finalUrl } = await followRedirects(metaRefresh[1]);
        return finalUrl || metaRefresh[1];
      }

      // JS redirect
      const jsRedirect = html.match(/window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)/);
      if (jsRedirect) {
        log("JS redirect: " + jsRedirect[1]);
        const { finalUrl } = await followRedirects(jsRedirect[1]);
        return finalUrl || jsRedirect[1];
      }

      // location.replace
      const locationReplace = html.match(/location\.replace\(\s*["']([^"']+)/);
      if (locationReplace && locationReplace[1].startsWith('http')) {
        log("Location replace: " + locationReplace[1]);
        const { finalUrl } = await followRedirects(locationReplace[1]);
        return finalUrl || locationReplace[1];
      }

      return null;
    } catch (err) {
      log("Resolve redirect error: " + err.message);
      return null;
    }
  }

  async _tpiPuppeteer(url, log) {
    if (PUPPETEER_SERVICE_URL) {
      try {
        const client = getClient({ timeout: 80000 });
        const res = await client.post(
          `${PUPPETEER_SERVICE_URL}/api/tpi`,
          { url, timeout: 75000 },
          { headers: { "Content-Type": "application/json" }, timeout: 75000 }
        );
        if (res.data?.success && res.data?.url) {
          return res.data.url;
        }
        log("Puppeteer TPI failed: " + (res.data?.error || "unknown"));
      } catch (err) {
        log("Puppeteer TPI error: " + err.message);
      }
    }
    // Fallback to direct Vercel puppeteer-core (no external service)
    if (process.env.VERCEL || !PUPPETEER_SERVICE_URL) {
      log("Trying direct Vercel puppeteer-core for TPI/OII...");
      const direct = await solveViaVercelPuppeteer(url, log, 28000);
      if (direct) {
        log("Vercel puppeteer TPI success -> " + direct);
        return direct;
      }
      log("Vercel puppeteer TPI failed");
    }
    return null;
  }

  async _genericPuppeteer(url, log) {
    if (PUPPETEER_SERVICE_URL) {
      try {
        const client = getClient({ timeout: 80000 });
        const res = await client.post(
          `${PUPPETEER_SERVICE_URL}/api/bypass`,
          { url, timeout: 75000, strategy: "generic" },
          { headers: { "Content-Type": "application/json" }, timeout: 75000 }
        );
        const data = res.data;
        if (data && data.success && data.url) {
          return data.url;
        }
        log("Generic solver failed: " + (data?.error || "unknown"));
      } catch (err) {
        log("Generic solver error: " + err.message);
      }
    }
    // Fallback to direct Vercel puppeteer-core (for SFL Cloudflare on Vercel)
    if (process.env.VERCEL || !PUPPETEER_SERVICE_URL) {
      log("Trying direct Vercel puppeteer-core for generic...");
      const direct = await solveViaVercelPuppeteer(url, log, 25000);
      if (direct) {
        log("Vercel puppeteer generic success -> " + direct);
        return direct;
      }
      log("Vercel puppeteer generic failed");
    }
    return null;
  }

  async _formSubmitHttp(url, html, log) {
    try {
      const $ = load(html);
      const form = $("form").first();
      if (!form.length) return null;
      const action = form.attr("action");
      if (!action) return null;
      const method = (form.attr("method") || "GET").toUpperCase();
      const formData = {};
      form.find("input, select, textarea").each(function () {
        const name = $(this).attr("name");
        if (name) formData[name] = $(this).val() || "";
      });
      const actionUrl = action.startsWith("http") ? action : new URL(action, url).href;
      const target = new URL(actionUrl);
      if (method === "GET") {
        for (const [k, v] of Object.entries(formData)) target.searchParams.set(k, v);
      }
      log("Form submit -> " + target.href);
      const { finalUrl, steps, cookies, html: finalHtml } = await followRedirects(target.href, 10);
      if (steps.length > 1) {
        log("Redirect steps: " + steps.map((s) => s.url).join(" -> "));
      }
      log("Final URL after form: " + finalUrl);

      // If we landed on khaddavi / safelinku article, try full Khaddavi API chain
      if (finalUrl && /khaddavi\.net|safelinku\.com/i.test(finalUrl)) {
        log("Detected Khaddavi/Safelinku article -> trying API chain (session/verify/go)");
        const apiResult = await this._khaddaviChain(url, finalUrl, cookies, finalHtml, log);
        if (apiResult) {
          log("Khaddavi chain success -> " + apiResult);
          return apiResult;
        }
        log("Khaddavi API chain failed, falling back to HTML parsing");
        // Try to extract destination directly from article HTML
        const b64 = this._extractB64(finalHtml || "");
        if (b64) {
          log("B64 fallback -> " + b64);
          return b64;
        }
        // Puppeteer fallback if available
        if (PUPPETEER_SERVICE_URL) {
          log("Trying Puppeteer for Khaddavi...");
          const pp = await this._genericPuppeteer(url, log);
          if (pp) return pp;
        }
      }

      if (finalUrl && finalUrl.startsWith("http") && !/khaddavi\.net\/redirect\.php/.test(finalUrl)) {
        // Check if finalUrl is actually article but we want ready/go destination
        // If finalUrl is khaddavi article without bypass, return it as fallback (old behavior)
        return finalUrl.replace(/\/+$/, "");
      }
      return finalUrl?.startsWith("http") ? finalUrl.replace(/\/+$/, "") : null;
    } catch (err) {
      log("Form submit error: " + err.message);
      return null;
    }
  }

  async _khaddaviChain(originalUrl, articleUrl, cookies, articleHtml, log) {
    try {
      const crypto = require("crypto");
      const client = getClient({ timeout: 15000 });
      // Build cookie header from followRedirects cookies
      const buildCookie = (ck) => Object.entries(ck || {}).map(([k,v])=>`${k}=${v}`).join("; ");
      let cookieHeader = buildCookie(cookies);

      // Extract XSRF-TOKEN (last one wins, decodeURIComponent)
      let xsrfRaw = "";
      if (cookies && cookies["XSRF-TOKEN"]) xsrfRaw = cookies["XSRF-TOKEN"];
      // Also try to get from articleHtml set-cookie meta? fallback: parse from response headers already in cookies
      // Need to decode as JS does: decodeURIComponent
      let xsrfDec = "";
      try { xsrfDec = decodeURIComponent(xsrfRaw); } catch { xsrfDec = xsrfRaw; }
      if (!xsrfDec) {
        log("Khaddavi: no XSRF-TOKEN found in cookies");
        return null;
      }

      // Generate dummy fingerprint hash (SHA256 of random + timestamp)
      const fingerprintSeed = `${Date.now()}-${Math.random()}-${originalUrl}`;
      const hashHex = crypto.createHash("sha256").update(fingerprintSeed).digest("hex");
      const u = "#" + Buffer.from(hashHex).toString("base64");
      const tokenStr = xsrfDec.slice(0, 128 - u.length) + u;

      log(`Khaddavi session _token len=${tokenStr.length} u=${u.slice(0,20)}...`);

      const baseHeaders = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": articleUrl,
        "Origin": "https://app.khaddavi.net",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      };
      if (cookieHeader) baseHeaders["Cookie"] = cookieHeader;

      // Keep track of updated cookies via response set-cookie
      const updateCookies = (res) => {
        const setCookies = res.headers?.["set-cookie"];
        if (setCookies) {
          for (const c of setCookies) {
            const [kv] = c.split(";");
            const idx = kv.indexOf("=");
            if (idx > -1) {
              const k = kv.slice(0, idx).trim();
              const v = kv.slice(idx + 1).trim();
              cookies[k] = decodeURIComponent(v);
            }
          }
          cookieHeader = buildCookie(cookies);
          baseHeaders["Cookie"] = cookieHeader;
        }
      };

      // 1. POST /api/session
      log("POST /api/session");
      let sessRes;
      try {
        sessRes = await client.post("https://app.khaddavi.net/api/session", JSON.stringify({ _token: tokenStr }), {
          headers: baseHeaders,
          validateStatus: s => s < 500,
        });
        updateCookies(sessRes);
      } catch (e) {
        log("session error: " + e.message);
        return null;
      }
      const sessData = typeof sessRes.data === "string" ? JSON.parse(sessRes.data) : sessRes.data;
      log("session response: " + JSON.stringify(sessData).slice(0,400));
      if (!sessData || typeof sessData.step === "undefined") {
        log("Invalid session response");
        return null;
      }
      if (sessData.captcha && sessData.captcha !== null) {
        log(`Khaddavi captcha required: ${sessData.captcha} -> need browser/solver`);
        // Try EzSolver for turnstile if available
        if (sessData.captcha === "turnstile") {
          const sitekey = sessData.captcha_key || "0x4AAAAAAA...";
          // attempt EzSolver if configured
          const ezToken = await solveViaEzSolver(articleUrl, sitekey, log).catch(()=>null);
          if (ezToken) {
            log("EzSolver got token, retrying verify with captcha");
            // Will handle in verify step
          } else if (PUPPETEER_SERVICE_URL) {
            log("Fallback to Puppeteer for turnstile");
            const pp = await this._genericPuppeteer(originalUrl, log);
            if (pp) return pp;
            return null;
          } else {
            log("No solver for captcha, aborting");
            return null;
          }
        } else {
          log("Custom captcha required -> need Puppeteer");
          if (PUPPETEER_SERVICE_URL) {
            const pp = await this._genericPuppeteer(originalUrl, log);
            if (pp) return pp;
          }
          return null;
        }
      }

      // 2. POST /api/verify
      log("POST /api/verify");
      let verifyRes;
      try {
        const verifyPayload = { _a: 0 };
        // if captcha solved via ezToken, include it (handled above - but we didn't store)
        verifyRes = await client.post("https://app.khaddavi.net/api/verify", JSON.stringify(verifyPayload), {
          headers: { ...baseHeaders, "Referer": articleUrl },
          validateStatus: s => s < 500,
        });
        updateCookies(verifyRes);
      } catch (e) {
        log("verify error: " + e.message);
        return null;
      }
      const verifyData = typeof verifyRes.data === "string" ? JSON.parse(verifyRes.data) : verifyRes.data;
      log("verify response: " + JSON.stringify(verifyData).slice(0,500));
      // verify returns { message:"OK", target:"https://app.khaddavi.net/redirect.php?ray_id=..." }
      // That target is not final destination, just signals success. Next step is /api/go
      if (!verifyData || verifyData.message !== "OK") {
        // Might still proceed to /api/go even if verify not OK? Check
        log("Verify not OK, attempting /api/go anyway");
      }

      // 3. POST /api/go
      log("POST /api/go");
      const goPayload = {
        key: Math.floor(Math.random()*1000),
        size: `${Math.floor(1200+Math.random()*400)}.${Math.floor(800+Math.random()*400)}`,
        ado: null,
      };
      let goRes;
      try {
        goRes = await client.post("https://app.khaddavi.net/api/go", JSON.stringify(goPayload), {
          headers: { ...baseHeaders, "Referer": articleUrl },
          validateStatus: s => s < 500,
        });
        updateCookies(goRes);
      } catch (e) {
        log("go error: " + e.message);
        return null;
      }
      const goData = typeof goRes.data === "string" ? JSON.parse(goRes.data) : goRes.data;
      log("go response: " + JSON.stringify(goData).slice(0,600));
      const readyUrl = goData?.url;
      if (!readyUrl || !readyUrl.startsWith("http")) {
        log("No ready URL in go response");
        return null;
      }
      log("Ready URL: " + readyUrl);

      // 4. GET ready/go page (on sfl.gl or sfl.link) -> extract final destination
      // This page is on sfl.* domain, need to fetch with appropriate cookies
      // Reuse same cookie jar but note domain difference - just send same cookies + new cookies for sfl domain
      const readyHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Referer": articleUrl,
      };
      if (cookieHeader) readyHeaders["Cookie"] = cookieHeader;
      let readyRes;
      try {
        readyRes = await client.get(readyUrl, {
          headers: readyHeaders,
          maxRedirects: 5,
          validateStatus: s => s < 400 || s === 302 || s === 301,
        });
      } catch (e) {
        // If it threw redirect, try followRedirects
        if (e.response?.headers?.location) {
          const loc = e.response.headers.location;
          log("Ready redirect via location: " + loc);
          return loc.startsWith("http") ? loc : new URL(loc, readyUrl).href;
        }
        log("ready fetch error: " + e.message);
        return null;
      }
      const readyHtml = typeof readyRes.data === "string" ? readyRes.data : "";
      log("Ready page len=" + readyHtml.length);
      // Check for redirect location header
      if (readyRes.headers?.location) {
        const loc = readyRes.headers.location;
        log("Ready location header: " + loc);
        if (loc.startsWith("http") && !/sfl\.(gl|link)/i.test(loc)) return loc;
      }
      // Extract window.location.href = "https://..."
      const jsRedir = readyHtml.match(/window\.location\.href\s*=\s*["']([^"']+)["']/);
      if (jsRedir) {
        let dest = jsRedir[1].replace(/\\\//g, "/").replace(/\\"/g, '"');
        try { dest = JSON.parse('"' + dest.replace(/"/g, '\\"') + '"'); } catch {}
        // Also handle unicode escaped
        dest = dest.replace(/\\u002F/g, "/");
        log("Extracted js redirect: " + dest);
        if (dest.startsWith("http") && !/sfl\.(gl|link)|khaddavi|safelinku/i.test(dest)) return dest;
        if (dest.startsWith("http")) {
          // If still internal, follow it
          const { finalUrl } = await followRedirects(dest, 5);
          if (finalUrl && !/sfl\.(gl|link)|khaddavi/i.test(finalUrl)) return finalUrl;
          return dest;
        }
      }
      // Also try <a href> in page
      const hrefMatch = readyHtml.match(/href\s*=\s*["'](https?:\/\/[^"']+)["']/g);
      if (hrefMatch) {
        for (const h of hrefMatch) {
          const u2 = h.match(/href\s*=\s*["']([^"']+)["']/)[1];
          if (u2.startsWith("http") && !/sfl\.(gl|link)|khaddavi|safelinku|googletagmanager|facebook|google/i.test(u2)) {
            log("Found href candidate: " + u2);
            return u2;
          }
        }
      }
      // Generic b64 fallback
      const b64 = this._extractB64(readyHtml);
      if (b64) {
        log("B64 from ready page: " + b64);
        return b64;
      }
      log("Could not extract final from ready page");
      return null;
    } catch (err) {
      log("Khaddavi chain error: " + err.message);
      return null;
    }
  }

  async _phpShortenerHttp(url, log) {
    try {
      const PhpShortenerHandler = require("./PhpShortenerHandler");
      const handler = new PhpShortenerHandler();
      log("Running PHP shortener flow...");
      const dest = await handler.solve(url);
      if (dest) {
        log("PHP shortener OK -> " + dest);
        return dest;
      }
      log("PHP shortener returned no destination");
      return null;
    } catch (err) {
      log("PHP shortener error: " + err.message);
      return null;
    }
  }

  async _shrinkmeHttp(url, log) {
    const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "https://shortlink-python.fly.dev";
    try {
      log("Calling Python bypass service...");
      const client = getClient({ timeout: 65000 });
      const res = await client.post(`${PYTHON_SERVICE_URL}/api/shrinkme`, { url }, {
        headers: { "Content-Type": "application/json" },
        timeout: 60000,
      });
      if (res.data?.success && res.data?.url) {
        log("Python service OK -> " + res.data.url);
        return res.data.url;
      }
      log("Python service failed: " + JSON.stringify(res.data));
      return null;
    } catch (err) {
      log("Python service error: " + err.message);
      return null;
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

    // New GraphQL flow (handles WaitTask-only links instantly)
    try {
      const { bypassViaGraphql } = require("./LinkvertiseHandler");
      const result = await bypassViaGraphql(url);
      if (result?.url) return result.url;
      if (result?.needsAds) {
        log("Linkvertise requires ad interaction or premium");
      }
    } catch (e) {
      log("Linkvertise GraphQL error: " + e.message);
    }

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

    if (PUPPETEER_SERVICE_URL) {
      log("HTTP failed, calling Puppeteer service...");
      const result = await callPuppeteerService(url);
      if (result && result.success && result.url) {
        log("Puppeteer service returned: " + result.url);
        return result.url;
      }
      log("Puppeteer service failed: " + (result?.error || "unknown"));
    }

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
  _isShortlink(u) { return /ouo\.(io|press)|linkvertise|shrinkme|shorte\.st|sh\.st|adf\.ly|bc\.vc|gplinks?|safelinku|sfl\.(gl|link)|khaddavi|exe\.io|tei\.ai|tpi\.(li|ac)|advertisingcamps|cekresi\.me|insurance\./.test(u); }
  _title(h) { return h.match(/<title>(.*?)<\/title>/i)?.[1] || ""; }
}

module.exports = new GenericOrganic();
