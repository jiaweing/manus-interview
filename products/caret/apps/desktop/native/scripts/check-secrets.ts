import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const desktop = resolve(import.meta.dir, "../..");
// This is a scoped issue-#6 verification, not a replacement for repository CI.
const patterns = [
  /sk-or-v1-[A-Za-z0-9]{32,}/,
  /(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,
];
let scanned = 0;
let failed = false;
function scan(path: string): void {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === "build" || entry.name === "evidence") {
      continue;
    }
    const file = resolve(path, entry.name);
    if (entry.isDirectory()) {
      scan(file);
    } else if (entry.isFile()) {
      scanned += 1;
      const content = readFileSync(file, "utf8");
      if (patterns.some((pattern) => pattern.test(content))) {
        console.error(
          `FAIL suspected credential in ${relative(desktop, file)} (value redacted)`
        );
        failed = true;
      }
    }
  }
}
scan(resolve(desktop, "native"));
scan(resolve(desktop, "src/main/helper"));
if (failed) {
  process.exit(1);
}
console.log(
  `PASS scoped helper secret scan: ${scanned} source/document files; no credential values printed`
);
