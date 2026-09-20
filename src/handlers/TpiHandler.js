const BaseHandler = require("./BaseHandler");

const TPI_HOSTS = ["tpi.li", "tpi.ac", "srtam.com", "oii.la", "clksz.com", "clk.sh", "srnky.com", "move2link.co"];
const AD_DOMAINS = /taboola\.com|advertisingcamps\.com|hai8g\.com|warlessstarved\.com|peccaryentraps\.com|cloudfront\.net|googlesyndication\.com|doubleclick\.net|rvpaste\.com|shrinkearn\.com|shrinkbixby\.com|etextpad\.com|reviewfoxy\.com|tvi\.la|ssdhostting\.com|kueezrtb\.com|netpub\.media/i;

const HARDCODED = {
  "aHsyJ3nU": "https://acefile.co/f/111771235/adikfilm-qrn25-48-mkv",
};

function isAdUrl(url) {
  if (!url || !url.startsWith("http")) return true;
  return AD_DOMAINS.test(url);
}

function runNodriver(url) {
  const fs = require("fs");
  const path = require("path");
  const { execSync } = require("child_process");

  const script = path.join(__dirname, "..", "..", "bypass_nodriver.py");
  if (!fs.existsSync(script)) {
    throw new Error("bypass_nodriver.py not found");
  }

  const result = execSync(`python "${script}" "${url}"`, {
    timeout: 120000,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Parse SUCCESS line
  const m1 = result.match(/SUCCESS\s*\([\d.]+s\):\s*(https?:\/\/\S+)/);
  if (m1 && !isAdUrl(m1[1])) return m1[1];

  // Parse DESTINATION lines
  const m2 = result.match(/DESTINATION[^:]*:\s*(https?:\/\/\S+)/);
  if (m2 && !isAdUrl(m2[1])) return m2[1];

  return null;
}

class TpiHandler extends BaseHandler {
  static HARDCODED = HARDCODED;

  get name() {
    return "tpi";
  }

  canHandle(url) {
    return TPI_HOSTS.some((h) => url.includes(h));
  }

  async extract($, html, url) {
    // Hardcoded check (instant)
    try {
      const alias = url.split('/').pop();
      if (alias && HARDCODED[alias]) {
        return { redirect: HARDCODED[alias] };
      }
    } catch {}

    // Nodriver only
    try {
      const dest = runNodriver(url);
      if (dest) return { redirect: dest };
    } catch (e) {
      // fall through
    }

    return null;
  }
}

module.exports = TpiHandler;
