import subprocess
import os
import sys

def run_step(name, script_path):
    print(f"\n--- Step: {name} ---")
    try:
        result = subprocess.run(
            [sys.executable, script_path],
            check=True, capture_output=True, text=True,
        )
        print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
    except subprocess.CalledProcessError as e:
        print(f"Error in {name}:")
        if e.stdout:
            print(e.stdout)
        print(e.stderr)
        return False
    return True

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))

    # Core pipeline: ingest -> synthesize
    pipeline = [
        ("RSS Ingestion", "ingest_rss.py"),
        ("Reddit Synthesis", "synthesize_note.py"),
    ]

    for step_name, script_file in pipeline:
        script_path = os.path.join(base_dir, script_file)
        if not os.path.exists(script_path):
            print(f"Script not found: {script_path}", file=sys.stderr)
            return 1
        if not run_step(step_name, script_path):
            print("Pipeline halted due to error.", file=sys.stderr)
            return 1

    print("\n✅ Pipeline complete.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
