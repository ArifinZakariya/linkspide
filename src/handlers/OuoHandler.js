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
    if (html.includes("Just a moment") || html.includes("cf-browser-verification")) {
      const code = url.match(/\/([A-Za-z0-9]+)$/)?.[1];
      if (code) {
        return {
          redirect: `https://ouo.io/re/${code}`,
          note: "cloudflare-challenge",
        };
      }
    }

    const form = $('form[action*="/go/"]').first();
    if (!form.length) {
      const altForm = $("form").first();
      if (altForm.length) {
        const action = altForm.attr("action");
        const token = altForm.find('input[name="_token"]').val();
        if (action && token) {
          return this._submitForm(url, action, { _token: token });
        }
      }
      return null;
    }

    const action = form.attr("action");
    const token = form.find('input[name="_token"]').val();
    if (!action || !token) return null;

    return this._submitForm(url, action, { _token: token });
  }

  async _submitForm(pageUrl, action, formData) {
    try {
      const client = getClient();
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
      if (body.includes("Just a moment")) {
        const code = pageUrl.match(/\/([A-Za-z0-9]+)$/)?.[1];
        if (code) return { redirect: `https://ouo.io/re/${code}` };
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
              new URLSearchParams({ _token: nextToken }).toString(),
              {
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  Referer: postUrl,
                },
                maxRedirects: 0,
                validateStatus: (s) => s < 400 || s === 301 || s === 302,
              }
            );
            const loc2 = res2.headers?.location;
            if (loc2) return { redirect: loc2.startsWith("http") ? loc2 : new URL(loc2, fullAction).href };
          } catch (e2) {
            if (e2.response?.headers?.location) {
              return { redirect: e2.response.headers.location };
            }
          }
        }
      }

      const jsRedirect = body.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)/);
      if (jsRedirect) return { redirect: jsRedirect[1] };
    } catch (err) {
      if (err.response?.headers?.location) {
        return { redirect: err.response.headers.location };
      }
    }

    return null;
  }
}

module.exports = OuoHandler;
