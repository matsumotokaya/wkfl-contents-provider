"""Shared two-stage WKFL article pipeline helpers."""

import os
import re
from datetime import datetime

from anthropic import Anthropic
from openai import OpenAI

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


def resolve_models(default_model: str, override_model: str = None) -> tuple[str, str]:
    base_model = override_model or os.environ.get("WKFL_MODEL", default_model)
    fact_model = os.environ.get("WKFL_FACT_MODEL", base_model)
    style_model = os.environ.get("WKFL_STYLE_MODEL", base_model)
    return fact_model, style_model


def is_openai_model(model: str) -> bool:
    return model.startswith("gpt-")


def _read_api_key(env_name: str) -> str:
    api_key = os.environ.get(env_name)
    if not api_key:
        raise RuntimeError(f"Missing required environment variable: {env_name}")
    return api_key


def _read_usage_tokens(usage: object) -> tuple:
    if usage is None:
        return None, None
    input_tokens = getattr(usage, "input_tokens", None)
    output_tokens = getattr(usage, "output_tokens", None)
    return input_tokens, output_tokens


def _resolve_openai_reasoning_effort(label: str) -> str:
    label_lower = label.lower()
    if "stage 1" in label_lower:
        return os.environ.get("WKFL_FACT_REASONING_EFFORT", "low")
    if "stage 2" in label_lower:
        return os.environ.get("WKFL_STYLE_REASONING_EFFORT", "medium")
    if "stage 3" in label_lower:
        return os.environ.get("WKFL_PODCAST_REASONING_EFFORT", "low")
    return os.environ.get("WKFL_OPENAI_REASONING_EFFORT", "medium")


def call_model(
    model: str,
    prompt: str,
    max_tokens: int,
    label: str,
) -> tuple[str, object]:
    print(f"Calling {label} with {model}...")
    if is_openai_model(model):
        client = OpenAI(api_key=_read_api_key("OPENAI_API_KEY"))
        response = client.responses.create(
            model=model,
            input=prompt,
            max_output_tokens=max_tokens,
            reasoning={"effort": _resolve_openai_reasoning_effort(label)},
        )
        text = response.output_text
        usage = response.usage
    else:
        client = Anthropic(api_key=_read_api_key("ANTHROPIC_API_KEY"))
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text
        usage = response.usage

    input_tokens, output_tokens = _read_usage_tokens(usage)
    if input_tokens is not None and output_tokens is not None:
        print(f"{label} usage: input={input_tokens:,} output={output_tokens:,}")
    else:
        print(f"{label} usage: token details unavailable")
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
## Title Format:
- Write a single, highly engaging title of around 60 Japanese characters.
- Move beyond simple news reporting to hint at a deep, insightful takeaway or a positive paradigm shift.
- Maximize CTR by tapping into curiosity, excitement, and profound implications for builders. Let your "AI addict designer" perspective shine with positive, expansive framing.
- Make it sound like a compelling, insightful YouTube or note.com title.
- (Note: You are given {slash_date} as context, but do not include dates or generic prefixes in the title itself).
- Example: `ついにLangChain卒業！？OpenAIの新機能がもたらすAIエージェント開発のパラダイムシフトと、UXデザインの未来`

## Heading Style:
- Write section headings in plain text so they read cleanly in Markdown.
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
- Ground every fact, link, and source name in the raw data below.
- Keep this dossier factual, clear, and planning-oriented so the final stylish narration can happen in the next stage.
- Facts should stay concise and grounded.
- Comment angle should identify the startup/builder lens, but remain analytical rather than fully stylized.
- If a claim looks like community opinion rather than established fact, make that clear.
- Fill only the item slots supported by strong material from the source data.
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
- This is a complete article formatted as a seamless spoken monologue.
- Total target length: about 2,800-3,200 Japanese characters.
- Structure must be:
  1. Title (follow the Title Format above exactly)
  2. Spoken Intro
  3. Seamless transitions into the topics (using a Markdown heading for each topic)
  4. Natural conversational closing

## Intro Requirements:
- Anchor your opening with the core catchphrase: 「皆さんおはようございます。今日もAI、回してますか？」(You can tweak it to match your mood).
- Follow it with a freestyle, conversational intro that sets the mood for the day's Reddit news. Dive straight into talking right after the title.
- Mention that we're looking at Reddit's 24-hour discussions, but say it naturally like a podcast host.

## Body Requirements:
- For each selected item, start with a simple topic heading: `### ■ [Title] (Source: [source with link])`
- Immediately below the heading, start speaking.
- Naturally explain the facts of the topic in spoken Japanese, as if you are explaining it clearly to a friend.
- Smoothly transition into your personal commentary, using conversational pivots like 「ということで、ついに来ましたね、新モデル！」 or 「いやー、これね、」 or 「まあ、アレですよ」.
- Write it as flowing, continuous paragraphs without any clunky subheadings.
- Keep the commentary witty, fair-minded, and sharp. Speak passionately from the perspective of an AI automation addict and designer.

