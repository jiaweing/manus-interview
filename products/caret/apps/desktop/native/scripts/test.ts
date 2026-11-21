import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { HelperClient } from "../../src/main/helper/client";
import { isTarget, type Target } from "../../src/main/helper/protocol";

const desktop = resolve(import.meta.dir, "../..");
const build = resolve(desktop, "native/build");
const windowsOnly = process.argv.includes("--windows");
const snapshotOnly = process.argv.includes("--snapshot");
if ((windowsOnly || snapshotOnly) && process.platform !== "win32") {
  console.error(
    "NOT RUN: needs Windows (real interactive desktop; Wine is not acceptance evidence)"
  );
  process.exit(2);
}
function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: desktop,
    env: {
      ...process.env,
      ASAN_OPTIONS: "detect_leaks=1",
      UBSAN_OPTIONS: "print_stacktrace=1:halt_on_error=1",
    },
    shell: false,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
const suffix = process.platform === "win32" ? ".exe" : "";
if (!snapshotOnly) {
  if (!windowsOnly) {
    run(process.execPath, ["native/scripts/build.ts", "--fixtures"]);
  }
  run(resolve(build, `protocol-fixtures${suffix}`), []);
  run(resolve(build, `paste-fixtures${suffix}`), []);
  run(resolve(build, `clipboard-policy-fixtures${suffix}`), []);
  if (process.platform === "linux" && !windowsOnly) {
    run(resolve(build, "win32-resource-fixtures"), []);
  }
  run(process.execPath, ["test", "native/tests/client.test.ts"]);
}

if (windowsOnly || snapshotOnly) {
  // Starting this verifier from a terminal must not turn the terminal into the
  // target. Give the operator time to switch to Notepad; do not activate it here.
  console.log(
    "Focus Notepad's editable input within 5 seconds; leave it focused."
  );
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 5000));
  const recorder = spawnSync(resolve(build, "record-target.exe"), [], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (recorder.error || recorder.status !== 0) {
    throw new Error("Independent Win32 handle recorder failed");
  }
  const recorded: unknown = JSON.parse(recorder.stdout);
  if (
    typeof recorded !== "object" ||
    recorded === null ||
    !("isNotepad" in recorded) ||
    recorded.isNotepad !== true ||
    !("foreground" in recorded) ||
    !("focus" in recorded)
  ) {
    throw new Error("Foreground target is not Notepad");
  }
  const independent: Target = {
    focus: String(recorded.focus),
    foreground: String(recorded.foreground),
  };
  if (!isTarget(independent)) {
    throw new Error("Invalid independently recorded handles");
  }
  const client = HelperClient.start(resolve(build, "caret-helper.exe"));
  try {
    const actual = await client.snapshot();
    console.log(`Independent Win32 handles: ${JSON.stringify(independent)}`);
    console.log(`Helper snapshot handles:  ${JSON.stringify(actual)}`);
    if (
      actual.foreground !== independent.foreground ||
      actual.focus !== independent.focus
    ) {
      throw new Error("Foreground/focused-control handle comparison failed");
    }
    console.log(
      "PASS real Windows Notepad foreground/focused-control handle comparison"
    );
    const outcome = await client.insert(
      { ...actual, foreground: actual.foreground === "0x1" ? "0x2" : "0x1" },
      "windows-protocol-only",
      "fixture text"
    );
    if (outcome === "paste_requested" || outcome === "clipboard_busy") {
      throw new Error("Stale target must not reach clipboard or paste");
    }
    try {
      await client.insert(actual, "windows-protocol-only", "fixture text");
      throw new Error("Duplicate session accepted");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error) ||
        error.code !== "duplicate_session"
      ) {
        throw error;
      }
    }
    console.log(
      "PASS real helper stale-target rejection; duplicate session rejected (no paste requested)"
    );
  } finally {
    client.close();
  }
}
