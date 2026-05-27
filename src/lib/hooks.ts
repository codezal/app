// Lifecycle hook runner — bash komutları event'lerde tetiklenir.
//
// Event sözleşmesi:
//   PreToolUse        — payload: { tool, input } → exit≠0 + blocking=true ise tool durur, stderr hata olur.
//                       stdout JSON içerebilir: { "decision": "block"|"allow", "reason"?: string }
//   PostToolUse       — payload: { tool, input, output, isError } → çıktı ignore (notify/format için).
//   UserPromptSubmit  — payload: { prompt } → stdout ile prompt'a ek bağlam injekte edilebilir (geri dönüş).
//   Stop              — payload: { reason } → tur bitiminde, ignore output.
//
// Komuta payload stdin'den JSON olarak verilir. workspace cwd. Tauri shell plugin.
import { Command } from "@tauri-apps/plugin-shell"
import type { HookConfig, HookEvent } from "@/store/types"

const DEFAULT_TIMEOUT = 10_000

export type HookResult = {
  ranCount: number
  blocked: boolean
  blockReason?: string
  // UserPromptSubmit için: stdout'tan toplanmış ek bağlam (varsa)
  extraContext?: string
}

type PreToolPayload = { tool: string; input: unknown }
type PostToolPayload = { tool: string; input: unknown; output: string; isError?: boolean }
type PromptPayload = { prompt: string }
type StopPayload = { reason: string }

export type HookPayload = PreToolPayload | PostToolPayload | PromptPayload | StopPayload

// Tool adıyla matcher karşılaştır. "*" veya boş → tümü. Aksi tam eşleşme.
function matches(hook: HookConfig, toolName?: string): boolean {
  if (hook.enabled === false) return false
  if (!hook.matcher || hook.matcher === "*") return true
  if (!toolName) return true
  return hook.matcher === toolName
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

// Tek bir hook'u çalıştır. Stdout/stderr/exit code döndür. Timeout'ta exit -1.
async function execHook(
  hook: HookConfig,
  payload: HookPayload,
  workspace: string | undefined,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const json = JSON.stringify(payload)
  // payload'ı $CODEZAL_HOOK_PAYLOAD env'inde + stdin'de ver.
  // stdin için: echo '...' | komut.  workspace yoksa $HOME'da çalış.
  const cwd = workspace ? `cd ${shellQuote(workspace)} && ` : ""
  const wrapped = `${cwd}echo ${shellQuote(json)} | { export CODEZAL_HOOK_EVENT=${shellQuote(hook.event)}; export CODEZAL_HOOK_PAYLOAD=${shellQuote(json)}; ${hook.command}; }`
  const timeout = hook.timeoutMs ?? DEFAULT_TIMEOUT
  const cmd = Command.create("bash", ["-lc", wrapped])
  let timer: number | undefined
  try {
    const out = await Promise.race([
      cmd.execute(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Hook timeout (${timeout}ms)`)),
          timeout,
        ) as unknown as number
      }),
    ])
    if (timer) clearTimeout(timer)
    return { stdout: out.stdout, stderr: out.stderr, code: out.code }
  } catch (e) {
    if (timer) clearTimeout(timer)
    const msg = e instanceof Error ? e.message : String(e)
    return { stdout: "", stderr: msg, code: -1 }
  }
}

// Stdout'tan { decision, reason } JSON parse et — yoksa null.
function parseDecision(stdout: string): { decision?: "block" | "allow"; reason?: string } | null {
  const t = stdout.trim()
  if (!t.startsWith("{")) return null
  try {
    const obj = JSON.parse(t) as { decision?: "block" | "allow"; reason?: string }
    if (obj && (obj.decision === "block" || obj.decision === "allow")) return obj
    return null
  } catch {
    return null
  }
}

// Bir event için kayıtlı tüm hook'ları sırayla çalıştır.
// PreToolUse + blocking=true + exit≠0 (veya decision=block) → erken çık, blocked döndür.
export async function runHooks(args: {
  hooks: HookConfig[] | undefined
  event: HookEvent
  toolName?: string
  payload: HookPayload
  workspace: string | undefined
}): Promise<HookResult> {
  const list = (args.hooks ?? []).filter((h) => h.event === args.event && matches(h, args.toolName))
  if (list.length === 0) return { ranCount: 0, blocked: false }

  let extraContext = ""
  for (const h of list) {
    const r = await execHook(h, args.payload, args.workspace)
    // Blocking PreToolUse: exit≠0 ya da decision=block → durdur.
    if (args.event === "PreToolUse" && h.blocking) {
      const decision = parseDecision(r.stdout)
      if (decision?.decision === "block" || (r.code !== 0 && decision?.decision !== "allow")) {
        const reason =
          decision?.reason ??
          (r.stderr.trim() || `Hook '${h.id}' exit ${r.code}`)
        console.warn(`[hook] BLOCK ${h.event} matcher=${h.matcher ?? "*"} reason=${reason}`)
        return { ranCount: list.indexOf(h) + 1, blocked: true, blockReason: reason }
      }
    } else if (args.event === "UserPromptSubmit" && r.code === 0 && r.stdout.trim()) {
      // Prompt'a inject edilecek ek bağlam — birden fazla hook varsa birleştir.
      extraContext += (extraContext ? "\n\n" : "") + r.stdout.trim()
    }
    if (r.code !== 0) {
      console.warn(`[hook] ${h.event} ${h.matcher ?? "*"} exit ${r.code}: ${r.stderr.trim()}`)
    }
  }
  return { ranCount: list.length, blocked: false, extraContext: extraContext || undefined }
}
