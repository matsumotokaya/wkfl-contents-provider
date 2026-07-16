import feedparser
import json
import os
import time
import urllib.request
import urllib.parse
import ssl
import sys
import re
import argparse
from datetime import datetime
from bs4 import BeautifulSoup

# --- PATH CONFIGURATION ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_DATA_DIR = os.path.join(BASE_DIR, "..", "data", "raw_feeds")
PROFILES_DIR = os.path.join(BASE_DIR, "..", "profiles")
DEFAULT_PROFILE = "general"

# Google News regional domains. Single source of truth for both the search loop
# and the "N regions" status message. The active set is limited to English- and
# Japanese-language editions. Up to 9 editions are available; the additional
# non-English/Japanese ones are listed below and can be appended when needed.
GOOGLE_NEWS_REGIONS = [
    "news.google.com",      # US/Global (English)
    "news.google.co.uk",    # UK (English)
    "news.google.co.in",    # India (English)
    "news.google.com.au",   # Australia (English)
    "news.google.ca",       # Canada (English)
    "news.google.co.jp",    # Japan (Japanese)
]
# Additional editions (other languages). Append to GOOGLE_NEWS_REGIONS above to
# widen coverage back toward the 9-edition maximum:
#   "news.google.de"       # Germany (German)
#   "news.google.fr"       # France (French)
#   "news.google.com.br"   # Brazil (Portuguese)

# Default Google News collection parameters. Overridable per profile
# (google_news_limit / google_news_time_filter_hours in app/profiles/<name>.json).
DEFAULT_GOOGLE_NEWS_LIMIT = 20
DEFAULT_GOOGLE_NEWS_TIME_FILTER_HOURS = 168

def load_profile(profile_name):
    """Load an exploration profile (a 'cut' of sources/keywords) from app/profiles/<name>.json."""
    path = os.path.join(PROFILES_DIR, f"{profile_name}.json")
    if not os.path.exists(path):
        print(f"❌ Profile '{profile_name}' not found at {path}.", file=sys.stderr)
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def load_feeds_from_db(theme=None):
    profile = load_profile(theme or DEFAULT_PROFILE)
    if not profile:
        return []
    return [s for s in profile.get("sources", []) if s.get("active", True)]

def match_keywords(text_to_search, keywords):
    if not keywords:
        return True
    for kw in keywords:
        # If keyword is purely alphanumeric/spaces/hyphens, match it with word boundaries to avoid false substrings
        if re.match(r"^[a-zA-Z0-9\s\-_]+$", kw):
            pattern = rf"(?<![a-zA-Z0-9]){re.escape(kw)}(?![a-zA-Z0-9])"
            if re.search(pattern, text_to_search, re.IGNORECASE):
                return True
        else:
            # Japanese/Unicode direct substring match
            if kw.lower() in text_to_search.lower():
                return True
    return False


def fetch_html_content(url, headers, context, timeout=15):
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, context=context, timeout=timeout) as response:
            return response.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"    -> ERROR fetching URL {url}: {e}")
        return ""

def extract_forbes_summary(html):
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    # Forbes Japan article text container is .article-detail-txt
    container = soup.select_one(".article-detail-txt")
    if container:
        text = container.get_text(" ", strip=True)
        return text[:400]
    return ""

def extract_wired_summary(html):
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    # WIRED Japan article container is <article>
    container = soup.select_one("article")
    if container:
        text = container.get_text(" ", strip=True)
        return text[:400]
    return ""

def parse_html_forbes(feed, headers, context, default_keywords=None):
    print(f"  -> Parsing Forbes HTML page: {feed['url']}...")
    html = fetch_html_content(feed['url'], headers, context)
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    links = soup.find_all("a", href=re.compile(r"/articles/detail/\d+"))

    entries = []
    seen = set()
    keywords = feed.get("keywords") or (default_keywords or [])

    for a in links:
        href = a['href']
        if href.startswith("/"):
            href = "https://forbesjapan.com" + href
        if href in seen:
            continue
        seen.add(href)

        title = a.get_text(" ", strip=True)
        title = re.sub(r"\s+", " ", title)
        if len(title) < 5:
            continue

        # Keywords filtering on title
        if keywords:
            if not match_keywords(title, keywords):
                continue


        print(f"    -> Found matching Forbes article: {title[:50]}...")
        # Fetch the first paragraph or summary of the article
        art_html = fetch_html_content(href, headers, context)
        summary = extract_forbes_summary(art_html) or title

        entries.append({
            "source": feed['name'],
            "title": title,
            "link": href,
            "summary": summary,
            "published": str(datetime.now().strftime("%Y-%m-%d")),
            "fetched_at": str(datetime.now())
        })
        time.sleep(1) # Polite delay
        if len(entries) >= 5: # Limit active ingestion per run
            break

    return entries

