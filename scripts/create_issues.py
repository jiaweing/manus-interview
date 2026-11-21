#!/usr/bin/env python3
"""Create GitHub milestones, labels, epics and linked sub-issues from issue-specs/*.json.

Usage: python3 scripts/create_issues.py <specs_dir> [--dry-run]
Idempotent-ish: writes <specs_dir>/created.json (product -> epic/issue numbers) and skips
products already present in it.
"""
import json
import os
import subprocess
import sys
import time

REPO = "jiaweing/manus-interview"
PRD_BASE = f"https://github.com/{REPO}/blob/main/docs/prds/"
PRD_FILES = {
    "caret": "01-desktop-voice-input.md",
    "flopside": "02-multiplayer-web-game.md",
    "patchbay": "03-local-agent-harness.md",
    "sidekick": "04-chrome-agent-sidepanel.md",
    "tetherterm": "05-mcp-terminal-controller.md",
    "glassroom": "06-p2p-encrypted-chat.md",
    "session-seven": "07-promo-video.md",
}
DRY = "--dry-run" in sys.argv


def gh(*args, inp=None):
    cmd = ["gh", *args]
    env = dict(os.environ, NO_COLOR="1", GH_FORCE_TTY="0", TERM="dumb")
    for attempt in range(4):
        r = subprocess.run(cmd, input=inp, capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL if inp is None else None)
        if r.returncode == 0:
            return r.stdout
        if "rate limit" in (r.stderr + r.stdout).lower() or "secondary" in (r.stderr + r.stdout).lower():
            time.sleep(30 * (attempt + 1))
            continue
        raise RuntimeError(f"{' '.join(cmd)}\n{r.stderr}\n{r.stdout}")
    raise RuntimeError("retries exhausted: " + " ".join(cmd))


def api(method, path, payload=None):
    import tempfile
    args = ["api", "-X", method, path]
    tmp = None
    if payload is not None:
        tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(payload, tmp)
        tmp.close()
        args += ["--input", tmp.name]
    try:
        out = gh(*args)
    finally:
        if tmp:
            os.unlink(tmp.name)
    if not out.strip():
        return {}
    try:
        starts = [i for i in (out.find("{"), out.find("[")) if i >= 0]
        return json.loads(out[min(starts):])
    except (json.JSONDecodeError, ValueError):
        raise RuntimeError("non-JSON output: " + out[:300])


def ensure_label(name, color="BFD4F2", desc=""):
    if DRY:
        return
    try:
        gh("label", "create", name, "--color", color, "--description", desc, "--repo", REPO, "--force")
    except RuntimeError as e:
        print("label warn", name, str(e)[:120])


def bullets(items, box=False):
    pre = "- [ ] " if box else "- "
    out = []
    for i in items:
        t = str(i).strip()
        for junk in ("- [ ] ", "- [x] ", "- "):
            if t.startswith(junk):
                t = t[len(junk):]
                break
        out.append(pre + t)
    return "\n".join(out)


def issue_body(prod, spec, it, numbers):
    deps = [d for d in it.get("depends_on", []) if d in numbers]
    parts = [
        f"**Product:** {prod} | **Type:** {it['type']} | **Priority:** {it['priority']} | "
        f"**PRD refs:** {', '.join(it.get('prd_refs', [])) or 'n/a'}",
        "## Context\n" + it["context"],
        "## Tasks\n" + bullets(it["tasks"], box=True),
        "## Acceptance criteria\n" + bullets(it["acceptance_criteria"], box=True),
        "## Verification (how to prove it is done)\n" + it["verification"],
    ]
    if deps:
        parts.append("## Blocked by\n" + "\n".join(f"- #{numbers[d]}" for d in deps))
    parts.append(f"---\nSource: [{PRD_FILES[prod]}]({PRD_BASE}{PRD_FILES[prod]}). Scope is limited to the PRD; do not add work that is not in it.")
    return "\n\n".join(parts)


