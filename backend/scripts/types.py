"""Regenerates frontend/src/api/generated from the Rust types of the core."""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def main() -> int:
    shutil.rmtree(ROOT / "frontend/src/api/generated", ignore_errors=True)
    result = subprocess.run(["cargo", "test", "-q", "-p", "diffloupe-core", "--lib", "export_bindings"], cwd=BACKEND)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
