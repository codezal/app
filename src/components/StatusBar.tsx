import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import { modelDetail, resolveContextCap, type ProvidersCatalog } from "@/lib/providers-catalog"
import { resolveLocalLlm } from "@/lib/local-llm"
import { useLocalRuntimeStore } from "@/store/local-runtime"
import { cn } from "@/lib/utils"
import { formatCount } from "@/lib/format"
import { useT } from "@/lib/i18n/useT"
import { pickWorkspaceFolder } from "@/lib/workspace"
import { BranchPicker } from "./BranchPicker"
import { ApprovalModeMenu, WorkspacePicker } from "./Composer"

type Props = {
  sessionId?: string
}

export function StatusBar({ sessionId }: Props) {
  const t = useT()
  const hasSession = useSessionsStore((s) =>
    sessionId ? s.sessions[sessionId] != null : s.active != null,
  )
  const workspacePath = useSessionsStore((s) =>
    sessionId ? s.sessions[sessionId]?.workspacePath : s.active?.workspacePath,
  )
  const messageCount = useSessionsStore((s) =>
    (sessionId ? s.sessions[sessionId]?.messages.length : s.active?.messages.length) ?? 0,
  )
  const usage = useSessionsStore((s) =>
    sessionId ? s.sessions[sessionId]?.usage : s.active?.usage,
  )
  const model = useSessionsStore(
    (s) => (sessionId ? s.sessions[sessionId]?.model : s.active?.model) ?? "",
  )
  const provider = useSessionsStore((s) =>
    sessionId ? s.sessions[sessionId]?.provider : s.active?.provider,
  )
  const updateActiveMeta = useSessionsStore((s) => s.updateActiveMeta)
  const updateMetaFor = useSessionsStore((s) => s.updateMetaFor)
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)
  const catalog = settings.providerCatalog?.data as ProvidersCatalog | undefined
  const localEff = useLocalRuntimeStore((s) => (model ? s.effectiveCtx[model] : undefined))

  if (!hasSession) return null

  const applyMeta = (patch: Parameters<typeof updateActiveMeta>[0]) =>
    sessionId ? updateMetaFor(sessionId, patch) : updateActiveMeta(patch)

  const workspace = workspacePath ?? (messageCount === 0 ? settings.defaultWorkspacePath : undefined)
  const settingWin = resolveLocalLlm(
    { localLlm: settings.localLlm, localLlmByModel: settings.localLlmByModel },
    model,
  ).contextWindow
  const localCtxWindow = localEff && localEff > 0 ? Math.min(localEff, settingWin) : settingWin
  const cap = resolveContextCap(catalog, provider, model, localCtxWindow, settings.customProviders)
  const deprecated = provider ? modelDetail(catalog, provider, model)?.deprecated === true : false
  const used = usage?.effectiveContextTokens ?? usage?.lastInputTokens ?? 0
  const pct = Math.min(100, Math.round((used / cap) * 100))

  async function pickNewWorkspace() {
    const path = await pickWorkspaceFolder()
    if (!path) return
    applyMeta({ workspacePath: path, workspaceReadOnly: false })
    await updateSettings({ defaultWorkspacePath: path })
  }

  return (
    <footer className="cz-meta group relative z-30 flex h-9 min-w-0 shrink-0 items-center gap-2 border-t border-codezal-panel bg-codezal-bg px-2 text-sm text-codezal-dim">
      <div className="flex min-w-0 items-center gap-1">
        {messageCount === 0 && (
          <WorkspacePicker
            current={workspace}
            onPick={(path) => {
              applyMeta({ workspacePath: path, workspaceReadOnly: false })
              void updateSettings({ defaultWorkspacePath: path })
            }}
            onPickNew={pickNewWorkspace}
            onClear={() => {
              applyMeta({ workspacePath: undefined })
              void updateSettings({ defaultWorkspacePath: undefined })
            }}
          />
        )}

        {workspace && <BranchPicker workspace={workspace} />}

        <span className="mx-0.5 h-4 w-px bg-codezal-hair" aria-hidden />
        <ApprovalModeMenu
          mode={settings.approvalMode}
          onChange={(mode) => void updateSettings({ approvalMode: mode })}
        />
      </div>

      <div className="flex-1" />

      <span
        className="flex items-center gap-1.5 tabular-nums"
        title={t("statusBar.ctxTitle", { used: formatCount(used), cap: formatCount(cap) })}
      >
        <span className="cz-meta-label hidden text-codezal-mute min-[980px]:inline">
          {t("statusBar.contextUsage")}
        </span>
        <span
          className={cn(
            pct > 80 ? "text-destructive" : pct > 50 ? "text-codezal-accent" : "text-codezal-dim",
          )}
        >
          {used > 0 ? "≈" : ""}{formatCount(used)} / {formatCount(cap)}
        </span>
        <span className="inline-block h-1 w-10 overflow-hidden rounded-full bg-codezal-hair" aria-hidden>
          <span
            className={cn(
              "block h-full rounded-full transition-[width] duration-300",
              pct > 90 ? "bg-destructive" : pct > 60 ? "bg-codezal-accent" : "bg-codezal-dim",
            )}
            style={{ width: `${pct}%` }}
          />
        </span>
      </span>

      {usage && (
        <span className="hidden border-l border-codezal-hair pl-2 tabular-nums text-codezal-mute min-[1100px]:inline">
          ${usage.costUsd.toFixed(4)}
        </span>
      )}

      {deprecated && (
        <span
          className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive"
          title={t("statusBar.deprecatedTitle")}
          role="status"
          aria-label={t("statusBar.deprecatedLabel")}
        >
          <span aria-hidden>⚠</span>
        </span>
      )}
    </footer>
  )
}
