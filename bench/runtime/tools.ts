// Headless bench tool implementations — node fs/child_process based.
//
// These mirror the app's tool NAMES, schemas, and descriptions (descriptions
// are read from the shared src/lib/tools/prompts/*.txt files at call time, so
// an optimizer edit to those files changes bench behavior immediately). The
// implementations themselves are bench-local: the app's versions depend on
// Tauri IPC and cannot run under plain node.
import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { tool, type ToolSet } from "ai"
import { z } from "zod"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const PROMPTS_DIR = path.join(REPO_ROOT, "src/lib/tools/prompts")

// Read a shared tool description from the app's prompt files. Fresh read on
// every call so optimizer edits between iterations are picked up.
async function sharedDesc(name: string): Promise<string> {
  return fs.readFile(path.join(PROMPTS_DIR, `${name}.txt`), "utf8")
}

function resolveInWorkspace(workspace: string, rel: string): string {
  const abs = path.resolve(workspace, rel)
  const root = path.resolve(workspace)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`Path escapes the workspace: ${rel}`)
  }
  return abs
}

const MAX_LINE_CHARS = 2000

async function readFileNumbered(
  workspace: string,
  rel: string,
  offset?: number,
  limit?: number,
): Promise<string> {
  const abs = resolveInWorkspace(workspace, rel)
  const raw = await fs.readFile(abs, "utf8")
  const lines = raw.split("\n")
  const start = Math.max(1, offset ?? 1)
  const max = limit ?? 2000
  const slice = lines.slice(start - 1, start - 1 + max)
  const body = slice
    .map((l, i) => `${start + i}\t${l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS) + "…" : l}`)
    .join("\n")
  const next = start - 1 + max
  const footer =
    next < lines.length ? `\n(${lines.length - next} more lines — continue with offset=${next + 1})` : ""
  return body + footer
}

async function listDir(
  workspace: string,
  rel: string,
  recursive?: boolean,
  depth?: number,
): Promise<string> {
  const abs = resolveInWorkspace(workspace, rel || ".")
  const maxDepth = recursive ? (depth && depth > 0 ? depth : 3) : 1
  const lines: string[] = []
  let count = 0
  const MAX_ENTRIES = 300

  async function walk(dir: string, level: number, prefix: string): Promise<void> {
    if (level > maxDepth || count >= MAX_ENTRIES) return
    const entries = await fs.readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const e of entries) {
      if (count >= MAX_ENTRIES) return
      if (e.name === "node_modules" || e.name === ".git") continue
      count++
      if (e.isDirectory()) {
        lines.push(`${prefix}d ${e.name}`)
        await walk(path.join(dir, e.name), level + 1, prefix + "  ")
      } else {
        const size = (await fs.stat(path.join(dir, e.name))).size
        lines.push(`${prefix}- ${e.name} (${formatSize(size)})`)
      }
    }
  }
  await walk(abs, 1, "")
  if (count >= MAX_ENTRIES) lines.push("(truncated)")
  return lines.join("\n") || "(empty directory)"
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / 1048576).toFixed(1)}M`
}

// Minimal glob → RegExp supporting the common shapes used in this repo:
// "*", "**", "?", "{a,b}", and path separators.
function globToRegExp(glob: string): RegExp {
  let out = ""
  let i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*"
        i += 2
        if (glob[i] === "/") i++
        continue
      }
      out += "[^/]*"
      i++
      continue
    }
    if (c === "?") {
      out += "[^/]"
      i++
      continue
    }
    if (c === "{") {
      const end = glob.indexOf("}", i)
      if (end > i) {
        const alts = glob
          .slice(i + 1, end)
          .split(",")
          .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        out += `(?:${alts.join("|")})`
        i = end + 1
        continue
      }
    }
    out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    i++
  }
  return new RegExp(`^${out}$`)
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git") continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) await walk(abs)
      else out.push(abs)
    }
  }
  await walk(root)
  return out
}

function smartCase(query: string, caseSensitive?: boolean): boolean {
  if (caseSensitive !== undefined) return caseSensitive
  return /[A-Z]/.test(query)
}

async function grepWorkspace(
  workspace: string,
  query: string,
  opts: { glob?: string; regex?: boolean; caseSensitive?: boolean },
): Promise<string> {
  const matcher = opts.regex
    ? new RegExp(query, smartCase(query, opts.caseSensitive) ? "g" : "gi")
    : null
  const needle = smartCase(query, opts.caseSensitive) ? query : query.toLowerCase()
  const globRe = opts.glob ? globToRegExp(opts.glob) : null
  const hits: string[] = []
  const MAX_HITS = 100

  for (const abs of await walkFiles(workspace)) {
    if (hits.length >= MAX_HITS) break
    const rel = path.relative(workspace, abs).split(path.sep).join("/")
    if (globRe && !globRe.test(rel) && !globRe.test(path.basename(rel))) continue
    let text: string
    try {
      text = await fs.readFile(abs, "utf8")
    } catch {
      continue
    }
    const lines = text.split("\n")
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= MAX_HITS) break
      const line = lines[i]
      const matched = matcher
        ? (matcher.lastIndex = 0, matcher.test(line))
        : (smartCase(query, opts.caseSensitive) ? line : line.toLowerCase()).includes(needle)
      if (matched) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 300)}`)
    }
  }
  if (hits.length === 0) return "No matches found."
  return hits.join("\n") + (hits.length >= MAX_HITS ? `\n(Results capped at ${MAX_HITS})` : "")
}

