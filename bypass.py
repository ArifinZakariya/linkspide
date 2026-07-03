"""
ShrinkMe.click Bypass Script
Resolved destination URL using cloudscraper + form submission

Usage:
    python bypass.py https://shrinkme.click/pRgC7uL
    python bypass.py (uses default URL)
"""

import cloudscraper
from bs4 import BeautifulSoup
import time
import sys
import json

def bypass_shrinkme(url):
    print(f"\n[.Target] {url}")
    
    url = url.rstrip('/')
    code = url.split("/")[-1]
    print(f"[.Code] {code}")
    
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
            print(f"\n[.Trying] {domain}")
            
            headers = {
                "referer": "https://mrproblogger.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            
            resp = client.get(target_url, headers=headers)
            
            if resp.status_code != 200:
                continue
            
            soup = BeautifulSoup(resp.content, "html.parser")
            inputs = soup.find_all("input")
            data = {inp.get('name'): inp.get('value', '') for inp in inputs if inp.get('name')}
            
            if not data:
                continue
            
            print(f"[.Wait] 15s...")
            time.sleep(15)
            
            go_headers = {
                "x-requested-with": "XMLHttpRequest",
                "referer": target_url,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            
            r = client.post(f"{domain}/links/go", data=data, headers=go_headers)
            result = r.json()
            
            if 'url' in result:
                final_url = result['url']
                print(f"\n{'='*60}")
                print(f"[+] DESTINATION URL:")
                print(f"    {final_url}")
                print(f"{'='*60}")
                return final_url
                
        except Exception as e:
            continue
    
    print("\n[-] All domains failed")
    return None

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://shrinkme.click/pRgC7uL"
    result = bypass_shrinkme(url)
    if result:
        print(f"\n[+] Copy: {result}")
