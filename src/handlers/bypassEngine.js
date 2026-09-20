const { load } = require("cheerio");
const { followRedirects } = require("../utils/httpClient");
const { identifyShortener } = require("./registry");

const OuoHandler = require("./OuoHandler");
const LinkvertiseHandler = require("./LinkvertiseHandler");
const PhpShortenerHandler = require("./PhpShortenerHandler");
const ShrinkmeHandler = require("./ShrinkmeHandler");
const GplinksHandler = require("./GplinksHandler");
const SafelinkHandler = require("./SafelinkHandler");
const CountdownHandler = require("./CountdownHandler");
const TokenBypassHandler = require("./TokenBypassHandler");
const ObfuscatedHandler = require("./ObfuscatedHandler");
const GenericRedirectHandler = require("./GenericRedirectHandler");
const TpiHandler = require("./TpiHandler");
const SflHandler = require("./SflHandler");
const livewireHandler = require("./LivewireHandler");

const handlers = [
  new SflHandler(),
  new TpiHandler(),
  new OuoHandler(),
  new LinkvertiseHandler(),
  new PhpShortenerHandler(),
  new ShrinkmeHandler(),
  new GplinksHandler(),
  new SafelinkHandler(),
  new CountdownHandler(),
  new TokenBypassHandler(),
  new ObfuscatedHandler(),
  new GenericRedirectHandler(),
];

const OVERALL_TIMEOUT = 90000;

async function decodeToken(url, token) {
  if (!token) return null;
  try {
    const patterns = [
      /([A-Za-z0-9+\/]{40,}={0,2})/,
      /atob\s*\(\s*["']([A-Za-z0-9+\/=]{20,})/,
    ];
    for (const p of patterns) {
      const match = token.match(p);
      if (match) {
        const decoded = Buffer.from(match[1], "base64").toString("utf-8");
        const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
        if (urlMatch) return urlMatch[0];
      }
    }
    const hexMatch = token.match(/^([0-9a-f]{40})/);
    if (hexMatch) {
      const rest = token.slice(40).replace(/^[0-9]+/, "");
      const b64Match = rest.match(/(aHR0cHM6Ly9[A-Za-z0-9+\/=]+)/);
      if (b64Match) {
        const decoded = Buffer.from(b64Match[1], "base64").toString("utf-8");
        const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
        if (urlMatch) return urlMatch[0];
      }
    }
  } catch {}
  return null;
}

async function submitForm(action, formData, referer, client) {
  try {
    const params = new URLSearchParams(formData);
    const res = await client.post(action, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: referer || action,
        Origin: new URL(action).origin,
      },
      maxRedirects: 0,
      validateStatus: (s) => s < 400 || s === 301 || s === 302 || s === 303,
    });
    return res;
  } catch (err) {
    if (err.response?.headers?.location) {
      return { data: "", headers: err.response.headers, status: err.response.status };
    }
    throw err;
  }
}

