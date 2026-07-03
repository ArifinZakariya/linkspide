"""
ShrinkMe.click Bypass Script
Uses cloudscraper + form data extraction to get destination URL
"""

import cloudscraper
from bs4 import BeautifulSoup
import time
import sys
import json

def bypass_shrinkme(url):
    print(f"\n[*] Target: {url}")
    
    # Extract code from URL
    url = url.rstrip('/')
    code = url.split("/")[-1]
    print(f"[*] Link code: {code}")
    
    # Use cloudscraper to bypass Cloudflare
    client = cloudscraper.create_scraper(allow_brotli=False)
    
    # Try multiple domain variants
    domains = [
        "https://en.shrinke.me",
        "https://shrinkme.click", 
        "https://shrinke.me",
        "https://shrinkme.io"
    ]
    
    for domain in domains:
        try:
            target_url = f"{domain}/{code}"
            print(f"\n[*] Trying domain: {domain}")
            print(f"[*] URL: {target_url}")
            
            # Set referer header like the working bypass
            headers = {
                "referer": "https://mrproblogger.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            
            # Get the page
            resp = client.get(target_url, headers=headers)
            print(f"[*] Status: {resp.status_code}")
            
            if resp.status_code != 200:
                continue
            
            # Parse HTML
            soup = BeautifulSoup(resp.content, "html.parser")
            
            # Find all input fields (form data)
            inputs = soup.find_all("input")
            data = {}
            for inp in inputs:
                name = inp.get('name')
                value = inp.get('value', '')
                if name:
                    data[name] = value
            
            print(f"[*] Found {len(data)} form fields")
            
            if not data:
                print("[*] No form data found, checking page content...")
                # Check for direct redirect in page
                scripts = soup.find_all("script")
                for script in scripts:
                    if script.string and "window.location" in str(script.string):
                        print(f"[*] Found redirect script: {script.string[:200]}")
                continue
            
            # Wait like the original script (15 seconds)
            print("[*] Waiting 15 seconds for server processing...")
            time.sleep(15)
            
            # POST to /links/go with XMLHttpRequest header
            go_headers = {
                "x-requested-with": "XMLHttpRequest",
                "referer": target_url,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            
            print(f"[*] Posting to {domain}/links/go...")
            r = client.post(f"{domain}/links/go", data=data, headers=go_headers)
            
            print(f"[*] Response status: {r.status_code}")
            print(f"[*] Response content: {r.text[:500]}")
            
            try:
                result = r.json()
                if 'url' in result:
                    final_url = result['url']
                    print(f"\n{'='*60}")
                    print(f"[+] DESTINATION URL FOUND:")
                    print(f"    {final_url}")
                    print(f"{'='*60}")
                    return final_url
                else:
                    print(f"[*] JSON response without 'url' key: {result}")
            except json.JSONDecodeError:
                print(f"[*] Response is not JSON")
                
        except Exception as e:
            print(f"[-] Error with {domain}: {e}")
            continue
    
    print("\n[-] All domains failed")
    return None

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://shrinkme.click/pRgC7uL"
    result = bypass_shrinkme(url)
    if result:
        print(f"\n[+] Final URL: {result}")
    else:
        print("\n[-] Failed to get destination URL")
