const { load } = require("cheerio");

class BaseHandler {
  get name() {
    return "base";
  }

  canHandle(url) {
    return false;
  }

  async extract($, html, url) {
    return null;
  }

  findMetaRedirect(html) {
    const match = html.match(
      /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'\s;]+)/i
    );
    return match ? match[1] : null;
  }

  findJsRedirect(html) {
    const patterns = [
      /window\.location\.href\s*=\s*["']([^"']+)/,
      /window\.location\.replace\s*\(\s*["']([^"']+)/,
      /window\.location\s*=\s*["']([^"']+)/,
      /location\.href\s*=\s*["']([^"']+)/,
      /location\.replace\s*\(\s*["']([^"']+)/,
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) return m[1];
    }
    return null;
  }
}

module.exports = BaseHandler;
