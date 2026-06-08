const express = require("express");
const { resolveUrl } = require("./handlers/bypassEngine");
const { identifyShortener } = require("./handlers/registry");
const genericOrganic = require("./handlers/GenericOrganic");

const router = express.Router();

router.post("/resolve", async (req, res) => {
  try {
    const { url, browser, ai } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: "Invalid URL" }); }

    const shortener = identifyShortener(parsed.href);
    const result = await resolveUrl(parsed.href, 15, { useBrowser: browser === true, useAi: ai !== false });

    res.json({
      original: parsed.href,
      resolved: result.resolved,
      success: !result.error,
      shortener: shortener || "Unknown",
      depth: result.depth,
      chain: result.chain,
      cloudflare: result.cloudflare || false,
      error: result.error || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/organic", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: "Invalid URL" }); }

    if (!genericOrganic.isAvailable()) return res.status(500).json({ error: "Puppeteer not installed" });

    const result = await genericOrganic.visit(parsed.href);

    res.json({
      original: parsed.href,
      resolved: result.url || null,
      success: result.success,
      service: result.service || null,
      method: result.method || null,
      logs: result.logs,
      error: result.error || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/check", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });
  try {
    let valid = false;
    try { new URL(url); valid = true; } catch {}
    const shortener = identifyShortener(url);
    const service = genericOrganic.detectService(url);
    res.json({ url, valid, known: !!shortener, service: shortener || service?.name || "Unknown", shortener: shortener || "Unknown", detectedService: service?.name || "Unknown" });
  } catch { res.status(400).json({ error: "Invalid URL" }); }
});

module.exports = router;
