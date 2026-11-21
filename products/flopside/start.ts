import { resolve } from "node:path";

// Intentionally a Bun entrypoint, not a package-shell script spawning another Bun.
// `bun run start` resolves start.ts and imports the production bundle in-process.
Bun.env.NODE_ENV = "production";
const serverEntry = resolve(import.meta.dir, "apps/server/dist/index.js");
await import(serverEntry);
