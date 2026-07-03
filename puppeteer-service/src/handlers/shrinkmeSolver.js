async function solveShrinkme(browser, url, timeout = 45000) {
  let page = null;
  const logs = [];

  try {
    page = await browser.newPage();
    
    await page.setViewport({ width: 1366, height: 768 });
    
    // Anti-detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      window.chrome = { runtime: {} };
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    logs.push({ step: "navigating", url });

    // Navigate to shrinkme page
    await page.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
    logs.push({ step: "page-loaded" });

    // Wait for page to fully load and Cloudflare to resolve
    await new Promise((r) => setTimeout(r, 5000));

    // Check for Cloudflare challenge and wait
    const isCloudflare = await page.evaluate(() => {
      return document.title.includes("Just a moment") || 
             document.querySelector("#challenge-running") !== null ||
             document.querySelector(".cf-browser-verification") !== null;
    });

    if (isCloudflare) {
      logs.push({ step: "cloudflare-detected-waiting" });
      // Wait up to 20 seconds for Cloudflare to resolve
      try {
        await page.waitForFunction(
          () => !document.title.includes("Just a moment") && 
                document.querySelector("#challenge-running") === null,
          { timeout: 20000 }
        );
        logs.push({ step: "cloudflare-resolved" });
      } catch (e) {
        logs.push({ step: "cloudflare-timeout" });
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Now try to extract form data (may need multiple attempts)
    let formData = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      formData = await page.evaluate(() => {
        const data = {};
        document.querySelectorAll("input[name]").forEach((el) => {
          data[el.name] = el.value || "";
        });
        return data;
      });

      logs.push({ step: `form-extract-attempt-${attempt}`, fields: Object.keys(formData).length });

      if (Object.keys(formData).length > 0) break;
      
      // Wait and retry
      await new Promise((r) => setTimeout(r, 5000));
    }

    if (Object.keys(formData).length === 0) {
      // Last resort: check if there's a recaptcha that needs solving
      const hasRecaptcha = await page.evaluate(() => {
        return document.querySelector(".g-recaptcha") !== null || 
               document.querySelector("[data-sitekey]") !== null;
      });
      
      if (hasRecaptcha) {
        logs.push({ step: "recaptcha-found-cannot-solve-automatically" });
        return { success: false, error: "reCAPTCHA present - cannot solve automatically", logs };
      }
      
      return { success: false, error: "No form data found after all attempts", logs };
    }

    // Get current URL for referer
    const currentUrl = page.url();
    const domain = new URL(currentUrl).origin;

    logs.push({ step: "posting-to-links-go", domain });

    // POST to /links/go using page context (keeps cookies)
    const result = await page.evaluate(
      async (formData, domain) => {
        try {
          const params = new URLSearchParams(formData);
          const resp = await fetch(`${domain}/links/go`, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: params.toString(),
          });
          return await resp.json();
        } catch (e) {
          return { error: e.message };
        }
      },
      formData,
      domain
    );

    logs.push({ step: "response", result });

    if (result && result.url) {
      return { success: true, url: result.url, logs };
    }

    return { success: false, error: "No URL in response", logs, raw: result };
  } catch (err) {
    return { success: false, error: err.message, logs };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

module.exports = { solveShrinkme };
