// Tool registry — AI SDK tool() ile zod schema + execute bağla.
// streamText({ tools: buildTools(workspace) }) şeklinde kullanılır.
import { generateText, stepCountIs, tool, type ToolSet } from "ai"
import { z } from "zod"
import { listDir, readFile, writeFile, editFile } from "./fs"
import { runBash } from "./shell"
import { webfetch as webfetchImpl, websearch as websearchImpl } from "./web"
import { repoOverview as repoOverviewImpl } from "./repo-overview"
import { applyPatch as applyPatchImpl, formatApplyResult } from "./patch"
import { cloneRepo as cloneRepoImpl } from "./repo-clone"
import {
  createWorktree as createWorktreeImpl,
  listWorktrees as listWorktreesImpl,
  removeWorktree as removeWorktreeImpl,
} from "./worktree"
import { useApprovalsStore } from "@/store/approvals"
import { useQuestionsStore } from "@/store/questions"
import { loadSkillByName } from "../skills"
import {
  findAgent,
  checkSubagentPolicy,
  readWorkspaceAgents,
  readUserAgents,
  type SubagentPolicy,
} from "../agents"
import { buildModel, type ProviderId } from "../providers"
import { useSettingsStore } from "@/store/settings"
import { useSessionsStore } from "@/store/sessions"
import { buildMcpTools, listPluginMcps } from "../mcp"
import { listPluginHooks } from "../hooks"
import { listPluginAgents } from "../agents/plugin"
import { captureFiles, affectedPaths } from "../snapshots"
import { runHooks } from "../hooks"
import { loadIndex, queryIndex } from "../semantic-index"
import {
  loadCodeMap,
  searchSymbols,
  resolveByName,
  callers as cmCallers,
  callees as cmCallees,
  trace as cmTrace,
  impact as cmImpact,
  formatSymbol,
  findById,
} from "../token-savers"
import type { CodeMap, CodeSymbol } from "../token-savers"

// Tool execute'undan önce kullanıcı onayını iste — reddedilirse hata fırlat.
// Read-only toollar (list_dir, read_file, load_skill) için onay gerekmez.
// question tool da onaysız çalışır — kullanıcıyla doğrudan etkileşir, zaten user-in-the-loop.
// spawn_agent için tek onay sorulur; alt ajan kendi tool çağrılarında ayrıca sorar.
const READ_ONLY = new Set(["list_dir", "read_file", "load_skill", "question"])

// Plan modunda reddedilen toollar — yazma/çalıştırma yapan her şey.
// Salt-okunur (READ_ONLY) ve web/spawn_agent dışındaki mutasyon araçları burada.
const PLAN_BLOCKED = new Set(["write_file", "edit_file", "bash", "apply_patch"])

// repo_overview ve list_worktrees salt-okunur — onay gerekmez.
const READ_ONLY_EXTRA = new Set([
  "repo_overview",
  "list_worktrees",
  "code_query",
  "code_search",
  "code_callers",
  "code_callees",
  "code_trace",
  "code_impact",
])

// Subagent tool'larını policy ile sarmala — her execute öncesi policy check.
// approvalRequired tool'lar normalde READ_ONLY olsa bile onay sorar.
function wrapToolsWithPolicy(tools: ToolSet, policy: SubagentPolicy): ToolSet {
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    const original = t as { execute?: (args: unknown, ctx: unknown) => Promise<unknown> }
    if (!original.execute) {
      out[name] = t
      continue
    }
    out[name] = {
      ...t,
      execute: async (args: unknown, ctx: unknown) => {
        const check = checkSubagentPolicy(policy, name, args)
        if (!check.allowed) {
          throw new Error(check.reason ?? `Subagent '${name}' kullanamaz`)
        }
        if (check.requiresApproval) {
          const decision = await useApprovalsStore.getState().request(name, args)
          if (decision === "deny") {
            throw new Error(`Kullanıcı subagent '${name}' çağrısını reddetti`)
          }
        }
        return original.execute!(args, ctx)
      },
    } as ToolSet[string]
  }
  return out
}

