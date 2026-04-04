import glob
import os
import re
import subprocess
import threading
import traceback
from datetime import datetime

import markdown as md
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

NOTE_DIR = os.path.join(PROJECT_ROOT, "note")
SCRIPTS_DIR = os.path.join(PROJECT_ROOT, "X", "scripts")
TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")

app = FastAPI()
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# Ensure required directories exist (not in git)
os.makedirs(NOTE_DIR, exist_ok=True)
os.makedirs(os.path.join(PROJECT_ROOT, "X", "data", "raw_feeds"), exist_ok=True)

# In-memory generation job state
_job: dict = {"running": False, "last": None}
# last: {"success": bool, "output": str, "date": str | None}


def _get_articles() -> list[dict]:
    files = glob.glob(os.path.join(NOTE_DIR, "AI_Briefing_*.md"))
    result = []
    for f in sorted(files, reverse=True):
        date = os.path.basename(f).replace("AI_Briefing_", "").replace(".md", "")
        result.append({"date": date})
    return result


@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def index(request: Request):
    try:
        return templates.TemplateResponse("index.html", {
            "request": request,
            "articles": _get_articles(),
            "job": _job,
        })
    except Exception as e:
        return HTMLResponse(f"<pre>{traceback.format_exc()}</pre>", status_code=500)


@app.get("/articles/{date}", response_class=HTMLResponse)
async def article_detail(request: Request, date: str):
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        return HTMLResponse("Not found", status_code=404)
    filepath = os.path.join(NOTE_DIR, f"AI_Briefing_{date}.md")
    if not os.path.exists(filepath):
        return HTMLResponse("Not found", status_code=404)
    with open(filepath, encoding="utf-8") as f:
        raw = f.read()
    content_html = md.markdown(raw, extensions=["tables", "fenced_code"])
    return templates.TemplateResponse("article.html", {
        "request": request,
        "date": date,
        "content": content_html,
        "raw": raw,
    })


@app.post("/api/generate")
async def generate():
    if _job["running"]:
        return JSONResponse({"status": "already_running"})
    _job["running"] = True
    _job["last"] = None
    threading.Thread(target=_run_pipeline, daemon=True).start()
    return JSONResponse({"status": "started"})


@app.get("/api/status")
async def get_status():
    return JSONResponse(_job)


def _run_pipeline():
    try:
        result = subprocess.run(
            ["python3", os.path.join(SCRIPTS_DIR, "run_all.py")],
            capture_output=True,
            text=True,
            timeout=300,
            cwd=PROJECT_ROOT,
        )
        _job["last"] = {
            "success": result.returncode == 0,
            "output": (result.stdout + result.stderr)[-2000:],
            "date": datetime.now().strftime("%Y-%m-%d"),
        }
    except Exception as e:
        _job["last"] = {"success": False, "output": str(e), "date": None}
    finally:
        _job["running"] = False
