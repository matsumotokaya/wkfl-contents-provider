"""WKFL keys live in ~/.secrets/wkfl/<provider>-token, never inside the repository.

An environment variable that is already set wins (GitHub Actions passes secrets that way).
Which account / project each key belongs to: ~/playbooks/gemini-tts.md, ~/playbooks/openai-api-keys.md.
"""
import os
from pathlib import Path

_FILES = {"ANTHROPIC_API_KEY": "anthropic-token", "OPENAI_API_KEY": "openai-token"}


def load_wkfl_keys() -> None:
    for env_name, file_name in _FILES.items():
        if os.environ.get(env_name):
            continue
        path = Path.home() / ".secrets" / "wkfl" / file_name
        if path.is_file():
            value = path.read_text().strip()
            if value:
                os.environ[env_name] = value
