import {
  readFile as readBinaryFile,
  mkdir,
  stat,
} from "@tauri-apps/plugin-fs"
import { invoke } from "@tauri-apps/api/core"
import {
  isScopeError,
  readTextFileSafe as readTextSafe,
  readFileSafe as readBinarySafe,
  writeTextFileSafe as writeTextSafe,
  readDirSafe,
  existsSafe,
} from "../fs-safe"
import { resolveInWorkspace } from "./paths"
import { sliceCharsSafe } from "@/lib/text"
import { isBinary, isImage, isPdf, mimeForImage, toBase64 } from "../file-type"
import { extractPdfText } from "../pdf"
import { isBinaryDoc, extractBinaryDoc } from "@/lib/documents"
import { replace } from "./replace"
import { joinFsPath } from "@/lib/fs-path"

async function readBase64Safe(abs: string): Promise<string> {
  try {
    return toBase64(await readBinaryFile(abs))
  } catch (e) {
    if (!isScopeError(e)) throw e
    return await invoke<string>("fs_read_file_base64", { path: abs })
  }
}

async function statSizeSafe(abs: string): Promise<number> {
  try {
    return (await stat(abs)).size
  } catch (e) {
    if (!isScopeError(e)) throw e
    return await invoke<number>("fs_stat_size", { path: abs })
  }
}

async function statIsDirSafe(abs: string): Promise<boolean> {
  try {
    return (await stat(abs))?.isDirectory === true
  } catch {
    return false
  }
}

