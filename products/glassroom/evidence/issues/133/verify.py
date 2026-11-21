#!/usr/bin/env python3
"""Issue 133 verification; run from products/glassroom with the assigned ports."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "evidence/issues/133"
ENV = dict(os.environ, PATH=f"{Path.home()}/.bun/bin:{os.environ['PATH']}", PUBLIC_PORT="4133", NEXT_INTERNAL_PORT="5133", CHROMIUM_PATH="/usr/bin/chromium")
RESULTS = []


def run(name, command):
    print(f"Running {name}: {command}", flush=True)
    result = subprocess.run(command, shell=True, executable="/bin/bash", cwd=ROOT, env=ENV, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    tail = "\n".join(line.rstrip() for line in result.stdout.splitlines()[-15:]).rstrip()
    (EVIDENCE / f"{name}.txt").write_text(f"$ {command}\nexit: {result.returncode}\n{tail}".rstrip() + "\n")
    RESULTS.append({"name": name, "command": command, "exit": result.returncode})
    print(f"{name}: exit {result.returncode}\n{tail}", flush=True)
    (EVIDENCE / f"{sys.argv[1]}-commands.json").write_text(json.dumps(RESULTS, indent=2) + "\n")
    if result.returncode:
        raise SystemExit(result.returncode)


if sys.argv[1] == "static":
    run("merge-main", "git fetch origin && git merge origin/main")
    run("install", "bun install --frozen-lockfile")
    run("biome-fix", "bunx biome check --write")
    run("check", "bun run check")
    run("types", "bun run check-types")
    run("invitation-test-types", "bunx tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --types bun tests/e2e/invitations.spec.ts tests/unit/invitations.test.ts")
    run("build", "bun run build")
    run("unit", "bun test tests/unit")
    run("diff", "git diff --check")
elif sys.argv[1] == "browser":
    with tempfile.TemporaryFile(mode="w+") as log:
        print("Starting owned dev:https stack on 4133/5133", flush=True)
        server = subprocess.Popen(["bun", "run", "dev:https"], cwd=ROOT, env=ENV, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            for attempt in range(120):
                ready = subprocess.run(["curl", "--silent", "--insecure", "--fail", "--output", "/dev/null", "https://localhost:4133"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
                if ready:
                    break
                if server.poll() is not None:
                    raise RuntimeError("dev:https exited before readiness")
                time.sleep(1)
            else:
                raise RuntimeError("dev:https readiness timeout")
            run("invitations-e2e", "xvfb-run -a --server-args='-screen 0 1280x900x24' env PUBLIC_PORT=4133 NEXT_INTERNAL_PORT=5133 CHROMIUM_PATH=/usr/bin/chromium PW_NO_WEBSERVER=1 INVITATION_SCREENSHOTS=1 bunx playwright test tests/e2e/invitations.spec.ts --project=chromium --headed --reporter=list")
            run("regression-e2e", "PUBLIC_PORT=4133 NEXT_INTERNAL_PORT=5133 CHROMIUM_PATH=/usr/bin/chromium PW_NO_WEBSERVER=1 bunx playwright test tests/e2e/boot.spec.ts tests/e2e/preflight.spec.ts tests/e2e/signal-server.spec.ts --project=chromium --reporter=list")
        finally:
            if server.poll() is None:
                os.killpg(server.pid, signal.SIGTERM)
                server.wait(timeout=20)
            log.seek(0)
            tail = "\n".join(line.rstrip() for line in log.read().splitlines()[-15:]).rstrip()
            (EVIDENCE / "dev-https.txt").write_text("$ PUBLIC_PORT=4133 NEXT_INTERNAL_PORT=5133 bun run dev:https\nOwned process group terminated after verification.\n" + tail + "\n")
else:
    raise SystemExit("usage: python3 evidence/issues/133/verify.py static|browser")
