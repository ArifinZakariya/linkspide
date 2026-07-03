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
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    logs.push({ step: "page-loaded" });

    // Wait for Cloudflare challenge to resolve (if present)
    try {
      await page.waitForFunction(
        () => {
          return (
            document.querySelector('input[name]') !== null ||
            document.querySelector('form') !== null ||
            !document.title.includes("Just a moment")
          );
        },
        { timeout: 15000 }
      );
    } catch (e) {
      logs.push({ step: "cloudflare-wait-timeout" });
    }

    // Wait a bit more for page to fully load
    await new Promise((r) => setTimeout(r, 3000));

    // Extract form data
    const formData = await page.evaluate(() => {
      const data = {};
      document.querySelectorAll("input[name]").forEach((el) => {
        data[el.name] = el.value || "";
      });
      return data;
    });

    logs.push({ step: "form-extracted", fields: Object.keys(formData).length });

    if (Object.keys(formData).length === 0) {
      // Try waiting more and check for recaptcha
      await new Promise((r) => setTimeout(r, 5000));
      
      const retryFormData = await page.evaluate(() => {
        const data = {};
        document.querySelectorAll("input[name]").forEach((el) => {
          data[el.name] = el.value || "";
        });
        return data;
      });

      if (Object.keys(retryFormData).length === 0) {
        return { success: false, error: "No form data found", logs };
      }
      Object.assign(formData, retryFormData);
    }

    // Get current URL for referer
    const currentUrl = page.url();
    const domain = new URL(currentUrl).origin;

    logs.push({ step: "posting-to-links-go" });

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
