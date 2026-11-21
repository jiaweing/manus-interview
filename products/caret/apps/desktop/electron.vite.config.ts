import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve("src/main/index.ts") } } },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve("src/preload/index.ts"), overlay: resolve("src/preload/overlay.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve("src/renderer"),
    build: { rollupOptions: { input: { index: resolve("src/renderer/index.html"), overlay: resolve("src/renderer/overlay.html") } } },
    plugins: [react()],
  },
});
