import json
import os
import sys
from datetime import datetime
import subprocess
import argparse
from email.utils import parsedate_to_datetime
from bs4 import BeautifulSoup
from anthropic import Anthropic

from ingest_rss import load_profile, DEFAULT_PROFILE

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))
RAW_DATA_DIR = os.path.join(BASE_DIR, "..", "data", "raw_feeds")

# Model used for the daily news-feed summary. Overridable via env.
SUMMARY_MODEL = os.environ.get("WKFL_SUMMARY_MODEL", "claude-opus-4-8")

def extract_date_from_published(published_str):
    """Extract date in YYYY-MM-DD format from RFC 2822 published string."""
    if not published_str:
        return ""
    try:
        dt = parsedate_to_datetime(published_str)
        return dt.strftime("%Y-%m-%d")
    except:
        return ""

def clean_html(html_text):
    """Remove HTML tags and return plain text."""
    if not html_text:
        return ""
    try:
        soup = BeautifulSoup(html_text, "html.parser")
        return soup.get_text(separator=" ", strip=True)
    except:
        return html_text

def generate_ai_summary(titles):
    """Generate AI summary from article titles using Anthropic API."""
    if not titles or len(titles) == 0:
        return None

    # Load API key from .env
    env_path = os.path.join(BASE_DIR, "..", "..", ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("ANTHROPIC_API_KEY="):
                    api_key = line.split("=", 1)[1].strip()
                    os.environ["ANTHROPIC_API_KEY"] = api_key

    try:
        client = Anthropic()

        # Build article list for prompt
        articles_text = "\n".join([f"{i+1}. {title}" for i, title in enumerate(titles)])

        prompt = f"""以下は、「ローカルLLM」をテーマにしたニュース収集システムが取得した記事タイトルの一覧です。

{articles_text}

以下のルールで整理してください：

1. 英語タイトルは日本語に訳して示す
2. 同じトピックを扱う記事が複数ある場合は1件にまとめ、「（X件）」と添える
3. モデル名・ツール名・企業名・数値などの固有名詞は省略せずそのまま残す
4. 各記事を1〜2文で紹介するだけでよい。「〜の記事がありました」という列挙スタイルで書く
5. 各記事の末尾に、ローカルLLMとの関係を一言添える。例：「（ローカル実行対応モデルの新リリース）」「（DeepSeekはオープンウェイトモデルを提供している企業で、今回は資金調達の話）」「（ローカルLLMとは直接無関係）」など
6. 考察・総評・業界への影響などの分析は不要"""

        message = client.messages.create(
            model=SUMMARY_MODEL,
            max_tokens=2048,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )

        return message.content[0].text
    except Exception as e:
        print(f"⚠️  Warning: AI summary generation failed: {e}", file=sys.stderr)
        return None

def main(theme=None):
    today = datetime.now().strftime("%Y-%m-%d")
    # Add theme suffix if specified
    raw_filename = f"{today}_raw.json" if not theme else f"{today}_{theme}_raw.json"
    raw_path = os.path.join(RAW_DATA_DIR, raw_filename)

    # Step 1: Run ingestion script first to ensure we have the latest news
    ingest_script = os.path.join(BASE_DIR, "ingest_rss.py")
    print(f"🔄 Running news ingestion pipeline{' for theme: ' + theme if theme else ''}...")
    try:
        cmd = [sys.executable, ingest_script]
        if theme:
            cmd.extend(["--theme", theme])
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(f"❌ Error running ingestion: {e}", file=sys.stderr)
        return 1

    if not os.path.exists(raw_path):
        print(f"❌ No raw feed data found at {raw_path}", file=sys.stderr)
        return 1

    with open(raw_path, "r", encoding="utf-8") as f:
        entries = json.load(f)

    if not entries:
        print("📭 No articles matched today's keywords.")
        return 0

    # Load the selected profile (a 'cut' of sources/keywords) once, reused below.
    profile = load_profile(theme or DEFAULT_PROFILE) or {}

    # Check if the profile allows Reddit (reddit_no_filter flag)
    reddit_included = profile.get("reddit_no_filter", False)

    # Step 2: Group articles by source, excluding Reddit (unless reddit_no_filter is True)
    grouped = {}
    total_filtered = 0
    for entry in entries:
        source = entry.get("source", "Unknown")
        if source.startswith("Reddit") and not reddit_included:
            continue
        grouped.setdefault(source, []).append(entry)
        total_filtered += 1

    # Step 3: Format as Markdown
    md_lines = [
        f"# WKFL Daily News Feed — {today}",
        f"Generated at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"Total captured articles: {total_filtered}",
        "",
        "> [!NOTE]",
        "> **Reddit 記事の除外について**",
        "> Reddit (r/LocalLLM, r/LocalLLaMA等) からの情報収集は、定点観測（ルートA：`run_all.py` / `synthesize_note.py`）用の独立したパイプラインで処理されるため、この個別選択用のニュースフィード (`news_feed.md`) からは明示的に除外しています。",
        "",
        "---",
        ""
    ]

    # Get all sources for this profile (already loaded above)
    all_sources = [s["name"] for s in profile.get("sources", []) if s.get("active", True)]

    # Display all sources, whether they have entries or not
    if all_sources:
        for source in sorted(all_sources):
            source_entries = grouped.get(source, [])
            md_lines.append(f"## {source} ({len(source_entries)} articles)")
            md_lines.append("")
            for idx, entry in enumerate(source_entries, 1):
                title = entry.get("title", "No Title")
                link = entry.get("link", "#")
                summary = clean_html(entry.get("summary", "No Summary")).strip()
                published = entry.get("published", "")
                date_str = extract_date_from_published(published)

                # Clean up the summary to keep it readable
                summary_preview = summary[:300] + "..." if len(summary) > 300 else summary

                date_part = f" ({date_str})" if date_str else ""
                md_lines.append(f"{idx}. [{title}]({link}){date_part}")
                if summary_preview and summary_preview != title:
                    md_lines.append(f"   {summary_preview}")
                md_lines.append("")
            md_lines.append("---")
    else:
        # Fallback if config reading fails: show grouped items
        for source, source_entries in sorted(grouped.items()):
            md_lines.append(f"## {source} ({len(source_entries)} articles)")
            md_lines.append("")
            for idx, entry in enumerate(source_entries, 1):
                title = entry.get("title", "No Title")
                link = entry.get("link", "#")
                summary = clean_html(entry.get("summary", "No Summary")).strip()
                published = entry.get("published", "")
                date_str = extract_date_from_published(published)

                summary_preview = summary[:300] + "..." if len(summary) > 300 else summary

                date_part = f" ({date_str})" if date_str else ""
                md_lines.append(f"{idx}. [{title}]({link}){date_part}")
                if summary_preview and summary_preview != title:
                    md_lines.append(f"   {summary_preview}")
                md_lines.append("")
            md_lines.append("---")

    md_content = "\n".join(md_lines)

    # Generate AI summary
    print("\n🤖 Generating AI summary...")
    all_titles = [entry.get("title", "") for entry in entries]
    ai_summary = generate_ai_summary(all_titles)

    if ai_summary:
        md_content += f"\n\n## 🤖 AIによる要約\n\n{ai_summary}"
        print("✅ AI summary added")
    else:
        print("⚠️  AI summary skipped")

    # Save to articles/YYYY-MM-DD/news_feed{_theme}.md
    output_dir = os.path.join(PROJECT_ROOT, "articles", today)
    os.makedirs(output_dir, exist_ok=True)
    output_filename = "news_feed.md" if not theme else f"news_feed_{theme}.md"
    output_path = os.path.join(output_dir, output_filename)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(md_content)

    print(f"\n✨ Successfully generated news feed report!")
    print(f"📂 Report saved to: [news_feed.md](file://{output_path})")
    print(f"📄 Open and inspect this file in your editor to select articles for the briefing.")
    
    # Print a neat console summary
    print(f"\n=========================================")
    print(f" TODAY'S CAPTURED ARTICLES ({total_filtered} items - Reddit Excluded)")
    print(f"=========================================")
    for source, source_entries in sorted(grouped.items()):
        print(f"\n[{source}]:")
        for idx, entry in enumerate(source_entries, 1):
            print(f"  {idx}. {entry.get('title')}")
            print(f"     URL: {entry.get('link')}")
    print(f"=========================================\n")

    return 0

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate themed news feed report")
    parser.add_argument("--theme", default=None, help="Theme name (e.g., 'general', 'localllm')")
    args = parser.parse_args()
    sys.exit(main(theme=args.theme))
