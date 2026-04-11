import json
import os
import re
import sys
from datetime import datetime
from anthropic import Anthropic
from dotenv import load_dotenv

from wkfl_pipeline import (
    FACT_MAX_TOKENS,
    PODCAST_MAX_TOKENS,
    STYLE_MAX_TOKENS,
    build_podcast_script_prompt,
    build_reddit_article_prompt,
    build_reddit_dossier_prompt,
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
CONFIG_PATH = os.path.join(BASE_DIR, "..", "data", "db", "user_config.json")

# --- MODEL CONFIGURATION ---
# Environment variable override: WKFL_MODEL=claude-opus-4-6
DEFAULT_MODEL = "claude-sonnet-4-6"


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


def render_raw_content(entries):
    """Render filtered Reddit data for the two-stage prompts."""
    raw_content = ""
    for i, entry in enumerate(entries, 1):
        raw_content += f"\n---\n#{i}. [{entry['source']}] {entry['title']}\n"
        raw_content += f"Link: {entry['link']}\n"
        raw_content += f"Published: {entry.get('published', 'unknown')}\n"
        raw_content += f"Content: {entry['summary']}\n"
    return raw_content


def write_text(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as file:
        file.write(content)


def synthesize(raw_json_path, model=None):
    """Generate the final Reddit article through a two-stage pipeline."""
    fact_model, style_model = resolve_models(DEFAULT_MODEL, model)

    with open(raw_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    edition_dt = datetime.now()
    today_date = format_japanese_date(edition_dt)
    spoken_date = format_japanese_spoken_date(edition_dt)
    slash_date = format_slash_date(edition_dt)

    # Pre-filter
    filtered = prefilter_entries(data)
    print(f"Pre-filtered: {len(data)} -> {len(filtered)} entries")

    client = Anthropic()
    raw_content = render_raw_content(filtered)

    dossier_prompt = build_reddit_dossier_prompt(raw_content, today_date)
    print(f"Estimated stage 1 input tokens: ~{len(dossier_prompt) // 4:,}")
    dossier, _ = call_model(
        client,
        fact_model,
        dossier_prompt,
        FACT_MAX_TOKENS,
        "Stage 1 dossier",
    )

    article_prompt = build_reddit_article_prompt(dossier, today_date, spoken_date, slash_date)
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


def main():
    today = datetime.now().strftime("%Y-%m-%d")
    raw_path = os.path.join(BASE_DIR, "..", "data", "raw_feeds", f"{today}_raw.json")

    if not os.path.exists(raw_path):
        print(f"No raw data found for today ({raw_path}).", file=sys.stderr)
        print("Run ingest_rss.py first.", file=sys.stderr)
        return 1

    dossier, article, podcast_script = synthesize(raw_path)

    article_dir = os.path.abspath(os.path.join(PROJECT_ROOT, "articles", today))
    article_path = os.path.join(article_dir, "reddit.md")
    podcast_path = os.path.join(article_dir, "reddit_podcast.md")
    dossier_path = os.path.join(article_dir, "reddit_dossier.md")
    write_text(article_path, article)
    write_text(podcast_path, podcast_script)
    write_text(dossier_path, dossier)

    print(f"\n✅ Saved article bundle -> {article_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
