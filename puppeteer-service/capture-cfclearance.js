/**
 * Capture cf_clearance cookie for move2link.co
 *
 * Usage:
 *   node capture-cfclearance.js <url>
 *
 * Steps:
 * 1. Opens a REAL Chrome window (no CDP/automation) so Cloudflare renders
 *    the interactive Turnstile widget for a human to solve.
 * 2. You solve the checkbox manually, wait for the page to pass, then CLOSE
 *    the Chrome window.
 * 3. Script reopens the SAME profile via puppeteer, reads the cf_clearance
 *    cookie, and saves it to .cfclearance.json (used by move2linkSolver).
 *
 * NOTE: cf_clearance is bound to your IP + User-Agent. The cookie only works
 * from this machine/browser. Re-run when it expires.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";

const PROFILE_DIR = path.join(__dirname, ".cfclearance-profile");
const CONFIG_FILE = path.join(__dirname, ".cfclearance.json");

async function main() {
  const url = process.argv[2] || "https://move2link.co/8d6b6f9";

  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  console.log("Opening REAL Chrome (no automation).");
  console.log("1. Solve the Cloudflare checkbox in the window.");
  console.log("2. Wait until the page loads (past 'Just a moment').");
  console.log("3. CLOSE the Chrome window when done.");

  const chrome = spawn(CHROME, [
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1366,900",
    url,
  ], { stdio: "ignore" });

  chrome.on("error", (e) => {
    console.error("Failed to launch Chrome:", e.message);
    process.exit(1);
  });

  const exited = new Promise((res) => chrome.on("exit", res));
  await exited;
  console.log("Chrome closed. Reading cookie via puppeteer...");

  const puppeteer = require("puppeteer-core");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME,
    userDataDir: PROFILE_DIR,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    let landed = null;
    let cfCookie = null;

    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const title = await page.title();
      const body = await page.evaluate(() => document.body && document.body.innerHTML.length || 0);
      console.log("Reopened ->", resp.status(), "title:", title, "bodyLen:", body);

      const cookies = await page.cookies();
      cfCookie = cookies.find((c) => c.name === "cf_clearance" && /move2link/.test(c.domain));
      if (cfCookie) {
        console.log("cf_clearance OK. domain:", cfCookie.domain, "expires:", new Date(cfCookie.expires * 1000).toISOString());
      } else {
        console.log("WARNING: no cf_clearance found in profile.");
        console.log("cookies:", cookies.map((c) => `${c.name}@${c.domain}`).join(", "));
      }

      if (!/Just a moment/.test(title)) {
        landed = page.url();
        console.log("Challenge already cleared. Final URL:", landed);
      }
    } catch (e) {
      console.log("Reopen nav error:", e.message);
    }

    const ua = await page.evaluate(() => navigator.userAgent);

    if (cfCookie) {
      const cfg = {
        domain: "move2link.co",
        cookie: cfCookie,
        ua,
        capturedAt: Date.now(),
        expiresAt: cfCookie.expires ? cfCookie.expires * 1000 : Date.now() + 60 * 60 * 1000,
      };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
      console.log("\nSaved to", CONFIG_FILE);
      console.log("Cookies need matching UA:", ua.slice(0, 60) + "...");
      if (landed) console.log("Also verified it passes: ", landed);
    } else {
      console.log("\nFAILED to capture cf_clearance. The cookie may not have been set.");
      console.log("Try again and make sure you fully solve + land past the challenge before closing.");
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});