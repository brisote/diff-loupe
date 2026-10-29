"""Starts the dev bridge and Vite, so the Diffloupe UI runs in a browser."""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

import demo_repos

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=7357, help="dev bridge port")
    parser.add_argument("--vite-port", type=int, default=1420, help="Vite port")
    parser.add_argument("--data-dir", type=Path, help="store folder; a new temporary one by default")
    parser.add_argument("--open", type=Path, action="append", default=[], help="repository to open at start")
    parser.add_argument("--pick", type=Path, help="folder that the Open… button returns")
    parser.add_argument("--platform", choices=["macos", "windows", "linux"], help="platform the UI should behave as; this system's by default")
    parser.add_argument("--shell", help="shell executable to use in the terminal")
    parser.add_argument("--demo", action="store_true", help="create demo repositories and open them")
    args = parser.parse_args()

    subprocess.run(["cargo", "build", "-q", "-p", "diffloupe-devbridge"], cwd=BACKEND, check=True)
    data_dir = args.data_dir or Path(tempfile.mkdtemp(prefix="diffloupe-data-"))
    opened = list(args.open)
    if args.demo:
        opened += demo_repos.create(Path(tempfile.mkdtemp(prefix="diffloupe-demo-")))

    bridge = [str(BACKEND / "target/debug/diffloupe-devbridge"), "--port", str(args.port), "--data-dir", str(data_dir)]
    for path in opened:
        bridge += ["--open", str(path)]
    if args.pick:
        bridge += ["--pick", str(args.pick)]
    if args.platform:
        bridge += ["--platform", args.platform]
    if args.shell:
        bridge += ["--shell", args.shell]

    processes = [subprocess.Popen(bridge, cwd=ROOT)]
    processes.append(subprocess.Popen(["pnpm", "vite", "--port", str(args.vite_port), "--strictPort"], cwd=ROOT / "frontend"))
    print(f"Open http://localhost:{args.vite_port}/?bridge=ws://127.0.0.1:{args.port}", flush=True)
    try:
        return processes[0].wait()
    except KeyboardInterrupt:
        return 0
    finally:
        for process in processes:
            process.terminate()


if __name__ == "__main__":
    sys.exit(main())
