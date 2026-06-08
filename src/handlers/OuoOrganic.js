let puppeteer = null;
try {
  puppeteer = require("puppeteer");
} catch {}

class OuoOrganic {
  get name() {
    return "ouo-organic";
  }

  isAvailable() {
    return !!puppeteer;
  }

  async visit(url, opts = {}) {
    if (!puppeteer) {
      return { success: false, error: "Puppeteer not installed" };
    }

    let browser = null;
    const logs = [];

    const log = (msg) => {
      logs.push(msg);
      console.log("[OUO]", msg);
    };

    try {
      const fs = require("fs");
      const launchOpts = {
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--window-size=1366,768",
          "--disable-blink-features=AutomationControlled",
          "--lang=en-US,en",
        ],
      };
      const chromePath = process.env.CHROME_PATH || (() => {
        const paths = [
          "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium-browser", "/usr/bin/chromium",
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ];
        for (const p of paths) { try { if (require("fs").existsSync(p)) return p; } catch {} }
        try {
          const r = require("child_process").execSync('find ~/.cache/puppeteer/chrome -name "chrome" -o -name "chrome.exe" 2>/dev/null | head -1', { encoding: "utf-8" }).trim();
          if (r) return r;
        } catch {}
        return null;
      })();
      if (chromePath) launchOpts.executablePath = chromePath;
      browser = await puppeteer.launch(launchOpts);

      const page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 768 });

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
      );

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
        window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
          parameters.name === "notifications"
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);
      });

      log("Opening " + url);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await this._humanDelay(2000, 4000);

      let html = await page.content();
      let title = this._getTitle(html);
      log("Page title: " + title);

      if (title.includes("Just a moment") || title.includes("Checking")) {
        log("Cloudflare detected, waiting for challenge...");
        await this._waitForCloudflare(page, 20000);
        html = await page.content();
        title = this._getTitle(html);
        log("After CF: " + title);
      }

      html = await page.content();
      title = this._getTitle(html);

      if (title.includes("Just a moment")) {
        log("Still on Cloudflare, trying to wait more...");
        await this._humanDelay(5000, 8000);
        html = await page.content();
        title = this._getTitle(html);
      }

      if (!html.includes("/go/")) {
        log("No OUO form found, checking page...");
        const hasTurnstile = html.includes("cf-turnstile") || html.includes("turnstile");
        if (hasTurnstile) {
          log("Turnstile captcha detected, waiting for solve...");
          await this._humanDelay(5000, 10000);
          html = await page.content();
        }
      }

      log("Simulating human behavior (scroll, mouse)...");
      await this._simulateHumanBehavior(page);

      log("Waiting for Turnstile token...");
      const turnstileReady = await this._waitForTurnstile(page, 15000);
      log("Turnstile ready: " + turnstileReady);

      html = await page.content();
      const hasForm = html.includes("/go/");
      log("Form found: " + hasForm);

      if (hasForm) {
        log("Waiting for countdown...");
        await this._waitForCountdown(page, 15000);

        log("Looking for continue button...");
        await this._humanDelay(1000, 2000);

        const clicked = await this._clickContinueButton(page);
        log("Button clicked: " + clicked);

        if (clicked) {
          log("Waiting for redirect...");
          await this._humanDelay(3000, 5000);

          html = await page.content();
          title = this._getTitle(html);
          log("After click: " + title);

          if (html.includes("/go/") || html.includes("/re/")) {
            log("Second page detected, waiting for Turnstile...");
            await this._waitForTurnstile(page, 15000);
            await this._humanDelay(2000, 3000);
            await this._clickContinueButton(page);
            await this._humanDelay(3000, 5000);
          }
        }
      }

      let finalUrl = "";
      try {
        finalUrl = page.url();
      } catch {}

      const pages = await browser.pages();
      for (const p of pages) {
        try {
          const u = p.url();
          if (u && u !== "about:blank") finalUrl = u;
        } catch {}
      }

      html = await page.content();
      title = this._getTitle(html);

      const isOuo = finalUrl.includes("ouo.io") || finalUrl.includes("ouo.press");
      const hasFinalForm = html.includes("/go/") || html.includes("/re/");

      if (isOuo && hasFinalForm) {
        log("Still on OUO, trying to extract destination...");
        const destUrl = this._extractDestination(html);
        if (destUrl) {
          log("Destination found: " + destUrl);
          return { success: true, url: destUrl, finalUrl, logs };
        }
      }

      const destUrl = this._extractDestination(html);
      if (destUrl) {
        log("Destination extracted: " + destUrl);
        return { success: true, url: destUrl, finalUrl, logs };
      }

      if (!isOuo || !hasFinalForm) {
        log("Left OUO! Final: " + finalUrl);
        return { success: true, url: finalUrl, finalUrl, logs };
      }

      log("Could not complete bypass");
      return { success: false, finalUrl, logs, error: "Still on OUO page" };

    } catch (err) {
      log("Error: " + err.message);
      return { success: false, error: err.message, logs };
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
    }
  }

  _getTitle(html) {
    const match = html.match(/<title>(.*?)<\/title>/i);
    return match ? match[1] : "";
  }

  _extractDestination(html) {
    const patterns = [
      /var\s+(?:dest|url|link|goto|target|redirect)\s*=\s*["']([^"']+)/i,
      /window\.location(?:\.href)?\s*=\s*["']([^"']+)/i,
      /location\.replace\s*\(\s*["']([^"']+)/i,
      /href\s*=\s*["'](https?:\/\/[^"']*(?!ouo\.io|ouo\.press|google|facebook)[^"']*)/i,
      /data-url\s*=\s*["']([^"']+)/i,
    ];

    for (const p of patterns) {
      const match = html.match(p);
      if (match && match[1].startsWith("http") && !match[1].includes("ouo.io")) {
        return match[1];
      }
    }

    const b64Match = html.match(/aHR0cHM6Ly9[A-Za-z0-9+\/=]+/);
    if (b64Match) {
      try {
        const decoded = Buffer.from(b64Match[0], "base64").toString("utf-8");
        if (decoded.startsWith("http")) return decoded;
      } catch {}
    }

    return null;
  }

  async _waitForCloudflare(page, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const html = await page.content();
        const title = this._getTitle(html);
        if (!title.includes("Just a moment") && !title.includes("Checking")) {
          return true;
        }
      } catch {}
      await this._humanDelay(2000, 3000);
    }
    return false;
  }

  async _waitForCountdown(page, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const btnDisabled = await page.evaluate(() => {
          const btn = document.querySelector('#btn-main, [class*="btn-main"]');
          if (!btn) return null;
          const isDisabled = btn.classList.contains("disabled") || btn.disabled;
          return isDisabled;
        });

        if (btnDisabled === false) {
          await this._humanDelay(500, 1000);
          return true;
        }
      } catch {}
      await this._humanDelay(1000, 2000);
    }
    return false;
  }

  async _clickContinueButton(page) {
    const selectors = [
      "#btn-main",
      'button:not(.disabled):not([disabled])',
      'a.btn-main',
      '[class*="btn-main"]',
      'button:has-text("Continue")',
      'button:has-text("Skip")',
      'button:has-text("Proceed")',
      'button:has-text("Get Link")',
      'button:has-text("I\'m a human")',
      'button[type="submit"]',
    ];

    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const isVisible = await el.isIntersectingViewport().catch(() => false);
          if (isVisible) {
            await this._humanDelay(200, 500);
            await el.click();
            log("Clicked: " + selector);
            return true;
          }
        }
      } catch {}
    }

    try {
      const clicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll("button, a, [role='button']");
        for (const btn of buttons) {
          const text = (btn.textContent || "").toLowerCase().trim();
          const isDisabled = btn.classList.contains("disabled") || btn.disabled;
          if (isDisabled) continue;
          if (
            text.includes("continue") ||
            text.includes("skip") ||
            text.includes("proceed") ||
            text.includes("get link") ||
            text.includes("i'm a human") ||
            text.includes("verify") ||
            text.includes("click here")
          ) {
            btn.click();
            return text;
          }
        }
        return null;
      });
      if (clicked) {
        log("Clicked by text: " + clicked);
        return true;
      }
    } catch {}

    return false;
  }

  async _simulateHumanBehavior(page) {
    try {
      await page.evaluate(() => {
        window.scrollBy(0, Math.random() * 300 + 100);
      });
      await this._humanDelay(500, 1000);

      await page.evaluate(() => {
        window.scrollBy(0, -(Math.random() * 200));
      });
      await this._humanDelay(300, 700);

      await page.mouse.move(
        Math.random() * 800 + 100,
        Math.random() * 400 + 100,
        { steps: 10 }
      );
      await this._humanDelay(200, 500);

      await page.mouse.move(
        Math.random() * 600 + 200,
        Math.random() * 300 + 150,
        { steps: 8 }
      );
      await this._humanDelay(300, 600);
    } catch {}
  }

  async _waitForTurnstile(page, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const token = await page.evaluate(() => {
          const el = document.querySelector("#x-token") || document.querySelector('[name="x-token"]');
          return el ? el.value : null;
        });
        if (token && token.length > 10) return true;
      } catch {}
      try {
        const hasTurnstile = await page.evaluate(() => !!document.querySelector(".cf-turnstile, [data-sitekey]"));
        if (!hasTurnstile) return true;
      } catch {}
      await this._humanDelay(500, 800);
    }
    return false;
  }

  _humanDelay(min, max) {
    const ms = Math.floor(Math.random() * (max - min) + min);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new OuoOrganic();