def main():
    specs_dir = sys.argv[1]
    created_path = os.path.join(specs_dir, "created.json")
    created = json.load(open(created_path)) if os.path.exists(created_path) else {}
    files = sorted(f for f in os.listdir(specs_dir) if f.endswith(".json") and f != "created.json")
    for f in files:
        spec = json.load(open(os.path.join(specs_dir, f)))
        prod = spec["product"]
        if prod in created and created[prod].get("done"):
            print("skip", prod)
            continue
        print("==", prod, len(spec["issues"]), "issues")
        for area in spec.get("areas", []):
            ensure_label(f"area:{area}", "BFD4F2", f"Area: {area}")
        if DRY:
            continue
        state = created.setdefault(prod, {"issues": {}, "done": False})
        title_prefix = f"[{prod}] "
        # milestone
        if "milestone" not in state:
            ms = api("POST", f"repos/{REPO}/milestones", {"title": spec["epic_title"], "description": spec["epic_summary"][:900]})
            state["milestone"] = ms["number"]
        ms_num = state["milestone"]
        # epic
        if "epic" not in state:
            body = (
                f"## Summary\n{spec['epic_summary']}\n\n## Done when (all true)\n{bullets(spec['epic_done_when'], box=True)}\n\n"
                f"## PRD\n[{PRD_FILES[prod]}]({PRD_BASE}{PRD_FILES[prod]})\n\n"
                "Sub-issues below are atomic; each has acceptance criteria and a verification outcome."
            )
            ep = api("POST", f"repos/{REPO}/issues", {
                "title": f"{title_prefix}EPIC: {spec['epic_title']}", "body": body, "milestone": ms_num,
                "labels": ["type:epic", f"product:{prod}", "priority:P0"],
            })
            state["epic"] = ep["number"]
            state["epic_id"] = ep["id"]
            json.dump(created, open(created_path, "w"), indent=1)
        numbers = {k: v["number"] for k, v in state["issues"].items()}
        for it in spec["issues"]:
            if it["key"] in state["issues"]:
                continue
            labels = [f"type:{it['type']}", f"priority:{it['priority']}", f"product:{prod}"]
            if it.get("area"):
                labels.append(f"area:{it['area']}")
            body = issue_body(prod, spec, it, numbers)
            iss = api("POST", f"repos/{REPO}/issues", {
                "title": f"{title_prefix}{it['title']}", "body": body, "milestone": ms_num, "labels": labels,
            })
            numbers[it["key"]] = iss["number"]
            state["issues"][it["key"]] = {"number": iss["number"], "id": iss["id"]}
            try:
                api("POST", f"repos/{REPO}/issues/{state['epic']}/sub_issues", {"sub_issue_id": iss["id"]})
            except RuntimeError as e:
                print("sub-issue link failed", it["key"], str(e)[:200])
                state.setdefault("link_failures", []).append(it["key"])
            json.dump(created, open(created_path, "w"), indent=1)
            time.sleep(1.2)
        # second pass: blocked-by for deps that were created later than the issue body
        for it in spec["issues"]:
            deps = [d for d in it.get("depends_on", []) if d in numbers]
            if not deps:
                continue
            me = state["issues"][it["key"]]
            if me.get("deps_set"):
                continue
            body = issue_body(prod, spec, it, numbers)
            api("PATCH", f"repos/{REPO}/issues/{me['number']}", {"body": body})
            for d in deps:
                try:
                    api("POST", f"repos/{REPO}/issues/{me['number']}/dependencies/blocked_by", {"issue_id": state["issues"][d]["id"]})
                except RuntimeError as e:
                    state.setdefault("dependency_api_failures", []).append([it["key"], d])
                    break
            me["deps_set"] = True
            json.dump(created, open(created_path, "w"), indent=1)
            time.sleep(0.8)
        # epic body with task list
        lines = []
        for it in spec["issues"]:
            n = state["issues"][it["key"]]["number"]
            lines.append(f"- [ ] #{n} ({it['priority']}, {it['type']}) {it['title']}")
        body = (
            f"## Summary\n{spec['epic_summary']}\n\n## Done when (all true)\n{bullets(spec['epic_done_when'], box=True)}\n\n"
            f"## Build order\n" + "\n".join(lines) + f"\n\n## PRD\n[{PRD_FILES[prod]}]({PRD_BASE}{PRD_FILES[prod]})"
        )
        api("PATCH", f"repos/{REPO}/issues/{state['epic']}", {"body": body})
        state["done"] = True
        json.dump(created, open(created_path, "w"), indent=1)
        print("done", prod, "epic #", state["epic"])


if __name__ == "__main__":
    main()
