#!/usr/bin/env python3
"""Sync docs/issue-specs/*.json to GitHub: PATCH changed issues, create new ones, link sub-issues and dependencies.
Usage: python3 scripts/sync_issues.py docs/issue-map.json
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import create_issues as ci  # noqa: E402

SPECS = "docs/issue-specs"


def main():
    map_path = sys.argv[1]
    created = json.load(open(map_path))
    for slug_file in sorted(f for f in os.listdir(SPECS) if f.startswith("0") and f.endswith(".json")):
        spec = json.load(open(os.path.join(SPECS, slug_file)))
        prod = spec["product"]
        st = created[prod]
        for area in spec.get("areas", []):
            ci.ensure_label(f"area:{area}", "BFD4F2", f"Area: {area}")
        numbers = {k: v["number"] for k, v in st["issues"].items()}
        # create new issues first so dependency numbers resolve
        for it in spec["issues"]:
            if it["key"] in st["issues"]:
                continue
            labels = [f"type:{it['type']}", f"priority:{it['priority']}", f"product:{prod}"]
            if it.get("area"):
                labels.append(f"area:{it['area']}")
            tmp_numbers = dict(numbers)
            iss = ci.api("POST", f"repos/{ci.REPO}/issues", {
                "title": f"[{prod}] {it['title']}", "body": ci.issue_body(prod, spec, it, tmp_numbers),
                "milestone": st["milestone"], "labels": labels,
            })
            numbers[it["key"]] = iss["number"]
            st["issues"][it["key"]] = {"number": iss["number"], "id": iss["id"], "new": True}
            ci.api("POST", f"repos/{ci.REPO}/issues/{st['epic']}/sub_issues", {"sub_issue_id": iss["id"]})
            print("created", prod, it["key"], iss["number"])
            json.dump(created, open(map_path, "w"), indent=1)
        # patch all
        for it in spec["issues"]:
            me = st["issues"][it["key"]]
            ci.api("PATCH", f"repos/{ci.REPO}/issues/{me['number']}", {
                "title": f"[{prod}] {it['title']}", "body": ci.issue_body(prod, spec, it, numbers),
            })
            if me.get("new"):
                for d in it.get("depends_on", []):
                    if d in st["issues"]:
                        ci.api("POST", f"repos/{ci.REPO}/issues/{me['number']}/dependencies/blocked_by", {"issue_id": st["issues"][d]["id"]})
                me.pop("new", None)
            time.sleep(0.7)
        lines = [f"- [ ] #{st['issues'][it['key']]['number']} ({it['priority']}, {it['type']}) {it['title']}" for it in spec["issues"]]
        body = (
            f"## Summary\n{spec['epic_summary']}\n\n## Done when (all true)\n{ci.bullets(spec['epic_done_when'], box=True)}\n\n"
            f"## Build order\n" + "\n".join(lines) + f"\n\n## PRD\n[{ci.PRD_FILES[prod]}]({ci.PRD_BASE}{ci.PRD_FILES[prod]})"
        )
        ci.api("PATCH", f"repos/{ci.REPO}/issues/{st['epic']}", {"body": body})
        json.dump(created, open(map_path, "w"), indent=1)
        print("synced", prod, len(spec["issues"]))


if __name__ == "__main__":
    main()
