const axios = require("axios");

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const API_KEY = process.env.OPENROUTER_API_KEY || "";
const MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

class AiService {
  constructor() {
    this.client = axios.create({
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "ShortLink Bypass",
      },
    });
  }

  async chat(messages, opts = {}) {
    try {
      const res = await this.client.post(OPENROUTER_API, {
        model: opts.model || MODEL,
        messages,
        temperature: 0.1,
        max_tokens: opts.maxTokens || 2048,
      });
      return res.data.choices[0].message.content;
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      throw new Error(`AI Error: ${msg}`);
    }
  }

  async analyzePage(html, url) {
    const truncated = html.substring(0, 8000);
    const prompt = `You are a URL shortener bypass expert. Analyze this HTML page and extract the FINAL destination URL.

URL: ${url}

HTML (truncated):
${truncated}

RULES:
1. Look for: form actions, JavaScript redirects, meta refresh, data attributes, encoded URLs (base64, hex), hidden inputs with URLs
2. Look for patterns like: window.location, location.href, location.replace, var dest=, var url=, var link=
3. Look for base64 encoded URLs (decode them)
4. Look for obfuscated JavaScript that might contain URLs
5. Check for Cloudflare challenge pages
6. For OUO.IO: look for form action="/go/CODE" and extract the _token, then the real URL is often in base64 encoded token
7. For Linkvertise: look for targetUrl or data-target
8. IGNORE: google analytics, facebook pixels, ad trackers, CDN URLs, image URLs

RESPOND WITH EXACTLY THIS JSON FORMAT:
{
  "detected_service": "name of the shortener service or 'unknown'",
  "has_cloudflare": true/false,
  "has_captcha": true/false,
  "form_action": "the form action URL if found",
  "form_data": {"key": "value"} ,
  "redirect_url": "the direct redirect URL if found",
  "decoded_urls": ["list of decoded URLs found"],
  "final_url": "THE ACTUAL FINAL DESTINATION URL if you can determine it",
  "bypass_strategy": "description of how to bypass this page",
  "confidence": 0.0-1.0
}

Be precise. Extract the ACTUAL final URL if possible.`;

    const response = await this.chat([{ role: "user", content: prompt }], { maxTokens: 1024 });

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}

    return { final_url: null, bypass_strategy: response, confidence: 0 };
  }

  async solveOuo(html, url) {
    const truncated = html.substring(0, 6000);
    const prompt = `You are an OUO.IO bypass expert. This is an OUO.IO shortener page.

URL: ${url}

HTML:
${truncated}

OUO.IO WORKS LIKE THIS:
1. Page loads with a form that has action="/go/{CODE}"
2. Form has a hidden "_token" field
3. You need to POST to the form action URL with the _token
4. The response might have another form or redirect
5. The FINAL URL is often encoded in base64 within tokens or response data
6. Sometimes the URL is in format: hex40chars + year + alias + date + base64url

LOOK FOR:
- form action="/go/..." with _token input
- Any base64 strings that decode to URLs (especially starting with aHR0cHM6Ly9)
- JavaScript variables containing URLs
- The pattern: hex(40) + digits + base64(url)

DECODE any base64 you find. The base64 part often contains the final URL.

RESPOND WITH EXACTLY THIS JSON:
{
  "form_action": "full URL to POST to",
  "form_data": {"_token": "token_value"},
  "decoded_token_url": "URL decoded from base64 token",
  "final_url": "THE ACTUAL FINAL DOWNLOAD/DESTINATION URL",
  "raw_tokens": ["all base64 strings found"],
  "confidence": 0.0-1.0
}`;

    const response = await this.chat([{ role: "user", content: prompt }], { maxTokens: 1024 });

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}

    return { final_url: null, confidence: 0 };
  }

  async findDestinationUrl(html, url) {
    const truncated = html.substring(0, 6000);
    const prompt = `Extract the final destination URL from this page. This is likely a URL shortener or ad page.

URL: ${url}

HTML:
${truncated}

Find the ACTUAL destination URL. Look for:
- Any URL that looks like a file download, video, or content page
- Base64 encoded URLs (aHR0cHM6Ly9 = https://)
- Encoded JavaScript with URLs
- Form submissions that lead to the real URL
- Meta refresh redirects
- window.location redirects

IGNORE ads, trackers, analytics.

RESPOND WITH ONLY THE FINAL URL (nothing else). If you cannot find it, respond with "NOT_FOUND"`;

    const response = await this.chat([{ role: "user", content: prompt }], { maxTokens: 512 });
    const urlMatch = response.match(/https?:\/\/[^\s"'<>]+/);
    return urlMatch ? urlMatch[0] : null;
  }
}

module.exports = new AiService();
