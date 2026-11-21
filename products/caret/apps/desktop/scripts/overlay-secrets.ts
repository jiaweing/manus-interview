import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../../../../..");
const patch = execFileSync(
  "git",
  [
    "diff",
    "--cached",
    "--no-ext-diff",
    "--unified=0",
    "--",
    "products/caret/apps/desktop",
    "products/caret/bun.lock",
    "evidence/overlay",
  ],
  { cwd: repo, encoding: "utf8" }
);
if (!patch.trim()) {
  console.error(
    "NOT RUN: stage overlay changes before running the secret check."
  );
  process.exit(1);
}
const added = patch
  .split("\n")
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
  .join("\n");
const patterns = [
  /\bsk-(?:or-v1-)?[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
if (patterns.some((pattern) => pattern.test(added))) {
  console.error(
    "FAIL: possible secret pattern in staged overlay text. Inspect privately; values are not printed."
  );
  process.exit(1);
}
console.log(
  "PASS: no known provider/GitHub/private-key secret patterns in staged overlay text. Screenshots require visual review."
);