async function gate(tool: string, input: unknown, workspace?: string): Promise<void> {
  // Plan modunda mutasyon araçlarını sessiz reddet — model hatayı görür, plan üretmeye döner.
  const mode = useSessionsStore.getState().active?.mode ?? "build"
  if (mode === "plan" && PLAN_BLOCKED.has(tool)) {
    throw new Error(
      `Plan modunda '${tool}' çağrılamaz — bu mod salt-okunur (read_file, list_dir, grep, webfetch, question). Build moduna geç (⌘M) veya alternatif yaklaşım öner.`,
    )
  }
  // PreToolUse hook'ları — blocking=true ise tool durur.
  // Settings + plugin hook'ları birleşik çalışır.
  const settingsHooks = useSettingsStore.getState().settings.hooks ?? []
  const hooks = [...settingsHooks, ...listPluginHooks()]
  if (hooks.length > 0) {
    const r = await runHooks({
      hooks,
      event: "PreToolUse",
      toolName: tool,
      payload: { tool, input },
      workspace,
    })
    if (r.blocked) {
      throw new Error(`Hook tarafından engellendi: ${r.blockReason ?? "(sebep yok)"}`)
    }
  }
  if (READ_ONLY.has(tool) || READ_ONLY_EXTRA.has(tool)) return
  const decision = await useApprovalsStore.getState().request(tool, input)
  if (decision === "deny") {
    throw new Error(`Kullanıcı '${tool}' çağrısını reddetti`)
  }
}

// Tool execute SONRASI — PostToolUse hook'ları (notify/format). Çıktıyı değiştirmez.
async function postHook(
  tool: string,
  input: unknown,
  output: string,
  workspace: string | undefined,
  isError = false,
): Promise<void> {
  const settingsHooks = useSettingsStore.getState().settings.hooks ?? []
  const hooks = [...settingsHooks, ...listPluginHooks()]
  if (hooks.length === 0) return
  try {
    await runHooks({
      hooks,
      event: "PostToolUse",
      toolName: tool,
      payload: { tool, input, output, isError },
      workspace,
    })
  } catch (e) {
    console.warn("[postHook] error:", e)
  }
}

// Mutasyon tool execute'undan ÖNCE çağrılır — etkilenen dosyaları snapshot'a al.
// Aktif session'ın son pending assistant mesajına iliştirilir.
async function captureSnapshotsForTool(
  toolName: string,
  input: unknown,
  workspace: string | undefined,
): Promise<void> {
  if (!workspace) return
  const paths = affectedPaths(toolName, input)
  if (paths.length === 0) return
  const session = useSessionsStore.getState().active
  if (!session) return
  const pendingMsg = [...session.messages].reverse().find((m) => m.role === "assistant" && m.pending)
  if (!pendingMsg) return
  try {
    await captureFiles(session.id, pendingMsg.id, workspace, paths)
    // Snapshot path listesini mesaja iliştir (cumulative — birden fazla tool çağrısı olabilir)
    useSessionsStore.getState().addSnapshotPaths(pendingMsg.id, paths)
  } catch (e) {
    console.warn("[snapshot] capture failed:", e)
  }
}

export type ToolName =
  | "list_dir"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "bash"
  | "question"
  | "webfetch"
  | "websearch"
  | "repo_overview"
  | "apply_patch"
  | "clone_repo"
  | "create_worktree"
  | "list_worktrees"
  | "remove_worktree"
  | "code_query"
  | "code_search"
  | "code_callers"
  | "code_callees"
  | "code_trace"
  | "code_impact"

// Her tool execute sonrası PostToolUse hook'unu çalıştıran wrapper.
// PreToolUse zaten gate() içinde manuel; bu sadece post tarafı.
// MCP tool'ları için de aynı wrap uygulanır.
function wrapWithPostHook(tools: ToolSet, workspace: string | undefined): ToolSet {
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    const orig = t as { execute?: (args: unknown, ctx: unknown) => Promise<unknown> }
    if (!orig.execute) {
      out[name] = t
      continue
    }
    out[name] = {
      ...t,
      execute: async (args: unknown, ctx: unknown) => {
        let output: unknown
        let err: unknown
        try {
          output = await orig.execute!(args, ctx)
          return output
        } catch (e) {
          err = e
          throw e
        } finally {
          const str =
            err != null
              ? err instanceof Error
                ? err.message
                : String(err)
              : typeof output === "string"
                ? output
                : JSON.stringify(output ?? "")
          void postHook(name, args, str, workspace, err != null)
        }
      },
    } as ToolSet[string]
  }
  return out
}

