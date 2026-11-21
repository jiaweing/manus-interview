#!/usr/bin/env python3
"""Mandatory static gates plus strict issue-test types and redaction regressions."""
import importlib.util
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[4]
spec = importlib.util.spec_from_file_location("verify", ROOT / "evidence/issues/133/verify.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
verify.EVIDENCE = Path(__file__).resolve().parent
sys.argv = [__file__, "static"]
for name, command in [
    ("merge-main", "git fetch origin && git merge origin/main"),
    ("install", "bun install --frozen-lockfile"),
    ("biome-fix", "bunx biome check --write"),
    ("check", "bun run check"),
    ("types", "bun run check-types"),
    ("invitation-test-types", "bunx tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --types bun tests/e2e/invitations.spec.ts tests/unit/invitations.test.ts tests/unit/invitation-admission.test.ts"),
    ("build", "bun run build"),
    ("unit", "bun test tests/unit"),
    ("redaction-unit", "python3 evidence/issues/133/verify_test.py"),
    ("diff", "git diff --check"),
]:
    verify.run(name, command)
