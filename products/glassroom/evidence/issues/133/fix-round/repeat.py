#!/usr/bin/env python3
"""Run the fix-round gates from products/glassroom on the caller's assigned ports."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("verify", ROOT / "evidence/issues/133/verify.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
verify.EVIDENCE = EVIDENCE
verify.ENV["PW_NO_WEBSERVER"] = "1"
sys.argv = [__file__, "runs"]
summary = []
public_port = verify.ENV["PUBLIC_PORT"]
internal_port = verify.ENV["NEXT_INTERNAL_PORT"]
command = "bunx playwright test tests/e2e/invitations.spec.ts --project=chromium --reporter=list"
all_specs = "bunx playwright test tests/e2e/boot.spec.ts tests/e2e/preflight.spec.ts tests/e2e/signal-server.spec.ts tests/e2e/data-envelope.spec.ts tests/e2e/invitations.spec.ts --project=chromium --reporter=list"
(EVIDENCE / "environment.json").write_text(json.dumps({"PUBLIC_PORT": public_port, "NEXT_INTERNAL_PORT": internal_port, "CHROMIUM_PATH": verify.ENV["CHROMIUM_PATH"], "PW_NO_WEBSERVER": "1"}, indent=2) + "\n")
for mode, service in [("dev", "dev:https"), ("prod", "start:https")]:
    if mode == "prod":
        # next dev writes .next, so rebuild only after the dev stack has stopped.
        verify.run("prod-build", "bun run build")
    with tempfile.TemporaryFile(mode="w+") as log:
        print(f"Starting {service} on assigned ports {public_port}/{internal_port}", flush=True)
        server = subprocess.Popen(["bun", "run", service], cwd=ROOT, env=verify.ENV, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            for attempt in range(120):
                if server.poll() is not None:
                    raise RuntimeError("Owned HTTPS stack exited before readiness")
                if subprocess.run(["curl", "-skf", f"https://localhost:{public_port}", "-o", "/dev/null"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError("Owned HTTPS readiness timeout")
            for number in range(1, 11):
                name = f"{mode}-{number:02d}"
                verify.run(name, command)
                summary.append({"mode": mode, "run": number, "exit": 0})
                (EVIDENCE / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
            verify.run(f"{mode}-all-chromium", all_specs)
        finally:
            if server.poll() is None:
                os.killpg(server.pid, signal.SIGTERM)
                try:
                    server.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    os.killpg(server.pid, signal.SIGKILL)
                    server.wait(timeout=20)
            log.seek(0)
            (EVIDENCE / f"{mode}-https.txt").write_text(f"$ PUBLIC_PORT={public_port} NEXT_INTERNAL_PORT={internal_port} bun run {service}\nOwned stack intentionally stopped after verification.\n{verify.output_tail(log.read())}\n")
            print(f"Stopped owned {service}", flush=True)
    time.sleep(2)
print("Completed: dev 10/10, prod 10/10", flush=True)
