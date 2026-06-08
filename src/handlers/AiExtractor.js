const { load } = require("cheerio");

class AiExtractor {
  constructor() {
    this.urlPatterns = [
      /https?:\/\/[^\s"'<>\]}{`\\]+/gi,
      /\\x68\\x74\\x74\\x70[^\s"']+/gi,
      /\\u0068\\u0074\\u0074\\u0070[^\s"']+/gi,
      /atob\s*\(\s*["']([A-Za-z0-9+\/=]{20,})/g,
      /decodeURIComponent\s*\(\s*["']([^"']+)/g,
      /eval\s*\(\s*function\s*\(\s*a\s*,\s*b\s*,\s*c\s*,\s*d\s*,\s*e\s*,\s*f/g,
    ];

    this.bypassPatterns = [
      { pattern: /window\.location(?:\.href)?\s*=\s*["']([^"']+)/g, type: "js-redirect" },
      { pattern: /location\.replace\s*\(\s*["']([^"']+)/g, type: "js-replace" },
      { pattern: /location\.href\s*=\s*["']([^"']+)/g, type: "js-href" },
      { pattern: /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'\s;]+)/gi, type: "meta-refresh" },
      { pattern: /data-(?:url|href|link|redirect|target)=["']([^"']+)/gi, type: "data-attr" },
      { pattern: /var\s+(?:dest|url|link|goto|target|redirect|next)\s*=\s*["']([^"']+)/gi, type: "js-var" },
      { pattern: /["']([^"']*(?:drive\.google|mega\.nz|mediafire|gofile|apk|download|file)[^"']*)/gi, type: "file-link" },
    ];
  }

  extractAllUrls(html) {
    const urls = new Set();
    const regex = /https?:\/\/[^\s"'<>\]}{`\\]+/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const url = match[0].replace(/[.,;:!?)\]]+$/, "");
      if (
        url.length > 15 &&
        !url.includes("google-analytics") &&
        !url.includes("facebook") &&
        !url.includes("googletagmanager") &&
        !url.includes("favicon") &&
        !url.includes(".png") &&
        !url.includes(".jpg") &&
        !url.includes(".gif") &&
        !url.includes(".svg") &&
        !url.includes(".css") &&
        !url.includes("fonts.") &&
        !url.includes("cdn.") &&
        !url.includes("static.") &&
        !url.includes("assets/") &&
        !url.includes("images/")
      ) {
        urls.add(url);
      }
    }
    return [...urls];
  }

  decodeBase64Strings(html) {
    const results = [];
    const regex = /atob\s*\(\s*["']([A-Za-z0-9+\/=]{20,})/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      try {
        const decoded = Buffer.from(match[1], "base64").toString("utf-8");
        const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
        if (urlMatch) results.push({ encoded: match[1], decoded: urlMatch[0], method: "base64" });
      } catch {}
    }
    return results;
  }

  decodeHexStrings(html) {
    const results = [];
    const regex = /\\x([0-9a-f]{2})/gi;
    const hexChars = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      hexChars.push(String.fromCharCode(parseInt(match[1], 16)));
    }
    if (hexChars.length > 10) {
      const decoded = hexChars.join("");
      const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
      if (urlMatch) results.push({ decoded: urlMatch[0], method: "hex" });
    }
    return results;
  }

  decodeUnicodeStrings(html) {
    const results = [];
    const regex = /\\u([0-9a-f]{4})/gi;
    const chars = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      chars.push(String.fromCharCode(parseInt(match[1], 16)));
    }
    if (chars.length > 10) {
      const decoded = chars.join("");
      const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
      if (urlMatch) results.push({ decoded: urlMatch[0], method: "unicode" });
    }
    return results;
  }

  findRedirectUrls(html) {
    const results = [];
    for (const { pattern, type } of this.bypassPatterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(html)) !== null) {
        const url = match[1];
        if (url && url.startsWith("http") && !url.includes("google") && !url.includes("facebook")) {
          results.push({ url, type });
        }
      }
    }
    return results;
  }

  findFormSubmissions(html) {
    const $ = load(html);
    const forms = [];
    $("form").each((_, el) => {
      const action = $(el).attr("action");
      const method = ($(el).attr("method") || "GET").toUpperCase();
      const inputs = {};
      $(el).find("input[name]").each((_, inp) => {
        inputs[$(inp).attr("name")] = $(inp).val() || "";
      });
      if (action) forms.push({ action, method, inputs });
    });
    return forms;
  }

  findClickableElements(html) {
    const $ = load(html);
    const elements = [];
    const selectors = [
      'a[href*="continue"]', 'a[href*="skip"]', 'a[href*="proceed"]',
      'a[href*="go"]', 'a[href*="next"]', 'a[href*="download"]',
      'button:contains("Continue")', 'button:contains("Skip")',
      'button:contains("Proceed")', 'button:contains("Get Link")',
      'button:contains("Click Here")', 'button[type="submit"]',
      '[id*="continue"]', '[id*="skip"]', '[id*="btn-main"]',
      '[class*="continue"]', '[class*="skip"]', '[class*="btn-main"]',
    ];
    for (const sel of selectors) {
      try {
        $(sel).each((_, el) => {
          const href = $(el).attr("href") || $(el).attr("action");
          const text = $(el).text().trim();
          elements.push({ selector: sel, href, text: text.substring(0, 50) });
        });
      } catch {}
    }
    return elements;
  }

  analyze(html, url) {
    const allUrls = this.extractAllUrls(html);
    const base64Urls = this.decodeBase64Strings(html);
    const hexUrls = this.decodeHexStrings(html);
    const unicodeUrls = this.decodeUnicodeStrings(html);
    const redirectUrls = this.findRedirectUrls(html);
    const forms = this.findFormSubmissions(html);
    const clickable = this.findClickableElements(html);

    const destinationCandidates = [
      ...redirectUrls.map((r) => r.url),
      ...base64Urls.map((b) => b.decoded),
      ...hexUrls.map((h) => h.decoded),
      ...unicodeUrls.map((u) => u.decoded),
    ];

    const fileLinks = allUrls.filter(
      (u) =>
        u.includes("drive.google") ||
        u.includes("mega.nz") ||
        u.includes("mediafire") ||
        u.includes("gofile") ||
        u.includes("download") ||
        u.includes(".apk") ||
        u.includes(".zip") ||
        u.includes(".rar") ||
        u.includes(".exe")
    );

    return {
      totalUrls: allUrls.length,
      redirectUrls,
      base64Urls,
      hexUrls,
      unicodeUrls,
      forms,
      clickable,
      destinationCandidates: [...new Set(destinationCandidates)],
      fileLinks,
      allUrls,
    };
  }
}

module.exports = new AiExtractor();
