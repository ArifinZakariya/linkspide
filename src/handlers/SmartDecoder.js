class SmartDecoder {
  decode(str) {
    if (!str || typeof str !== "string") return null;

    let result = this.tryBase64(str);
    if (result) return result;

    result = this.tryRot13(str);
    if (result) return result;

    result = this.tryHexDecode(str);
    if (result) return result;

    result = this.tryUrlDecode(str);
    if (result) return result;

    result = this.tryCharCodes(str);
    if (result) return result;

    return null;
  }

  tryBase64(str) {
    const patterns = [
      /([A-Za-z0-9+\/]{40,}={0,2})/,
      /atob\s*\(\s*["']([A-Za-z0-9+\/=]{20,})/,
    ];

    for (const p of patterns) {
      const match = str.match(p);
      if (match) {
        try {
          const decoded = Buffer.from(match[1], "base64").toString("utf-8");
          const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
          if (urlMatch) return urlMatch[0];
          if (decoded.includes("http")) return decoded;
        } catch {}
      }
    }

    try {
      const hexMatch = str.match(/^([0-9a-f]{40})/);
      if (hexMatch) {
        const rest = str.slice(40).replace(/^[0-9]+/, "");
        const urlIdx = rest.indexOf("aHR0cHM6Ly9");
        if (urlIdx >= 0) {
          const b64Part = rest.slice(urlIdx);
          const decoded = Buffer.from(b64Part, "base64").toString("utf-8");
          const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
          if (urlMatch) return urlMatch[0];
        }
      }
    } catch {}

    return null;
  }

  tryRot13(str) {
    const rot13 = (s) =>
      s.replace(/[a-zA-Z]/g, (c) =>
        String.fromCharCode(
          c.charCodeAt(0) <= 90
            ? ((c.charCodeAt(0) - 65 + 13) % 26) + 65
            : ((c.charCodeAt(0) - 97 + 13) % 26) + 97
        )
      );

    const decoded = rot13(str);
    const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
    if (urlMatch) return urlMatch[0];

    const encoded = str.replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
    const urlMatch2 = encoded.match(/https?:\/\/[^\s"'<>]+/);
    if (urlMatch2) return urlMatch2[0];

    return null;
  }

  tryHexDecode(str) {
    const hexPattern = /\\x([0-9a-f]{2})/gi;
    const chars = [];
    let match;
    while ((match = hexPattern.exec(str)) !== null) {
      chars.push(String.fromCharCode(parseInt(match[1], 16)));
    }
    if (chars.length > 5) {
      const decoded = chars.join("");
      const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
      if (urlMatch) return urlMatch[0];
    }

    const plainHex = str.match(/([0-9a-f]{40,})/i);
    if (plainHex) {
      try {
        const hex = plainHex[1];
        let decoded = "";
        for (let i = 0; i < hex.length; i += 2) {
          decoded += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        }
        const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
        if (urlMatch) return urlMatch[0];
      } catch {}
    }

    return null;
  }

  tryUrlDecode(str) {
    try {
      const decoded = decodeURIComponent(str);
      if (decoded !== str) {
        const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
        if (urlMatch) return urlMatch[0];
      }
    } catch {}

    const unicodePattern = /\\u([0-9a-f]{4})/gi;
    const chars = [];
    let match;
    while ((match = unicodePattern.exec(str)) !== null) {
      chars.push(String.fromCharCode(parseInt(match[1], 16)));
    }
    if (chars.length > 5) {
      const decoded = chars.join("");
      const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
      if (urlMatch) return urlMatch[0];
    }

    return null;
  }

  tryCharCodes(str) {
    const charCodePattern = /String\.fromCharCode\s*\(\s*(\d+(?:\s*,\s*\d+)*)\s*\)/g;
    let match;
    while ((match = charCodePattern.exec(str)) !== null) {
      try {
        const codes = match[1].split(",").map((c) => parseInt(c.trim()));
        const decoded = String.fromCharCode(...codes);
        const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
        if (urlMatch) return urlMatch[0];
      } catch {}
    }
    return null;
  }

  extractFromScript(html) {
    const $ = require("cheerio").load(html);
    const results = [];

    $("script").each((_, el) => {
      const text = $(el).html() || "";
      const url = this.decode(text);
      if (url) results.push(url);

      const inlineUrls = text.match(/["'](https?:\/\/[^"']+)/g);
      if (inlineUrls) {
        for (const u of inlineUrls) {
          const clean = u.replace(/^["']/, "");
          if (clean.includes("drive") || clean.includes("mega") || clean.includes("download") || clean.includes("file")) {
            results.push(clean);
          }
        }
      }
    });

    return [...new Set(results)];
  }
}

module.exports = new SmartDecoder();
