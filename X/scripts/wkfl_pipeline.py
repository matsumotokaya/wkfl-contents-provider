"""Shared two-stage WKFL article pipeline helpers."""

import os
import re
from datetime import datetime

from anthropic import Anthropic

from wkfl_persona import WKFL_PERSONA_BLOCK


FACT_MAX_TOKENS = 4096
STYLE_MAX_TOKENS = 4096
PODCAST_MAX_TOKENS = 4096


def format_japanese_date(dt: datetime) -> str:
    weekdays = ["月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日", "日曜日"]
    return f"{dt.month}月{dt.day}日({weekdays[dt.weekday()]})"


def format_japanese_spoken_date(dt: datetime) -> str:
    weekdays = ["月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日", "日曜日"]
    return f"{dt.month}月{dt.day}日{weekdays[dt.weekday()]}"


def format_slash_date(dt: datetime) -> str:
    return f"{dt.month}/{dt.day}"


def resolve_models(default_model: str, override_model: str | None = None) -> tuple[str, str]:
    base_model = override_model or os.environ.get("WKFL_MODEL", default_model)
    fact_model = os.environ.get("WKFL_FACT_MODEL", base_model)
    style_model = os.environ.get("WKFL_STYLE_MODEL", base_model)
    return fact_model, style_model


def call_model(
    client: Anthropic,
    model: str,
    prompt: str,
    max_tokens: int,
    label: str,
) -> tuple[str, object]:
    print(f"Calling {label} with {model}...")
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    text = response.content[0].text
    usage = response.usage
    print(f"{label} usage: input={usage.input_tokens:,} output={usage.output_tokens:,}")
    return text, usage


def extract_title(article: str) -> str:
    """Extract the first H1 heading from a Markdown article."""
    for line in article.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def prepend_title_to_podcast(podcast_script: str, title: str) -> str:
    """Add the article title as a Markdown heading at the top of the podcast script file."""
    if not title:
        return podcast_script
    return f"# {title}\n\n{podcast_script}"


TITLE_FORMAT_INSTRUCTION = """
## Title Format (CRITICAL):
- The article title must follow this exact format:
  `{slash_date} | 最新AIニュース | [keywords]`
- Total length: ~50 Japanese characters (the prefix `{slash_date} | 最新AIニュース | ` is already ~16 chars, so keywords should be ~34 chars)
- Keywords: extract 2-4 key topic words or short phrases from the article content, separated by spaces or commas
- No emojis anywhere in the title
- Example: `4/10 | 最新AIニュース | GPT-5発表 Anthropic新モデル Cursor競争激化`

## Heading Style:
- No emojis in any section headings (##, ###)
"""


REDDIT_DOSSIER_PROMPT_TEMPLATE = """
# Stage 1: WKFL Reddit Briefing Dossier

## Shared Persona Context:
{persona_block}

## Mission:
Build a factual editorial dossier for a Reddit-based daily briefing.
This is NOT the final article. This is the source-grounded planning document that the final article will be written from.

## Input:
- Date: {today_date}
- Source type: Reddit discussions from the past 24 hours

## Output Goals:
- Select 3 corners:
  - Macro AI Trends
  - Reddit's Lab
  - AI Coding
- Pick 1-2 items per corner, 3-6 total.
- Produce enough structure that a second pass can turn it into a finished article of about 2,800-3,200 Japanese characters.

## Output Format:
Write Markdown in exactly this structure:

# Briefing Dossier
- Edition: Reddit Daily
- Date: {today_date}
- Final Article Target: 2800-3200 Japanese chars

## Intro Direction
- Greeting anchor: Include the standard WKFL greeting.
- Context: Explain that this edition is based on Reddit discussions from the past 24 hours.
- Editorial angle: 2-3 sentences describing what kind of day it was in AI.

## Corner: Macro AI Trends
### Item 1
- Title:
- Source:
- Link:
- Facts:
- Why it matters:
- Comment angle:

### Item 2
- Title:
- Source:
- Link:
- Facts:
- Why it matters:
- Comment angle:

## Corner: Reddit's Lab
### Item 1
- Title:
- Source:
- Link:
- Facts:
- Why it matters:
- Comment angle:

### Item 2
- Title:
- Source:
- Link:
- Facts:
- Why it matters:
- Comment angle:

## Corner: AI Coding
### Item 1
- Title:
- Source:
- Link:
- Facts:
- Why it matters:
- Comment angle:

### Item 2
- Title:
- Source:
- Link:
- Facts:
- Why it matters:
- Comment angle:

## Outro Direction
- 2-3 sentences on what ties the day together and how to close naturally.

## Rules:
- Use ONLY the raw data below. Never fabricate facts, links, or source names.
- This dossier should be factual, clear, and planning-oriented. Do not perform the final stylish narration yet.
- Facts should stay concise and grounded.
- Comment angle should identify the startup/builder lens, but remain analytical rather than fully stylized.
- If a claim looks like community opinion rather than established fact, make that clear.
- Omit empty item slots rather than inventing weak topics.
- Output language: Japanese.

## RAW DATA:
{raw_content}
"""


