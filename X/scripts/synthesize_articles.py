import argparse
import json
import os
import re
import ssl
import urllib.request
from datetime import datetime
from urllib.parse import urlparse

from anthropic import Anthropic
from bs4 import BeautifulSoup
from dotenv import load_dotenv

from wkfl_pipeline import (
    FACT_MAX_TOKENS,
    PODCAST_MAX_TOKENS,
    STYLE_MAX_TOKENS,
    build_podcast_script_prompt,
    build_selected_article_prompt,
    build_selected_dossier_prompt,
    call_model,
    extract_title,
    format_japanese_date,
    format_japanese_spoken_date,
    format_slash_date,
    prepend_title_to_podcast,
    resolve_models,
)

# --- LOAD .env ---
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

# --- PATH CONFIGURATION ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# --- MODEL CONFIGURATION ---
DEFAULT_MODEL = "claude-sonnet-4-6"
MIN_ARTICLE_CONTENT_CHARS = 1000

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
)

def clean_text(text):
    text = re.sub(r"\s+", " ", text or "")
    return text.strip()


def split_title_and_site(raw_title):
    separators = [" | ", " - ", "｜"]
    for separator in separators:
        if separator in raw_title:
            parts = [clean_text(part) for part in raw_title.split(separator) if clean_text(part)]
            if len(parts) >= 2:
                return separator.join(parts[:-1]), parts[-1]
    return raw_title, ""


def parse_date_string(value):
    if not value:
        return None

    candidate = value.strip()
    candidate = candidate.replace("Z", "+00:00")

    try:
        return datetime.fromisoformat(candidate)
    except ValueError:
        pass

    patterns = [
        r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})",
        r"(\d{4})\.(\d{1,2})\.(\d{1,2})",
        r"(\d{4})年(\d{1,2})月(\d{1,2})日",
    ]
    for pattern in patterns:
        match = re.search(pattern, candidate)
        if match:
            year, month, day = [int(part) for part in match.groups()]
            return datetime(year, month, day)

    return None


def format_publication_date(value):
    dt = parse_date_string(value)
    if not dt:
        return None
    return f"{dt.year}年{dt.month}月{dt.day}日"


def normalize_site_name(site_name):
    cleaned = clean_text(site_name)
    cleaned = re.sub(r"\s*公式サイト.*$", "", cleaned)
    return cleaned


def fetch_html(url):
    context = ssl._create_unverified_context()
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, context=context, timeout=30) as response:
        return response.read().decode("utf-8", errors="ignore")


def extract_json_ld(soup):
    objects = []
    for node in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = node.string or node.get_text()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(data, list):
            objects.extend(data)
        else:
            objects.append(data)
    return objects


def first_text(soup, selectors):
    for selector in selectors:
        node = soup.select_one(selector)
        if node:
            if node.name == "meta":
                content = node.get("content")
            elif node.has_attr("datetime"):
                content = node.get("datetime")
            else:
                content = node.get_text(" ", strip=True)
            if content:
                return clean_text(content)
    return ""


def extract_article_text(soup, json_ld_objects):
    for obj in json_ld_objects:
        if isinstance(obj, dict) and obj.get("articleBody"):
            body = clean_text(obj.get("articleBody"))
            if len(body) > 400:
                return body

    selectors = [
        "article",
        "main",
        ".article-body",
        ".post-content",
        ".entry-content",
        ".itemizedBox",
        ".it-MdContent",
        "#main",
    ]
    for selector in selectors:
        node = soup.select_one(selector)
        if node:
            text = clean_text(node.get_text(" ", strip=True))
            if len(text) > 400:
                return text

    body = soup.body.get_text(" ", strip=True) if soup.body else ""
    return clean_text(body)


def extract_metadata(url, html):
    soup = BeautifulSoup(html, "html.parser")
    json_ld_objects = extract_json_ld(soup)

    raw_title = first_text(
        soup,
        [
            'meta[property="og:title"]',
            'meta[name="twitter:title"]',
            "title",
        ],
    )
    if not raw_title:
        for obj in json_ld_objects:
            if isinstance(obj, dict) and obj.get("headline"):
                raw_title = clean_text(obj["headline"])
                break

    title, title_site_name = split_title_and_site(raw_title or "")

    site_name = first_text(
        soup,
        [
            'meta[property="og:site_name"]',
            'meta[name="application-name"]',
        ],
    )
    if not site_name:
        for obj in json_ld_objects:
            publisher = obj.get("publisher") if isinstance(obj, dict) else None
            if isinstance(publisher, dict) and publisher.get("name"):
                site_name = clean_text(publisher["name"])
                break
    if title_site_name and (
        not site_name or "株式会社" in site_name or "|" in site_name or len(site_name) > 30
    ):
        site_name = title_site_name
    if not site_name:
        site_name = urlparse(url).netloc.replace("www.", "")

    published_raw = first_text(
        soup,
        [
            ".style-3k9iaf",
            ".post-date",
            ".entry-date",
            ".published",
            ".date",
            'meta[property="article:published_time"]',
            'meta[property="og:published_time"]',
            'meta[name="parsely-pub-date"]',
            'meta[name="publish-date"]',
            'meta[itemprop="datePublished"]',
        ],
    )
    if not published_raw:
        for obj in json_ld_objects:
            if isinstance(obj, dict) and obj.get("datePublished"):
                published_raw = clean_text(obj["datePublished"])
                break
    if not published_raw:
        normalized_html = re.sub(r'\\+"', '"', html)
        regex_patterns = [
            r'Posted at <time[^>]+dateTime="([^"]+)"',
            r'"datePublished"\s*:\s*"([^"]+)"',
        ]
        for haystack in [html, normalized_html]:
            for pattern in regex_patterns:
                match = re.search(pattern, haystack)
                if match:
                    published_raw = clean_text(match.group(1))
                    break
            if published_raw:
                break

    article_text = extract_article_text(soup, json_ld_objects)

    return {
        "url": url,
        "site_name": normalize_site_name(site_name),
        "title": title or raw_title or url,
        "published_raw": published_raw,
        "published_jp": format_publication_date(published_raw),
        "content": article_text[:6000],
    }


