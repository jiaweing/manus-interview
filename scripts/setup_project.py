#!/usr/bin/env python3
"""Create the GitHub Projects v2 board and add every issue with Priority / Product / Type fields.

Needs a token with the `project` scope (classic PAT, or fine-grained PAT with user "Projects: read/write").
The default sandbox token (a GitHub App user token) cannot create user-owned Projects v2.

Usage:
  GH_TOKEN=<pat with project scope> python3 scripts/setup_project.py issue-specs/created.json
  (or `gh auth refresh -s project` on your own machine, then run without GH_TOKEN)

created.json is the file written by scripts/create_issues.py: {product: {epic, issues:{key:{number,id}}}}.
If you do not have it, pass --from-repo to enumerate issues by label instead.
"""
import json
import subprocess
import sys

REPO = "jiaweing/manus-interview"
OWNER = "jiaweing"
TITLE = "Interview: 7 products"
PRODUCTS = ["caret", "flopside", "patchbay", "sidekick", "tetherterm", "glassroom", "session-seven"]
PRIORITIES = ["P0", "P1"]
TYPES = ["epic", "setup", "feature", "test", "verification", "docs"]
STATUSES = ["Todo", "In Progress", "Done"]


def gql(query, **vars):
    args = ["gh", "api", "graphql", "-f", f"query={query}"]
    for k, v in vars.items():
        args += ["-F" if isinstance(v, int) else "-f", f"{k}={v}"]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(r.stderr + r.stdout)
    d = json.loads(r.stdout)
    if d.get("errors"):
        raise SystemExit(json.dumps(d["errors"], indent=1))
    return d["data"]


def rest(path):
    return json.loads(subprocess.run(["gh", "api", path, "--paginate"], capture_output=True, text=True, check=True).stdout)


def main():
    owner_id = gql("query($l:String!){user(login:$l){id}}", l=OWNER)["user"]["id"]
    proj = gql(
        "mutation($o:ID!,$t:String!){createProjectV2(input:{ownerId:$o,title:$t}){projectV2{id number url}}}",
        o=owner_id, t=TITLE,
    )["createProjectV2"]["projectV2"]
    print("project", proj["url"])
    pid = proj["id"]
    gql("mutation($p:ID!,$r:String!){updateProjectV2(input:{projectId:$p,readme:$r,public:false}){projectV2{id}}}",
        p=pid, r="Scoping and discovery for 7 products. Each product has one epic with atomic sub-issues. See docs/handover.md.")
    # link repo
    repo_id = gql("query($o:String!,$n:String!){repository(owner:$o,name:$n){id}}", o=OWNER, n="manus-interview")["repository"]["id"]
    gql("mutation($p:ID!,$r:ID!){linkProjectV2ToRepository(input:{projectId:$p,repositoryId:$r}){repository{id}}}", p=pid, r=repo_id)

    def make_field(name, options):
        opts = ",".join('{name:"%s",color:GRAY,description:""}' % o for o in options)
        q = 'mutation($p:ID!){createProjectV2Field(input:{projectId:$p,dataType:SINGLE_SELECT,name:"%s",singleSelectOptions:[%s]}){projectV2Field{... on ProjectV2SingleSelectField{id options{id name}}}}}' % (name, opts)
        f = gql(q, p=pid)["createProjectV2Field"]["projectV2Field"]
        return f["id"], {o["name"]: o["id"] for o in f["options"]}

    f_pri = make_field("Priority", PRIORITIES)
    f_prod = make_field("Product", PRODUCTS)
    f_type = make_field("Type", TYPES)
    # The built-in Status field already exists with Todo / In Progress / Done.

    issues = []
    for label in [f"product:{p}" for p in PRODUCTS]:
        for i in rest(f"repos/{REPO}/issues?state=all&labels={label}&per_page=100"):
            names = {l["name"] for l in i["labels"]}
            pri = next((n.split(":")[1] for n in names if n.startswith("priority:")), None)
            typ = next((n.split(":")[1] for n in names if n.startswith("type:")), None)
            issues.append((i["node_id"], i["number"], pri, label.split(":")[1], typ))
    print(len(issues), "issues to add")
    for node, num, pri, prod, typ in issues:
        item = gql("mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}", p=pid, c=node)["addProjectV2ItemById"]["item"]["id"]
        for (fid, opts), val in ((f_pri, pri), (f_prod, prod), (f_type, typ)):
            if val in opts:
                gql("mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}",
                    p=pid, i=item, f=fid, o=opts[val])
        print("added #", num)
    print("done:", proj["url"])


if __name__ == "__main__":
    main()