async function resolveUrl(url, maxDepth = 15) {
  const chain = [];
  let current = url;
  const visited = new Set();
  let cloudflareDetected = false;
  const startTime = Date.now();

  // Unwrap Facebook l.php / fb redirect links
  if (/facebook\.com\/l\.php|fbclid/.test(current)) {
    try {
      const u = new URL(current);
      const target = u.searchParams.get("u");
      if (target && target.startsWith("http")) {
        chain.push({ url: current, status: "facebook-unwrap", to: target });
        current = target;
      }
    } catch {}
  }

  for (let depth = 0; depth < maxDepth; depth++) {
    if (Date.now() - startTime > OVERALL_TIMEOUT) {
      chain.push({ note: "Overall timeout reached", final: true });
      break;
    }

    if (visited.has(current)) {
      chain.push({ url: current, status: "loop-detected", final: true });
      break;
    }
    visited.add(current);

    const shortener = identifyShortener(current);
    chain.push({ url: current, shortener: shortener || "Unknown" });

    try {
      const isLivewire = livewireHandler.canHandle(current);

      if (isLivewire) {
        chain.push({ method: "livewire", status: "attempting direct Livewire bypass" });
        const lwResult = await livewireHandler.solve(current, (m) => chain.push({ log: m }));
        if (lwResult.success && lwResult.url) {
          chain.push({ method: "livewire", status: "success", url: lwResult.url });
          current = lwResult.url;
          continue;
        }
        chain.push({ method: "livewire", status: "failed", error: lwResult.error || "No link captured" });
      }

      const { finalUrl, steps, html } = await followRedirects(current);
      chain.push(...steps.map((s) => ({ ...s, shortener: shortener || "Unknown" })));

      const isCf = html && (
        html.includes("Just a moment") ||
        html.includes("cf-browser-verification") ||
        html.includes("cf_chl_opt") ||
        html.includes("challenge-platform")
      );

      if (isCf) cloudflareDetected = true;

      // For shrinkme.click, try handler directly (bypass Cloudflare check)
      if (cloudflareDetected && /shrinkme\.click|shrinke\.me/.test(current)) {
        const shrinkmeHandler = handlers.find(h => h.name === "shrinkme");
        if (shrinkmeHandler) {
          try {
            const found = await shrinkmeHandler.extract(null, "", current);
            if (found && found.redirect) {
              chain.push({ handler: "shrinkme", extracted: found, method: "direct-bypass" });
              current = found.redirect;
              continue;
            }
          } catch (e) {}
        }
      }

      // For sfl.* (AWS WAF), try handler directly even if html empty / WAF
      if (/sfl\.(gl|link)/i.test(current)) {
        const sflHandler = handlers.find(h => h.name === "sfl");
        if (sflHandler) {
          try {
            const { load } = require("cheerio");
            const $tmp = html ? load(html) : load("<html></html>");
            const found = await sflHandler.extract($tmp, html || "", current);
            if (found && found.redirect) {
              chain.push({ handler: "sfl", extracted: found, method: "direct-bypass" });
              current = found.redirect;
              continue;
            }
          } catch (e) {}
        }
      }

      if (finalUrl === current && html) {
        const $ = load(html);
        let found = null;

        // Try handlers first, even if Cloudflare is detected
        for (const handler of handlers) {
          if (handler.canHandle(current)) {
            found = await handler.extract($, html, current);
        if (found) {
          chain.push({ handler: handler.name, extracted: found });
          if (found.finalUrl) {
            current = found.finalUrl;
            chain.push({ method: "final", url: current, final: true });
            return { resolved: current, chain, depth, cloudflare: cloudflareDetected };
          }
          break;
        }
          }
        }

        if (!found && cloudflareDetected) {
          chain.push({ note: "Cloudflare detected - cannot bypass via HTTP", final: true });
          return { resolved: current, chain, depth, cloudflare: cloudflareDetected };
        }

        if (!found) {
          // Special handling for TPI - requires Puppeteer / captcha solve
          if (/tpi\.(li|ac)|srtam\.com/i.test(current)) {
            chain.push({ note: "TPI requires Turnstile captcha - use /api/organic with Puppeteer service", final: true });
            return { resolved: current, chain, depth, cloudflare: cloudflareDetected, error: "TPI requires Turnstile captcha - use organic bypass with Puppeteer service" };
          }
          chain.push({ final: true });
          return { resolved: current, chain, depth, cloudflare: cloudflareDetected };
        }

        if (found.redirect) {
          // Filter ad URLs
          if (/taboola\.com|advertisingcamps\.com|hai8g\.com|warlessstarved|peccaryentraps|ek\.warlessstarved|sxa?\.peccaryentraps|cloudfront\.net.*\?zgiqd/i.test(found.redirect)) {
            chain.push({ note: "Handler returned ad URL, ignoring", redirect: found.redirect, final: true });
            return { resolved: current, chain, depth, cloudflare: cloudflareDetected, error: "Handler returned ad URL - captcha required" };
          }
          current = found.redirect.startsWith("http")
            ? found.redirect
            : new URL(found.redirect, current).href;
          continue;
        }

        if (found.formData && found.formAction) {
          const decoded = await decodeToken(current, found.formData.token || found.formData._token || "");
          if (decoded) {
            // Filter ad destinations
            if (!/taboola\.com|advertisingcamps\.com|hai8g\.com|warlessstarved|peccaryentraps|cloudfront\.net/i.test(decoded)) {
              chain.push({ decoded, method: "token-decode" });
              current = decoded;
              continue;
            }
          }

          try {
            const { getClient } = require("../utils/httpClient");
            const client = getClient();
            const postUrl = found.formAction.startsWith("http")
              ? found.formAction
              : new URL(found.formAction, current).href;
            // Skip known ad form actions without captcha - they just lead to ads
            if (/advertisingcamps\.com|hai8g\.com|taboola\.com/i.test(postUrl)) {
              chain.push({ note: "Skipping ad form submit without captcha", action: postUrl, final: true });
              return { resolved: current, chain, depth, cloudflare: cloudflareDetected, error: "Captcha required - use organic bypass with Puppeteer" };
            }
            const formRes = await submitForm(postUrl, found.formData, current, client);
            const loc = formRes.headers?.location;
            if (loc) {
              // Filter ad redirects
              if (/taboola\.com|advertisingcamps\.com|hai8g\.com/i.test(loc)) {
                chain.push({ note: "Form submit led to ad page, not destination", redirect: loc, final: true });
                return { resolved: current, chain, depth, cloudflare: cloudflareDetected, error: "Form submit returned ad page - captcha required" };
              }
              current = loc.startsWith("http") ? loc : new URL(loc, postUrl).href;
              chain.push({ formSubmit: true, redirect: current });
              continue;
            }
          } catch {}

          chain.push({ final: true });
          return { resolved: current, chain, depth, cloudflare: cloudflareDetected };
        }

        chain.push({ final: true });
        return { resolved: current, chain, depth, cloudflare: cloudflareDetected };
      } else {
        current = finalUrl;
      }
    } catch (err) {
      chain.push({ url: current, status: "error", error: err.message, final: true });
      return { resolved: current, chain, depth, error: err.message };
    }
  }

  return { resolved: current, chain, depth: maxDepth };
}

module.exports = { resolveUrl };