REDDIT_ARTICLE_PROMPT_TEMPLATE = """
# Stage 2: WKFL Reddit Article Draft

## Shared Persona Context:
{persona_block}

{title_format_instruction}

## Mission:
Turn the factual dossier below into the final published article.

## Article Shape:
- This is a complete article, not notes.
- Total target length: about 2,800-3,200 Japanese characters.
- Structure must be:
  1. Title (follow the Title Format above exactly)
  2. Intro
  3. Macro AI Trends
  4. Reddit's Lab
  5. AI Coding
  6. Outro

## Intro Requirements:
- The intro must include this fixed opening in natural Japanese:
  「皆さんおはようございます。今日もAI回してますか、ということで、{spoken_date}の朝イチ、AIキャッチアップニュースのお時間です。」
- Explicitly say this edition is based on Reddit discussions from the last 24 hours.
- Let the intro reflect the actual mood or pattern of the selected topics, not just a fixed boilerplate.

## Body Requirements:
- For each selected item, write:
  - ### ■ [Title] (Source: [source with link])
  - **[議論の概要]**: factual and readable
  - **[WKFLの感想]**: the human commentary
- Keep [議論の概要] grounded and concise.
- Keep [WKFLの感想] witty, fair-minded, and sharp without sounding superior.
- Critique choices, tradeoffs, incentives, or execution. Do not mock people.

## Outro Requirements:
- Close naturally by tying together the day's themes.
- It should feel like an ending to this specific edition, not a generic sign-off pasted onto any day.
- The final line must end with:
  「それでは、また明日お会いしましょう。」

## Rules:
- Use ONLY the dossier below.
- Do not invent facts that are not in the dossier.
- Preserve the Reddit-specific framing.
- Output language: Japanese.
- Output format: Markdown.

## DOSSIER:
{dossier}
"""


