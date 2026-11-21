import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { which } from "bun";

const native = resolve(import.meta.dir, "..");
const build = resolve(native, "build");
mkdirSync(build, { recursive: true });
const fixturesOnly = process.argv.includes("--fixtures");
const windows = process.platform === "win32";
const cross = !(windows || fixturesOnly);
function defaultCompiler(): string {
  if (cross) {
    return "x86_64-w64-mingw32-g++-posix";
  }
  return windows && which("cl.exe") ? "cl.exe" : "g++";
}
const compiler = process.env.CXX ?? defaultCompiler();
const msvc = /(^|[\\/])cl(\.exe)?$/i.test(compiler);
const suffix = windows || cross ? ".exe" : "";

function compile(sources: string[], name: string, win32 = false): void {
  const output = resolve(build, `${name}${suffix}`);
  const args = msvc
    ? [
        "/nologo",
        "/std:c++20",
        "/EHsc",
        "/utf-8",
        "/W4",
        "/WX",
        "/O2",
        "/MT",
        ...sources.map((source) => resolve(native, source)),
        `/Fe:${output}`,
        "/link",
        "/MACHINE:X64",
        ...(win32 ? ["user32.lib", "advapi32.lib", "gdi32.lib"] : []),
      ]
    : [
        "-std=c++20",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-pedantic",
        "-O2",
        ...(windows || cross
          ? ["-static", "-static-libgcc", "-static-libstdc++"]
          : []),
        ...sources.map((source) => resolve(native, source)),
        "-o",
        output,
        ...(win32 ? ["-luser32", "-ladvapi32", "-lgdi32"] : []),
      ];
  const result = spawnSync(compiler, args, {
    cwd: build,
    shell: false,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(
      `Compiler unavailable: ${compiler}. Use CXX or a Windows x64 Developer Prompt.`
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.log(
    `PASS compiled ${name}${suffix}${cross ? " (cross-compile only; NOT Windows behavioral evidence)" : ""}`
  );
}

compile(["protocol.cpp", "tests/protocol_test.cpp"], "protocol-fixtures");
compile(
  ["protocol.cpp", "paste.cpp", "tests/paste_test.cpp"],
  "paste-fixtures"
);
compile(
  ["protocol.cpp", "paste.cpp", "tests/clipboard_policy_test.cpp"],
  "clipboard-policy-fixtures"
);
if (!fixturesOnly) {
  compile(
    ["protocol.cpp", "paste.cpp", "win32_platform.cpp", "win32_main.cpp"],
    "caret-helper",
    true
  );
  compile(
    [
      "protocol.cpp",
      "paste.cpp",
      "win32_platform.cpp",
      "tests/clipboard_policy_windows.cpp",
    ],
    "clipboard-policy-windows",
    true
  );
  compile(["tests/record_target.cpp"], "record-target", true);
  compile(
    [
      "protocol.cpp",
      "paste.cpp",
      "win32_platform.cpp",
      "tests/paste_target.cpp",
    ],
    "paste-target",
    true
  );
}
