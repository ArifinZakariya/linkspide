const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const OUO_RE = /ouo\.(io|press)/;

const AD_BLOCK_RE = /(google|facebook|doubleclick|adservice|pagead|a-ads|srvqk|clvrads|displayvertising|adsco|celeritascdn|uptimecdn|excavatenearbywand|driverhugoverblown|check\.html|runative|pubadx|adcash|mavineads|popads|propellerads|popsugar|adsterra|clickadu|bemob)/i;

function delay(min, max) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
}

async function waitForSelector(page, selector, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if (await page.$(selector)) return true;
    } catch {}
    await delay(800, 1200);
  }
  return false;
}

function isValidDestination(u) {
  if (!u || !u.startsWith("http")) return false;
  if (/chrome-error|about:|about:blank/.test(u)) return false;
  if (OUO_RE.test(u)) return false;
  if (AD_BLOCK_RE.test(u)) return false;
  return true;
}

function extractDestination(html, t0) {
  if (!html) return null;

  const meta = html.match(
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'\s;]+)/i
  );
  if (meta && isValidDestination(meta[1])) return meta[1];

  const jsRedirect = html.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)/);
  if (jsRedirect && isValidDestination(jsRedirect[1])) return jsRedirect[1];

  const locHref = html.match(/location\.href\s*=\s*["']([^"']+)/);
  if (locHref && isValidDestination(locHref[1])) return locHref[1];

  const b64s = html.match(/aHR0cHM6Ly9[A-Za-z0-9+/=]+/g);
  if (b64s) {
    for (const b of b64s) {
      try {
        const decoded = Buffer.from(b, "base64").toString("utf-8");
        if (isValidDestination(decoded)) return decoded;
      } catch {}
    }
  }

  return null;
}

async function solveOuo(browser, url, timeout = 60000) {
  const logs = [];
  const t0 = Date.now();
  const at = () => Date.now() - t0;
  let page = null;
  let captured = null;

  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(DESKTOP_UA);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      window.chrome = { runtime: {} };
    });

    page.on("dialog", (d) => d.dismiss().catch(() => {}));

    page.on("response", async (resp) => {
      try {
        const rurl = resp.url();
        if (/\/go\/|\/xreallcygo\//.test(rurl)) {
          const loc = resp.headers()["location"];
          logs.push({ step: "resp", url: rurl, status: resp.status(), loc: loc || null, at: at() });
          if (!captured && loc && isValidDestination(loc)) {
            captured = loc.startsWith("http") ? loc : new URL(loc, rurl).href;
            logs.push({ step: "captured-location", url: captured, at: at() });
            return;
          }
          if (!captured) {
            const body = await resp.text();
            const dest = extractDestination(body);
            if (dest) {
              captured = dest;
              logs.push({ step: "captured-body", url: dest, at: at() });
            }
          }
        }
      } catch {}
    });

    page.on("popup", async (popup) => {
      try {
        await popup.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
        let deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          let u = "";
          try { u = popup.url(); } catch {}
          if (isValidDestination(u) && !captured) {
            captured = u;
            logs.push({ step: "captured-popup-nav", url: u, at: at() });
            break;
          }
          await delay(400, 600);
        }
      } catch {}
    });

    logs.push({ step: "navigating", url, at: at() });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});

    logs.push({ step: "waiting-cloudflare", at: at() });
    const cfDeadline = Date.now() + 30000;
    while (Date.now() < cfDeadline) {
      const title = await page.title().catch(() => "");
      if (!/Just a moment/.test(title)) break;
      await delay(1500, 2500);
    }
    logs.push({ step: "cloudflare-cleared", url: page.url(), at: at() });

    if (await waitForSelector(page, "#btn-main", Math.max(5000, timeout - (Date.now() - t0)))) {
      logs.push({ step: "submitting-captcha", at: at() });
      await page.evaluate(() => {
        const btn = document.querySelector("#btn-main");
        if (btn) {
          btn.disabled = false;
          btn.click();
        }
      });
    }

    const hasFormGo = await waitForSelector(page, "#form-go", Math.max(8000, timeout - (Date.now() - t0)));
    logs.push({ step: "form-go-present", present: hasFormGo, at: at() });

    if (hasFormGo) {
      logs.push({ step: "waiting-countdown", at: at() });
      await delay(4200, 5000);

      if (!captured) {
        logs.push({ step: "submitting-go", at: at() });
        await page.evaluate(() => {
          const btn = document.querySelector("#form-go #btn-main");
          if (btn) {
            btn.disabled = false;
            btn.click();
            return;
          }
          const f = document.querySelector("#form-go");
          if (f) f.submit();
        });
      }
    }

    logs.push({ step: "waiting-destination", at: at() });
    const destDeadline = Date.now() + Math.max(10000, Math.min(25000, timeout - (Date.now() - t0)));
    let pollCount = 0;
    while (Date.now() < destDeadline) {
      if (captured) break;

      try {
        const cur = page.url();
        if (isValidDestination(cur)) {
          captured = cur;
          logs.push({ step: "captured-main-nav", url: cur, at: at() });
          break;
        }
      } catch {}

      const pages = await browser.pages();
      for (const p of pages) {
        if (p === page) continue;
        try {
          const u = p.url();
          if (isValidDestination(u)) {
            captured = u;
            logs.push({ step: "captured-popup", url: u, at: at() });
            break;
          }
        } catch {}
      }

      pollCount++;
      await delay(400, 600);
    }
    logs.push({ step: "poll-cycles", count: pollCount, at: at() });

    if (captured) {
      const clean = captured.replace(/\/+$/, "");
      logs.push({ step: "done", url: clean, at: at() });
      return { success: true, url: clean, logs, elapsed: at() };
    }

    const finalHtml = await page.content();
    const dest = extractDestination(finalHtml);
    if (dest) {
      logs.push({ step: "done", url: dest, at: at() });
      return { success: true, url: dest, logs, elapsed: at() };
    }

    return {
      success: false,
      error: "Timeout: could not reach destination",
      url: page.url(),
      logs,
      elapsed: at(),
    };
  } catch (err) {
    return { success: false, error: err.message, logs, elapsed: at() };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

module.exports = { solveOuo };
