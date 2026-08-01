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
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Framework — rarely changes, cached across deploys.
            { name: "vendor-react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            // CodeMirror editor stack.
            { name: "vendor-codemirror", test: /node_modules[\\/](@codemirror|@lezer|codemirror)[\\/]/ },
            // Vercel AI SDK + all provider adapters.
            { name: "vendor-ai", test: /node_modules[\\/](ai|@ai-sdk)[\\/]/ },
            // Syntax highlighting (highlight.js core + grammars + lowlight).
            { name: "vendor-highlight", test: /node_modules[\\/](highlight\.js|lowlight|rehype-highlight)[\\/]/ },
            // KaTeX math rendering.
            { name: "vendor-katex", test: /node_modules[\\/](katex|rehype-katex)[\\/]/ },
            // Icon library.
            { name: "vendor-lucide", test: /node_modules[\\/]lucide-react[\\/]/ },
          ],
        },
      },
    },
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
