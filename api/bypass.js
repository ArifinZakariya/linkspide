const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ 
      error: 'Missing url parameter',
      usage: '?url=https://shrinkme.click/xxxxx'
    });
  }

  try {
    const result = await bypassShrinkme(url);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

async function bypassShrinkme(url) {
  const code = url.replace(/\/$/, '').split('/').pop();
  
  const domains = [
    'https://en.shrinke.me',
    'https://shrinkme.click',
    'https://shrinke.me'
  ];

  const client = axios.create({
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    }
  });

  for (const domain of domains) {
    try {
      const targetUrl = `${domain}/${code}`;
      
      // GET request with referer
      const resp = await client.get(targetUrl, {
        headers: { 'referer': 'https://mrproblogger.com/' }
      });

      if (resp.status !== 200) continue;

      // Parse form data
      const $ = cheerio.load(resp.data);
      const formData = {};
      $('input').each((_, el) => {
        const name = $(el).attr('name');
        const value = $(el).attr('value') || '';
        if (name) formData[name] = value;
      });

      if (Object.keys(formData).length === 0) continue;

      // Wait 12 seconds (Vercel timeout is 10s for hobby, 60s for pro)
      await new Promise(resolve => setTimeout(resolve, 12000));

      // POST to /links/go
      const goResp = await client.post(`${domain}/links/go`, 
        new URLSearchParams(formData).toString(),
        {
          headers: {
            'x-requested-with': 'XMLHttpRequest',
            'referer': targetUrl,
            'content-type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const result = goResp.data;
      
      if (result && result.url) {
        return {
          success: true,
          source: url,
          destination: result.url,
          message: result.message || 'OK'
        };
      }

    } catch (e) {
      continue;
    }
  }

  throw new Error('All bypass methods failed');
}