// MCP dahil tam tool set — App stream tarafında bu kullanılır.
export async function buildAllTools(
  workspace: string | undefined,
  mcpServers: Parameters<typeof buildMcpTools>[0] = [],
): Promise<ToolSet> {
  const local = buildTools(workspace)
  const merged: ToolSet = { ...local }
  // Settings'ten + plugin'lerden gelen MCP server'ları birleştir
  const allMcps = [...mcpServers, ...listPluginMcps()]
  if (allMcps.length > 0) {
    const { tools: mcp } = await buildMcpTools(allMcps)
    Object.assign(merged, mcp)
  }
  // dispatch_workers sadece orkestra modunda yayınlanır
  const mode = useSessionsStore.getState().active?.mode ?? "build"
  if (mode !== "orchestra" && merged.dispatch_workers) {
    delete merged.dispatch_workers
  }
  // spawn_agent sadece disk'te agent .md varsa yayınlanır — yoksa LLM hayali agent çağırır.
  // Workspace + global + plugin katalog toplamı 0 ise tool seti'nden silinir.
  if (merged.spawn_agent) {
    try {
      const [proj, user] = await Promise.all([
        readWorkspaceAgents(workspace),
        readUserAgents(),
      ])
      const pluginCount = listPluginAgents().length
      if (proj.length + user.length + pluginCount === 0) {
        delete merged.spawn_agent
      }
    } catch {
      // Okuma hatası → güvenli tarafta kal, tool'u sil
      delete merged.spawn_agent
    }
  }
  return wrapWithPostHook(merged, workspace)
}

// Web/clone tool'ları workspace gerektirmez — bash native binary çağırır.
// Bu tool'lar her zaman aktif; question da öyle.
function buildWebTools(): ToolSet {
  return {
    clone_repo: tool({
      description:
        "Git deposunu klonla ve aktif session'ı klonlanan klasöre bağla. " +
        "URL https://, git@ veya ssh:// olabilir. target verilmezse ~/Documents/<repo-adı>. " +
        "branch verilirse o branch'i checkout eder. depth=1 ile shallow clone (büyük repo'lar için hızlı). " +
        "Başarılıysa workspace otomatik bağlanır — sonraki tool çağrıları orada çalışır.",
      inputSchema: z.object({
        url: z.string().describe("Git URL — https/git@/ssh"),
        target: z
          .string()
          .optional()
          .describe("Hedef absolute path. Verilmezse ~/Documents/<repo-adı>."),
        branch: z.string().optional().describe("Klonlandıktan sonra checkout edilecek branch"),
        depth: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Shallow clone derinliği (örn 1 → sadece son commit). Verilmezse full history."),
      }),
      execute: async ({ url, target, branch, depth }) => {
        await gate("clone_repo", { url, target, branch })
        const r = await cloneRepoImpl({ url, target, branch, depth })
        // Aktif session'ı klonlanan klasöre bağla
        useSessionsStore.getState().updateActiveMeta({ workspacePath: r.path })
        const lines = [
          `Klonlandı: ${r.repoName}`,
          `Yol: ${r.path}`,
        ]
        if (r.branch) lines.push(`Aktif branch: ${r.branch}`)
        lines.push("Workspace otomatik bağlandı — sonraki tool'lar bu klasörde çalışır.")
        return lines.join("\n")
      },
    }),

    webfetch: tool({
      description:
        "Bir URL'i indir ve sadeleştirilmiş metne çevir (HTML → markdown). Dokümantasyon, blog, API referansı okumak için. 50KB ile sınırlı; uzun sayfa kesilir. Sadece http/https.",
      inputSchema: z.object({
        url: z.string().url().describe("İndirilecek URL — http:// veya https://"),
      }),
      execute: async ({ url }) => {
        await gate("webfetch", { url })
        return webfetchImpl(url)
      },
    }),

    websearch: tool({
      description:
        "Web'de arama yap ve özet sonuç listesi al. Tavily veya Brave API key gerekir (Ayarlar > Web Arama). Yapılandırma yoksa kullanılabilir değil.",
      inputSchema: z.object({
        query: z.string().describe("Arama sorgusu — net anahtar kelimeler"),
        max_results: z.number().int().min(1).max(10).optional().describe("Maksimum sonuç sayısı (1-10, default 5)"),
      }),
      execute: async ({ query, max_results }) => {
        await gate("websearch", { query })
        const cfg = useSettingsStore.getState().settings.webSearch
        return websearchImpl(query, cfg, max_results ?? 5)
      },
    }),

    // question workspace gerektirmez — sadece UI üzerinden kullanıcıya soru sorar.
    // Workspace bağlı olmasa bile bağlanmadan önce belirsizliği çözmek için kritik.
    question: tool({
      description:
        "Kullanıcıya açık uçlu bir soru sor ve cevabını bekle. Belirsizlik veya kritik karar gerektiren durumlarda kullan — yanlış varsayım yapmak yerine. choices verirsen liste olarak gösterilir; vermezsen serbest metin alınır.",
      inputSchema: z.object({
        prompt: z.string().describe("Kullanıcıya gösterilecek soru — Türkçe, net, tek soru"),
        choices: z
          .array(z.string())
          .optional()
          .describe("Opsiyonel seçenek listesi (2-6 madde). Verilirse buton listesi gösterilir."),
      }),
      execute: async ({ prompt, choices }) => {
        return useQuestionsStore.getState().ask(prompt, choices)
      },
    }),
  }
}

