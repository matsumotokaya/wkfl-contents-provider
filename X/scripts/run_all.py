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
    except subprocess.CalledProcessError as e:
        print(f"Error in {name}:")
        print(e.stderr)
        return False
    return True

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))

    # Core pipeline: ingest -> synthesize
    pipeline = [
        ("RSS Ingestion", "ingest_rss.py"),
        ("Note Synthesis", "synthesize_note.py"),
    ]

    for step_name, script_file in pipeline:
        script_path = os.path.join(base_dir, script_file)
        if not os.path.exists(script_path):
            print(f"Script not found: {script_path}")
            break
        if not run_step(step_name, script_path):
            print("Pipeline halted due to error.")
            break

    print("\n✅ Pipeline complete.")

if __name__ == "__main__":
    main()
