const { getClient } = require("../utils/httpClient");

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
    try {
      const client = getClient();
      const res = await client.get(url, {
        maxRedirects: 10,
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        },
      });

      const finalUrl = res.request?.res?.responseUrl || url;
      const html = typeof res.data === "string" ? res.data : "";

      if (this.isCloudflarePage(html)) {
        return {
          success: false,
          url: finalUrl,
          error: "Cloudflare challenge detected - cannot bypass via HTTP alone",
        };
      }

      return { success: true, url: finalUrl, html };
    } catch (err) {
      if (err.response?.headers?.location) {
        return { success: true, url: err.response.headers.location };
      }
      return { success: false, error: err.message };
    }
  }
}

module.exports = new CloudflareHandler();