def parse_html_wired(feed, headers, context, default_keywords=None):
    print(f"  -> Parsing WIRED HTML page: {feed['url']}...")
    html = fetch_html_content(feed['url'], headers, context)
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    links = []
    for a in soup.find_all("a", href=True):
        href = a['href']
        if "/article/" in href:
            if href.startswith("/"):
                href = "https://wired.jp" + href
            links.append((href, a.get_text(strip=True)))

    entries = []
    seen = set()
    keywords = feed.get("keywords") or (default_keywords or [])

    for href, text in links:
        if href in seen:
            continue
        seen.add(href)
        title = re.sub(r"\s+", " ", text)
        if len(title) < 5:
            continue

        # Keywords filtering on title
        if keywords:
            if not match_keywords(title, keywords):
                continue


        print(f"    -> Found matching WIRED article: {title[:50]}...")
        # Fetch summary of the article
        art_html = fetch_html_content(href, headers, context)
        summary = extract_wired_summary(art_html) or title

        entries.append({
            "source": feed['name'],
            "title": title,
            "link": href,
            "summary": summary,
            "published": str(datetime.now().strftime("%Y-%m-%d")),
            "fetched_at": str(datetime.now())
        })
        time.sleep(1) # Polite delay
        if len(entries) >= 5: # Limit active ingestion per run
            break

    return entries

def fetch_google_news(keywords, time_filter_hours, limit):
    """Fetch Google News from multiple regions worldwide, keyword filtered, newest first, limited to N items."""
    all_news = []

    context = ssl._create_unverified_context()
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    # Use the theme's keywords (from user_config.json) directly as the search
    # queries, so the search scope and the post-fetch filter are driven by the
    # exact same list. Regions come from the module-level GOOGLE_NEWS_REGIONS.
    search_queries = keywords or []

    for region in GOOGLE_NEWS_REGIONS:
        for query in search_queries:
            url = f"https://{region}/rss/search?q={urllib.parse.quote(query)}"
            try:
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, context=context, timeout=15) as response:
                    xml_data = response.read()

                parsed = feedparser.parse(xml_data)

                for entry in parsed.entries:
                    # Apply time filter
                    if time_filter_hours > 0:
                        parsed_time = None
                        if hasattr(entry, "published_parsed") and entry.published_parsed:
                            parsed_time = entry.published_parsed

                        if parsed_time:
                            entry_time = time.mktime(parsed_time)
                            if (time.time() - entry_time) > (time_filter_hours * 3600):
                                continue

                    # Check if any keyword matches
                    title = entry.get("title", "")
                    content = entry.get("summary", "")
                    text_to_search = title + " " + content

                    if match_keywords(text_to_search, keywords):
                        all_news.append({
                            "title": title,
                            "link": entry.get("link", ""),
                            "summary": content,
                            "published": entry.get("published", ""),
                            "fetched_at": str(datetime.now())
                        })

                time.sleep(0.3)  # Polite delay between requests
            except Exception as e:
                pass  # Skip on error

    # Deduplicate by link
    unique_news = {n['link']: n for n in all_news}.values()

    # Sort by published date (newest first)
    sorted_news = sorted(
        unique_news,
        key=lambda x: x.get('published', ''),
        reverse=True
    )

    # Limit to N items
    limited_news = sorted_news[:limit]

    # Add source name
    for item in limited_news:
        item['source'] = 'Google News'

    return list(limited_news)


