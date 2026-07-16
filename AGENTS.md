# AGENTS (WKFL)

Project-specific rules for `/Users/kaya.matsumoto/projects/WKFL`.

## Priority

- Read `/Users/kaya.matsumoto/AGENTS.md` first.
- This file adds WKFL-specific rules.

## GitHub / Actions Rules

- Repository: `matsumotokaya/wkfl-contents-provider`
- Required account for this project: `matsumotokaya`
- Before any `git push`, PR action, or `gh workflow run`, always run:
  - `git remote -v`
  - `env -u GH_TOKEN gh auth status`
  - `env -u GH_TOKEN gh api repos/matsumotokaya/wkfl-contents-provider --jq '.permissions'`

Expected permission baseline for workflow dispatch:
- `push: true`
- `admin: true` (required in this repository for manual `workflow_dispatch`)

If account/permissions are wrong:
- `env -u GH_TOKEN gh auth switch -u matsumotokaya`
- Re-run the three checks above.

## Content Pipeline Rules

### Pickup News Pipeline Rule (Mandatory)

When the user asks to create a Pickup News / Selected Articles article, always follow the selected-articles pipeline.

Required order:
1. Create or update `articles/{date}/articles_dossier.md` first.
2. Create or update `articles/{date}/articles.md` only after the dossier exists.
3. Create or update `articles/{date}/articles_podcast.md` only if the user explicitly asks for podcast output.

Rules:
- Do not draft the final article directly from source URLs unless the user explicitly says to skip the dossier stage.
- Treat the README pipeline description as an execution rule for Pickup News work, not as optional guidance.
- The primary deliverable is file output under `articles/{date}/`, not chat-only draft text.
- Preserve the existing two-stage structure from `app/engine/wkfl_pipeline.py`:
  - Stage 1: factual dossier / planning document
  - Stage 2: styled final article
- Apply the title rules defined in `app/engine/wkfl_pipeline.py`, not just approximate length:
  - write a single highly engaging title of around 60 Japanese characters
  - hint at a deep takeaway, positive paradigm shift, or builder-relevant implication
  - avoid simple news-reporting titles
  - do not include dates or generic prefixes in the title
- If source extraction fails, ask the user to paste the source text, then continue the same pipeline.
- If the user asks for "styling only", this exception applies only when a dossier for the same topic already exists. Otherwise, build the dossier first.

### FreeTalk / Other Content

- For FreeTalk or other structured content types, prefer the same discipline:
  - planning / dossier first
  - styled article second
- If there is a content-specific pipeline in code or README, follow that pipeline instead of improvising a shortened flow unless the user explicitly asks to skip steps.
