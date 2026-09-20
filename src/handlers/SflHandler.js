const BaseHandler = require("./BaseHandler");
const { load } = require("cheerio");
const { getClient, followRedirects } = require("../utils/httpClient");
const crypto = require("crypto");

class SflHandler extends BaseHandler {
  get name() { return "sfl"; }

  canHandle(url) {
    return /sfl\.(gl|link)/i.test(url) || /khaddavi\.net|safelinku\.com/i.test(url);
  }

  async extract($, html, url) {
    // Domain fallback: if sfl.link under WAF and no html, try sfl.gl
    if (/sfl\.link/i.test(url) && (!html || html.includes("Human Verification") || html.includes("gokuProps"))) {
      const altUrl = url.replace(/sfl\.link/i, "sfl.gl");
      try {
        const { html: altHtml, cookies: altCookies } = await followRedirects(altUrl, 5);
        if (altHtml && altHtml.includes("redirect.php")) {
          const $alt = load(altHtml);
          const formAlt = $alt("form").first();
          if (formAlt.length) {
            html = altHtml;
            $ = $alt;
            url = altUrl;
          }
        }
      } catch {}
    }
    // This handler is used by bypassEngine when followRedirects gets HTML
    // For sfl.gl/link the initial html is a <form> to app.khaddavi.net/redirect.php
    // Do full chain via HTTP bypass (session/verify/go/ready)
    try {
      const form = $("form").first();
      if (form.length) {
        const action = form.attr("action") || "";
        if (/khaddavi\.net.*redirect\.php/i.test(action) || /redirect\.php/i.test(action)) {
          const formData = {};
          form.find("input[name]").each((_, el) => {
            const name = $(el).attr("name");
            const val = $(el).attr("value") || $(el).val() || "";
            if (name) formData[name] = val;
          });
          const target = new URL(action.startsWith("http") ? action : new URL(action, url).href);
          for (const [k,v] of Object.entries(formData)) target.searchParams.set(k,v);

          const generic = require("./GenericOrganic");
          // Use followRedirects to get article page + cookies
          const { finalUrl, cookies, html: articleHtml } = await followRedirects(target.href, 10);
          if (finalUrl && /khaddavi\.net|safelinku/i.test(finalUrl)) {
            const dest = await generic._khaddaviChain(url, finalUrl, cookies, articleHtml, () => {});
            if (dest) return { redirect: dest };
          }
          if (finalUrl) return { redirect: finalUrl };
        }
      }
      // If already on khaddavi article (no form), try direct chain
      if (/khaddavi\.net/i.test(url) || /khaddavi\.net/i.test(html.slice(0,2000))) {
        const generic = require("./GenericOrganic");
        const { cookies } = await followRedirects(url, 5).catch(()=>({cookies:{}}));
        const dest = await generic._khaddaviChain(url, url, cookies || {}, html, () => {});
        if (dest) return { redirect: dest };
      }
      // Fallback: look for ready/go page direct extraction
      const jsRedir = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/);
      if (jsRedir) {
        let dest = jsRedir[1].replace(/\\\//g, "/");
        if (dest.startsWith("http") && !/sfl\.(gl|link)|khaddavi|safelinku/i.test(dest)) {
          return { redirect: dest };
        }
      }
    } catch {}
    return null;
  }
}

module.exports = SflHandler;
