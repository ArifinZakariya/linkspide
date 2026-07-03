const BaseHandler = require("./BaseHandler");
const { getClient } = require("../utils/httpClient");
const cheerio = require("cheerio");
const axios = require("axios");

const PUPPETEER_SERVICE_URL = process.env.PUPPETEER_SERVICE_URL || "https://shortlink-puppeteer.fly.dev";

class ShrinkmeHandler extends BaseHandler {
  get name() {
    return "shrinkme";
  }

  canHandle(url) {
    return /shrinkme\.io|shrinkme\.click|shrinke\.me|shorte\.st|sh\.st|adf\.ly|bc\.vc|exe\.io|tei\.ai|cuturl\.cc/.test(url);
  }

  async extract($, html, url) {
    if (/shrinkme\.click|shrinke\.me/.test(url)) {
      return await this.handleShrinkmeClick(url);
    }

    const form = $("form").first();
    if (form.length) {
      const action = form.attr("action");
      if (action && action !== "#") {
        const formData = {};
        form.find("input[name]").each((_, el) => {
          formData[$(el).attr("name")] = $(el).val() || "";
        });
        if (Object.keys(formData).length > 0) {
          return {
            formAction: action.startsWith("http") ? action : new URL(action, url).href,
            formData,
          };
        }
      }
    }

    const tokenMatch = html.match(/token\s*=\s*["']([^"']+)/);
    const destMatch = html.match(/dest(?:ination)?\s*=\s*["']([^"']+)/);
    if (tokenMatch && destMatch) {
      try {
        const client = getClient();
        const res = await client.post(
          url,
          new URLSearchParams({ token: tokenMatch[1], dest: destMatch[1] }).toString(),
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Referer: url,
            },
            maxRedirects: 0,
            validateStatus: (s) => s < 400 || s === 301 || s === 302,
          }
        );
        const loc = res.headers?.location;
        if (loc) return { redirect: loc.startsWith("http") ? loc : new URL(loc, url).href };
      } catch (err) {
        if (err.response?.headers?.location) {
          return { redirect: err.response.headers.location };
        }
      }
    }

    return null;
  }

  async handleShrinkmeClick(url) {
    // Method 1: Try HTTP bypass first (faster)
    const httpResult = await this.tryHttpBypass(url);
    if (httpResult) return httpResult;

    // Method 2: Fallback to Puppeteer service on Fly.io
    return await this.tryPuppeteerBypass(url);
  }

  async tryHttpBypass(url) {
    const parsed = new URL(url);
    const code = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!code) return null;

    const domains = [
      "https://en.shrinke.me",
      "https://shrinkme.click",
      "https://shrinke.me",
      "https://shrinkme.io",
    ];

    for (const domain of domains) {
      try {
        const targetUrl = `${domain}/${code}`;
        const client = axios.create({
          timeout: 15000,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Upgrade-Insecure-Requests": "1",
          },
        });

        const getResp = await client.get(targetUrl, {
          headers: { referer: "https://mrproblogger.com/" },
        });

        if (!getResp.data || typeof getResp.data !== "string") continue;
        if (getResp.data.includes("challenge-platform") || getResp.data.includes("Just a moment")) {
          continue;
        }

        const $page = cheerio.load(getResp.data);
        const formData = {};
        $page("input[name]").each((_, el) => {
          const name = $page(el).attr("name");
          const value = $page(el).attr("value") || "";
          if (name) formData[name] = value;
        });

        if (Object.keys(formData).length === 0) continue;

        const setCookies = getResp.headers?.["set-cookie"];
        let cookieStr = "";
        if (setCookies) {
          cookieStr = setCookies.map((c) => c.split(";")[0]).join("; ");
        }

        const goResp = await client.post(
          `${domain}/links/go`,
          new URLSearchParams(formData).toString(),
          {
            headers: {
              "x-requested-with": "XMLHttpRequest",
              referer: targetUrl,
              "content-type": "application/x-www-form-urlencoded",
              ...(cookieStr ? { Cookie: cookieStr } : {}),
            },
          }
        );

        if (goResp.data?.url) {
          return { redirect: goResp.data.url };
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  async tryPuppeteerBypass(url) {
    try {
      const resp = await axios.post(
        `${PUPPETEER_SERVICE_URL}/api/shrinkme`,
        { url, timeout: 45000 },
        { timeout: 60000 }
      );

      if (resp.data?.success && resp.data?.url) {
        return { redirect: resp.data.url };
      }
      return null;
    } catch (e) {
      console.error("[ShrinkmeHandler] Puppeteer service error:", e.message);
      return null;
    }
  }
}

module.exports = ShrinkmeHandler;
