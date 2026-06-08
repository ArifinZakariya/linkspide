const { load } = require("cheerio");
const { getClient } = require("../utils/httpClient");
const aiService = require("./AiService");
const puppeteerBypass = require("./PuppeteerBypass");

class AiBypassHandler {
  get name() {
    return "ai-bypass";
  }

  canHandle(url) {
    return true;
  }

  isCloudflare(html) {
    return (
      html.includes("Just a moment") ||
      html.includes("cf-browser-verification") ||
      html.includes("cf_chl_opt") ||
      html.includes("challenge-platform") ||
      html.includes("Checking your browser")
    );
  }

  async getPageContent(url) {
    const isCfSite = /ouo\.(io|press)|linkvertise|shrinkme|shorte\.st|gplinks/.test(url);

    if (isCfSite && puppeteerBypass.isAvailable()) {
      try {
        const result = await puppeteerBypass.autoBypass(url, { timeout: 30000 });
        if (result.success) {
          return { html: result.html, finalUrl: result.url, usedBrowser: true };
        }
      } catch (e) {
        console.log("[AI] Puppeteer failed:", e.message);
      }
    }

    const { followRedirects } = require("../utils/httpClient");
    const { finalUrl, html } = await followRedirects(url);
    return { html, finalUrl, usedBrowser: false };
  }

  decodeOuoToken(token) {
    try {
      const b64Match = token.match(/(aHR0cHM6Ly9[A-Za-z0-9+\/=]+)/);
      if (b64Match) {
        const decoded = Buffer.from(b64Match[1], "base64").toString("utf-8");
        const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
        if (urlMatch) return urlMatch[0];
      }

      const patterns = [/([A-Za-z0-9+\/]{40,}={0,2})/];
      for (const p of patterns) {
        const match = token.match(p);
        if (match) {
          const decoded = Buffer.from(match[1], "base64").toString("utf-8");
          const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
          if (urlMatch) return urlMatch[0];
        }
      }
    } catch {}
    return null;
  }

  async solveOuo(url) {
    console.log("[AI] Fetching OUO page:", url);
    const { html, finalUrl, usedBrowser } = await this.getPageContent(url);
    console.log("[AI] Got HTML:", html?.length, "chars, browser:", usedBrowser);

    if (!html || html.length < 100) {
      return { success: false, error: "Empty page" };
    }

    const $ = load(html);
    const form = $('form[action*="/go/"]').first();

    if (form.length) {
      const action = form.attr("action");
      const token = form.find('input[name="_token"]').val();
      console.log("[AI] Found form:", action);

      if (token) {
        const decoded = this.decodeOuoToken(token);
        if (decoded) {
          console.log("[AI] Decoded token URL:", decoded);
          return { success: true, url: decoded, method: "token-decode" };
        }
        console.log("[AI] Token decode failed, trying form submit...");
      }

      if (action && token) {
        const postUrl = action.startsWith("http") ? action : new URL(action, url).href;
        try {
          const client = getClient();
          const res = await client.post(
            postUrl,
            new URLSearchParams({ _token: token }).toString(),
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
          if (loc) {
            const finalUrl = loc.startsWith("http") ? loc : new URL(loc, postUrl).href;
            console.log("[AI] Form redirect:", finalUrl);
            return { success: true, url: finalUrl, method: "form-submit" };
          }

          const body = typeof res.data === "string" ? res.data : "";
          if (body) {
            const $2 = load(body);
            const nextForm = $2('form[action*="/go/"], form[action*="/re/"]').first();
            if (nextForm.length) {
              const nextAction = nextForm.attr("action");
              const nextToken = nextForm.find('input[name="_token"]').val();
              if (nextToken) {
                const nextDecoded = this.decodeOuoToken(nextToken);
                if (nextDecoded) {
                  console.log("[AI] Second page decoded:", nextDecoded);
                  return { success: true, url: nextDecoded, method: "token-decode-2" };
                }

                if (nextAction) {
                  const nextPostUrl = nextAction.startsWith("http") ? nextAction : new URL(nextAction, postUrl).href;
                  try {
                    const res2 = await client.post(
                      nextPostUrl,
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
                    if (loc2) {
                      return { success: true, url: loc2.startsWith("http") ? loc2 : new URL(loc2, nextPostUrl).href, method: "form-submit-2" };
                    }
                  } catch (e2) {
                    if (e2.response?.headers?.location) {
                      return { success: true, url: e2.response.headers.location, method: "form-submit-2" };
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          if (err.response?.headers?.location) {
            return { success: true, url: err.response.headers.location, method: "form-error-redirect" };
          }
        }
      }
    }

    console.log("[AI] Direct methods failed, using AI analysis...");
    try {
      const analysis = await aiService.solveOuo(html, url);
      if (analysis.final_url && analysis.final_url !== "NOT_FOUND") {
        return { success: true, url: analysis.final_url, method: "ai-direct" };
      }
      if (analysis.decoded_token_url) {
        return { success: true, url: analysis.decoded_token_url, method: "ai-decoded" };
      }
    } catch (e) {
      console.log("[AI] AI analysis failed:", e.message);
    }

    return { success: false, error: "Could not extract URL" };
  }

  async genericBypass(url, html) {
    const $ = load(html);

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
          if (loc) return { success: true, url: loc.startsWith("http") ? loc : new URL(loc, postUrl).href, method: "generic-form" };
        } catch (err) {
          if (err.response?.headers?.location) {
            return { success: true, url: err.response.headers.location, method: "generic-form-err" };
          }
        }
      }
    }

    try {
      const analysis = await aiService.analyzePage(html, url);
      if (analysis.final_url && analysis.final_url !== "NOT_FOUND") {
        return { success: true, url: analysis.final_url, method: "ai-analyze" };
      }
    } catch {}

    return { success: false };
  }

  async resolve(url, html) {
    const isOuo = /ouo\.(io|press)/.test(url);

    if (isOuo) {
      return await this.solveOuo(url);
    }

    if (this.isCloudflare(html)) {
      const { html: newHtml, finalUrl } = await this.getPageContent(url);
      if (newHtml && !this.isCloudflare(newHtml)) {
        return await this.genericBypass(finalUrl, newHtml);
      }
    }

    return await this.genericBypass(url, html);
  }
}

module.exports = new AiBypassHandler();
