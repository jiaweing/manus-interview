import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

if (process.platform !== "win32") {
  console.error(
    "NOT RUN: needs Windows (real interactive desktop; Wine is not acceptance evidence)"
  );
  process.exit(2);
}
const desktop = resolve(import.meta.dir, "../..");
for (const [command, args] of [
  [process.execPath, ["native/scripts/build.ts"]],
  [resolve(desktop, "native/build/clipboard-policy-fixtures.exe"), []],
  [resolve(desktop, "native/build/clipboard-policy-windows.exe"), []],
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
