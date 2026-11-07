"""Regenerates frontend/src/api/generated from the Rust types of the core."""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def main() -> int:
    target = ROOT / "frontend/src/api/generated"
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["TS_RS_EXPORT_DIR"] = str(target)
    result = subprocess.run(
        ["cargo", "test", "-q", "-p", "diffloupe-core", "--lib", "export_bindings"],
        cwd=BACKEND,
        env=env,
    )
    shutil.rmtree(BACKEND / "core/bindings", ignore_errors=True)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
