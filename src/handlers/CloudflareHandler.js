let puppeteer = null;
try {
  puppeteer = require("puppeteer");
} catch {}

class CloudflareHandler {
  get name() {
    return "cloudflare";
  }

  canHandle(url) {
    return true;
  }

  isCloudflarePage(html) {
    return (
      html.includes("Just a moment") ||
      html.includes("cf-browser-verification") ||
      html.includes("cf_chl_opt") ||
      html.includes("challenge-platform")
    );
  }

  async bypass(url, opts = {}) {
    if (!puppeteer) {
      return {
        success: false,
        error: "Puppeteer not installed. Run: npm install puppeteer",
      };
    }

    let browser = null;
    try {
      const fs = require("fs");
      const launchOpts = {
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--window-size=1920,1080",
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
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
      );

      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

      await page.waitForFunction(
        () => !document.title.includes("Just a moment"),
        { timeout: 15000 }
      ).catch(() => {});

      const currentUrl = page.url();
      const html = await page.content();

      if (html.includes("Just a moment")) {
        return {
          success: false,
          url: currentUrl,
          error: "Cloudflare challenge could not be solved automatically",
        };
      }

      return {
        success: true,
        url: currentUrl,
        html,
      };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      if (browser) await browser.close();
    }
  }
}

module.exports = new CloudflareHandler();
