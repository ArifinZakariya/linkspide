import cloudscraper
from bs4 import BeautifulSoup
import time
import json
from flask import Flask, request, jsonify

app = Flask(__name__)

def bypass_shrinkme(url):
    code = url.rstrip('/').split('/')[-1]
    
    client = cloudscraper.create_scraper(allow_brotli=False)
    
    domains = [
        "https://en.shrinke.me",
        "https://shrinkme.click",
        "https://shrinke.me",
        "https://shrinkme.io"
    ]
    
    for domain in domains:
        try:
            target_url = f"{domain}/{code}"
            
            headers = {
                "referer": "https://mrproblogger.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            
            resp = client.get(target_url, headers=headers)
            
            if resp.status_code != 200:
                continue
            
            soup = BeautifulSoup(resp.content, "html.parser")
            inputs = soup.find_all("input")
            data = {inp.get('name'): inp.get('value', '') for inp in inputs if inp.get('name')}
            
            if not data:
                continue
            
            time.sleep(12)
            
            go_headers = {
                "x-requested-with": "XMLHttpRequest",
                "referer": target_url,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            
            r = client.post(f"{domain}/links/go", data=data, headers=go_headers)
            result = r.json()
            
            if 'url' in result:
                return {
                    "success": True,
                    "url": result['url'],
                    "message": result.get('message', ''),
                    "domain_used": domain
                }
                
        except Exception as e:
            continue
    
    return {"success": False, "error": "All bypass methods failed"}

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})

@app.route('/api/shrinkme', methods=['POST'])
def shrinkme():
    data = request.get_json()
    url = data.get('url')
    
    if not url:
        return jsonify({"error": "URL is required"}), 400
    
    result = bypass_shrinkme(url)
    return jsonify(result)

@app.route('/api/bypass', methods=['POST'])
def bypass():
    data = request.get_json()
    url = data.get('url')
    
    if not url:
        return jsonify({"error": "URL is required"}), 400
    
    result = bypass_shrinkme(url)
    return jsonify(result)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
