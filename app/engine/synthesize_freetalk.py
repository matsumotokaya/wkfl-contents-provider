import argparse
import os
import sys
from datetime import datetime

from dotenv import load_dotenv

from wkfl_pipeline import (
    FACT_MAX_TOKENS,
    PODCAST_MAX_TOKENS,
    STYLE_MAX_TOKENS,
    build_freetalk_article_prompt,
    build_freetalk_dossier_prompt,
    build_freetalk_podcast_script_prompt,
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

DEFAULT_MODEL = "gpt-5.4"


def write_text(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def synthesize_freetalk(raw_notes, model=None, edition_date=None):
    fact_model, style_model = resolve_models(DEFAULT_MODEL, model)

    if edition_date:
        edition_dt = datetime.strptime(edition_date, "%Y-%m-%d")
    else:
        edition_dt = datetime.now()

    today_date = format_japanese_date(edition_dt)
    spoken_date = format_japanese_spoken_date(edition_dt)
    slash_date = format_slash_date(edition_dt)

    dossier_prompt = build_freetalk_dossier_prompt(raw_notes, today_date)
    print(f"Estimated stage 1 input tokens: ~{len(dossier_prompt) // 4:,}")
    dossier, _ = call_model(fact_model, dossier_prompt, FACT_MAX_TOKENS, "Stage 1 dossier")

    article_prompt = build_freetalk_article_prompt(dossier, today_date, spoken_date, slash_date)
    print(f"Estimated stage 2 input tokens: ~{len(article_prompt) // 4:,}")
    article, _ = call_model(style_model, article_prompt, STYLE_MAX_TOKENS, "Stage 2 article")

    podcast_prompt = build_freetalk_podcast_script_prompt(article)
    print(f"Estimated stage 3 input tokens: ~{len(podcast_prompt) // 4:,}")
    podcast_script_raw, _ = call_model(style_model, podcast_prompt, PODCAST_MAX_TOKENS, "Stage 3 podcast script")
    podcast_script = prepend_title_to_podcast(podcast_script_raw, extract_title(article))

    return dossier, article, podcast_script


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate a WKFL FreeTalk article from freeform notes."
    )
    parser.add_argument(
        "input_file",
        nargs="?",
        help="Path to a text file containing the raw notes. Reads from stdin if omitted.",
    )
    parser.add_argument(
        "--edition-date",
        help="Edition date in YYYY-MM-DD. Defaults to today.",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    if args.input_file:
        with open(args.input_file, "r", encoding="utf-8") as f:
            raw_notes = f.read()
    else:
        print("Reading notes from stdin (Ctrl+D to finish)...")
        raw_notes = sys.stdin.read()

    if not raw_notes.strip():
        print("Error: no input notes provided.", file=sys.stderr)
        return 1

    today = (
        args.edition_date
        or datetime.now().strftime("%Y-%m-%d")
    )

    dossier, article, podcast_script = synthesize_freetalk(
        raw_notes,
        edition_date=args.edition_date,
    )

    article_dir = os.path.abspath(os.path.join(PROJECT_ROOT, "articles", today))
    write_text(os.path.join(article_dir, "freetalk.md"), article)
    write_text(os.path.join(article_dir, "freetalk_podcast.md"), podcast_script)
    write_text(os.path.join(article_dir, "freetalk_dossier.md"), dossier)

    print(f"\n✅ Saved FreeTalk bundle -> {article_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
