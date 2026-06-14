const express = require("express");
const { solveLivewire } = require("./handlers/livewireSolver");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3001;

let browser = null;

async function getBrowser() {
  if (browser && browser.connected) return browser;

  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch {
    puppeteer = require("puppeteer-core");
  }

  const chromePath = process.env.CHROME_PATH || (() => {
    const fs = require("fs");
    const paths = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/app/chrome/chrome",
    ];
    for (const p of paths) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  })();

  const launchOpts = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1366,768",
      "--disable-blink-features=AutomationControlled",
    ],
  };
  if (chromePath) launchOpts.executablePath = chromePath;

  browser = await puppeteer.launch(launchOpts);
  browser.on("disconnected", () => { browser = null; });
  return browser;
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", browser: browser?.connected ? "connected" : "disconnected" });
});

app.post("/api/bypass", async (req, res) => {
  const { url, strategy = "livewire", timeout = 30000 } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    const b = await getBrowser();
    const result = await solveLivewire(b, url, timeout);
    res.json(result);
  } catch (err) {
    console.error("[ERROR]", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Puppeteer service running on port ${PORT}`);
});

process.on("SIGTERM", async () => {
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
});
