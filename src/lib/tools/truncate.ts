// Config-driven output truncation with AppData archival.
// Full output saved to AppData/tool-output/ when limits exceeded.
// LLM gets a preview + path hint; file retained for 7 days.
import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs"
import { useSettingsStore } from "@/store/settings"
import { estimateTextTokens } from "@/lib/tokens"

export const DEFAULT_MAX_LINES = 2000
export const DEFAULT_MAX_BYTES = 50 * 1024
// Token-based ceiling (~10k tokens) so a single tool result can't blow past the
// model's working memory even when the byte/line limits would allow more (e.g.
// dense, low-byte-per-token output). Kept as a hard default; callers can raise
// it per-call via TruncateOptions.maxTokens.
export const DEFAULT_MAX_TOKENS = 10_000
const TOOL_OUTPUT_DIR = "tool-output"
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export type TruncateOptions = {
  maxLines?: number
  maxBytes?: number
  maxTokens?: number
  direction?: "head" | "tail" | "middle"
}

export type TruncateResult =
  | { content: string; truncated: false }
  | { content: string; truncated: true; outputPath: string }

// Monotonic filename — timestamp + counter to avoid collisions within same ms.
let _seq = 0
function makeFilename(): string {
  return `tool_${Date.now()}_${String(++_seq).padStart(4, "0")}.txt`
}

async function ensureOutputDir(): Promise<void> {
  const has = await exists(TOOL_OUTPUT_DIR, { baseDir: BaseDirectory.AppData })
  if (!has) await mkdir(TOOL_OUTPUT_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
}

async function archiveOutput(text: string): Promise<string> {
  await ensureOutputDir()
  const filename = `${TOOL_OUTPUT_DIR}/${makeFilename()}`
  await writeTextFile(filename, text, { baseDir: BaseDirectory.AppData })
  return filename
}

function getLimits(opts: TruncateOptions): { maxLines: number; maxBytes: number; maxTokens: number } {
  const cfg = useSettingsStore.getState().settings.toolOutput
  return {
    maxLines: opts.maxLines ?? cfg?.maxLines ?? DEFAULT_MAX_LINES,
    maxBytes: opts.maxBytes ?? cfg?.maxBytes ?? DEFAULT_MAX_BYTES,
    maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
  }
}

/**
 * Truncates large tool output and archives the full text to AppData.
 * Returns the full text unchanged when within limits.
 * On truncation: returns preview + "archived at <path>" hint for the LLM.
 * direction="head" (default) shows the top; "tail" shows the bottom.
 *
 * Three independent ceilings are enforced — lines, bytes and tokens — and the
 * first one to trip wins. The token ceiling keeps dense output from overflowing
 * the model's context even when it stays under the byte/line limits.
 */
export async function truncateOutput(text: string, opts: TruncateOptions = {}): Promise<TruncateResult> {
  const { maxLines, maxBytes, maxTokens } = getLimits(opts)
  const direction = opts.direction ?? "head"
  const enc = new TextEncoder()
  const lines = text.split("\n")
  const totalBytes = enc.encode(text).length
  const totalTokens = estimateTextTokens(text)

  if (lines.length <= maxLines && totalBytes <= maxBytes && totalTokens <= maxTokens) {
    return { content: text, truncated: false }
  }

  if (direction === "middle") {
    const headBudgetBytes = Math.floor(maxBytes * 0.6)
    const headBudgetLines = Math.floor(maxLines * 0.6)
    const headBudgetTokens = Math.floor(maxTokens * 0.6)
    const head: string[] = []
    let hb = 0
    let ht = 0
    for (let i = 0; i < lines.length && head.length < headBudgetLines; i++) {
      const size = enc.encode(lines[i]).length + (i > 0 ? 1 : 0)
      const tok = estimateTextTokens(lines[i])
      if (hb + size > headBudgetBytes || ht + tok > headBudgetTokens) break
      head.push(lines[i])
      hb += size
      ht += tok
    }
    const tail: string[] = []
    let tb = 0
    let tt = 0
    const tailBudgetBytes = maxBytes - hb
    const tailBudgetTokens = maxTokens - ht
    for (let i = lines.length - 1; i >= head.length && tail.length < maxLines - head.length; i--) {
      const size = enc.encode(lines[i]).length + 1
      const tok = estimateTextTokens(lines[i])
      if ((tb + size > tailBudgetBytes || tt + tok > tailBudgetTokens) && tail.length > 0) break
      tail.unshift(lines[i])
      tb += size
      tt += tok
    }
    const removed = lines.length - head.length - tail.length
    const outputPath = await archiveOutput(text)
    const hint =
      `Tool output truncated — ${removed} lines dropped (middle section). Full output saved to:\n${outputPath}\n` +
      `Use bash with grep/head/tail to inspect, or read_file with offset/limit.`
    const content = `${head.join("\n")}\n\n...${removed} lines truncated (middle dropped — head + tail preserved)...\n${hint}\n\n${tail.join("\n")}`
    return { content, truncated: true, outputPath }
  }

  const out: string[] = []
  let bytes = 0
  let tokens = 0
  let hitBytes = false
  let hitTokens = false

  if (direction === "head") {
    for (let i = 0; i < lines.length && i < maxLines; i++) {
      const size = enc.encode(lines[i]).length + (i > 0 ? 1 : 0)
      const tok = estimateTextTokens(lines[i])
      if (bytes + size > maxBytes) { hitBytes = true; break }
      if (tokens + tok > maxTokens) { hitTokens = true; break }
      out.push(lines[i])
      bytes += size
      tokens += tok
    }
  } else {
    for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
      const size = enc.encode(lines[i]).length + (out.length > 0 ? 1 : 0)
      const tok = estimateTextTokens(lines[i])
      if (bytes + size > maxBytes) { hitBytes = true; break }
      if (tokens + tok > maxTokens) { hitTokens = true; break }
      out.unshift(lines[i])
      bytes += size
      tokens += tok
    }
  }

  const removed = hitBytes
    ? totalBytes - bytes
    : hitTokens
      ? totalTokens - tokens
      : lines.length - out.length
  const unit = hitBytes ? "bytes" : hitTokens ? "tokens" : "lines"
  const preview = out.join("\n")
  const outputPath = await archiveOutput(text)

  const hint =
    `Tool output truncated — ${removed} ${unit} dropped. Full output saved to:\n${outputPath}\n` +
    `Use bash with grep/head/tail to inspect, or read_file with offset/limit.`

  const content =
    direction === "head"
      ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
      : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`

  return { content, truncated: true, outputPath }
}

/**
 * Startup cleanup — removes tool-output files older than 7 days.
 * Call once at app init; fails silently (non-critical).
 */
export async function cleanupOldOutputs(): Promise<void> {
  try {
    const has = await exists(TOOL_OUTPUT_DIR, { baseDir: BaseDirectory.AppData })
    if (!has) return
    const entries = await readDir(TOOL_OUTPUT_DIR, { baseDir: BaseDirectory.AppData })
    const cutoff = Date.now() - RETENTION_MS
    for (const e of entries) {
      if (!e.isFile || !e.name.startsWith("tool_")) continue
      // filename: tool_<timestamp>_<seq>.txt — extract timestamp from name
      const ts = parseInt(e.name.split("_")[1] ?? "0", 10)
      if (ts < cutoff) {
        await remove(`${TOOL_OUTPUT_DIR}/${e.name}`, { baseDir: BaseDirectory.AppData }).catch(() => {})
      }
    }
  } catch {
    // Startup cleanup is best-effort — never crash on failure
  }
}