def normalize_manual_article(article):
    published_jp = article.get("published_jp")
    if not published_jp:
        published_jp = format_publication_date(
            article.get("published_raw") or article.get("published") or article.get("date")
        )
    return {
        "url": article.get("url", ""),
        "site_name": normalize_site_name(article.get("site_name") or article.get("media") or "Manual Source"),
        "title": article.get("title", ""),
        "published_raw": article.get("published_raw") or article.get("published") or article.get("date", ""),
        "published_jp": published_jp,
        "content": clean_text(article.get("content", ""))[:6000],
    }


def load_manual_articles(paths):
    articles = []
    for path in paths:
        with open(path, "r", encoding="utf-8") as file:
            payload = json.load(file)
        if isinstance(payload, dict):
            payload = [payload]
        for item in payload:
            articles.append(normalize_manual_article(item))
    return articles


def resolve_edition_datetime(edition_date):
    if not edition_date:
        return datetime.now()
    return datetime.strptime(edition_date, "%Y-%m-%d")


def write_text(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as file:
        file.write(content)


def render_article_content(articles):
    chunks = []
    for index, article in enumerate(articles, start=1):
        publication_line = article["published_jp"] or "公開日の確認が取れていない"
        chunks.append(
            "\n".join(
                [
                    "---",
                    f"#{index}. {article['title']}",
                    f"Media: {article['site_name']}",
                    f"Publication date: {publication_line}",
                    f"URL: {article['url']}",
                    f"Content: {article['content']}",
                ]
            )
        )

    return "\n".join(chunks)


def synthesize_articles(urls, model=None, edition_date=None, manual_article_files=None):
    fact_model, style_model = resolve_models(DEFAULT_MODEL, model)
    manual_article_files = manual_article_files or []

    articles = []
    for url in urls:
        print(f"Fetching article: {url}")
        html = fetch_html(url)
        article = extract_metadata(url, html)
        if len(article["content"]) < MIN_ARTICLE_CONTENT_CHARS:
            raise RuntimeError(
                "Could not extract enough article text from "
                f"{url}. The page may be paywalled, login-protected, or JS-rendered."
            )
        print(
            f"  -> Parsed: {article['site_name']} / "
            f"{article['title'][:60]} / "
            f"{article['published_jp'] or 'date unknown'}"
        )
        articles.append(article)

    articles.extend(load_manual_articles(manual_article_files))
    edition_dt = resolve_edition_datetime(edition_date)
    today_date = format_japanese_date(edition_dt)
    spoken_date = format_japanese_spoken_date(edition_dt)
    slash_date = format_slash_date(edition_dt)
    client = Anthropic()
    article_content = render_article_content(articles)

    dossier_prompt = build_selected_dossier_prompt(
        article_content,
        today_date,
        len(articles),
    )
    print(f"Estimated stage 1 input tokens: ~{len(dossier_prompt) // 4:,}")
    dossier, _ = call_model(
        client,
        fact_model,
        dossier_prompt,
        FACT_MAX_TOKENS,
        "Stage 1 dossier",
    )

    article_prompt = build_selected_article_prompt(dossier, today_date, spoken_date, slash_date)
    print(f"Estimated stage 2 input tokens: ~{len(article_prompt) // 4:,}")
    article, _ = call_model(
        client,
        style_model,
        article_prompt,
        STYLE_MAX_TOKENS,
        "Stage 2 article",
    )

    podcast_prompt = build_podcast_script_prompt(article, spoken_date)
    print(f"Estimated stage 3 input tokens: ~{len(podcast_prompt) // 4:,}")
    podcast_script_raw, _ = call_model(
        client,
        style_model,
        podcast_prompt,
        PODCAST_MAX_TOKENS,
        "Stage 3 podcast script",
    )
    podcast_script = prepend_title_to_podcast(podcast_script_raw, extract_title(article))

    return dossier, article, podcast_script


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate a WKFL spot briefing from article URLs."
    )
    parser.add_argument("urls", nargs="+", help="Article URLs to summarize")
    parser.add_argument(
        "--output",
        help="Optional output path. Defaults to articles/YYYY-MM-DD/articles.md",
    )
    parser.add_argument(
        "--edition-date",
        help="Article edition date in YYYY-MM-DD. Useful when preparing tomorrow's briefing in advance.",
    )
    parser.add_argument(
        "--manual-article-file",
        action="append",
        default=[],
        help="Path to a JSON file containing one manual article object or a list of article objects.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    timestamp_base = args.edition_date or datetime.now().strftime("%Y-%m-%d")
    timestamp = f"{timestamp_base}_{datetime.now().strftime('%H%M')}"

    dossier, article, podcast_script = synthesize_articles(
        args.urls,
        edition_date=args.edition_date,
        manual_article_files=args.manual_article_file,
    )

    article_dir = os.path.abspath(os.path.join(PROJECT_ROOT, "articles", timestamp_base))
    article_path = args.output or os.path.join(article_dir, "articles.md")
    podcast_path = os.path.join(article_dir, "articles_podcast.md")
    dossier_path = os.path.join(article_dir, "articles_dossier.md")
    write_text(article_path, article)
    write_text(podcast_path, podcast_script)
    write_text(dossier_path, dossier)

    print(f"\n✅ Saved article bundle -> {article_dir}")


if __name__ == "__main__":
    main()