// Workspace bağlı değilse sadece workspace-bağımsız tool'lar dön (webfetch/websearch).
export function buildTools(workspace: string | undefined): ToolSet {
  if (!workspace) return buildWebTools()

  return {
    list_dir: tool({
      description:
        "Workspace içinde bir klasörün içeriğini listele. path workspace köküne göre relative.",
      inputSchema: z.object({
        path: z.string().describe("Workspace'e göre relative klasör. '.' = kök"),
      }),
      execute: async ({ path }) => listDir(workspace, path),
    }),

    read_file: tool({
      description:
        "Workspace içindeki metin dosyasının içeriğini oku (max ~200KB).",
      inputSchema: z.object({
        path: z.string().describe("Workspace'e göre relative dosya yolu"),
      }),
      execute: async ({ path }) => readFile(workspace, path),
    }),

    write_file: tool({
      description:
        "Dosya yaz veya tamamen üzerine yaz. Üst klasör yoksa oluşturulur.",
      inputSchema: z.object({
        path: z.string().describe("Workspace'e göre relative dosya yolu"),
        content: z.string().describe("Dosyanın tam içeriği"),
      }),
      execute: async ({ path, content }) => {
        await gate("write_file", { path, content })
        await captureSnapshotsForTool("write_file", { path }, workspace)
        return writeFile(workspace, path, content)
      },
    }),

    edit_file: tool({
      description:
        "Mevcut dosyada cerrahî edit. old_string TAM olarak bir kez geçmeli; new_string ile değiştirilir.",
      inputSchema: z.object({
        path: z.string().describe("Workspace'e göre relative dosya yolu"),
        old_string: z.string().describe("Değiştirilecek tam metin (eşsiz olmalı)"),
        new_string: z.string().describe("Yeni metin"),
      }),
      execute: async ({ path, old_string, new_string }) => {
        await gate("edit_file", { path, old_string, new_string })
        await captureSnapshotsForTool("edit_file", { path }, workspace)
        return editFile(workspace, path, old_string, new_string)
      },
    }),

    bash: tool({
      description:
        "Workspace klasöründe bash komutu çalıştır. 30s timeout, stdout+stderr+exit code döner.",
      inputSchema: z.object({
        command: z.string().describe("Tek satır bash komutu (cd workspace zaten yapıldı)"),
      }),
      execute: async ({ command }) => {
        await gate("bash", { command })
        const compactOutput = useSettingsStore.getState().settings.tokenSavers?.compactOutput
        return runBash(workspace, command, { compactOutput })
      },
    }),

    ...buildWebTools(),

    repo_overview: tool({
      description:
        "Workspace kökünün özet markdown raporunu üret: stack (package.json/Cargo.toml vb.), README ilk satırları, git remote/branch/son commitler, üst-seviye dosya ağacı. Yeni bir projeyi kavramak için ilk çağrılacak tool.",
      inputSchema: z.object({}),
      execute: async () => {
        await gate("repo_overview", {})
        return repoOverviewImpl(workspace)
      },
    }),

    create_worktree: tool({
      description:
        "Yeni git worktree oluştur — aynı repo'da paralel bir branch'te çalış. " +
        "baseRef verilirse yeni branch o ref'ten oluşturulur (-b). " +
        "Yoksa branch mevcut olmalı (checkout edilir). " +
        "target verilmezse repo kardeşinde '<repo>-wt-<branch>' adıyla oluşur.",
      inputSchema: z.object({
        branch: z.string().describe("Worktree'nin checkout edeceği branch adı"),
        baseRef: z
          .string()
          .optional()
          .describe("Yeni branch oluşturulacaksa baz alınacak ref (örn 'main', 'origin/dev')"),
        target: z.string().optional().describe("Worktree hedef path — absolute"),
      }),
      execute: async ({ branch, baseRef, target }) => {
        await gate("create_worktree", { branch, baseRef, target })
        const wt = await createWorktreeImpl({ repoPath: workspace, branch, baseRef, target })
        return [
          `Worktree oluşturuldu`,
          `Path: ${wt.path}`,
          `Branch: ${wt.branch ?? "(detached)"}`,
          `HEAD: ${wt.head}`,
          "",
          "Bu worktree'de çalışmak için ayrı bir session aç ve workspace'i bu klasöre bağla.",
        ].join("\n")
      },
    }),

    ...buildCodeMapTools(workspace),

    code_query: tool({
      description:
        "Workspace'in semantic index'inde doğal dil sorgusu çalıştır. " +
        "Embedding vektör benzerliği ile en alakalı kod parçacıklarını döndürür (path:line0-line1 + snippet). " +
        "İndex yoksa veya semantic kapalıysa hata döner — kullanıcının Ayarlar > Semantic'ten index üretmesi gerekir. " +
        "grep'in yapamayacağı kavramsal aramalar için kullan (örn 'token refresh akışı', 'kullanıcı oturum kapatma').",
      inputSchema: z.object({
        query: z.string().describe("Doğal dil sorgusu — net ve özlü"),
        top_k: z.number().int().min(1).max(20).optional().describe("Kaç sonuç döndürülsün (1-20, default 5)"),
      }),
      execute: async ({ query, top_k }) => {
        const cfg = useSettingsStore.getState().settings.semantic
        if (!cfg || !cfg.enabled) {
          return "Semantic index kapalı. Ayarlar > Semantic'ten etkinleştir."
        }
        const idx = await loadIndex(workspace)
        if (!idx) {
          return "Semantic index yok. Ayarlar > Semantic > 'İndex oluştur' butonu ile üret."
        }
        const results = await queryIndex({
          index: idx,
          cfg: {
            provider: cfg.provider,
            baseUrl: cfg.baseUrl,
            model: cfg.model,
            apiKey: cfg.apiKey,
          },
          query,
          topK: top_k ?? cfg.topK ?? 5,
        })
        if (results.length === 0) return "(eşleşme yok)"
        return results
          .map((r, i) => {
            const head = `## ${i + 1}. ${r.chunk.path}:${r.chunk.line0}-${r.chunk.line1}  (sim=${r.score.toFixed(3)})`
            const snippet =
              r.chunk.text.length > 1500 ? r.chunk.text.slice(0, 1500) + "\n… [kesildi]" : r.chunk.text
            return `${head}\n\`\`\`\n${snippet}\n\`\`\``
          })
          .join("\n\n")
      },
    }),

    list_worktrees: tool({
      description:
        "Mevcut repo'nun tüm git worktree'lerini listele (path, branch, head). Paralel session'larda hangi branch'lerin açık olduğunu görmek için.",
      inputSchema: z.object({}),
      execute: async () => {
        await gate("list_worktrees", {})
        const entries = await listWorktreesImpl(workspace)
        if (entries.length === 0) return "(worktree yok)"
        return entries
          .map((e) => {
            const label = e.branch ? `branch=${e.branch}` : e.detached ? "(detached)" : ""
            const lock = e.locked ? ` 🔒${e.locked}` : ""
            return `- ${e.path}  ${label}  head=${e.head.slice(0, 7)}${lock}`
          })
          .join("\n")
      },
    }),

    remove_worktree: tool({
      description:
        "Belirtilen worktree'yi sil (git worktree remove). force=true ile uncommitted değişikliklere rağmen siler. " +
        "Aktif worktree (şu an bağlı olduğun) silinemez.",
      inputSchema: z.object({
        target: z.string().describe("Silinecek worktree absolute path"),
        force: z.boolean().optional().describe("Uncommitted değişiklik olsa bile zorla sil"),
      }),
      execute: async ({ target, force }) => {
        await gate("remove_worktree", { target, force })
        await removeWorktreeImpl(workspace, target, force ?? false)
        return `Worktree silindi: ${target}`
      },
    }),

    apply_patch: tool({
      description:
        "Multi-hunk diff uygula — birden fazla dosyada birden fazla değişikliği tek atomik patch'te yap. " +
        "edit_file'ın güçlü versiyonu: context satırları konum bulur, line number gerekmez. " +
        "Format:\n" +
        "*** Begin Patch\n" +
        "*** Update File: <path>\n" +
        "@@\n" +
        " context line (boşlukla başlar)\n" +
        "-silinecek satır\n" +
        "+eklenecek satır\n" +
        " context line\n" +
        "*** End Patch\n\n" +
        "Çoklu @@ hunk ve çoklu *** Update File aynı patch içinde kullanılabilir. " +
        "*** Add File: <path> + her satır + ile başlar (yeni dosya). " +
        "*** Delete File: <path> (silme). " +
        "Context satırları benzersiz konum bulmak için yeterli olmalı.",
      inputSchema: z.object({
        patch: z
          .string()
          .describe("Tam patch metni — *** Begin Patch ile başlar, *** End Patch ile biter"),
      }),
      execute: async ({ patch }) => {
        await gate("apply_patch", { patch })
        await captureSnapshotsForTool("apply_patch", { patch }, workspace)
        const result = await applyPatchImpl(workspace, patch)
        return formatApplyResult(result)
      },
    }),

    load_skill: tool({
      description:
        "Adıyla bir skill'i yükle. Mevcut skill'ler system prompt'taki katalogda listelenir; bu tool tam içeriği döndürür.",
      inputSchema: z.object({
        name: z.string().describe("Yüklenecek skill adı"),
      }),
      execute: async ({ name }) => {
        const s = await loadSkillByName(workspace, name)
        if (!s) return `Skill bulunamadı: ${name}`
        return `# ${s.name} (${s.scope})\n${s.description}\n\n---\n\n${s.body}`
      },
    }),

    // dispatch_workers — sadece orkestra modu için. buildAllTools tarafından mod kontrolü
    // yapılır (mode !== "orchestra" ise tool set'ten silinir).
    dispatch_workers: tool({
      description:
        "ORKESTRA MODU — worker havuzundan bir veya birden fazla worker'a PARALEL görev dağıt. " +
        "Tüm worker'lar bitince sonuçlar JSON listesi olarak döner. Worker'lar bağımsız çalışır, " +
        "aralarında doğrudan iletişim yoktur — sentezi sen yapacaksın. Mevcut worker havuzu " +
        "system prompt katalogundadır.",
      inputSchema: z.object({
        dispatches: z
          .array(
            z.object({
              workerIdx: z
                .number()
                .int()
                .min(1)
                .max(5)
                .describe("Havuzdaki worker indeksi (1-5)"),
              task: z
                .string()
                .describe("Worker'a verilecek görev — net, self-contained, kısa"),
            }),
          )
          .min(1)
          .max(5),
      }),
      execute: async ({ dispatches }, ctx) => {
        const sess = useSessionsStore.getState().active
        if (!sess?.orchestra || sess.mode !== "orchestra") {
          throw new Error("Orkestra modu aktif değil — dispatch_workers çağrılamaz")
        }
        // Parent assistant mesajı (pending) — agent kartları buraya bağlanır
        const pendingMsg = [...sess.messages]
          .reverse()
          .find((m) => m.role === "assistant" && m.pending)
        if (!pendingMsg) throw new Error("Pending assistant mesajı bulunamadı")

        // Parent streamText'in abort sinyalini worker'lara propagate et (Composer "stop")
        const parentSignal = (ctx as { abortSignal?: AbortSignal } | undefined)?.abortSignal

        // dispatchWorkers runtime'ı dinamik import — döngüsel bağımlılık riskine karşı
        const { dispatchWorkers } = await import("../orchestra/runtime")
        const results = await dispatchWorkers(
          sess.orchestra,
          dispatches,
          pendingMsg.id,
          sess.workspacePath,
          parentSignal,
        )
        return JSON.stringify(results, null, 2)
      },
    }),

    spawn_agent: tool({
      description:
        "Karmaşık alt görevi izole context'te bir agent'a devret. Agent kendi tool döngüsünü çalıştırır ve sadece final özetini döner. Mevcut agent isimleri system prompt katalogundadır.",
      inputSchema: z.object({
        name: z.string().describe("Agent adı (katalogdan)"),
        task: z.string().describe("Agent'a verilecek görev tanımı — net ve self-contained"),
      }),
      execute: async ({ name, task }) => {
        await gate("spawn_agent", { name, task })
        const agent = await findAgent(workspace, name)
        if (!agent) return `Agent bulunamadı: ${name}`

        // Parent session'dan provider/model fallback
        const parent = useSessionsStore.getState().active
        const provider = (agent.provider ?? parent?.provider) as ProviderId | undefined
        const modelId = agent.model ?? parent?.model
        if (!provider || !modelId) return "Provider/model belirlenemedi"

        const settings = useSettingsStore.getState().settings
        let model
        try {
          model = buildModel(provider, modelId, settings.apiKeys)
        } catch (e) {
          return `Model kurulamadı: ${e instanceof Error ? e.message : String(e)}`
        }

        // Tool whitelist — alt ajanın izinli tool seti
        const fullSet = buildTools(workspace)
        const subTools: ToolSet = {}
        if (agent.tools && agent.tools.length > 0) {
          for (const t of agent.tools) {
            if (fullSet[t]) subTools[t] = fullSet[t]
          }
        } else {
          // Default: spawn_agent hariç tümü (sub-agent'ların kendi sub-agent çağırmasını engelle)
          for (const k of Object.keys(fullSet)) {
            if (k !== "spawn_agent") subTools[k] = fullSet[k]
          }
        }

        // Policy uygula — bash whitelist/deny, approval_required, plan_mode
        const policedTools = wrapToolsWithPolicy(subTools, agent.policy)

        try {
          const result = await generateText({
            model,
            system: agent.systemPrompt,
            messages: [{ role: "user", content: task }],
            tools: policedTools,
            stopWhen: stepCountIs(agent.maxSteps ?? 12),
          })
          const text = result.text?.trim() || "(agent boş cevap döndürdü)"
          return `# ${agent.name} özeti\n${text}`
        } catch (e) {
          return `Agent hatası: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),
  }
}

// Code Map tools — wrap a single loaded index per turn so each tool call
// doesn't reparse JSON from disk. Returns empty toolset when Code Map is
// disabled in settings (no tools surface to the model).
function buildCodeMapTools(workspace: string | undefined): ToolSet {
  const enabled = useSettingsStore.getState().settings.tokenSavers?.codeMap.enabled
  if (!enabled || !workspace) return {}

  async function loadOrError(): Promise<CodeMap | string> {
    const map = await loadCodeMap(workspace!)
    if (!map) {
      return "Code Map not built yet. Open Settings → Token Saving → Code Map and click 'Build index'."
    }
    return map
  }

  function symList(syms: CodeSymbol[]): string {
    if (syms.length === 0) return "(no matches)"
    return syms.map((s) => `- ${formatSymbol(s)}`).join("\n")
  }

  function pickSymbol(map: CodeMap, ref: string): CodeSymbol | string {
    // Accept either an explicit symbol id ("file::name::line") or a bare name.
    if (ref.includes("::")) {
      const s = findById(map, ref)
      return s ?? `No symbol with id '${ref}'`
    }
    const matches = resolveByName(map, ref)
    if (matches.length === 0) return `No symbol named '${ref}'`
    if (matches.length === 1) return matches[0]!
    // Ambiguous — list candidates so the model can re-call with a specific id.
    return `Ambiguous '${ref}' (${matches.length} matches). Pass a specific id:\n${symList(matches)}`
  }

  return {
    code_search: tool({
      description:
        "Search the Code Map for symbols by name. Returns matching functions, classes, methods, types " +
        "with file:line and a short signature. Use this before code_callers / code_callees to find the " +
        "exact symbol id when a name has multiple definitions.",
      inputSchema: z.object({
        query: z.string().describe("Symbol name or partial name (case-insensitive)"),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ query, limit }) => {
        const res = await loadOrError()
        if (typeof res === "string") return res
        return symList(searchSymbols(res, query, limit ?? 20))
      },
    }),

    code_callers: tool({
      description:
        "List functions/methods that call the given symbol. Pass the symbol name or its full id from code_search.",
      inputSchema: z.object({
        symbol: z.string().describe("Symbol name or id ('file::name::line')"),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: async ({ symbol, limit }) => {
        const res = await loadOrError()
        if (typeof res === "string") return res
        const picked = pickSymbol(res, symbol)
        if (typeof picked === "string") return picked
        return symList(cmCallers(res, picked.id, limit ?? 30))
      },
    }),

    code_callees: tool({
      description:
        "List the functions/methods that the given symbol calls. Pass the symbol name or its full id from code_search.",
      inputSchema: z.object({
        symbol: z.string().describe("Symbol name or id ('file::name::line')"),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: async ({ symbol, limit }) => {
        const res = await loadOrError()
        if (typeof res === "string") return res
        const picked = pickSymbol(res, symbol)
        if (typeof picked === "string") return picked
        return symList(cmCallees(res, picked.id, limit ?? 30))
      },
    }),

    code_trace: tool({
      description:
        "Find the shortest call-path from one symbol to another (BFS over the calls graph). Returns the chain in order, " +
        "or '(no path)' when unreachable. Use for 'how does X reach Y' questions.",
      inputSchema: z.object({
        from: z.string().describe("Source symbol name or id"),
        to: z.string().describe("Target symbol name or id"),
      }),
      execute: async ({ from, to }) => {
        const res = await loadOrError()
        if (typeof res === "string") return res
        const a = pickSymbol(res, from)
        if (typeof a === "string") return a
        const b = pickSymbol(res, to)
        if (typeof b === "string") return b
        const chain = cmTrace(res, a.id, b.id)
        if (chain.length === 0) return "(no path)"
        return chain.map((s, i) => `${i + 1}. ${formatSymbol(s)}`).join("\n")
      },
    }),

    code_impact: tool({
      description:
        "Transitive callers of a symbol up to N hops — the 'blast radius' of changing it. Useful before a rename or signature change.",
      inputSchema: z.object({
        symbol: z.string().describe("Symbol name or id"),
        depth: z.number().int().min(1).max(5).optional().describe("How many hops upward (default 2)"),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ symbol, depth, limit }) => {
        const res = await loadOrError()
        if (typeof res === "string") return res
        const picked = pickSymbol(res, symbol)
        if (typeof picked === "string") return picked
        return symList(cmImpact(res, picked.id, depth ?? 2, limit ?? 60))
      },
    }),
  }
}
