const BaseHandler = require("./BaseHandler");
const { getClient } = require("../utils/httpClient");

class OuoHandler extends BaseHandler {
  get name() {
    return "ouo";
  }

  canHandle(url) {
    return /ouo\.(io|press)/.test(url);
  }

  async extract($, html, url) {
    const code = url.match(/\/([A-Za-z0-9]+)$/)?.[1];

    if (url.includes("/re/") || url.includes("/fbc/")) {
      return null;
    }

    if (html.includes("Just a moment") || html.includes("cf-browser-verification")) {
      if (code) {
        return {
          redirect: `https://ouo.io/fbc/${code}`,
          note: "cloudflare-challenge-via-fbc",
        };
      }
    }

    const hasTurnstile = html.includes("cf-turnstile") || html.includes("data-sitekey");
    if (hasTurnstile) {
      if (code) {
        return {
          redirect: `https://ouo.io/fbc/${code}`,
          note: "turnstile-detected-via-fbc",
        };
      }
    }

    const form = $('form[action*="/go/"]').first();
    if (form.length) {
      const action = form.attr("action");
      const token = form.find('input[name="_token"]').val();
      if (action && token) {
        const result = await this._submitForm(url, action, {
          _token: token,
          "x-token": form.find('input[name="x-token"]').val() || "",
          "v-token": form.find('input[name="v-token"]').val() || "vm",
        });
        if (result) return result;
      }
    }

    if (code) {
      return {
        redirect: `https://ouo.io/fbc/${code}`,
        note: "fallback-to-fbc",
      };
    }

    return null;
  }

  async _submitForm(pageUrl, action, formData) {
    try {
      const client = getClient({ timeout: 8000 });
      const postUrl = action.startsWith("http") ? action : new URL(action, pageUrl).href;

      const res = await client.post(
        postUrl,
        new URLSearchParams(formData).toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: pageUrl,
            Origin: new URL(pageUrl).origin,
          },
          maxRedirects: 0,
          validateStatus: (s) => s < 400 || s === 301 || s === 302 || s === 303 || s === 403,
        }
      );

      const loc = res.headers?.location;
      if (loc) {
        return { redirect: loc.startsWith("http") ? loc : new URL(loc, postUrl).href };
      }

      const body = typeof res.data === "string" ? res.data : "";

      const b64Match = body.match(/aHR0cHM6Ly9[A-Za-z0-9+\/=]+/);
      if (b64Match) {
        try {
          const decoded = Buffer.from(b64Match[0], "base64").toString("utf-8");
          if (decoded.startsWith("http") && !decoded.includes("ouo.io")) {
            return { redirect: decoded };
          }
        } catch {}
      }

      const jsRedirect = body.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)/);
      if (jsRedirect && !jsRedirect[1].includes("ouo.io")) {
        return { redirect: jsRedirect[1] };
      }

      const $2 = require("cheerio").load(body);
      const nextForm = $2('form').first();
      if (nextForm.length) {
        const nextAction = nextForm.attr("action");
        const nextToken = nextForm.find('input[name="_token"]').val();
        if (nextAction && nextToken) {
          const fullAction = nextAction.startsWith("http") ? nextAction : new URL(nextAction, postUrl).href;
          try {
            const res2 = await client.post(
              fullAction,
              new URLSearchParams({
                _token: nextToken,
                "x-token": nextForm.find('input[name="x-token"]').val() || "",
                "v-token": nextForm.find('input[name="v-token"]').val() || "vm",
              }).toString(),
              {
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  Referer: postUrl,
                },
                maxRedirects: 0,
                validateStatus: (s) => s < 400 || s === 301 || s === 302 || s === 303,
              }
            );
            const loc2 = res2.headers?.location;
            if (loc2) return { redirect: loc2.startsWith("http") ? loc2 : new URL(loc2, fullAction).href };

            const body2 = typeof res2.data === "string" ? res2.data : "";
            const b64_2 = body2.match(/aHR0cHM6Ly9[A-Za-z0-9+\/=]+/);
            if (b64_2) {
              try {
                const decoded2 = Buffer.from(b64_2[0], "base64").toString("utf-8");
                if (decoded2.startsWith("http") && !decoded2.includes("ouo.io")) {
                  return { redirect: decoded2 };
                }
              } catch {}
            }
          } catch (e2) {
            if (e2.response?.headers?.location) {
              return { redirect: e2.response.headers.location };
            }
          }
        }
      }
    } catch (err) {
      if (err.response?.headers?.location) {
        return { redirect: err.response.headers.location };
      }
    }

    return null;
  }
}

module.exports = OuoHandler;
