import feedparser
import json
import os
import time
import urllib.request
import ssl
from datetime import datetime

# --- PATH CONFIGURATION ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_DATA_DIR = os.path.join(BASE_DIR, "..", "data", "raw_feeds")
CONFIG_PATH = os.path.join(BASE_DIR, "..", "data", "db", "user_config.json")

def load_feeds_from_db():
    if not os.path.exists(CONFIG_PATH):
        return []
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)
        return [s for s in config.get("sources", []) if s.get("active", True)]

def fetch_feeds():
    os.makedirs(RAW_DATA_DIR, exist_ok=True)
    feeds = load_feeds_from_db()
    
    all_entries = []
    
    # RedditのブロックとSSLエラーを強引に突破するための設定
    # 1. SSL証明書の検証を無効化 (Mac環境への対応)
    context = ssl._create_unverified_context()
    
    # 2. Chromeブラウザへのなりすまし
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    for feed in feeds:
        print(f"Fetching: {feed['name']}...")
        try:
            # 3. リクエストの実行
            req = urllib.request.Request(feed['url'], headers=headers)
            with urllib.request.urlopen(req, context=context) as response:
                xml_data = response.read()
            
            # 4. XMLをパース
            parsed = feedparser.parse(xml_data)
            
            count = 0
            for entry in parsed.entries:
                # フィルタ：24時間以内
                if hasattr(entry, "published_parsed"):
                    entry_time = time.mktime(entry.published_parsed)
                    if (time.time() - entry_time) > (24 * 3600):
                        continue
                
                content = entry.get("summary", "") or entry.get("content", [{"value": ""}])[0]["value"]
                
                all_entries.append({
                    "source": feed['name'],
                    "title": entry.get("title", ""),
                    "link": entry.get("link", ""),
                    "summary": content,
                    "published": entry.get("published", ""),
                    "fetched_at": str(datetime.now())
                })
                count += 1
                
            print(f"  -> Found {count} items in {feed['name']}")
        except Exception as e:
            print(f"  -> ERROR fetching {feed['name']}: {e}")

    # 重複排除
    unique_entries = {e['link']: e for e in all_entries}.values()

    today = datetime.now().strftime("%Y-%m-%d")
    output_path = os.path.join(RAW_DATA_DIR, f"{today}_raw.json")
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(list(unique_entries), f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ SUCCESS: Total {len(unique_entries)} items captured in {output_path}")
    return output_path

if __name__ == "__main__":
    fetch_feeds()
