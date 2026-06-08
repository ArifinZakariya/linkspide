const { load } = require("cheerio");
const { getClient } = require("../utils/httpClient");

let puppeteer = null;
try { puppeteer = require("puppeteer"); } catch {}

class OuoSolver {
  get name() { return "ouo-solver"; }
  isAvailable() { return !!puppeteer; }

  async solve(url) {
    const logs = [];
    const log = (m) => { logs.push(m); console.log("[OUO]", m); };

    if (!puppeteer) return { success: false, error: "Puppeteer not installed", logs };

    let browser = null;
    try {
      const launchOpts = {
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      };
      if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
      browser = await puppeteer.launch(launchOpts);

      const page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 768 });
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });

      log("Loading " + url);
      await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 }).catch(() => {});
      await this._delay(3000, 5000);

      let html = await page.content();
      let title = this._title(html);
      log("Title: " + title);

      if (title.includes("Just a moment")) {
        log("Cloudflare, waiting...");
        for (let i = 0; i < 15; i++) {
          await this._delay(2000, 3000);
          html = await page.content();
          title = this._title(html);
          if (!title.includes("Just a moment")) { log("CF passed!"); break; }
        }
      }

      const $ = load(html);
      const form1 = $("form").first();
      if (!form1.length) return { success: false, error: "No form found", logs };

      const action1 = form1.attr("action");
      log("Form 1: " + action1);

      log("Clicking 'I'm a human'...");
      await page.evaluate(() => document.querySelector("#btn-main")?.click());

      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      await this._delay(2000, 4000);

      let currentUrl = page.url();
      log("After click: " + currentUrl);

      if (currentUrl.includes("/go/")) {
        const $2 = load(await page.content());
        const form2 = $2("form").first();
        const action2 = form2.attr("action");

        if (action2) {
          log("Form 2: " + action2);
          log("Submitting form 2...");

          await page.evaluate(() => {
            const form = document.querySelector("form");
            if (form) form.submit();
          });

          await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
          await this._delay(3000, 5000);

          currentUrl = page.url();
          log("After form 2: " + currentUrl);
        }
      }

      const allPages = await browser.pages();
      for (const p of allPages) {
        try {
          const u = p.url();
          if (u && u !== "about:blank" && !u.includes("ouo.io") && !u.includes("ouo.press")) {
            log("Found: " + u);
            return { success: true, url: u, logs };
          }
        } catch {}
      }

      if (!currentUrl.includes("ouo.io") && !currentUrl.includes("ouo.press") && currentUrl.startsWith("http")) {
        log("Left OUO! " + currentUrl);
        return { success: true, url: currentUrl, logs };
      }

      html = await page.content();
      const finalUrl = this._extractUrl(html);
      if (finalUrl) {
        log("Extracted: " + finalUrl);
        return { success: true, url: finalUrl, logs };
      }

      return { success: false, error: "Could not find destination", logs, currentUrl };

    } catch (err) {
      log("Error: " + err.message);
      return { success: false, error: err.message, logs };
    } finally {
      if (browser) try { await browser.close(); } catch {}
    }
  }

  _extractUrl(html) {
    const b64 = html.match(/aHR0cHM6Ly9[A-Za-z0-9+\/=]+/g);
    if (b64) {
      const seen = new Set();
      for (const b of b64) {
        if (seen.has(b)) continue;
        seen.add(b);
        try {
          const d = Buffer.from(b, "base64").toString("utf-8");
          if (d.startsWith("http") && !d.includes("ouo.io")) return d;
        } catch {}
      }
    }

    const jsUrl = html.match(/window\.location(?:\.href)?\s*=\s*["'](https?:\/\/(?!ouo\.io)[^"']+)/);
    if (jsUrl) return jsUrl[1];

    const $ = load(html);
    const link = $("a[href]").filter(function () {
      const h = $(this).attr("href") || "";
      return h.startsWith("http") && !h.includes("ouo.io") && !h.includes("google");
    }).first().attr("href");
    if (link) return link;

    return null;
  }

  _title(html) {
    return html.match(/<title>(.*?)<\/title>/i)?.[1] || "";
  }

  _delay(min, max) {
    return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
  }
}

module.exports = new OuoSolver();
