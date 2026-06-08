const BaseHandler = require("./BaseHandler");

class GenericRedirectHandler extends BaseHandler {
  get name() {
    return "generic-redirect";
  }

  canHandle(url) {
    return true;
  }

  async extract($, html, url) {
    const metaRedirect = this.findMetaRedirect(html);
    if (metaRedirect) return { redirect: metaRedirect };

    const jsRedirect = this.findJsRedirect(html);
    if (jsRedirect) return { redirect: jsRedirect };

    const link = $('a[href][id*="continue"], a[href][class*="continue"], a[href][id*="skip"], a[href][class*="skip"], a[href][id*="go"], a[href][class*="go-btn"], a[href][id*="visit"], a[href][class*="visit"]').first().attr("href");
    if (link) return { redirect: link };

    const allLinks = $('a[href]').toArray();
    for (const el of allLinks) {
      const text = $(el).text().toLowerCase().trim();
      if (["continue", "skip", "go", "visit", "proceed", "next", "click here", "lanjutkan", "lewati"].includes(text)) {
        return { redirect: $(el).attr("href") };
      }
    }

    return null;
  }
}

module.exports = GenericRedirectHandler;
