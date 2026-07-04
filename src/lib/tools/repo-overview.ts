import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs"
import { runProgram } from "@/lib/exec"
import { resolveInWorkspace } from "./paths"

type Section = { title: string; body: string }

async function readHead(absPath: string, maxLines: number): Promise<string | null> {
  if (!(await exists(absPath))) return null
  try {
    const content = await readTextFile(absPath)
    const lines = content.split(/\r?\n/)
    if (lines.length <= maxLines) return content.trim()
    return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} satır daha)`
  } catch {
    return null
  }
}

async function tryGit(workspace: string, args: string[], timeoutMs = 5000): Promise<string | null> {
  try {
    const out = await runProgram("git", args, { cwd: workspace, timeoutMs })
    if (out.code !== 0) return null
    return out.stdout.trim() || null
  } catch {
    return null
  }
}

const SKIP = new Set([".git", "node_modules", "target", "dist", "build", ".next", ".turbo", ".cache", "venv", "__pycache__", ".venv"])

async function tree(workspace: string, depth: number): Promise<string> {
  const lines: string[] = []
  async function walk(absDir: string, relPrefix: string, level: number): Promise<void> {
    if (level > depth) return
    let entries
    try {
      entries = await readDir(absDir)
    } catch {
      return
    }
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".github" && e.name !== ".env.example") continue
      if (SKIP.has(e.name)) continue
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name
      lines.push(`${"  ".repeat(level)}${e.isDirectory ? "📁" : "📄"} ${e.name}`)
      if (e.isDirectory && level < depth) {
        await walk(`${absDir}/${e.name}`, rel, level + 1)
      }
    }
  }
  await walk(workspace, "", 0)
  return lines.slice(0, 80).join("\n") + (lines.length > 80 ? `\n... (${lines.length - 80} satır daha)` : "")
}

type StackInfo = { name?: string; description?: string; deps: string[]; lang: string }

async function detectStack(workspace: string): Promise<StackInfo | null> {
  // Node
  const pkgPath = `${workspace}/package.json`
  if (await exists(pkgPath)) {
    try {
      const raw = await readTextFile(pkgPath)
      const pkg = JSON.parse(raw) as {
        name?: string
        description?: string
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const deps = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ].slice(0, 20)
      return { name: pkg.name, description: pkg.description, deps, lang: "Node.js / TypeScript" }
    } catch {
      // Intentionally ignored.
    }
  }
  // Rust
  const cargoPath = `${workspace}/Cargo.toml`
  if (await exists(cargoPath)) {
    try {
      const raw = await readTextFile(cargoPath)
      const nameMatch = raw.match(/^\s*name\s*=\s*"([^"]+)"/m)
      const descMatch = raw.match(/^\s*description\s*=\s*"([^"]+)"/m)
      const deps = Array.from(raw.matchAll(/^([a-zA-Z0-9_-]+)\s*=/gm))
        .map((m) => m[1])
        .filter((n) => n !== "name" && n !== "version" && n !== "edition")
        .slice(0, 20)
      return { name: nameMatch?.[1], description: descMatch?.[1], deps, lang: "Rust" }
    } catch {
      // Intentionally ignored.
    }
  }
  // Python
  const pyprojPath = `${workspace}/pyproject.toml`
  if (await exists(pyprojPath)) {
    const raw = await readTextFile(pyprojPath)
    const nameMatch = raw.match(/^\s*name\s*=\s*"([^"]+)"/m)
    return { name: nameMatch?.[1], deps: [], lang: "Python" }
  }
  // Go
  if (await exists(`${workspace}/go.mod`)) {
    const raw = await readTextFile(`${workspace}/go.mod`)
    const modMatch = raw.match(/^module\s+(\S+)/m)
    return { name: modMatch?.[1], deps: [], lang: "Go" }
  }
  return null
}

export async function repoOverview(workspace: string): Promise<string> {
  if (!workspace) throw new Error("Çalışma klasörü bağlı değil")
  resolveInWorkspace(workspace, ".")

  const sections: Section[] = []

  // Stack
  const stack = await detectStack(workspace)
  if (stack) {
    const lines: string[] = [`**Dil/Stack:** ${stack.lang}`]
    if (stack.name) lines.push(`**Ad:** ${stack.name}`)
    if (stack.description) lines.push(`**Açıklama:** ${stack.description}`)
    if (stack.deps.length > 0) {
      lines.push(`**Bağımlılıklar (örnekleme):** ${stack.deps.join(", ")}`)
    }
    sections.push({ title: "Proje", body: lines.join("\n") })
  } else {
    sections.push({ title: "Proje", body: "(package.json/Cargo.toml/pyproject.toml/go.mod bulunamadı — generic klasör)" })
  }

  for (const fname of ["README.md", "README.mdx", "README.rst", "README.txt", "README"]) {
    const head = await readHead(`${workspace}/${fname}`, 40)
    if (head !== null) {
      sections.push({ title: `${fname}`, body: head })
      break
    }
  }

  // Git remote + son commitler
  const remoteRaw = await tryGit(workspace, ["remote", "-v"])
  const remote = remoteRaw ? remoteRaw.split("\n").slice(0, 2).join("\n") : null
  const log = await tryGit(workspace, ["log", "--oneline", "-n", "8"])
  const branch = await tryGit(workspace, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (remote || log || branch) {
    const gitLines: string[] = []
    if (branch) gitLines.push(`**Aktif branch:** ${branch}`)
    if (remote) gitLines.push("**Remote:**\n```\n" + remote + "\n```")
    if (log) gitLines.push("**Son commitler:**\n```\n" + log + "\n```")
    sections.push({ title: "Git", body: gitLines.join("\n\n") })
  }

  const treeOut = await tree(workspace, 2)
  if (treeOut) sections.push({ title: "Dosya ağacı (max 2 seviye)", body: "```\n" + treeOut + "\n```" })

  return sections.map((s) => `## ${s.title}\n${s.body}`).join("\n\n")
}