SELECTED_DOSSIER_PROMPT_TEMPLATE = """
# Stage 1: WKFL Selected Articles Dossier

## Shared Persona Context:
{persona_block}

## Mission:
Build a factual editorial dossier for a selected-articles edition.
This is NOT the final article. This is the source-grounded planning document that the final article will be written from.

## Input:
- Date: {today_date}
- Source type: editor-selected published articles
- Number of source articles: {article_count}

## Output Goals:
- Use exactly one item per source article.
- Preserve input order.
- Produce enough structure that a second pass can turn it into a finished article of about 2,800-3,200 Japanese characters.

## Output Format:
Write Markdown in exactly this structure:

# Briefing Dossier
- Edition: Selected Articles
- Date: {today_date}
- Final Article Target: 2800-3200 Japanese chars

## Intro Direction
- Greeting anchor: Include the standard WKFL greeting.
- Context: Explain that this edition is based on 3 selected topics WKFL is watching right now.
- Editorial angle: 2-3 sentences describing what links these picks together.

## Item 1
- Title:
- Media:
- Publication date:
- URL:
- Source introduction:
- Facts:
- Article intent / direction:
- Comment angle:

## Item 2
- Title:
- Media:
- Publication date:
- URL:
- Source introduction:
- Facts:
- Article intent / direction:
- Comment angle:

## Item 3
- Title:
- Media:
- Publication date:
- URL:
- Source introduction:
- Facts:
- Article intent / direction:
- Comment angle:

## Outro Direction
- 2-3 sentences on what these selected topics say about the current AI landscape.

## Rules:
- Use ONLY the source data below. Do not fabricate facts.
- Preserve input order.
- This dossier should be factual, clear, and planning-oriented. Do not perform the final stylish narration yet.
- If the source text is thin or uncertain, say so explicitly.
- Source introduction should identify the media and publication date naturally.
- Comment angle should identify the startup/builder lens, but remain analytical rather than fully stylized.
- Output language: Japanese.

## SOURCE ARTICLES:
{article_content}
"""


SELECTED_ARTICLE_PROMPT_TEMPLATE = """
# Stage 2: WKFL Selected Articles Draft

## Shared Persona Context:
{persona_block}

{title_format_instruction}

## Mission:
Turn the factual dossier below into the final published article.

## Article Shape:
- This is a complete article, not notes.
- Total target length: about 2,800-3,200 Japanese characters.
- Structure must be:
  1. Title (follow the Title Format above exactly)
  2. Intro
  3. Body with one section per selected article
  4. Outro

## Intro Requirements:
- The intro must include this fixed opening in natural Japanese:
  「皆さんおはようございます。今日もAI回してますか、ということで、{spoken_date}の朝イチ、AIキャッチアップニュースのお時間です。」
- Explicitly say that today WKFL is talking through 3 selected topics he is paying attention to right now.
- Let the intro reflect what links the picks together, not just a fixed boilerplate.

## Body Requirements:
- For each article, write:
  - ### ■ [Title]
  - **[ソース紹介]**
  - **[概要]**
  - **[WKFLの感想]**
  - Source: [記事タイトル](URL)
- Keep [概要] factual and readable.
- Keep [WKFLの感想] witty, fair-minded, and sharp without condescension.
- Comment on implications, tradeoffs, market meaning, developer meaning, or long-term direction when the dossier supports it.

## Outro Requirements:
- Close naturally by tying together what the 3 selected topics reveal about the current moment in AI.
- It should feel specific to this set of picks.
- The final line must end with:
  「それでは、また明日お会いしましょう。」

## Rules:
- Use ONLY the dossier below.
- Do not invent facts that are not in the dossier.
- Preserve the selected-articles framing.
- Output language: Japanese.
- Output format: Markdown.

## DOSSIER:
{dossier}
"""


FREETALK_DOSSIER_PROMPT_TEMPLATE = """
# Stage 1: WKFL FreeTalk Dossier

## Shared Persona Context:
{persona_block}

## Mission:
Build a structured editorial dossier from WKFL's freeform notes and talking points.
This is NOT the final article. This is the planning document that organizes the raw input into a structure the final article can be written from.

## Input:
- Date: {today_date}
- Source type: WKFL's own freeform notes, ideas, and referenced material

## Output Goals:
- Identify 2-4 distinct topics or threads from the raw input.
- For each topic, extract the core facts, the key insight or observation, and a comment angle.
- Identify a through-line or connective theme if one exists.
- Produce enough structure that a second pass can turn it into a finished article of about 2,800-3,200 Japanese characters.

## Output Format:
Write Markdown in exactly this structure:

# FreeTalk Dossier
- Edition: FreeTalk
- Date: {today_date}
- Final Article Target: 2800-3200 Japanese chars

## Intro Direction
- Greeting anchor: Include the standard WKFL greeting.
- Context: This edition is WKFL talking through things he's been thinking about.
- Editorial angle: 1-2 sentences on what ties the topics together, if anything.

## Topic 1
- Theme:
- Key facts / claims:
- Core insight:
- Comment angle:

## Topic 2
- Theme:
- Key facts / claims:
- Core insight:
- Comment angle:

## Topic 3 (if applicable)
- Theme:
- Key facts / claims:
- Core insight:
- Comment angle:

## Outro Direction
- 2-3 sentences on how to close naturally, tying together what WKFL was getting at.

## Rules:
- Use ONLY the raw notes below. Do not fabricate facts.
- Organize and clarify the input, but do not invent new claims.
- This dossier should be factual and planning-oriented. Do not perform the final stylish narration yet.
- Output language: Japanese.

## RAW NOTES:
{raw_notes}
"""


