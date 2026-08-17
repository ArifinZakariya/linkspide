const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PROFILE_DIR = path.join(__dirname, "..", "..", ".cfclearance-profile");
const CONFIG_FILE = path.join(__dirname, "..", "..", ".cfclearance.json");

const AD_BLOCK_RE = /(google|facebook|doubleclick|adservice|pagead|a-ads|popads|propellerads|adsco|adsterra|clickadu|bemob|dtscout)/i;

function getChromePath() {
  const p = process.env.CHROME_PATH || (() => {
    const paths = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/app/chrome/chrome",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ];
    for (const q of paths) { try { if (fs.existsSync(q)) return q; } catch {} }
    return null;
  })();
  return p;
}

function realChromeUA() {
  const chromePath = getChromePath();
  if (!chromePath) return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
  try {
    const out = execSync(`"${chromePath}" --version`, { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).toString();
    const m = out.match(/Chrome\/(\d+)\./);
    if (m) {
      return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${m[1]}.0.0.0 Safari/537.36`;
    }
  } catch {}
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hasClearance() {
  return fs.existsSync(PROFILE_DIR) && fs.existsSync(path.join(PROFILE_DIR, "Default", "Network", "Cookies"));
}

function decodeJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function isValidDestination(u) {
  if (!u || !u.startsWith("http")) return false;
  if (/chrome-error|about:/.test(u)) return false;
  if (/move2link\.co/.test(u)) return false;
  if (AD_BLOCK_RE.test(u)) return false;
  return true;
}

async function solveMove2link(url, timeout = 60000) {
  const logs = [];
  const t0 = Date.now();
  const at = () => Date.now() - t0;

  if (!hasClearance()) {
    return {
      success: false,
      error: "No cf_clearance profile. Run: node capture-cfclearance.js",
      logs,
      elapsed: at(),
    };
  }

  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch {
    puppeteer = require("puppeteer-core");
  }

  const chromePath = getChromePath();
  const ua = realChromeUA();
  logs.push({ step: "ua", ua, at: at() });

  let browser = null;
  let page = null;
  try {
    const launchOpts = {
      headless: true,
      userDataDir: PROFILE_DIR,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1366,900"],
    };
    if (chromePath) launchOpts.executablePath = chromePath;

    browser = await puppeteer.launch(launchOpts);
    page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.setUserAgent(ua);

    page.on("dialog", (d) => d.dismiss().catch(() => {}));

    let captured = null;
    let jwtInfo = null;

    page.on("response", async (resp) => {
      try {
        const rurl = resp.url();
        if (resp.status() >= 300 && resp.status() < 400) {
          const loc = resp.headers().location;
          if (loc && /move2link\.co/.test(rurl) && isValidDestination(loc)) {
            logs.push({ step: "redirect", from: rurl, to: loc.slice(0, 150), at: at() });
            if (loc.includes("token=")) {
              const tok = loc.match(/token=([^&]+)/);
              if (tok) jwtInfo = decodeJwt(tok[1]);
            }
          }
        }
        if (/siendu\.com/.test(rurl) && /token=/.test(rurl)) {
          const tok = rurl.match(/token=([^&]+)/);
          if (tok) {
            jwtInfo = decodeJwt(tok[1]);
            if (jwtInfo) logs.push({ step: "jwt", fod: jwtInfo.fod, tad: jwtInfo.tad, puz: jwtInfo.puz, at: at() });
          }
        }
      } catch {}
    });

    logs.push({ step: "navigating", url, at: at() });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => logs.push({ step: "goto-err", err: e.message, at: at() }));

    logs.push({ step: "waiting-cloudflare", at: at() });
    const cfDeadline = Date.now() + 30000;
    while (Date.now() < cfDeadline) {
      const title = await page.title().catch(() => "");
      if (!/Just a moment/.test(title)) break;
      await delay(1500);
    }
    logs.push({ step: "cf-state", title: await page.title().catch(() => ""), url: page.url().slice(0, 150), at: at() });

    // wait for the flow to settle / redirect chain to finish
    const settleDeadline = Date.now() + 20000;
    let prev = "";
    while (Date.now() < settleDeadline) {
      const cur = page.url();
      if (cur !== prev) {
        logs.push({ step: "nav", url: cur.slice(0, 150), at: at() });
        prev = cur;
      }
      if (isValidDestination(cur) && !/siendu\.com/.test(cur)) break;
      await delay(1500);
    }

    const finalUrl = page.url();
    logs.push({ step: "done", url: finalUrl, at: at() });

    // Prefer JWT fod/tad (the actual destination) if present and valid
    let best = finalUrl;
    if (jwtInfo) {
      for (const k of ["fod", "tad", "fad"]) {
        if (jwtInfo[k] && /^https?:\/\//.test(jwtInfo[k]) && isValidDestination(jwtInfo[k])) {
          best = jwtInfo[k];
          logs.push({ step: "jwt-target", url: jwtInfo[k], at: at() });
          break;
        }
      }
    }

    if (/Just a moment/.test(await page.title().catch(() => ""))) {
      return { success: false, error: "Cloudflare challenge not cleared by profile", url: finalUrl, logs, elapsed: at() };
    }

    if (isValidDestination(best)) {
      return { success: true, url: best, logs, elapsed: at(), ua };
    }

    return { success: false, error: "No destination reached", url: finalUrl, logs, elapsed: at() };
  } catch (err) {
    return { success: false, error: err.message, logs, elapsed: at() };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { solveMove2link, hasClearance, realChromeUA, CONFIG_FILE }; 
