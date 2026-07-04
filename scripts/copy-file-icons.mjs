// Copy material-icon-theme SVGs into public/file-icons/.
// Vite import.meta.glob does not reliably traverse pnpm symlinked node_modules
// here, so serving a copied public directory keeps dev/build/Tauri bundling
// independent from the package manager layout. The output is gitignored.
import { cp, mkdir, readdir, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
// Resolve the package root through package.json so symlinks and versions do not matter.
const pkgRoot = dirname(require.resolve("material-icon-theme/package.json"))
const srcDir = join(pkgRoot, "icons")
const outDir = join(process.cwd(), "public", "file-icons")

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
await cp(srcDir, outDir, { recursive: true })
const n = (await readdir(outDir)).length
console.log(`[file-icons] copied ${n} icons to public/file-icons/`)