async function globWorkspace(workspace: string, pattern: string): Promise<string> {
  const re = globToRegExp(pattern)
  const files = await walkFiles(workspace)
  const matched = files
    .map((abs) => path.relative(workspace, abs).split(path.sep).join("/"))
    .filter((rel) => re.test(rel))
    .sort()
  if (matched.length === 0) return "No files found"
  const LIMIT = 100
  const shown = matched.slice(0, LIMIT)
  return (
    shown.join("\n") +
    (matched.length > LIMIT ? `\n\n(Results truncated: showing first ${LIMIT}.)` : "")
  )
}

function runShell(
  workspace: string,
  command: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const isWin = process.platform === "win32"
  const [shell, args] = isWin ? ["cmd.exe", ["/c", command]] : ["bash", ["-c", command]]
  return new Promise((resolve) => {
    execFile(
      shell,
      args,
      { cwd: workspace, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : error ? 1 : 0
        resolve({ stdout, stderr, code })
      },
    )
  })
}

// Keep in sync with the app's edit_file semantics: exact replacement, must
// match exactly once unless replace_all, file must have been read first.
export function buildBenchTools(workspace: string): ToolSet {
  const readFiles = new Set<string>()

  return {
    list_dir: tool({
      description:
        "List a directory in the workspace. Directories first, then files " +
        "with size. Set recursive to walk subdirectories (depth-limited, " +
        "default 3). path is relative to the workspace root.",
      inputSchema: z.object({
        path: z.string().optional().describe("Workspace-relative directory. Empty means '.' = root"),
        recursive: z.boolean().optional().describe("Walk subdirectories as an indented tree"),
        depth: z.number().optional().describe("Max depth when recursive (default 3)"),
      }),
      execute: async ({ path: p, recursive, depth }) => listDir(workspace, p ?? ".", recursive, depth),
    }),

    read_file: tool({
      description: "placeholder",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the workspace root"),
        offset: z.number().optional().describe("1-based start line to read from"),
        limit: z.number().optional().describe("Max lines to read (default 2000)"),
      }),
      execute: async ({ path: p, offset, limit }) => {
        readFiles.add(path.resolve(workspace, p))
        return readFileNumbered(workspace, p, offset, limit)
      },
    }),

    grep: tool({
      description: "placeholder",
      inputSchema: z.object({
        query: z.string().describe("Text or regex to search for"),
        glob: z.string().optional().describe("Limit to files matching this glob, e.g. '*.ts'"),
        regex: z.boolean().optional().describe("Treat query as regex (default: fixed string)"),
        case_sensitive: z.boolean().optional().describe("Case-sensitive match (default: smart-case)"),
      }),
      execute: async ({ query, glob, regex, case_sensitive }) =>
        grepWorkspace(workspace, query, { glob, regex, caseSensitive: case_sensitive }),
    }),

    glob: tool({
      description: "placeholder",
      inputSchema: z.object({
        pattern: z.string().describe("Glob pattern, e.g. 'src/**/*.tsx' or '*.md'"),
      }),
      execute: async ({ pattern }) => globWorkspace(workspace, pattern),
    }),

    write_file: tool({
      description: "placeholder",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the workspace root"),
        content: z.string().describe("Full contents of the file"),
      }),
      execute: async ({ path: p, content }) => {
        const abs = resolveInWorkspace(workspace, p)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, content, "utf8")
        readFiles.add(abs)
        return `Wrote ${p} (${content.length} chars).`
      },
    }),

    edit_file: tool({
      description: "placeholder",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the workspace root"),
        old_string: z.string().describe("The exact text to replace"),
        new_string: z.string().describe("The replacement text (must differ from old_string)"),
        replace_all: z
          .boolean()
          .optional()
          .describe("Replace every occurrence — for renaming a variable/string. Default false."),
      }),
      execute: async ({ path: p, old_string, new_string, replace_all }) => {
        const abs = resolveInWorkspace(workspace, p)
        if (!readFiles.has(abs)) {
          return `Error: you must read the file with read_file at least once before editing it.`
        }
        if (old_string === new_string) return `Error: new_string must differ from old_string.`
        const content = await fs.readFile(abs, "utf8")
        const occurrences = content.split(old_string).length - 1
        if (occurrences === 0) return `Error: old_string not found in ${p}.`
        if (occurrences > 1 && !replace_all) {
          return `Error: old_string matches ${occurrences} times in ${p}. Provide more surrounding context or set replace_all:true.`
        }
        const next = replace_all
          ? content.split(old_string).join(new_string)
          : content.replace(old_string, new_string)
        await fs.writeFile(abs, next, "utf8")
        return `Edited ${p}: replaced ${replace_all ? occurrences : 1} occurrence(s).`
      },
    }),

    bash: tool({
      description: "placeholder",
      inputSchema: z.object({
        command: z.string().describe("Single-line bash command (cd to the workspace is already done)"),
        description: z
          .string()
          .describe("Short description of what the command does (5-10 words), shown as the UI title."),
        background: z
          .boolean()
          .optional()
          .describe("Start in the background (no timeout). Returns a jobId; track its output and status with bash_status."),
      }),
      execute: async ({ command, background }) => {
        const { stdout, stderr, code } = await runShell(workspace, command, 30_000)
        const note = background
          ? "(note: background mode is not supported in the bench harness; the command ran synchronously)\n"
          : ""
        const out = `${note}exit code: ${code}\n${stdout}${stderr ? `\nstderr:\n${stderr}` : ""}`
        return out.length > 30_000 ? out.slice(0, 30_000) + "\n(output truncated)" : out
      },
    }),
  }
}

// Replace the placeholder descriptions with the shared prompt files. Done
// lazily right before a run so optimizer edits between iterations apply.
export async function applySharedDescriptions(tools: ToolSet): Promise<void> {
  const map: Record<string, string> = {
    read_file: "read",
    grep: "grep",
    glob: "glob",
    write_file: "write",
    edit_file: "edit",
    bash: "bash",
  }
  for (const [toolName, file] of Object.entries(map)) {
    const t = tools[toolName] as { description?: string } | undefined
    if (t) t.description = await sharedDesc(file)
  }
}
