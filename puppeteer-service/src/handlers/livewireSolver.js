async function solveLivewire(browser, url, timeout = 30000) {
  const t0 = Date.now();
  let page = null;

  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    let capturedLink = null;

    await page.exposeFunction("__captureLink", (link) => {
      if (link && !capturedLink) {
        const urlMatch = String(link).match(/https?:\/\/[^\s"',\]]+/);
        if (urlMatch) {
          capturedLink = urlMatch[0].replace(/\/+$/, "");
        }
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await delay(2000, 3000);

    const origUrl = page.url();
    const html = await page.content();

    if (!html.includes("Livewire") && !html.includes("livewire") && !html.includes("wire:")) {
      return { success: false, error: "No Livewire component found", elapsed: Date.now() - t0 };
    }

    await page.evaluateOnNewDocument(() => {
      const origOn = window.Livewire?.on;
      if (origOn) {
        window.Livewire.on = function (event, cb) {
          if (event === "setLink") {
            origOn.call(this, event, (link) => {
              window.__captureLink(link);
              cb(link);
            });
          } else {
            origOn.call(this, event, cb);
          }
        };
      }
    });

    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    await delay(2000, 3000);

    if (capturedLink) {
      return { success: true, url: capturedLink, elapsed: Date.now() - t0 };
    }

    const maxWait = timeout - (Date.now() - t0);
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      if (capturedLink) {
        return { success: true, url: capturedLink, elapsed: Date.now() - t0 };
      }

      const cur = page.url();
      if (cur !== origUrl && !cur.includes("chrome-error") && cur.startsWith("http")) {
        const isAd = /google\.com|facebook\.com|doubleclick|adservice|pagead|cekresi\.me|insurance\./.test(cur);
        if (!isAd) {
          return { success: true, url: cur, elapsed: Date.now() - t0 };
        }
      }

      await delay(1000, 1500);
    }

    if (capturedLink) {
      return { success: true, url: capturedLink, elapsed: Date.now() - t0 };
    }

    const finalHtml = await page.content();
    const b64Match = finalHtml.match(/aHR0cHM6Ly9[A-Za-z0-9+\/=]+/g);
    if (b64Match) {
      for (const b of b64Match) {
        try {
          const decoded = Buffer.from(b, "base64").toString("utf-8");
          if (decoded.startsWith("http") && !decoded.includes("cekresi") && !decoded.includes("datapendidikan")) {
            return { success: true, url: decoded, elapsed: Date.now() - t0 };
          }
        } catch {}
      }
    }

    return { success: false, error: "Timeout: setLink not received", elapsed: Date.now() - t0 };
  } catch (err) {
    return { success: false, error: err.message, elapsed: Date.now() - t0 };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

function delay(min, max) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
}

module.exports = { solveLivewire };
