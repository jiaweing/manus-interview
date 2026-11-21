// Verification-only scan: never print a match or a file's contents.
const git = (args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error("Git read failed during staged-file scan");
  }
  return result.stdout.toString();
};

const files = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
  .split("\0")
  .filter(Boolean);
const patterns = [
  /sk-or-v1-[a-fA-F0-9]{32,}/,
  /gh[pousr]_[A-Za-z0-9]{36,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
let violations = 0;
for (const path of files) {
  const content = git(["show", `:${path}`]);
  if (patterns.some((pattern) => pattern.test(content)) || /(?:^|\/)\.env(?:\.[^/]+)?$/.test(path) && !path.endsWith(".env.example")) {
    violations += 1;
  }
}
console.info(`Scanned ${files.length} staged files; secret-pattern violations: ${violations}`);
process.exit(violations === 0 ? 0 : 1);
