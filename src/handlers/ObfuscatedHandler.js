const BaseHandler = require("./BaseHandler");

class ObfuscatedHandler extends BaseHandler {
  get name() {
    return "obfuscated-js";
  }

  canHandle(url) {
    return true;
  }

  async extract($, html, url) {
    const encodedPatterns = [
      /window\.location\s*=\s*atob\s*\(\s*["']([^"']+)/,
      /window\.location\.href\s*=\s*atob\s*\(\s*["']([^"']+)/,
      /location\s*=\s*atob\s*\(\s*["']([^"']+)/,
      /window\[_0x[a-f0-9]+\]\s*=\s*["']?(https?:\/\/[^"'\s]+)/,
      /(?:var|let|const)\s+\w+\s*=\s*["'](https?:\/\/[^"']*(?:drive|mega|mediafire|gofile|apk|zip|rar|exe|app)[^"']*)/i,
    ];

    for (const p of encodedPatterns) {
      const m = html.match(p);
      if (m) {
        try {
          const decoded = m[1].startsWith("http")
            ? m[1]
            : Buffer.from(m[1], "base64").toString("utf-8");
          if (decoded.startsWith("http")) return { redirect: decoded };
        } catch {
          if (m[1].startsWith("http")) return { redirect: m[1] };
        }
      }
    }

    const iframe = $("iframe[src]").first().attr("src");
    if (iframe && iframe.startsWith("http") && !iframe.includes("google") && !iframe.includes("facebook")) {
      return { redirect: iframe };
    }

    const allScripts = $("script").toArray();
    for (const el of allScripts) {
      const text = $(el).html() || "";
      const urlMatch = text.match(
        /["'](https?:\/\/[^"']*(?:ouo|linkvertise|shrinkme|cuturl|safelink|dl-protect|gplinks|tnlink|za)[^"']*)/i
      );
      if (urlMatch) return { redirect: urlMatch[1] };
    }

    return null;
  }
}

module.exports = ObfuscatedHandler;
