const { getClient, followRedirects } = require("./src/utils/httpClient");

(async () => {
  const client = getClient({ timeout: 10000 });

  // First, follow the redirectLink to see where it goes
  console.log("=== Follow redirectLink ===");
  const redirectLink = "https://insurance.cekresi.me/2024/08/15/top-auto-insurance-reviews-in-san-antonio-best-picks-for-maximum-coverage/";
  try {
    const res = await client.get(redirectLink, { maxRedirects: 10 });
    const finalUrl = res.request?.res?.responseUrl || "unknown";
    console.log("Final URL:", finalUrl);
    const html = typeof res.data === "string" ? res.data : "";
    console.log("HTML length:", html.length);
    
    // Look for pixeldrive
    const pd = html.match(/pixeldrive[^\s"'<>]*/gi);
    console.log("Pixeldrive refs:", pd);
    
    // Look for any interesting URLs
    const urls = html.match(/https?:\/\/[^\s"'<>]+/g) || [];
    const filtered = [...new Set(urls)].filter(u => 
      !u.includes("cekresi") && !u.includes("google") && !u.includes("cloudflare")
    );
    console.log("External URLs:", filtered.slice(0, 10));
  } catch(e) {
    console.log("Error:", e.message);
    if (e.response?.headers?.location) {
      console.log("Redirect to:", e.response.headers.location);
    }
  }

  // Now try with pndk.to to see full redirect chain
  console.log("\n=== Full redirect chain from pndk.to ===");
  const chain = await followRedirects("https://pndk.to/X2NfybmXf");
  for (const step of chain.steps) {
    console.log(step.status, step.url);
  }
  console.log("Final:", chain.finalUrl);

  // Check the article page more carefully for encrypted link patterns
  console.log("\n=== Check for encrypted/hidden link in article page ===");
  const res2 = await client.get(chain.finalUrl, { maxRedirects: 3 });
  const html2 = typeof res2.data === "string" ? res2.data : "";

  // Look for adtival_encrypted pattern
  const encMatch = html2.match(/adtival_encrypted['":\s]+([^,}<]+)/);
  console.log("adtival_encrypted:", encMatch ? encMatch[1] : "null");

  // Look for the actual Livewire component update - try different endpoint formats
  const endpoints = [
    "/livewire/message",
    "/livewire/update", 
    "/livewire",
    "/invest.datapendidikan.com/livewire/message",
  ];

  const setCookies = res2.headers["set-cookie"] || [];
  const cookies = {};
  for (const c of setCookies) {
    const [kv] = c.split(";");
    const [k, v] = kv.split("=");
    cookies[k?.trim()] = v?.trim();
  }
  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  
  const csrfMeta = html2.match(/<meta name=['"]_token['"] value=['"]([^'"]+)/);
  const csrf = csrfMeta ? csrfMeta[1] : "";

  const wireInit = html2.match(/wire:initial-data=['"](.+?)['"]/);
  const raw = wireInit[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'");
  const data = JSON.parse(raw);

  // Try Livewire v2 message format with proper JSON content type
  console.log("\n=== Try Livewire v2 message format ===");
  const payload = JSON.stringify({
    _token: csrf,
    components: [{
      snapshot: JSON.stringify(data),
      calls: [{
        path: "",
        method: "__dispatch",
        params: ["changePhase", []],
      }],
      updates: {},
      id: data.fingerprint.id,
    }],
  });

  for (const ep of endpoints) {
    const fullUrl = `https://invest.datapendidikan.com${ep}`;
    console.log(`\nTrying ${fullUrl}...`);
    try {
      const res3 = await client.post(fullUrl, payload, {
        headers: {
          "Content-Type": "application/json",
          "X-Livewire": "true",
          "X-CSRF-TOKEN": csrf,
          "Referer": "https://invest.datapendidikan.com/" + chain.finalUrl.split("/").pop(),
          "X-Requested-With": "XMLHttpRequest",
          "Cookie": cookieStr,
          "Accept": "application/json, text/html, */*",
        },
        timeout: 8000,
      });
      console.log("Status:", res3.status);
      const body = typeof res3.data === "string" ? res3.data : JSON.stringify(res3.data);
      console.log("Body:", body.substring(0, 2000));
    } catch(e) {
      console.log("Status:", e.response?.status, e.message);
    }
  }

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
