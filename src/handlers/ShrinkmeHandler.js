const BaseHandler = require("./BaseHandler");
const { getClient } = require("../utils/httpClient");

class ShrinkmeHandler extends BaseHandler {
  get name() {
    return "shrinkme";
  }

  canHandle(url) {
    return /shrinkme\.io|shrinkme\.click|shrinke\.me|shorte\.st|sh\.st|adf\.ly|bc\.vc|exe\.io|tei\.ai|cuturl\.cc/.test(url);
  }

  async extract($, html, url) {
    // shrinkme.click uses /links/go POST endpoint
    if (/shrinkme\.click|shrinke\.me/.test(url)) {
      return await this.handleShrinkmeClick($, html, url);
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

    const scriptUrls = html.match(/(?:src|href)=["']([^"']*(?:config|dest|go|link|redirect)[^"']*)/gi);
    if (scriptUrls) {
      for (const s of scriptUrls) {
        const m = s.match(/["']([^"']+)/);
        if (m && m[1].startsWith("http")) return { redirect: m[1] };
      }
    }

    return null;
  }

  async handleShrinkmeClick($, html, url) {
    const client = getClient();
    const code = url.replace(/\/$/, "").split("/").pop();

    // Extract hidden form inputs from current page
    const formData = {};
    $("input[name]").each((_, el) => {
      const name = $(el).attr("name");
      const value = $(el).attr("value") || "";
      if (name) formData[name] = value;
    });

    // Determine base domain from URL
    const parsed = new URL(url);
    const baseDomain = `${parsed.protocol}//${parsed.hostname}`;

    // Try multiple domain variants
    const domains = [
      "https://en.shrinke.me",
      baseDomain,
      "https://shrinke.me",
      "https://shrinkme.io",
    ];

    for (const domain of domains) {
      try {
        const targetUrl = `${domain}/${code}`;

        // GET request with special headers to bypass Cloudflare
        const getResp = await client.get(targetUrl, {
          headers: {
            referer: "https://mrproblogger.com/",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
            "Cache-Control": "max-age=0",
          },
          timeout: 15000,
        });

        // Extract form data from response if we got HTML
        let sessionFormData = { ...formData };
        if (getResp.data && typeof getResp.data === "string") {
          const $resp = require("cheerio").load(getResp.data);
          $resp("input[name]").each((_, el) => {
            const name = $resp(el).attr("name");
            const value = $resp(el).attr("value") || "";
            if (name) sessionFormData[name] = value;
          });
        }

        if (Object.keys(sessionFormData).length === 0) continue;

        // Extract cookies from response
        const setCookies = getResp.headers?.["set-cookie"];
        let cookieStr = "";
        if (setCookies) {
          cookieStr = setCookies.map((c) => c.split(";")[0]).join("; ");
        }

        // POST to /links/go with XMLHttpRequest header
        const goResp = await client.post(
          `${domain}/links/go`,
          new URLSearchParams(sessionFormData).toString(),
          {
            headers: {
              "x-requested-with": "XMLHttpRequest",
              referer: targetUrl,
              "content-type": "application/x-www-form-urlencoded",
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              ...(cookieStr ? { Cookie: cookieStr } : {}),
            },
            timeout: 20000,
          }
        );

        const result = goResp.data;
        if (result && result.url) {
          return { redirect: result.url };
        }
      } catch (e) {
        continue;
      }
    }

    return null;
  }
}

module.exports = ShrinkmeHandler;