FREETALK_ARTICLE_PROMPT_TEMPLATE = """
# Stage 2: WKFL FreeTalk Article Draft

## Shared Persona Context:
{persona_block}

{title_format_instruction}

## Mission:
Turn the structured dossier below into a finished FreeTalk article.

## Article Shape:
- This is a complete article, not notes.
- Total target length: about 2,800-3,200 Japanese characters.
- Structure:
  1. Title (follow the Title Format above exactly)
  2. Intro
  3. One section per topic
  4. Outro

## Intro Requirements:
- Open with: 「皆さんおはようございます。今日もAI回してますか、ということで、WKFLです。」
- Then: 「今日はちょっと気になっていることを話してみたいんですが、」
- Let the intro set up what the topics are about in a natural, conversational way.

## Body Requirements:
- Each topic gets its own section with a plain Markdown heading (## [topic title], no emojis).
- Write the factual part and the commentary as continuous flowing prose — do NOT use bold labels like **WKFL's Eye** or **感想** to break up the paragraphs.
- The commentary and personal take should flow naturally out of the factual description, not be labeled separately.
- Keep the voice conversational, first-person, and grounded in WKFL's builder perspective.
- The insight or "so what" should land at the end of each section as a natural conclusion, not a labeled callout.

## Outro Requirements:
- Tie together the topics naturally.
- The final line must be: 「それでは、また明日お会いしましょう。」

## Rules:
- Use ONLY the dossier below.
- Do not invent facts not in the dossier.
- No emojis anywhere.
- No bold section labels for commentary (no **WKFL's Eye**, no **感想**, no **コメント**).
- Output language: Japanese.
- Output format: Markdown.

## DOSSIER:
{dossier}
"""


PODCAST_SCRIPT_PROMPT_TEMPLATE = """
# Stage 3: WKFL Podcast Script

## Shared Persona Context:
{persona_block}

## Mission:
Turn the completed article below into a podcast-ready narration script.

## Requirements:
- Output language: Japanese.
- Output plain text only. No Markdown, no headings, no bullets, no labels.
- The output must contain only words that should actually be spoken by the TTS.
- This is a spoken script, not a blog article.
- Preserve the same facts and same editorial intent as the article.
- Rewrite into smoother, more human spoken language.
- The script must open with:
  「皆さんおはようございます。今日もAI回してますか、ということで、{spoken_date}の朝イチ、AIキャッチアップニュースのお時間です。」
- The script must end with:
  「それでは、また明日お会いしましょう。」
- Explain each news item in a way that sounds introduced by a host, not read aloud from a note post.
- Keep reactions emotionally readable and voiceable, but do not add unsupported facts.
- Small spoken hesitations or oral phrasing are fine, but do not overdo them.
- Do not output any title line like "ポッドキャスト台本".
- Do not output section headers like "オープニング" or "Topic 1".
- Do not output separators like "---".

## Structure:
1. Opening
2. Topic 1
3. Topic 2
4. Topic 3
5. Closing

## ARTICLE:
{article}
"""