const MAX_ENTRIES = 300

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(1)}M`
  return `${(bytes / 1073741824).toFixed(1)}G`
}

export async function listDir(
  workspace: string,
  rel: string,
  recursive?: boolean,
  depth?: number,
): Promise<string> {
  const abs = resolveInWorkspace(workspace, rel || ".")
  return listDirAbs(abs, recursive, depth)
}

export async function listDirAbs(
  abs: string,
  recursive?: boolean,
  depth?: number,
): Promise<string> {
  const maxDepth = recursive ? (depth && depth > 0 ? depth : 3) : 1
  const lines: string[] = []
  let count = 0
  let truncated = false

  async function walk(dir: string, level: number): Promise<void> {
    if (level > maxDepth || truncated) return
    let entries
    try {
      entries = await readDirSafe(dir)
    } catch {
      // Unreadable subdir: report it instead of skipping silently, so the model
      // knows the directory exists but its contents could not be listed.
      if (level > 1) {
        const name = dir.split(/[\\/]/).pop() ?? dir
        lines.push(`${"  ".repeat(level - 2)}d ${name} (unreadable — skipped)`)
        count++
      }
      return
    }
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    const indent = "  ".repeat(level - 1)
    for (const e of entries) {
      if (count >= MAX_ENTRIES) {
        truncated = true
        return
      }
      const child = joinFsPath(dir, e.name)
      if (e.isDirectory) {
        lines.push(`${indent}d ${e.name}`)
        count++
        if (recursive) await walk(child, level + 1)
      } else {
        let size = ""
        try {
          size = ` (${formatSize(await statSizeSafe(child))})`
        } catch {
          // Intentionally ignored.
        }
        lines.push(`${indent}- ${e.name}${size}`)
        count++
      }
    }
  }

  try {
    await readDirSafe(abs)
  } catch {
    return (await existsSafe(abs))
      ? `Error: ${abs} is not a directory — use read_file for file contents.`
      : `Error: path not found: ${abs}`
  }

  await walk(abs, 1)
  if (lines.length === 0) return "(empty folder)"
  if (truncated) lines.push(`... (truncated, ${MAX_ENTRIES}+ entries)`)
  return lines.join("\n")
}

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LEN = 2000
const MAX_READ_CHARS = 200_000

export async function readFileAbs(
  abs: string,
  offset?: number,
  limit?: number,
  maxChars?: number,
): Promise<string> {
  const filename = abs.split(/[\\/]/).pop() ?? abs
  const cap = maxChars && maxChars > 0 ? Math.min(maxChars, MAX_READ_CHARS) : MAX_READ_CHARS

  // Image → base64 data URL
  if (isImage(filename)) {
    const mime = mimeForImage(filename)
    return `data:${mime};base64,${await readBase64Safe(abs)}`
  }

  if (isPdf(filename)) {
    const bytes = await readBinarySafe(abs)
    const text = await extractPdfText(bytes, 50)
    return text || `(could not extract PDF text — may be scanned: ${filename})`
  }

  if (isBinaryDoc(filename)) {
    const bytes = await readBinarySafe(abs)
    return extractBinaryDoc(bytes, filename)
  }

  if (isBinary(filename)) {
    return `(binary file — cannot read contents of ${filename})`
  }

  if (await statIsDirSafe(abs)) {
    return `Error: ${abs} is a directory — use list_dir to list its contents.`
  }

  const content = await readTextSafe(abs)
  const allLines = content.split("\n")
  const total = allLines.length
  const start = offset && offset > 0 ? offset - 1 : 0

  if (start > 0 && start >= total) {
    return `Error: offset ${offset} is out of range — the file has ${total} lines.`
  }

  const lim = limit && limit > 0 ? limit : DEFAULT_READ_LIMIT
  const hardEnd = Math.min(start + lim, total)

  const out: string[] = []
  let chars = 0
  let cut = false
  for (let i = start; i < hardEnd; i++) {
    let line = allLines[i]
    if (line.length > MAX_LINE_LEN) {
      line = sliceCharsSafe(line, MAX_LINE_LEN) + ` … (line truncated to ${MAX_LINE_LEN} characters)`
    }
    if (chars + line.length > cap && out.length > 0) {
      cut = true
      break
    }
    out.push(line)
    chars += line.length + 1
  }

  const last = start + out.length
  const numbered = numberLines(out.join("\n"), start + 1)

  let footer: string
  if (cut) {
    footer = `(hit the ${Math.round(cap / 1000)}K character limit. Showing lines ${start + 1}-${last}. Continue with offset=${last + 1}.)`
  } else if (hardEnd < total) {
    footer = `(Lines ${start + 1}-${last} / ${total} total. Continue with offset=${last + 1}.)`
  } else {
    footer = `(End of file — ${total} lines total.)`
  }
  return `${numbered}\n\n${footer}`
}

export async function readFile(
  workspace: string,
  rel: string,
  offset?: number,
  limit?: number,
): Promise<string> {
  const abs = resolveInWorkspace(workspace, rel)
  return readFileAbs(abs, offset, limit)
}

function numberLines(text: string, start: number): string {
  const lines = text.split("\n")
  const width = String(start + lines.length - 1).length
  return lines
    .map((l, i) => `${String(start + i).padStart(width, " ")}\t${l}`)
    .join("\n")
}

export async function writeFileAbs(
  abs: string,
  content: string,
  label?: string,
  onOld?: (oldContent: string) => void,
): Promise<string> {
  const existed = await existsSafe(abs)
  if (existed && onOld) {
    try {
      onOld(await readTextSafe(abs))
    } catch {
      // Intentionally ignored.
    }
  }
  try {
    const lastSep = Math.max(abs.lastIndexOf("/"), abs.lastIndexOf("\\"))
    if (lastSep > 0) {
      const parent = abs.slice(0, lastSep)
      if (!(await existsSafe(parent))) {
        await mkdir(parent, { recursive: true })
      }
    }
  } catch {
    // Intentionally ignored.
  }
  await writeTextSafe(abs, content)
  return `File ${existed ? "updated" : "created"}: ${label ?? abs} (${content.length} char)`
}

export async function writeFile(
  workspace: string,
  rel: string,
  content: string,
): Promise<string> {
  const abs = resolveInWorkspace(workspace, rel)
  return writeFileAbs(abs, content, rel)
}

export async function editFileAbs(
  abs: string,
  oldString: string,
  newString: string,
  replaceAll = false,
  label?: string,
): Promise<string> {
  const content = await readTextSafe(abs)
  const ending: "\n" | "\r\n" = content.includes("\r\n") ? "\r\n" : "\n"
  const toEnding = (s: string) => s.replace(/\r\n/g, "\n").replace(/\n/g, ending)
  const next = replace(content, toEnding(oldString), toEnding(newString), replaceAll)
  await writeTextSafe(abs, next)
  return `Edited: ${label ?? abs}`
}

export async function editFile(
  workspace: string,
  rel: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): Promise<string> {
  const abs = resolveInWorkspace(workspace, rel)
  return editFileAbs(abs, oldString, newString, replaceAll, rel)
}
