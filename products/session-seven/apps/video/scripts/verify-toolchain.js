// bun run verify:toolchain: check pins in toolchain.json against the environment and write qa/toolchain.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const videoDir = resolve(here, "..");
const productDir = resolve(videoDir, "../..");
const pins = JSON.parse(readFileSync(join(videoDir, "toolchain.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(videoDir, "package.json"), "utf8"));
const rootPkg = JSON.parse(readFileSync(join(productDir, "package.json"), "utf8"));

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail}`);
};

const chromiumPath = process.env.CHROMIUM_PATH || pins.chromium.executable;
const chromiumOut = spawnSync(chromiumPath, ["--version"], { encoding: "utf8" });
const chromiumVersion = (chromiumOut.stdout || "").match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null;
check("chromium", chromiumVersion === pins.chromium.version, `expected ${pins.chromium.version}, got ${chromiumVersion}`);

const bunVersion = Bun.version;
check("bun", bunVersion === pins.bun, `expected ${pins.bun}, got ${bunVersion}`);
check("packageManager", rootPkg.packageManager === `bun@${pins.bun}`, `root packageManager is ${rootPkg.packageManager}`);

const installed = (name) => {
  const p = join(videoDir, "node_modules", name, "package.json");
  const q = join(productDir, "node_modules", name, "package.json");
  const file = existsSync(p) ? p : q;
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).version : null;
};
const remotionPkgs = ["remotion", "@remotion/cli", "@remotion/bundler", "@remotion/renderer"];
const remotion = {};
for (const name of remotionPkgs) {
  remotion[name] = installed(name);
  check(name, remotion[name] === pins.remotion, `expected ${pins.remotion}, got ${remotion[name]}`);
  check(`${name} declared`, pkg.dependencies[name] === pins.remotion, `package.json declares ${pkg.dependencies[name]} (must be exact)`);
}
for (const name of ["react", "react-dom"]) {
  const v = installed(name);
  check(name, v === pins.react, `expected ${pins.react}, got ${v}`);
}
check("lockfile", existsSync(join(productDir, "bun.lock")), "bun.lock missing");

const fontPath = join(videoDir, pins.font.file);
const licensePath = join(videoDir, pins.font.licenseFile);
check("font", existsSync(fontPath), `${pins.font.file} missing`);
check("font license", existsSync(licensePath), `${pins.font.licenseFile} missing`);
const fontSha = existsSync(fontPath) ? createHash("sha256").update(readFileSync(fontPath)).digest("hex") : null;

const report = {
  ok: failures.length === 0,
  bun: bunVersion,
  chromium: { executable: chromiumPath, version: chromiumVersion },
  remotion,
  react: installed("react"),
  font: { ...pins.font, sha256: fontSha },
  failures,
};
mkdirSync(join(productDir, "qa"), { recursive: true });
writeFileSync(join(productDir, "qa/toolchain.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.error(`FAIL verify:toolchain\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("PASS verify:toolchain");
