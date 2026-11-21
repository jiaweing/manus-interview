#!/usr/bin/env python3
"""Run issue 132 verification from the Glassroom product root, retaining text only."""
from pathlib import Path
import os
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
evidence = root / "evidence/issues/132"
env = {
    **os.environ,
    "PATH": f"{Path.home()}/.bun/bin:{os.environ['PATH']}",
    "PUBLIC_PORT": "4332",
    "NEXT_INTERNAL_PORT": "5332",
    "CHROMIUM_PATH": "/usr/bin/chromium",
    "NEXT_TELEMETRY_DISABLED": "1",
    "CI": "1",
    "NO_COLOR": "1",
}
commands = [
    ("install", "bun install --frozen-lockfile"),
    ("unit", "bun test tests/unit/signal-server.test.ts"),
    ("check", "bun run check"),
    ("types", "bun run check-types"),
    ("build", "bun run build"),
    ("all-unit", "bun test tests/unit"),
    ("e2e", "bun run test:e2e tests/e2e/boot.spec.ts tests/e2e/signal-server.spec.ts"),
    ("static", "python3 evidence/issues/132/static-audit.py"),
    ("diff", "git -c color.ui=false diff --check"),
]
failed = []
for name, command in commands:
    print(f"RUN {command}", flush=True)
    completed = subprocess.run(command, cwd=root, env=env, shell=True,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    output = completed.stdout.decode("utf-8", errors="replace")
    output = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", output)
    output = "\n".join(line.rstrip() for line in output.splitlines()).rstrip() + "\n"
    (evidence / f"{name}.command.txt").write_text(command + "\n")
    (evidence / f"{name}.exit.txt").write_text(f"{completed.returncode}\n")
    (evidence / f"{name}.output.txt").write_text(output)
    print(f"EXIT {completed.returncode}\n" + "\n".join(output.splitlines()[-15:]), flush=True)
    if completed.returncode:
        failed.append(name)
print("FAILED: " + ", ".join(failed) if failed else "PASS: all verification commands exited 0", flush=True)
sys.exit(bool(failed))
