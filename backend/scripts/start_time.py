"""Times how long the release app takes from launch to its first painted page.

Build it first with `pnpm tauri build`. Each run starts the app through `open`, as Finder
does, in a temporary home folder, and waits for the line the app prints when its page has
loaded.
"""

import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
APP = BACKEND / "target/release/bundle/macos/Diffloupe.app"
READY = "Diffloupe page loaded"
TARGET_MS = 500
RUNS = 5
NO_UPDATES = "http://127.0.0.1:9/download/latest/macos/version"


def running() -> bool:
    found = subprocess.run(["pgrep", "-f", "Diffloupe.app/Contents/MacOS/diffloupe"], capture_output=True)
    return found.returncode == 0


def once(home: Path) -> float:
    log = home / "stderr.log"
    log.write_text("")
    start = time.monotonic()
    subprocess.run(["open", "-n", "--env", f"HOME={home}", "--env", f"DIFFLOUPE_UPDATE_URL={NO_UPDATES}", "--stderr", str(log), str(APP)], check=True)
    deadline = start + 30
    while READY not in log.read_text():
        if time.monotonic() > deadline:
            raise SystemExit("the app did not load its page within 30 seconds")
        time.sleep(0.005)
    took = (time.monotonic() - start) * 1000
    subprocess.run(["pkill", "-f", "Diffloupe.app/Contents/MacOS/diffloupe"], check=False)
    while running():
        time.sleep(0.1)
    return took


def main() -> int:
    if not APP.exists():
        raise SystemExit(f"{APP} is missing; run `pnpm tauri build` first")
    if running():
        raise SystemExit("Quit the running Diffloupe first.")
    with tempfile.TemporaryDirectory(prefix="diffloupe-start-") as tmp:
        times = [once(Path(tmp)) for _ in range(RUNS)]
    median = statistics.median(times)
    print("runs: " + ", ".join(f"{t:.0f} ms" for t in times))
    print(f"{'ok  ' if median <= TARGET_MS else 'SLOW'} start to first page {median:.0f} ms (target {TARGET_MS} ms)")
    return 0 if median <= TARGET_MS else 1


if __name__ == "__main__":
    sys.exit(main())
