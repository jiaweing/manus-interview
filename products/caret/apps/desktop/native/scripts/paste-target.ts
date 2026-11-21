import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.platform !== "win32") {
  console.error(
    "NOT RUN: needs Windows (real interactive desktop; Wine is not acceptance evidence)"
  );
  process.exit(2);
}
const desktop = resolve(import.meta.dir, "../..");
// Adapter has no refocus primitive; additionally audit actual Windows sources.
const forbidden =
  /\b(?:SetForegroundWindow|AttachThreadInput|SetFocus|SetActiveWindow|BringWindowToTop|SwitchToThisWindow)\s*\(/;
for (const source of ["win32_platform.cpp", "win32_main.cpp", "paste.cpp"]) {
  if (
    forbidden.test(readFileSync(resolve(desktop, "native", source), "utf8"))
  ) {
    console.error("FAIL foreground-setting API found in insertion sources");
    process.exit(1);
  }
}
console.log("PASS source audit: zero foreground-setting/refocusing APIs");
for (const [command, args] of [
  [process.execPath, ["native/scripts/build.ts"]],
  [resolve(desktop, "native/build/paste-fixtures.exe"), []],
  [resolve(desktop, "native/build/paste-target.exe"), []],
] as const) {
  const result = spawnSync(command, [...args], {
    cwd: desktop,
    shell: false,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
