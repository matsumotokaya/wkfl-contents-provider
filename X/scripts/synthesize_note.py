import json
import os
import re
import sys
from datetime import datetime
from dotenv import load_dotenv
from anthropic import Anthropic

# --- LOAD .env ---
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

# --- PATH CONFIGURATION ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "..", "data", "db", "user_config.json")

# --- MODEL CONFIGURATION ---
# Environment variable override: WKFL_MODEL=claude-opus-4-6
DEFAULT_MODEL = "claude-sonnet-4-6"


def format_japanese_date(dt):
    """Format a date as '4月5日(日曜日)'."""
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


# --- CORNER-BASED PODCAST STYLE PROMPT ---
SYNTHESIS_PROMPT_TEMPLATE = """
# System Prompt: AI Podcast Personality 'WKFL' (Corner-based Edition)

## Your Persona:
You are "WKFL", the AI podcast personality.
- Intro/outro: relaxed, natural spoken tone.
- News commentary: objective ~300 chars, then a sharp review ~300 chars from the perspective of an AI product entrepreneur/developer (market and labor impact).

## Task:
From the past 24 hours of Reddit discussions (RAW DATA below), select news for 3 "corners", picking 1-2 items each (3-6 total).

## Format (follow this structure exactly):

1. **Title**: 【日刊】AIキャッチアップ最前線 | {today_date}
2. **Intro**:
   「こんにちはーWKFLです。今日も朝イチのAIキャッチアップ、やっていきましょう。{today_date}、 朝8時の時点で集計されたRedditのトピックス。ディープな最新情報があるのはやはりReddit。ただし英語だし情報量も更新頻度も早すぎてもはやカオス。 ということで厳選したスレッドから気になるネタをいくつか、デイリーで紹介する取り組みを始めました。マクロなトレンド、Redditならではのハック、そして我々のテーマである『AI駆動開発』に関する最新情報という、3つのコーナーに分けてお届けします。それでは、いってみましょう〜」

3. **【Macro AI Trends】マクロなAIトレンド・市況**
   (Industry-wide macro trends, big company announcements, model evolution, policy — 1-2 items)
   - ### ■ [Title] (Source: [subreddit with link])
   - **[議論の概要]** (~300 chars)
   - **[WKFLの感想]** (~300 chars)

4. **【Reddit's Lab】局地的な面白ニュース・ハック**
   (Individual experiments, community hacks, weird builds — 1-2 items)
   - ### ■ [Title] (Source: [subreddit with link])
   - **[議論の概要]** (~300 chars)
   - **[WKFLの感想]** (~300 chars)

5. **【AI Coding】AI駆動開発の最前線**
   (Vibe coding, AI-driven development tools, coding agent progress — 1-2 items)
   - ### ■ [Title] (Source: [subreddit with link])
   - **[議論の概要]** (~300 chars)
   - **[WKFLの感想]** (~300 chars)

6. **Outro**:
   「本日提供のネタは以上となります。 マクロなトレンドと、現場のハックが混在しているのがRedditの面白いところですね。では、また明日お会いしましょう。」

## Rules:
- Use ONLY information from the RAW DATA. Never fabricate sources or facts.
- Each [議論の概要] must be objective and factual.
- Each [WKFLの感想] must contain a sharp opinion from an AI entrepreneur/developer perspective.
- Source links must come from the actual data.
- Output language: Japanese.
- Output format: Markdown.

## RAW DATA:
{raw_content}
"""


def strip_html(text):
    """Remove HTML tags and clean up whitespace."""
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'&[a-zA-Z]+;', ' ', text)
    text = re.sub(r'&#\d+;', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


def prefilter_entries(entries):
    """Light pre-filtering to remove noise while preserving valuable content.

    Strategy:
    - Remove very short/empty posts (link-only, no discussion value)
    - Remove obvious help/question posts unlikely to fit any corner
    - Truncate summaries to cap token usage
    """
    noise_title_patterns = [
        r'^help\b',
        r'^how do [iI]',
        r'^any advice',
        r'^some advise',
        r'^suggestions?\??$',
        r'^which model should',
        r'^looking for\b',
        r'^can someone\b',
        r'^searching for\b',
    ]

    filtered = []
    for entry in entries:
        title = entry.get('title', '')
        raw_summary = entry.get('summary', '')
        clean_summary = strip_html(raw_summary)

        # Skip entries with very short content (link-only posts)
        if len(clean_summary) < 80:
            continue

        # Skip obvious noise/question posts
        title_lower = title.lower().strip()
        if any(re.match(p, title_lower) for p in noise_title_patterns):
            continue

        # Keep entry with truncated summary to reduce tokens
        entry_slim = {
            'source': entry.get('source', ''),
            'title': title,
            'link': entry.get('link', ''),
            'summary': clean_summary[:500],
            'published': entry.get('published', ''),
        }
        filtered.append(entry_slim)

    return filtered


def build_prompt(entries, today_date):
    """Build the synthesis prompt with filtered data."""
    raw_content = ""
    for i, entry in enumerate(entries, 1):
        raw_content += f"\n---\n#{i}. [{entry['source']}] {entry['title']}\n"
        raw_content += f"Link: {entry['link']}\n"
        raw_content += f"Published: {entry.get('published', 'unknown')}\n"
        raw_content += f"Content: {entry['summary']}\n"

    return SYNTHESIS_PROMPT_TEMPLATE.format(
        today_date=today_date,
        raw_content=raw_content,
    )


def synthesize(raw_json_path, model=None):
    """Call the Anthropic API to generate the article."""
    model = model or os.environ.get("WKFL_MODEL", DEFAULT_MODEL)

    with open(raw_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    today_date = format_japanese_date(datetime.now())

    # Pre-filter
    filtered = prefilter_entries(data)
    print(f"Pre-filtered: {len(data)} -> {len(filtered)} entries")

    # Build prompt
    prompt = build_prompt(filtered, today_date)
    prompt_tokens_est = len(prompt) // 4  # rough estimate
    print(f"Estimated input tokens: ~{prompt_tokens_est:,}")

    # Call Anthropic API
    print(f"Calling {model}...")
    client = Anthropic()
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    article = response.content[0].text

    # Report usage
    usage = response.usage
    print(f"Actual usage: input={usage.input_tokens:,} output={usage.output_tokens:,}")

    return article


def main():
    today = datetime.now().strftime("%Y-%m-%d")
    raw_path = os.path.join(BASE_DIR, "..", "data", "raw_feeds", f"{today}_raw.json")
    out_dir = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "note"))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"AI_Briefing_{today}.md")

    if not os.path.exists(raw_path):
        print(f"No raw data found for today ({raw_path}).", file=sys.stderr)
        print("Run ingest_rss.py first.", file=sys.stderr)
        return 1

    article = synthesize(raw_path)

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(article)

    print(f"\n✅ Generated article -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
