const BaseHandler = require("./BaseHandler");
const { getClient } = require("../utils/httpClient");

class SafelinkHandler extends BaseHandler {
  get name() {
    return "safelink";
  }

  canHandle(url) {
    return /safelinku\.com|dutchycorp\.com|link1s\.com|linkspy\.cc|cutdy\.link/.test(url);
  }

  async extract($, html, url) {
    const decodedUrl = html.match(/decoded?Url\s*=\s*["']([^"']+)/i);
    if (decodedUrl) return { redirect: decodedUrl[1] };

    const加密 = html.match(/encUrl\s*=\s*["']([^"']+)/i);
    if (加密) return { redirect: 加密[1] };

    const form = $("form").first();
    if (form.length) {
      const action = form.attr("action");
      const formData = {};
      form.find("input[name]").each((_, el) => {
        formData[$(el).attr("name")] = $(el).val() || "";
      });

      if (action && Object.keys(formData).length > 0) {
        try {
          const client = getClient();
          const postUrl = action.startsWith("http") ? action : new URL(action, url).href;
          const res = await client.post(
            postUrl,
            new URLSearchParams(formData).toString(),
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
          if (loc) return { redirect: loc.startsWith("http") ? loc : new URL(loc, postUrl).href };
        } catch (err) {
          if (err.response?.headers?.location) {
            return { redirect: err.response.headers.location };
          }
        }
      }
    }

    const decryptBtn = $('a[href*="decrypt"], a[href*="go"], a.btn-success, button:contains("Decrypt"), button:contains("Get Link")').first().attr("href");
    if (decryptBtn) return { redirect: decryptBtn };

    return null;
  }
}

module.exports = SafelinkHandler;
