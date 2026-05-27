// Approval modal — kuyrukta bekleyen ilk request'i göster.
// "İzin ver", "Reddet", "Her zaman izin ver (bu tool)", "Her zaman izin ver (bu komut)".
import { useState } from "react"
import { AlertTriangle, Check, FileText, ShieldCheck, X } from "lucide-react"
import { useApprovalsStore } from "@/store/approvals"
import { useSettingsStore } from "@/store/settings"
import { hunksForEdit, type DiffLine } from "@/lib/diff"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic } from "@/lib/i18n"

export function ApprovalModal() {
  const t = useT()
  const queue = useApprovalsStore((s) => s.queue)
  const decide = useApprovalsStore((s) => s.decide)
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)
  const req = queue[0]
  const [tab, setTab] = useState<"detay" | "kural">("detay")

  if (!req) return null

  const subj = subjectOf(req.tool, req.input)
  const isDangerous = checkDanger(req.tool, req.input)

  async function decideAndMaybeRule(d: "allow" | "deny", rule?: "tool" | "subject") {
    if (rule && d === "allow") {
      const pattern = rule === "subject" ? subj : undefined
      const rules = [
        ...settings.approvalRules,
        { tool: req!.tool, pattern, decision: "allow" as const, scope: "persistent" as const },
      ]
      await updateSettings({ approvalRules: rules })
    }
    decide(req!.id, d)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[520px] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl">
        <header className="flex items-center gap-2 border-b border-codezal px-3 py-2.5">
          <ShieldCheck className="h-4 w-4 text-codezal-accent" />
          <span className="text-[13px] font-medium text-codezal-text">{t("approvalModal.needApproval")}</span>
          {isDangerous && (
            <span className="ml-2 flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10.5px] text-destructive">
              <AlertTriangle className="h-3 w-3" />
              {t("approvalModal.riskyLabel")}
            </span>
          )}
          <div className="flex-1" />
          {queue.length > 1 && (
            <span className="text-[11px] text-codezal-mute">{t("approvalModal.pendingMore", { count: queue.length - 1 })}</span>
          )}
        </header>

        <div className="px-3 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded bg-codezal-chip px-1.5 py-0.5 font-mono text-[11px] text-codezal-text">
              {req.tool}
            </span>
            <span className="text-[12px] text-codezal-mute">{t("approvalModal.wantsToRun")}</span>
          </div>

          <div className="mb-3 flex rounded-md border border-codezal text-[11px]">
            {(["detay", "kural"] as const).map((tt) => (
              <button
                key={tt}
                type="button"
                onClick={() => setTab(tt)}
                className={cn(
                  "flex-1 px-2 py-1 capitalize",
                  tab === tt ? "bg-codezal-chip text-codezal-text" : "text-codezal-dim",
                )}
              >
                {tt === "detay" ? t("approvalModal.tabDetail") : t("approvalModal.tabRule")}
              </button>
            ))}
          </div>

          {tab === "detay" ? (
            <DetailView tool={req.tool} input={req.input} />
          ) : (
            <div className="space-y-2 text-[12px] text-codezal-dim">
              <p>{t("approvalModal.rulesHintLine1", { tool: req.tool })}</p>
              <p>{t("approvalModal.rulesHintLine2")}</p>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-codezal px-3 py-2.5">
          <button
            type="button"
            onClick={() => decideAndMaybeRule("deny")}
            className="flex items-center gap-1 rounded-md border border-codezal px-2.5 py-1.5 text-[12px] text-codezal-dim hover:border-destructive/40 hover:text-destructive"
          >
            <X className="h-3 w-3" /> {t("approvalModal.deny")}
          </button>
          {subj && (
            <button
              type="button"
              onClick={() => void decideAndMaybeRule("allow", "subject")}
              className="rounded-md border border-codezal px-2.5 py-1.5 text-[12px] text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
              title={t("approvalModal.btnPatternTitle", { pattern: subj.slice(0, 40) })}
            >
              {t("approvalModal.btnPatternAllow")}
            </button>
          )}
          <button
            type="button"
            onClick={() => void decideAndMaybeRule("allow", "tool")}
            className="rounded-md border border-codezal px-2.5 py-1.5 text-[12px] text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
            title={t("approvalModal.btnAllToolTitle", { tool: req.tool })}
          >
            {t("approvalModal.btnAllToolAllow", { tool: req.tool })}
          </button>
          <button
            type="button"
            onClick={() => void decideAndMaybeRule("allow")}
            className="flex items-center gap-1 rounded-md bg-codezal-accent px-3 py-1.5 text-[12px] font-medium text-[#1a1106]"
          >
            <Check className="h-3 w-3" /> {t("approvalModal.allow")}
          </button>
        </footer>
      </div>
    </div>
  )
}

function subjectOf(tool: string, input: unknown): string {
  const i = (input as Record<string, unknown>) ?? {}
  if (tool === "bash") return String(i.command ?? "")
  if (typeof i.path === "string") return i.path
  return ""
}

// Tool'a özel zengin önizleme. edit_file için referans tarzı unified diff,
// write_file için yeni içerik bloğu, bash için terminal, diğerleri için JSON.
function DetailView({ tool, input }: { tool: string; input: unknown }) {
  const i = (input as Record<string, unknown>) ?? {}

  if (tool === "edit_file") {
    const path = String(i.path ?? "")
    const oldStr = String(i.old_string ?? "")
    const newStr = String(i.new_string ?? "")
    const hunks = hunksForEdit(oldStr, newStr)
    const added = hunks.filter((h) => h.kind === "add").length
    const removed = hunks.filter((h) => h.kind === "del").length
    return (
      <div className="max-h-[320px] overflow-auto rounded-md border border-codezal-strong bg-codezal-code">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-codezal bg-codezal-panel-2/80 px-3 py-1.5 text-[11px] backdrop-blur">
          <FileText className="h-3 w-3 text-codezal-mute" />
          <span className="font-mono text-codezal-text">{path}</span>
          {added > 0 && <span className="text-codezal-diff-add">{tStatic("approvalModal.addedLabel", { count: added })}</span>}
          {removed > 0 && <span className="text-codezal-diff-del">{tStatic("approvalModal.removedLabel", { count: removed })}</span>}
        </div>
        <UnifiedDiff lines={hunks} />
      </div>
    )
  }

  if (tool === "write_file") {
    const path = String(i.path ?? "")
    const content = String(i.content ?? "")
    const lines = content.split(/\r?\n/)
    const preview = lines.slice(0, 30).join("\n")
    const more = Math.max(0, lines.length - 30)
    return (
      <div className="max-h-[320px] overflow-auto rounded-md border border-codezal-strong bg-codezal-code">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-codezal bg-codezal-panel-2/80 px-3 py-1.5 text-[11px] backdrop-blur">
          <FileText className="h-3 w-3 text-codezal-mute" />
          <span className="font-mono text-codezal-text">{path}</span>
          <span className="text-codezal-mute">{tStatic("approvalModal.newFileLabel", { count: content.length })}</span>
        </div>
        <pre className="m-0 whitespace-pre-wrap px-3 py-2 font-mono text-[12px] leading-[1.6] text-codezal-text">
          {preview}
          {more > 0 && `\n${tStatic("approvalModal.moreLines", { count: more })}`}
        </pre>
      </div>
    )
  }

  if (tool === "bash") {
    const cmd = String(i.command ?? "")
    return (
      <div className="overflow-hidden rounded-md border border-codezal-strong bg-codezal-code">
        <div className="border-b border-codezal bg-codezal-panel-2/80 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.08em] text-codezal-mute">
          {tStatic("approvalModal.commandLabel")}
        </div>
        <pre className="m-0 max-h-[260px] overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[12px] leading-[1.65] text-codezal-text">
          <span className="text-codezal-mute">$ </span>
          {cmd}
        </pre>
      </div>
    )
  }

  return (
    <pre className="m-0 max-h-[260px] overflow-auto whitespace-pre-wrap rounded-md border border-codezal-strong bg-codezal-code px-3 py-2 font-mono text-[12px] leading-[1.6] text-codezal-text">
      {JSON.stringify(input, null, 2)}
    </pre>
  )
}

// Unified diff render — referanstaki GitHub stili.
// Sol gutter: satır numarası veya +/-, sağ tarafta satır içeriği.
function UnifiedDiff({ lines }: { lines: DiffLine[] }) {
  if (lines.length === 0) {
    return (
      <div className="px-3 py-3 text-[12px] text-codezal-mute">{tStatic("approvalModal.diffEmpty")}</div>
    )
  }
  return (
    <div className="font-mono text-[12px] leading-[1.65]">
      {lines.map((l, idx) => {
        const isAdd = l.kind === "add"
        const isDel = l.kind === "del"
        const isCtx = l.kind === "ctx"
        return (
          <div
            key={idx}
            className={cn(
              "grid grid-cols-[28px_1fr] items-start",
              isAdd && "bg-codezal-diff-add",
              isDel && "bg-codezal-diff-del",
            )}
          >
            <span
              className={cn(
                "select-none border-r border-codezal/40 px-2 text-center",
                isAdd && "text-codezal-diff-add",
                isDel && "text-codezal-diff-del",
                isCtx && "text-codezal-mute",
              )}
            >
              {isAdd ? "+" : isDel ? "-" : " "}
            </span>
            <span
              className={cn(
                "whitespace-pre-wrap break-all px-3",
                isAdd && "text-codezal-diff-add",
                isDel && "text-codezal-diff-del",
                isCtx && "text-codezal-text",
              )}
            >
              {l.text || " "}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// Bash komutu çoğunlukla yıkıcı mı? Basit heuristic.
function checkDanger(tool: string, input: unknown): boolean {
  if (tool !== "bash") return false
  const cmd = String((input as { command?: string }).command ?? "")
  return /\b(rm\s+-rf|sudo\b|mkfs|dd\s+if=|chmod\s+777|:(){:|:&};:|curl\s+.*\|\s*sh)\b/.test(cmd)
}