def fetch_feeds(theme=None):
    os.makedirs(RAW_DATA_DIR, exist_ok=True)

    # Load default_keywords and Google News config from the selected profile
    profile = load_profile(theme or DEFAULT_PROFILE) or {}
    default_keywords = profile.get("default_keywords", [])
    google_news_keywords = profile.get("google_news_keywords", [])
    google_news_limit = profile.get("google_news_limit", DEFAULT_GOOGLE_NEWS_LIMIT)
    google_news_time_filter = profile.get("google_news_time_filter_hours", DEFAULT_GOOGLE_NEWS_TIME_FILTER_HOURS)

    all_entries = []

    # If theme has google_news_keywords, fetch and process Google News separately
    google_news_entries = []
    if google_news_keywords:
        print(f"Fetching: Google News (unified with {len(google_news_keywords)} keywords from {len(GOOGLE_NEWS_REGIONS)} regions)...")
        google_news_entries = fetch_google_news(google_news_keywords, google_news_time_filter, google_news_limit)
        print(f"  -> Found {len(google_news_entries)} items in Google News (after filtering & limiting to {google_news_limit})")
        all_entries.extend(google_news_entries)

    # Load and process regular feeds (RSS/HTML sources)
    feeds = load_feeds_from_db(theme=theme)

    if not feeds and not google_news_entries:
        print("No active RSS/HTML sources or Google News configured in user_config.json.", file=sys.stderr)
        return None

    # SSL configuration (mainly for MacOS compatibility)
    context = ssl._create_unverified_context()
    
    # Chrome User-Agent spoofing to bypass blocks
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    for feed in feeds:
        print(f"Fetching: {feed['name']}...")
        feed_type = feed.get("type", "rss")

        try:
            if feed_type == "html_forbes":
                entries = parse_html_forbes(feed, headers, context, default_keywords)
                all_entries.extend(entries)
                print(f"  -> Captured {len(entries)} items from Forbes HTML")
            elif feed_type == "html_wired":
                entries = parse_html_wired(feed, headers, context, default_keywords)
                all_entries.extend(entries)
                print(f"  -> Captured {len(entries)} items from WIRED HTML")
            else:
                # Default RSS flow
                req = urllib.request.Request(feed['url'], headers=headers)
                with urllib.request.urlopen(req, context=context) as response:
                    xml_data = response.read()
                
                parsed = feedparser.parse(xml_data)
                count = 0
                for entry in parsed.entries:
                    # Time-based filter: 24-hour by default, or custom hours if specified
                    time_filter_hours = feed.get("time_filter_hours", 24)  # Default 24 hours
                    if time_filter_hours > 0:  # Skip if time_filter_hours <= 0
                        parsed_time = None
                        if hasattr(entry, "published_parsed") and entry.published_parsed:
                            parsed_time = entry.published_parsed
                        elif hasattr(entry, "updated_parsed") and entry.updated_parsed:
                            parsed_time = entry.updated_parsed

                        if parsed_time:
                            entry_time = time.mktime(parsed_time)
                            if (time.time() - entry_time) > (time_filter_hours * 3600):
                                continue
                    
                    content = entry.get("summary", "") or entry.get("content", [{"value": ""}])[0]["value"]

                    # Keywords filter (use source keywords, or fall back to theme default_keywords)
                    keywords = feed.get("keywords") or default_keywords
                    if keywords:
                        title = entry.get("title", "")
                        text_to_search = title + " " + content
                        if not match_keywords(text_to_search, keywords):
                            continue


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
            
        time.sleep(2)  # Avoid rate limits

    # Deduplicate entries by link
    unique_entries = {e['link']: e for e in all_entries}.values()

    today = datetime.now().strftime("%Y-%m-%d")
    # Add theme suffix to filename if specified
    filename = f"{today}_raw.json" if not theme else f"{today}_{theme}_raw.json"
    output_path = os.path.join(RAW_DATA_DIR, filename)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(list(unique_entries), f, indent=2, ensure_ascii=False)

    if not unique_entries:
        print(f"\nERROR: No feed entries captured. Wrote empty file to {output_path}", file=sys.stderr)
        return None

    print(f"\n✅ SUCCESS: Total {len(unique_entries)} items captured in {output_path}")
    return output_path

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch RSS feeds for specified theme")
    parser.add_argument("--theme", default=None, help="Theme name (e.g., 'general', 'localllm')")
    args = parser.parse_args()
    raise SystemExit(0 if fetch_feeds(theme=args.theme) else 1)
