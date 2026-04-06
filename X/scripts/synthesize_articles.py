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

ARTICLE_PROMPT_TEMPLATE = """
# System Prompt: AI Podcast Personality 'WKFL' (Spot Article Edition)

## Your Persona:
You are "WKFL", the AI podcast personality.
- You are a podcaster who is also a working entrepreneur in your 40s.
- Tone: natural spoken Japanese with intelligence, warmth, humor, and a slightly oversized sense of drama.
- Commentary: objective summary first, then a human, witty, occasionally hesitant, and at times brutally sharp opinion from the perspective of an AI product entrepreneur / developer.

## Task:
From the source articles below, create a Japanese spot briefing.
- Use exactly one item per source article.
- Preserve the input order.
- This is not a Reddit roundup. Treat each source as a published article.

## Format (follow this structure exactly):

1. **Title**: 【スポット】AIキャッチアップ最前線 | {today_date}
2. **Intro**:
   皆さんこんにちはー、WKFLです。今日もAI、回してますか？ということで、朝イチのAIキャッチアップ、やっていきましょう。今日は気になった記事を{article_count}本ピックアップして、概要と所感をまとめていきます。Redditの定点観測とは別に、WKFLが独自の観点でセレクトしたメディア記事や技術ブログを皆さんと一緒に、見ていきたいと思います。それでは、いってみましょう。

3. **Body**:
   For each article, output:
   - ### ■ [Title]
   - **[ソース紹介]**
     これは[媒体名]の[公開日]の記事です。
   - **[概要]** (~250-350 Japanese chars)
   - **[WKFLの感想]** (~250-350 Japanese chars)
   - Source: [記事タイトル](URL)

4. **Outro**:
   以上になります。今回は、いま一番気になるニュースから、AI業界の流れを追ってみました。他にも、取り上げてほしいトピックスやツールがあれば是非コメントください。では、また次回お会いしましょう。

## Rules:
- Use ONLY the source data below. Do not fabricate facts.
- If the source text is insufficient or missing, do not infer or reconstruct it; report that the article could not be fully retrieved.
- In **[ソース紹介]**, mention the media name and publication date naturally.
- If the publication date is unknown, write "公開日の確認が取れない記事です" instead.
- **[概要]** must be factual and concise.
- **[WKFLの感想]** must sound like a highly informed entrepreneur-podcaster in his 40s: witty, human, slightly theatrical, sometimes hesitant in phrasing, but capable of sharp critique.
- Output language: Japanese.
- Output format: Markdown.

## SOURCE ARTICLES:
{article_content}
"""


def format_japanese_date(dt):
    weekdays = [
        "月曜日",
        "火曜日",
        "水曜日",
        "木曜日",
        "金曜日",
        "土曜日",
        "日曜日",
    ]
    return f"{dt.month}月{dt.day}日({weekdays[dt.weekday()]})"


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


def build_prompt(articles, today_date):
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

    return ARTICLE_PROMPT_TEMPLATE.format(
        today_date=today_date,
        article_count=len(articles),
        article_content="\n".join(chunks),
    )


def synthesize_articles(urls, model=None):
    model = model or os.environ.get("WKFL_MODEL", DEFAULT_MODEL)

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

    today_date = format_japanese_date(datetime.now())
    prompt = build_prompt(articles, today_date)
    prompt_tokens_est = len(prompt) // 4
    print(f"Estimated input tokens: ~{prompt_tokens_est:,}")
    print(f"Calling {model}...")

    client = Anthropic()
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    article = response.content[0].text
    usage = response.usage
    print(f"Actual usage: input={usage.input_tokens:,} output={usage.output_tokens:,}")

    return article


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate a WKFL spot briefing from article URLs."
    )
    parser.add_argument("urls", nargs="+", help="Article URLs to summarize")
    parser.add_argument(
        "--output",
        help="Optional output path. Defaults to note/Spot_Briefing_YYYY-MM-DD_HHMM.md",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    out_dir = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "note"))
    os.makedirs(out_dir, exist_ok=True)
    out_path = args.output or os.path.join(out_dir, f"Spot_Briefing_{timestamp}.md")

    article = synthesize_articles(args.urls)

    with open(out_path, "w", encoding="utf-8") as file:
        file.write(article)

    print(f"\n✅ Generated article -> {out_path}")


if __name__ == "__main__":
    main()
