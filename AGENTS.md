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

