import { execFileSync } from "node:child_process";

// Inspect staged additions, or the committed/staged PR against main. Never echo matches.
const args = ["diff", "--cached", "--no-color", "--no-ext-diff", "--unified=0"];
if (process.argv.includes("--against-main")) {
  args.push("origin/main");
}
const diff = execFileSync("git", args, { encoding: "utf8" });
const additions = diff
  .split("\n")
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
const patterns = [
  /sk-or-v1-[a-zA-Z0-9]{32,}/,
  /gh[pousr]_[a-zA-Z0-9]{20,}/,
  /github_pat_[a-zA-Z0-9_]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /OPENROUTER_API_KEY\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}/,
];
if (additions.length === 0) {
  console.error("Secret check NOT RUN: no staged additions to inspect.");
  process.exit(2);
}
if (additions.some((line) => patterns.some((pattern) => pattern.test(line)))) {
  console.error(
    "Secret check FAILED: credential-shaped material found in staged additions (content withheld)."
  );
  process.exit(1);
}
console.info(
  `Secret check PASS: ${additions.length} staged added lines; checked OpenRouter/GitHub token, key assignment and private-key patterns. This is not a comprehensive secret audit.`
);
