let puppeteer = null;
try {
  puppeteer = require("puppeteer");
} catch {}

class PuppeteerBypass {
  get name() {
    return "puppeteer";
  }

  isAvailable() {
    return !!puppeteer;
  }

  async autoBypass(url, opts = {}) {
    if (!puppeteer) {
      return { success: false, error: "Puppeteer not installed" };
    }

    let browser = null;
    try {
      browser = await puppeteer.launch({
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--window-size=1920,1080",
          "--disable-blink-features=AutomationControlled",
        ],
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
      );

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        window.chrome = { runtime: {} };
      });

      const timeout = opts.timeout || 45000;

      await page.goto(url, { waitUntil: "domcontentloaded", timeout });

      await this._sleep(3000);

      let html = "";
      try {
        html = await page.content();
      } catch {
        const pages = await browser.pages();
        if (pages.length > 0) {
          html = await pages[pages.length - 1].content();
        }
      }

      const title = html.match(/<title>(.*?)<\/title>/i)?.[1] || "";
      console.log("[Puppeteer] Title:", title);

      if (title.includes("Just a moment") || title.includes("Checking")) {
        console.log("[Puppeteer] Cloudflare detected, waiting...");
        for (let i = 0; i < 10; i++) {
          await this._sleep(2000);
          try {
            html = await page.content();
            const t = html.match(/<title>(.*?)<\/title>/i)?.[1] || "";
            if (!t.includes("Just a moment") && !t.includes("Checking")) {
              console.log("[Puppeteer] Cloudflare passed!");
              break;
            }
          } catch {
            const pages = await browser.pages();
            if (pages.length > 0) {
              html = await pages[pages.length - 1].content();
            }
          }
        }
      }

      await this._tryClickContinue(page);
      await this._sleep(2000);

      let finalUrl = "";
      try {
        finalUrl = page.url();
      } catch {
        const pages = await browser.pages();
        if (pages.length > 0) {
          finalUrl = pages[pages.length - 1].url();
        }
      }

      try {
        html = await page.content();
      } catch {
        const pages = await browser.pages();
        if (pages.length > 0) {
          html = await pages[pages.length - 1].content();
        }
      }

      console.log("[Puppeteer] Final URL:", finalUrl);
      console.log("[Puppeteer] HTML length:", html.length);
      console.log("[Puppeteer] Has form:", html.includes("/go/"));

      return {
        success: html.length > 100,
        url: finalUrl,
        html,
      };
    } catch (err) {
      console.log("[Puppeteer] Error:", err.message);
      return { success: false, error: err.message };
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
    }
  }

  async _tryClickContinue(page) {
    const selectors = [
      'button:contains("Continue")',
      'button:contains("Skip")',
      'button:contains("Proceed")',
      'button:contains("Get Link")',
      'button:contains("Click Here")',
      'button:contains("I\'m a human")',
      '[id*="btn-main"]',
      '[class*="btn-main"]',
      'button[type="submit"]',
    ];

    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.click().catch(() => {});
          await this._sleep(1000);
          return true;
        }
      } catch {}
    }

    try {
      await page.evaluate(() => {
        const buttons = document.querySelectorAll("button, a, [role='button']");
        for (const btn of buttons) {
          const text = (btn.textContent || "").toLowerCase();
          if (
            text.includes("continue") ||
            text.includes("skip") ||
            text.includes("proceed") ||
            text.includes("get link") ||
            text.includes("i'm a human") ||
            text.includes("verify")
          ) {
            btn.click();
            return true;
          }
        }
        return false;
      });
    } catch {}

    return false;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new PuppeteerBypass();
