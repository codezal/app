/// <reference types="vitest" />
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import strip from "@rollup/plugin-strip"
import path from "node:path"

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    {
      ...strip({
        include: ["**/*.{ts,tsx}"],
        functions: ["console.info", "console.debug", "console.log"],
        debugger: false,
      }),
      apply: "build",
    },
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 5174 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    // Tauri/DOM gerektirmeyen pure-logic testler
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tauri IPC has no runtime under node — stub it so modules that import
    // `invoke` (env-reader, secret-store) load and hit their fallback paths.
    alias: {
      "@tauri-apps/api/core": path.resolve(__dirname, "./tests/helpers/tauri-core-stub.ts"),
    },
  },
}))
