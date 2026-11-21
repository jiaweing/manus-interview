import { Config } from "@remotion/cli/config";
// Pinned Chromium: system binary, version asserted by `bun run verify:toolchain`.
Config.setBrowserExecutable(process.env.CHROMIUM_PATH || "/usr/bin/chromium");
Config.setChromiumOpenGlRenderer("swangle");
Config.setConcurrency(4);
