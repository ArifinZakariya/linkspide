const BaseHandler = require("./BaseHandler");
const { getClient } = require("../utils/httpClient");

class ShrinkmeHandler extends BaseHandler {
  get name() {
    return "shrinkme";
  }

  canHandle(url) {
    return /shrinkme\.io|shorte\.st|sh\.st|adf\.ly|bc\.vc|exe\.io|tei\.ai|cuturl\.cc/.test(url);
  }

  async extract($, html, url) {
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
}

module.exports = ShrinkmeHandler;
