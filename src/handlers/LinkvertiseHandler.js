const BaseHandler = require("./BaseHandler");
const { getClient } = require("../utils/httpClient");

class LinkvertiseHandler extends BaseHandler {
  get name() {
    return "linkvertise";
  }

  canHandle(url) {
    return /linkvertise\.com/.test(url);
  }

  async extract($, html, url) {
    const apiMatch = html.match(/\/api\/v1\/dynamic\/links\/([a-zA-Z0-9]+)/);
    if (apiMatch) {
      try {
        const client = getClient({ timeout: 6000 });
        const apiUrl = `https://linkvertise.com/api/v1/dynamic/links/${apiMatch[1]}?r=&u=`;
        const res = await client.get(apiUrl, {
          headers: { Referer: url },
        });
        if (res.data?.data?.targetUrl) {
          return { redirect: res.data.data.targetUrl };
        }
      } catch {}
    }

    const targetMatch = html.match(/targetUrl["\s:=]+["']?(https?:\/\/[^"'\s&]+)/i);
    if (targetMatch) return { redirect: targetMatch[1] };

    const dataUrl = html.match(/data-url=["']([^"']+)/);
    if (dataUrl) return { redirect: dataUrl[1] };

    const bypassLink = $('a[href*="bypass"], a[href*="skip"], a[href*="continue"]').first().attr("href");
    if (bypassLink) return { redirect: bypassLink };

    return null;
  }
}

module.exports = LinkvertiseHandler;
