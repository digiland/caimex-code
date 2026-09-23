import { defineConfig } from "electron-vite"
import solid from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: "src/main/index.ts" } } },
  },
  preload: {
    // Sandboxed preloads cannot be ES modules.
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: { format: "cjs", entryFileNames: "[name].js" },
      },
    },
  },
  renderer: {
    // 5173 belongs to the existing desktop app's dev server; keep clear of it.
    server: { port: 5280, strictPort: false },
    plugins: [solid(), tailwindcss()],
  },
})