## Outro Requirements:
- When you finish the last topic, transition into a natural closing thought that ties the day together.
- The very last line must be: 「それでは、また明日お会いしましょう。」

## Rules:
- Build the article entirely from the dossier below.
- Keep every fact anchored to the dossier.
- Use your persona (first-person "僕", spoken tone, occasional fillers).
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
- Ground every fact in the source data below.
- Preserve input order.
- Keep this dossier factual, clear, and planning-oriented so the final stylish narration can happen in the next stage.
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
- This is a complete article formatted as a seamless spoken monologue.
- Total target length: about 2,800-3,200 Japanese characters.
- Structure must be:
  1. Title (follow the Title Format above exactly)
  2. Spoken Intro
  3. Seamless transitions into each selected article (using a Markdown heading)
  4. Natural conversational closing

## Intro Requirements:
- Anchor your opening with the core catchphrase: 「皆さんおはようございます。今日もAI、回してますか？」(You can tweak it naturally).
- Follow it with a freestyle, conversational intro stating that today you picked specific topics you're paying attention to. Let the intro reflect what links them together.

## Body Requirements:
- For each article, start with a simple topic heading: 
  - `### ■ [Title]`
  - `Source: [記事タイトル](URL)`
- Then immediately start speaking.
- Briefly and naturally explain the source and the facts in spoken Japanese.
- Smoothly transition into your personal commentary using natural conversational pivots.
- Write it as flowing, continuous paragraphs without any clunky subheadings.
- Provide observations from your "AI addict designer" perspective.

## Outro Requirements:
- When you finish the last topic, transition into a natural closing thought.
- The very last line must be: 「それでは、また明日お会いしましょう。」

## Rules:
- Build the article entirely from the dossier below.
- Keep every fact anchored to the dossier.
- Use your persona (first-person "僕", spoken tone, occasional fillers).
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
- Ground every fact in the raw notes below.
- Organize and clarify the input while staying faithful to the claims already present.
- Keep this dossier factual and planning-oriented so the final stylish narration can happen in the next stage.
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
- This is a complete article formatted as a seamless spoken monologue.
- Total target length: about 2,800-3,200 Japanese characters.
- Structure:
  1. Title (follow the Title Format above exactly)
  2. Spoken Intro
  3. Seamless transitions into each topic (using a Markdown heading)
  4. Natural conversational closing

## Intro Requirements:
- Anchor your opening with the core catchphrase: 「皆さんおはようございます。今日もAI、回してますか？」(You can tweak it naturally).
- Follow it with a freestyle intro: 「今日はちょっと気になっていることを話してみたいんですが、」 and naturally introduce the themes.

## Body Requirements:
- Each topic gets its own section with a plain Markdown heading `### [topic title]`.
- Immediately below, write as a continuous flowing monologue. Use "僕" throughout.
- Speak freely about the facts and your insights. Blend them together naturally.
- Let your passion, curiosity, and minor self-deprecating humor shine.
- Integrate the commentary organically into the flow of speech without any clunky subheadings.

## Outro Requirements:
- Tie together the topics naturally.
- The final line must be: 「それでは、また明日お会いしましょう。」

## Rules:
- Build the article entirely from the dossier below.
- Keep every fact anchored to the dossier.
- Use your persona (first-person "僕", spoken tone, occasional fillers).
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
- The provided article is already written in a spoken, conversational tone.
- Your job is to format it as plain spoken text, removing any Markdown headings, bullet points, URLs, BGM instructions, or any non-spoken text within parentheses.
- The output must contain only the exact words that should be read aloud by the TTS.
- Preserve the same facts and editorial flow as the article.
- Do NOT add a rigid boilerplate opening if the article already has a natural one. Just ensure the core opening and closing ("それでは、また明日お会いしましょう。") are maintained.
- Keep the script continuous and ready to read aloud, without title lines, section headers, or visual separators.

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
- The provided article is already written in a spoken, conversational tone.
- Your job is to format it as plain spoken text, removing any Markdown headings, bullet points, URLs, BGM instructions, or any non-spoken text within parentheses.
- The output must contain only the exact words that should be read aloud by the TTS.
- Preserve the same facts and editorial flow as the article.
- Do NOT add a rigid boilerplate opening if the article already has a natural one. Just ensure the core opening and closing ("それでは、また明日お会いしましょう。") are maintained.
- Keep the script continuous and ready to read aloud, without title lines, section headers, or visual separators.

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
