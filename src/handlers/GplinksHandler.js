const BaseHandler = require("./BaseHandler");
const { getClient } = require("../utils/httpClient");

class GplinksHandler extends BaseHandler {
  get name() {
    return "gplinks";
  }

  canHandle(url) {
    return /gplinks\.com|gplink\.co|gplink\.net|mitly\.us|cutp\.in|fc\.lc|za\.gl|tnlink\.in/.test(url);
  }

  async extract($, html, url) {
    const form = $('form[action*="go"], form[action*="verify"], form[method="POST"]').first();
    if (form.length) {
      const action = form.attr("action");
      const formData = {};
      form.find("input[name]").each((_, el) => {
        formData[$(el).attr("name")] = $(el).val() || "";
      });

      if (action && Object.keys(formData).length > 0) {
        try {
          const client = getClient({ timeout: 8000 });
          const postUrl = action.startsWith("http") ? action : new URL(action, url).href;
          const res = await client.post(
            postUrl,
            new URLSearchParams(formData).toString(),
            {
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Referer: url,
                Origin: new URL(url).origin,
              },
              maxRedirects: 0,
              validateStatus: (s) => s < 400 || s === 301 || s === 302 || s === 303,
            }
          );
          const loc = res.headers?.location;
          if (loc) return { redirect: loc.startsWith("http") ? loc : new URL(loc, postUrl).href };

          const body = typeof res.data === "string" ? res.data : "";
          const jsMatch = body.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)/);
          if (jsMatch) return { redirect: jsMatch[1] };

          const $2 = require("cheerio").load(body);
          const nextLink = $2('a[href*="go"], a[href*="download"], a.btn').first().attr("href");
          if (nextLink) return { redirect: nextLink.startsWith("http") ? nextLink : new URL(nextLink, postUrl).href };
        } catch (err) {
          if (err.response?.headers?.location) {
            return { redirect: err.response.headers.location };
          }
        }
      }
    }

    const goBtn = $('a[href*="/go/"], a[href*="/link/"]').first().attr("href");
    if (goBtn) return { redirect: goBtn };

    return null;
  }
}

module.exports = GplinksHandler;