FREETALK_PODCAST_SCRIPT_PROMPT_TEMPLATE = """
# Stage 3: WKFL FreeTalk Podcast Script

## Shared Persona Context:
{persona_block}

## Mission:
Turn the completed FreeTalk article below into a podcast-ready narration script.

## Requirements:
- Output language: Japanese.
- Output plain text only. No Markdown, no headings, no bullets, no labels.
- The output must contain only words that should actually be spoken by the TTS.
- This is a spoken script, not a blog article.
- Preserve the same facts and same editorial intent as the article.
- Rewrite into smoother, more human spoken language.
- The script must open with:
  「皆さんおはようございます。今日もAI回してますか、ということで、WKFLです。今日はちょっと気になっていることを話してみたいんですが、」
- The script must end with:
  「それでは、また明日お会いしましょう。」
- Keep the voice conversational and first-person throughout — this is WKFL thinking out loud, not reading a structured briefing.
- Do not output any title line or section headers.
- Do not output separators like "---".

## ARTICLE:
{article}
"""


def build_title_format_instruction(slash_date: str) -> str:
    return TITLE_FORMAT_INSTRUCTION.format(slash_date=slash_date)


def build_reddit_dossier_prompt(raw_content: str, today_date: str) -> str:
    return REDDIT_DOSSIER_PROMPT_TEMPLATE.format(
        persona_block=WKFL_PERSONA_BLOCK.strip(),
        today_date=today_date,
        raw_content=raw_content,
    )


def build_reddit_article_prompt(dossier: str, today_date: str, spoken_date: str, slash_date: str) -> str:
    return REDDIT_ARTICLE_PROMPT_TEMPLATE.format(
        persona_block=WKFL_PERSONA_BLOCK.strip(),
        today_date=today_date,
        spoken_date=spoken_date,
        slash_date=slash_date,
        title_format_instruction=build_title_format_instruction(slash_date),
        dossier=dossier,
    )


def build_selected_dossier_prompt(article_content: str, today_date: str, article_count: int) -> str:
    return SELECTED_DOSSIER_PROMPT_TEMPLATE.format(
        persona_block=WKFL_PERSONA_BLOCK.strip(),
        today_date=today_date,
        article_count=article_count,
        article_content=article_content,
    )


def build_selected_article_prompt(dossier: str, today_date: str, spoken_date: str, slash_date: str) -> str:
    return SELECTED_ARTICLE_PROMPT_TEMPLATE.format(
        persona_block=WKFL_PERSONA_BLOCK.strip(),
        today_date=today_date,
        spoken_date=spoken_date,
        slash_date=slash_date,
        title_format_instruction=build_title_format_instruction(slash_date),
        dossier=dossier,
    )


def build_freetalk_dossier_prompt(raw_notes: str, today_date: str) -> str:
    return FREETALK_DOSSIER_PROMPT_TEMPLATE.format(
        persona_block=WKFL_PERSONA_BLOCK.strip(),
        today_date=today_date,
        raw_notes=raw_notes,
    )


def build_freetalk_article_prompt(dossier: str, today_date: str, spoken_date: str, slash_date: str) -> str:
    return FREETALK_ARTICLE_PROMPT_TEMPLATE.format(
        persona_block=WKFL_PERSONA_BLOCK.strip(),
        today_date=today_date,
        spoken_date=spoken_date,
        slash_date=slash_date,
        title_format_instruction=build_title_format_instruction(slash_date),
        dossier=dossier,
    )


def build_podcast_script_prompt(article: str, spoken_date: str) -> str:
    return PODCAST_SCRIPT_PROMPT_TEMPLATE.format(
        persona_block=WKFL_PERSONA_BLOCK.strip(),
        spoken_date=spoken_date,
        article=article,
    )


def build_freetalk_podcast_script_prompt(article: str) -> str:
    return FREETALK_PODCAST_SCRIPT_PROMPT_TEMPLATE.format(
        persona_block=WKFL_PERSONA_BLOCK.strip(),
        article=article,
    )
