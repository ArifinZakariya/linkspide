const { load } = require("cheerio");
const { followRedirects } = require("../utils/httpClient");
const { identifyShortener } = require("./registry");

const OuoHandler = require("./OuoHandler");
const LinkvertiseHandler = require("./LinkvertiseHandler");
const ShrinkmeHandler = require("./ShrinkmeHandler");
const GplinksHandler = require("./GplinksHandler");
const SafelinkHandler = require("./SafelinkHandler");
const CountdownHandler = require("./CountdownHandler");
const TokenBypassHandler = require("./TokenBypassHandler");
const ObfuscatedHandler = require("./ObfuscatedHandler");
const GenericRedirectHandler = require("./GenericRedirectHandler");
const livewireHandler = require("./LivewireHandler");

const handlers = [
  new OuoHandler(),
  new LinkvertiseHandler(),
  new ShrinkmeHandler(),
  new GplinksHandler(),
  new SafelinkHandler(),
  new CountdownHandler(),
  new TokenBypassHandler(),
  new ObfuscatedHandler(),
  new GenericRedirectHandler(),
];

const OVERALL_TIMEOUT = 25000;

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
        html.includes("cf_chl_opt")
      );

      if (isCf) cloudflareDetected = true;

      if (finalUrl === current && html) {
        const $ = load(html);
        let found = null;

        for (const handler of handlers) {
          if (handler.canHandle(current)) {
            found = await handler.extract($, html, current);
            if (found) {
              chain.push({ handler: handler.name, extracted: found });
              break;
            }
          }
        }

        if (!found) {
          if (cloudflareDetected) {
            chain.push({ note: "Cloudflare detected - cannot bypass via HTTP", final: true });
          } else {
            chain.push({ final: true });
          }
          return { resolved: current, chain, depth, cloudflare: cloudflareDetected };
        }

        if (found.redirect) {
          current = found.redirect.startsWith("http")
            ? found.redirect
            : new URL(found.redirect, current).href;
          continue;
        }

        if (found.formData && found.formAction) {
          const decoded = await decodeToken(current, found.formData.token || found.formData._token || "");
          if (decoded) {
            chain.push({ decoded, method: "token-decode" });
            current = decoded;
            continue;
          }

          try {
            const { getClient } = require("../utils/httpClient");
            const client = getClient();
            const postUrl = found.formAction.startsWith("http")
              ? found.formAction
              : new URL(found.formAction, current).href;
            const formRes = await submitForm(postUrl, found.formData, current, client);
            const loc = formRes.headers?.location;
            if (loc) {
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
