#!/usr/bin/env python3
"""Run gpt-image-2.5 through fal (edit or text-to-image) and save the result.

Ported from gen-video/src/image-fal.ts. Calling gpt-image-2.5 on OpenAI directly
returns 403 without organization verification, so fal is the default route.

Usage:
  python3 tools/image_fal.py --prompt p.txt --image a.png [--image b.png ...] --out out.png [options]
  python3 tools/image_fal.py --request <id> --out out.png      # collect a submitted job, no new charge

Options:
  --model sunburst|flare   default sunburst (precision tier)
  --size WxH               default 2048x1152. Both sides multiples of 16, max edge 3840, ratio within 3:1
  --quality low|medium|high|xhigh|max   default high
  --n 1-10                 number of variations (extra files get -2, -3 ... suffixes)
  --dry-run                show the estimate and stop
  --yes                    skip the cost confirmation

The --image order maps to "Image 1 / Image 2 ..." in the prompt.
Key: ~/.secrets/fal-token (or FAL_KEY). Every run is appended to tools/ledger/image-fal.jsonl.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEDGER = ROOT / "tools" / "ledger" / "image-fal.jsonl"
QUEUE_URL = "https://queue.fal.run"
TIERS = {
    "sunburst": "openai/gpt-image-2.5/sunburst/edit",
    "flare": "openai/gpt-image-2.5/flare/edit",
}
# fal list price per image at 1024x1536; other sizes scale on pixel count.
# https://fal.ai/models/openai/gpt-image-2.5/sunburst/edit
PRICE_AT_1024X1536 = {"low": 0.00474, "medium": 0.01029, "high": 0.04116, "xhigh": 0.07377, "max": 0.16464}
REFERENCE_PIXELS = 1024 * 1536
MAX_COST_USD = float(os.environ.get("MAX_COST_USD_PER_IMAGE_RUN", "1"))
POLL_INTERVAL_S = 5
POLL_TIMEOUT_S = 900


def fal_key() -> str:
    key = os.environ.get("FAL_KEY", "").strip()
    if key:
        return key
    path = Path.home() / ".secrets" / "fal-token"
    if not path.exists():
        sys.exit("Missing fal key: put it in ~/.secrets/fal-token (chmod 600) or set FAL_KEY")
    return path.read_text().strip()


def fal_json(url: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method="POST" if data is not None else "GET",
        headers={"Authorization": f"Key {fal_key()}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"fal {e.code} on {url}: {e.read().decode(errors='replace')[:800]}")


def parse_size(size: str) -> tuple[int, int]:
    m = re.fullmatch(r"(\d+)x(\d+)", size)
    if not m:
        sys.exit(f"--size must look like 2048x1152, got: {size}")
    w, h = int(m[1]), int(m[2])
    if w % 16 or h % 16:
        sys.exit(f"--size {size}: both sides must be multiples of 16")
    if max(w, h) > 3840:
        sys.exit(f"--size {size}: neither side may exceed 3840")
    if not (1 / 3 <= w / h <= 3):
        sys.exit(f"--size {size}: aspect ratio must be within 3:1")
    return w, h


def dated(out: str) -> Path:
    """Prefix the file name with the run time, as gen-video does, unless it already starts with a date."""
    p = Path(out)
    if re.match(r"\d{4}-\d{2}-\d{2}_", p.name):
        return p
    return p.with_name(f"{datetime.now().strftime('%Y-%m-%d_%H%M')}_{p.name}")


def data_uri(file: str) -> str:
    mime = mimetypes.guess_type(file)[0]
    if mime not in ("image/png", "image/jpeg", "image/webp"):
        sys.exit(f"Unsupported image type for {file}. Use png, jpg or webp.")
    return f"data:{mime};base64,{base64.b64encode(Path(file).read_bytes()).decode()}"


def queue_base(endpoint: str) -> str:
    # Queue routes drop the trailing sub-path: .../sunburst/edit is polled at .../sunburst/requests/<id>.
    parts = endpoint.strip("/").split("/")
    return f"{QUEUE_URL}/{'/'.join(parts[:-1]) if len(parts) > 2 else endpoint}"


def append_ledger(record: dict) -> None:
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def collect(status_url: str, response_url: str, out: Path, record: dict) -> None:
    started = time.time()
    last = ""
    while True:
        status = fal_json(status_url)
        line = f"  [{int(time.time() - started)}s] {status.get('status')}"
        if line != last:
            print(line, flush=True)
            last = line
        if status.get("status") == "COMPLETED":
            break
        if status.get("status") == "FAILED":
            sys.exit(f"Request failed: {json.dumps(status)[:800]}")
        if time.time() - started > POLL_TIMEOUT_S:
            sys.exit(f"Timed out; resume later with --request {record.get('request_id')}")
        time.sleep(POLL_INTERVAL_S)

    images = fal_json(response_url).get("images") or []
    if not images:
        sys.exit("Completed but no image returned")
    out.parent.mkdir(parents=True, exist_ok=True)
    written = []
    for i, image in enumerate(images):
        target = out if i == 0 else out.with_name(f"{out.stem}-{i + 1}{out.suffix}")
        with urllib.request.urlopen(image["url"], timeout=120) as res:
            target.write_bytes(res.read())
        print(f"✓ Saved: {target} ({image.get('width')}x{image.get('height')})")
        written.append(str(target))
    append_ledger({**record, "timestamp": datetime.now(timezone.utc).isoformat(), "output_files": written})
    print(f"  Ledger: {LEDGER}")
    print("  Actual charge: see the fal dashboard (the estimate is the list price).")


def main() -> None:
    ap = argparse.ArgumentParser(description="gpt-image-2.5 via fal")
    ap.add_argument("--prompt")
    ap.add_argument("--image", action="append", default=[])
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", choices=TIERS, default="sunburst")
    ap.add_argument("--size", default="2048x1152")
    ap.add_argument("--quality", choices=PRICE_AT_1024X1536, default="high")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--request")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--yes", action="store_true")
    args = ap.parse_args()

    endpoint = TIERS[args.model]
    out = dated(args.out)

    if args.request:
        base = queue_base(endpoint)
        collect(f"{base}/requests/{args.request}/status", f"{base}/requests/{args.request}", out,
                {"endpoint": endpoint, "request_id": args.request, "prompt_file": "(resumed)"})
        return

    if not args.prompt:
        sys.exit("--prompt is required")
    if not args.image:
        sys.exit("At least one --image is required for the edit endpoint")
    if len(args.image) > 16:
        sys.exit("The API accepts at most 16 input images")
    if not 1 <= args.n <= 10:
        sys.exit("--n must be between 1 and 10")
    prompt = Path(args.prompt).read_text(encoding="utf-8").strip()
    if not prompt:
        sys.exit(f"Prompt file is empty: {args.prompt}")
    w, h = parse_size(args.size)
    estimate = PRICE_AT_1024X1536[args.quality] * (w * h / REFERENCE_PIXELS) * args.n

    print(f"Endpoint: {endpoint}")
    print(f"Size:     {args.size}   Quality: {args.quality}   n: {args.n}")
    print(f"Prompt:   {args.prompt} ({len(prompt)} chars)")
    for i, image in enumerate(args.image, 1):
        print(f"  image {i}: {image}")
    print(f"Output:   {out}")
    print(f"Estimate: ~${estimate:.3f} USD at fal's list price")
    if estimate > MAX_COST_USD:
        sys.exit(f"Estimate exceeds MAX_COST_USD_PER_IMAGE_RUN (${MAX_COST_USD:.2f})")
    if args.dry_run:
        print("--dry-run: no API call made.")
        return
    if not args.yes and input(f"Charge roughly ${estimate:.3f}? [y/N] ").strip().lower() != "y":
        print("Aborted.")
        return

    payload = {
        "prompt": prompt,
        "image_urls": [data_uri(i) for i in args.image],
        "image_size": {"width": w, "height": h},
        "quality": args.quality,
        "num_images": args.n,
        "output_format": "png",
    }
    submit = fal_json(f"{QUEUE_URL}/{endpoint}", payload)
    request_id = submit["request_id"]
    print(f"Request:  {request_id}")
    base = queue_base(endpoint)
    collect(
        submit.get("status_url") or f"{base}/requests/{request_id}/status",
        submit.get("response_url") or f"{base}/requests/{request_id}",
        out,
        {
            "endpoint": endpoint,
            "size": args.size,
            "quality": args.quality,
            "n": args.n,
            "inputs": [str(Path(i).resolve()) for i in args.image],
            "prompt_file": args.prompt,
            "prompt": prompt,
            "request_id": request_id,
            "estimated_cost_usd": round(estimate, 5),
        },
    )


if __name__ == "__main__":
    main()
