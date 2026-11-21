import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve("src/main/index.ts") } } },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          overlay: resolve("src/preload/overlay.ts"),
        },
        output: { entryFileNames: "[name].cjs", format: "cjs" },
      },
    },
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          overlay: resolve("src/renderer/overlay.html"),
        },
      },
    },
    plugins: [react()],
    root: resolve("src/renderer"),
  },
});
