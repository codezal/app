// Autopilot — scheduled automations (internally called "routines"). Full-page
// view that occupies the main column while the sidebar remains visible.
// Scheduling is human-friendly; cron stays under the advanced option. "Run"
// creates a new session and sends the routine prompt.
import { useEffect, useState, type ComponentType, type ReactNode } from "react"
import {
  Play,
  X,
  Zap,
  Plus,
  ArrowLeft,
  Save,
  Trash2,
  Plug,
  GitBranch,
  ShieldCheck,
  Wrench,
  FileText,
  Sun,
  Globe,
  Pencil,
} from "@/lib/icons"
import type { SessionMeta } from "@/store/types"
import {
  readWorkspaceRoutines,
  readUserRoutines,
  writeRoutine,
  deleteRoutine,
  type Routine,
  type RoutineScope,
} from "@/lib/routines"
import {
  nextFireAt,
  parseCron,
  validateCron,
  cronToFriendly,
  cronFromFriendly,
  type FriendlySchedule,
} from "@/lib/cron"
import { refreshScheduler } from "@/lib/routine-scheduler"
import { AUTOPILOT_TEMPLATES, type AutopilotTemplate } from "@/lib/autopilot-templates"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"
import { basename } from "@/lib/workspace"
import {
  PROVIDERS,
  modelsFor,
  defaultModelFor,
  reasoningEfforts,
  type ProviderId,
  type ReasoningEffort,
} from "@/lib/providers"
import { modelDetail, type ProvidersCatalog } from "@/lib/providers-catalog"

type Props = {
  onClose: () => void
  onRun: (prompt: string, opts?: { provider?: string; model?: string }) => void
}

type FreqKind = FriendlySchedule["kind"]
const FREQS: FreqKind[] = ["daily", "weekdays", "weekly", "hourly", "everyN", "manual", "advanced"]

const TPL_ICON: Record<string, ComponentType<{ className?: string }>> = {
  "pr-digest": GitBranch,
  "dep-check": ShieldCheck,
  "flaky-tests": Wrench,
  "release-notes": FileText,
  "daily-briefing": Sun,
  "us-iran-ceasefire": Globe,
}

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-sm font-semibold uppercase tracking-[0.08em] text-codezal-mute">
        {children}
      </span>
    </div>
  )
}

function ToggleRow({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-codezal-text">{label}</div>
        {hint && <div className="mt-0.5 text-sm text-codezal-mute">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={`flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors duration-200 ${
          on ? "bg-codezal-accent" : "bg-codezal-chip"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-codezal-bg shadow-sm transition-transform duration-200 ${
            on ? "translate-x-4" : ""
          }`}
        />
      </button>
    </div>
  )
}

const inputCls =
  "rounded-md border border-codezal bg-codezal-input px-3 py-2 text-sm text-codezal-text outline-none transition-colors focus:border-codezal-accent focus:ring-2 focus:ring-codezal-accent/20"

export function AutopilotPage({ onClose, onRun }: Props) {
  const t = useT()
  const active = useSessionsStore((s) => s.active)
  const projects = useSessionsStore((s) => s.projects)
  const projectMeta = useSessionsStore((s) => s.projectMeta)
  const settings = useSettingsStore((s) => s.settings)
  const workspace = active?.workspacePath
  const locale = settings.language || "en"

  const [routines, setRoutines] = useState<Routine[] | null>(null)
  const [view, setView] = useState<"list" | "create" | "edit" | "detail">("list")
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [runs, setRuns] = useState<SessionMeta[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [name, setName] = useState("")
  const [objective, setObjective] = useState("")
  const [freq, setFreq] = useState<FreqKind>("daily")
  const [timeStr, setTimeStr] = useState("09:00")
  const [dow, setDow] = useState(1)
  const [everyN, setEveryN] = useState(1)
  const [advCron, setAdvCron] = useState("")
  const [scope, setScope] = useState<RoutineScope>("global")
  const [selectedProject, setSelectedProject] = useState<string | undefined>(undefined)
  const [selProvider, setSelProvider] = useState<ProviderId | "">("")
  const [selModel, setSelModel] = useState<string>("")
  const [selEffort, setSelEffort] = useState<ReasoningEffort | "">("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoutines(null)
    Promise.all([readWorkspaceRoutines(workspace), readUserRoutines()])
      .then(([p, u]) => alive && setRoutines([...p, ...u]))
      .catch(() => alive && setRoutines([]))
    return () => {
      alive = false
    }
  }, [workspace])

  useEffect(() => {
    if (view !== "detail" || !selectedPath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRuns([])
      return
    }
    let alive = true
    setRunsLoading(true)
    void useSessionsStore
      .getState()
      .listRoutineRuns(selectedPath)
      .then((rs) => {
        if (alive) setRuns(rs)
      })
      .finally(() => {
        if (alive) setRunsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [view, selectedPath])

  const ap = settings.autopilot ?? {}
  const connections = (settings.mcpServers ?? [])
    .filter((s) => s.enabled !== false)
    .map((s) => s.name)
    .filter(Boolean)

  const updateAp = (patch: { runInBackground?: boolean; autostart?: boolean; keepAwake?: boolean }) =>
    void useSettingsStore.getState().update({ autopilot: { ...ap, ...patch } })

  const dayName = (d: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "long" }).format(new Date(2024, 0, 7 + d))

  // friendly → insan metni (kart + kuyruk rozeti). advanced → ham cron (power-user).
  const describe = (f: FriendlySchedule): string => {
    switch (f.kind) {
      case "manual":
        return t("routinesOverlay.schedManual")
      case "hourly":
        return t("routinesOverlay.schedHourly")
      case "everyN":
        return t("routinesOverlay.schedEveryN", { n: String(f.n) })
      case "daily":
        return t("routinesOverlay.schedDaily", { time: hhmm(f.h, f.m) })
      case "weekdays":
        return t("routinesOverlay.schedWeekdays", { time: hhmm(f.h, f.m) })
      case "weekly":
        return t("routinesOverlay.schedWeekly", { day: dayName(f.dow), time: hhmm(f.h, f.m) })
      case "advanced":
        return f.cron
    }
  }

  const freqLabel = (k: FreqKind): string => {
    switch (k) {
      case "daily":
        return t("routinesOverlay.freqDaily")
      case "weekdays":
        return t("routinesOverlay.freqWeekdays")
      case "weekly":
        return t("routinesOverlay.freqWeekly")
      case "hourly":
        return t("routinesOverlay.freqHourly")
      case "everyN":
        return t("routinesOverlay.freqEveryN")
      case "manual":
        return t("routinesOverlay.freqManual")
      default:
        return t("routinesOverlay.freqAdvanced")
    }
  }

  const resetForm = () => {
    setName("")
    setObjective("")
    setFreq("daily")
    setTimeStr("09:00")
    setDow(1)
    setEveryN(1)
    setAdvCron("")
    setScope(workspace ? "project" : "global")
    setSelProvider("")
    setSelModel("")
    setSelEffort("")
    setSelectedProject(workspace)
    setEditingPath(null)
    setError(null)
  }

  const startCreate = () => {
    resetForm()
    setView("create")
  }

  const startEdit = (r: Routine) => {
    resetForm()
    setName(r.name)
    setObjective(r.prompt)
    const f = cronToFriendly(r.schedule)
    setFreq(f.kind)
    if (f.kind === "daily" || f.kind === "weekdays") setTimeStr(hhmm(f.h, f.m))
    if (f.kind === "weekly") {
      setDow(f.dow)
      setTimeStr(hhmm(f.h, f.m))
    }
    if (f.kind === "everyN") setEveryN(f.n)
    if (f.kind === "advanced") setAdvCron(f.cron)
    setScope(r.scope)
    if (r.scope === "project") {
      const wsPath = r.path.replace(/\/\.codezal\/routines\/[^/]+$/, "")
      setSelectedProject(wsPath)
    }
    setSelProvider(r.provider ?? "")
    setSelModel(r.model ?? "")
    setSelEffort(r.reasoningEffort ?? "")
    setEditingPath(r.path)
    setView("edit")
  }

  const startDetail = (r: Routine) => {
    setSelectedPath(r.path)
    setView("detail")
  }

  const applyTemplate = (tpl: AutopilotTemplate) => {
    resetForm()
    setName(tpl.name)
    setObjective(tpl.prompt)
    const f = cronToFriendly(tpl.schedule)
    setFreq(f.kind)
    if (f.kind === "daily" || f.kind === "weekdays") setTimeStr(hhmm(f.h, f.m))
    if (f.kind === "weekly") {
      setDow(f.dow)
      setTimeStr(hhmm(f.h, f.m))
    }
    if (f.kind === "everyN") setEveryN(f.n)
    if (f.kind === "advanced") setAdvCron(f.cron)
    setView("create")
  }

  const buildCron = (): string => {
    const [h, m] = timeStr.split(":").map((n) => parseInt(n, 10) || 0)
    let f: FriendlySchedule
    switch (freq) {
      case "hourly":
        f = { kind: "hourly" }
        break
      case "everyN":
        f = { kind: "everyN", n: everyN }
        break
      case "daily":
        f = { kind: "daily", h, m }
        break
      case "weekdays":
        f = { kind: "weekdays", h, m }
        break
      case "weekly":
        f = { kind: "weekly", dow, h, m }
        break
      case "advanced":
        f = { kind: "advanced", cron: advCron.trim() }
        break
      default:
        f = { kind: "manual" }
    }
    return cronFromFriendly(f)
  }

  const reload = async () => {
    const [p, u] = await Promise.all([readWorkspaceRoutines(workspace), readUserRoutines()])
    setRoutines([...p, ...u])
  }

  const onSave = async () => {
    setError(null)
    if (!name.trim() || !objective.trim()) {
      setError(t("common.required"))
      return
    }
    const cron = buildCron()
    if (cron) {
      const err = validateCron(cron)
      if (err) {
        setError(err)
        return
      }
    }
    const targetWs = scope === "project" ? selectedProject : workspace
    const useScope: RoutineScope = scope === "project" && !targetWs ? "global" : scope
    const existing = editingPath ? routines?.find((r) => r.path === editingPath) : undefined
    setSaving(true)
    try {
      const newPath = await writeRoutine(
        useScope,
        {
          name: name.trim(),
          prompt: objective.trim(),
          schedule: cron || undefined,
          provider: selProvider || undefined,
          model: selModel || undefined,
          reasoningEffort: selEffort || undefined,
          disabled: existing?.disabled,
        },
        targetWs,
      )
      if (editingPath && editingPath !== newPath) {
        try {
          await deleteRoutine(editingPath)
        } catch (e) {
          console.warn(`[routines] eski rutin silinemedi '${editingPath}':`, e)
        }
      }
      await refreshScheduler(workspace)
      await reload()
      setEditingPath(null)
      if (editingPath) {
        setSelectedPath(newPath)
        setView("detail")
      } else {
        setView("list")
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleDisabled = async (r: Routine) => {
    try {
      await writeRoutine(
        r.scope,
        {
          name: r.name,
          description: r.description,
          prompt: r.prompt,
          schedule: r.schedule,
          once: r.once,
          fireAt: r.fireAt,
          provider: r.provider,
          model: r.model,
          reasoningEffort: r.reasoningEffort,
          disabled: !r.disabled,
        },
        r.scope === "project"
          ? r.path.replace(/\/\.codezal\/routines\/[^/]+$/, "")
          : undefined,
      )
      await refreshScheduler(workspace)
      await reload()
    } catch (e) {
      setError(String(e))
    }
  }

  const onDelete = async (path: string) => {
    try {
      await deleteRoutine(path)
      await refreshScheduler(workspace)
      await reload()
      if (selectedPath === path) {
        setSelectedPath(null)
        setView("list")
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setPendingDelete(null)
    }
  }

  const selectedRoutine = selectedPath ? routines?.find((r) => r.path === selectedPath) ?? null : null

  const showTime = freq === "daily" || freq === "weekdays" || freq === "weekly"

  const catalog = settings.providerCatalog?.data as ProvidersCatalog | undefined
  const providerIds = Object.keys(PROVIDERS) as ProviderId[]
  const effProvider = (selProvider || settings.defaultProvider) as ProviderId
  const modelList = modelsFor(effProvider, catalog, settings.modelStatus)
  const effModel = selModel || defaultModelFor(effProvider, catalog) || settings.defaultModel || ""
  const effortCapable =
    modelDetail(catalog, effProvider, effModel)?.reasoning === true
  const efforts = reasoningEfforts(effProvider, effModel, effortCapable)

  const primaryBtn =
    "flex items-center gap-1.5 rounded-md bg-codezal-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground transition hover:brightness-95 active:scale-[0.98] dark:text-white"

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-codezal-bg">
      <div className="flex items-center gap-2.5 border-b border-codezal-hair bg-codezal-bg px-5 py-3">
        {view !== "list" ? (
          <button
            type="button"
            onClick={() => {
              if (view === "edit") {
                setEditingPath(null)
                if (selectedPath) setView("detail")
                else setView("list")
              } else {
                setView("list")
                if (view === "detail") setSelectedPath(null)
              }
            }}
            aria-label={t("common.cancel")}
            className="rounded-md p-1 text-codezal-mute transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-codezal-accent-dim text-codezal-accent">
            <Zap className="h-4 w-4" aria-hidden />
          </span>
        )}
        <span className="text-base font-semibold tracking-tight text-codezal-text">
          {view === "create"
            ? t("routinesOverlay.createTitle")
            : view === "edit"
              ? t("routinesOverlay.editTitle")
              : view === "detail"
                ? selectedRoutine?.name ?? t("routinesOverlay.title")
                : t("routinesOverlay.title")}
        </span>
        <div className="flex-1" />
        {view === "list" && (
          <button type="button" onClick={startCreate} className={primaryBtn}>
            <Plus className="h-4 w-4" /> {t("routinesOverlay.createTitle")}
          </button>
        )}
        {view === "detail" && selectedRoutine && (
          <>
            <button
              type="button"
              onClick={() => {
                onRun(selectedRoutine.prompt, {
                  provider: selectedRoutine.provider ?? settings.defaultProvider,
                  model: selectedRoutine.model ?? settings.defaultModel,
                })
                onClose()
              }}
              className={primaryBtn}
            >
              <Play className="h-4 w-4" /> {t("routinesOverlay.runNow")}
            </button>
            <button
              type="button"
              onClick={() => startEdit(selectedRoutine)}
              className="flex items-center gap-1.5 rounded-md border border-codezal px-3 py-1.5 text-sm text-codezal-text transition-colors hover:bg-codezal-panel-2"
            >
              <Pencil className="h-4 w-4" /> {t("common.edit")}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="rounded-md p-1 text-codezal-mute transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-5xl px-5 py-5">
          {view === "create" || view === "edit" ? (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <section className="rounded-lg border border-codezal-hair bg-codezal-panel p-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-codezal-mute">
                      {t("routinesOverlay.routineName")}
                    </span>
                    <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className={inputCls} />
                  </label>
                  <label className="mt-4 flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-codezal-mute">
                      {t("routinesOverlay.objective")}
                    </span>
                    <textarea
                      value={objective}
                      onChange={(e) => setObjective(e.target.value)}
                      rows={14}
                      placeholder={t("routinesOverlay.objectivePlaceholder")}
                      className={`${inputCls} resize-y leading-relaxed`}
                    />
                  </label>
                </section>

                <aside className="rounded-lg border border-codezal-hair bg-codezal-panel p-4">
                  <SectionLabel>{t("routinesOverlay.schedulePresetLabel")}</SectionLabel>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-codezal-mute">
                      {t("routinesOverlay.frequencyLabel")}
                    </span>
                    <select value={freq} onChange={(e) => setFreq(e.target.value as FreqKind)} className={inputCls}>
                      {FREQS.map((k) => (
                        <option key={k} value={k}>
                          {freqLabel(k)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {showTime && (
                    <label className="mt-3 flex flex-col gap-1.5">
                      <span className="text-sm font-semibold text-codezal-mute">{t("routinesOverlay.timeLabel")}</span>
                      <input
                        type="time"
                        value={timeStr}
                        onChange={(e) => setTimeStr(e.target.value)}
                        className={inputCls}
                      />
                    </label>
                  )}
                  {freq === "weekly" && (
                    <label className="mt-3 flex flex-col gap-1.5">
                      <span className="text-sm font-semibold text-codezal-mute">{t("routinesOverlay.dayLabel")}</span>
                      <select
                        value={dow}
                        onChange={(e) => setDow(parseInt(e.target.value, 10))}
                        className={`${inputCls} capitalize`}
                      >
                        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                          <option key={d} value={d}>
                            {dayName(d)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {freq === "everyN" && (
                    <label className="mt-3 flex flex-col gap-1.5">
                      <span className="text-sm font-semibold text-codezal-mute">
                        {t("routinesOverlay.everyNLabel")}
                      </span>
                      <input
                        type="number"
                        min={1}
                        value={everyN}
                        onChange={(e) => setEveryN(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className={inputCls}
                      />
                    </label>
                  )}
                  <label className="mt-3 flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-codezal-mute">
                      {t("routinesOverlay.scopeProject")} / {t("routinesOverlay.scopeGlobal")}
                    </span>
                    <select
                      value={scope}
                      onChange={(e) => {
                        const v = e.target.value as RoutineScope
                        setScope(v)
                        if (v === "project" && !selectedProject && projects.length > 0) {
                          setSelectedProject(projects[0])
                        }
                      }}
                      className={inputCls}
                    >
                      <option value="global">{t("routinesOverlay.scopeGlobal")}</option>
                      <option value="project" disabled={projects.length === 0}>
                        {t("routinesOverlay.scopeProject")}
                      </option>
                    </select>
                    {scope === "project" && projects.length > 0 && (
                      <select
                        value={selectedProject ?? ""}
                        onChange={(e) => setSelectedProject(e.target.value || undefined)}
                        className={`${inputCls} mt-2`}
                      >
                        {projects.map((p) => (
                          <option key={p} value={p}>
                            {projectMeta[p]?.name || basename(p)}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                  <label className="mt-3 flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-codezal-mute">
                      {t("routinesOverlay.providerLabel")}
                    </span>
                    <select
                      value={selProvider}
                      onChange={(e) => {
                        setSelProvider(e.target.value as ProviderId | "")
                        setSelModel("")
                        setSelEffort("")
                      }}
                      className={inputCls}
                    >
                      <option value="">{t("routinesOverlay.defaultOption")}</option>
                      {providerIds.map((p) => (
                        <option key={p} value={p}>
                          {PROVIDERS[p].label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mt-3 flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-codezal-mute">
                      {t("routinesOverlay.modelLabel")}
                    </span>
                    <select
                      value={selModel}
                      onChange={(e) => {
                        setSelModel(e.target.value)
                        setSelEffort("")
                      }}
                      className={inputCls}
                    >
                      <option value="">{t("routinesOverlay.defaultOption")}</option>
                      {modelList.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                  {efforts.length > 0 && (
                    <label className="mt-3 flex flex-col gap-1.5">
                      <span className="text-sm font-semibold text-codezal-mute">
                        {t("routinesOverlay.reasoningLabel")}
                      </span>
                      <select
                        value={selEffort}
                        onChange={(e) => setSelEffort(e.target.value as ReasoningEffort | "")}
                        className={inputCls}
                      >
                        <option value="">{t("routinesOverlay.defaultOption")}</option>
                        {efforts.map((ef) => (
                          <option key={ef} value={ef}>
                            {ef}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {freq === "advanced" && (
                    <label className="mt-3 flex flex-col gap-1.5">
                      <span className="text-sm font-semibold text-codezal-mute">
                        {t("routinesOverlay.customCron")}
                      </span>
                      <input
                        value={advCron}
                        onChange={(e) => setAdvCron(e.target.value)}
                        placeholder="*/15 * * * *"
                        className={`${inputCls} font-mono`}
                      />
                      <span className="text-sm text-codezal-mute">{t("routinesOverlay.cronHint")}</span>
                    </label>
                  )}
                </aside>
              </div>

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setView("list")}
                  className="rounded-md border border-codezal px-3 py-1.5 text-sm text-codezal-text transition-colors hover:bg-codezal-panel-2"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void onSave()}
                  disabled={saving}
                  className={`${primaryBtn} disabled:opacity-60`}
                >
                  <Save className="h-4 w-4" /> {t("common.save")}
                </button>
              </div>
            </div>
          ) : view === "detail" && selectedRoutine ? (
            <div className="flex flex-col gap-4">
              <section className="rounded-lg border border-codezal-hair bg-codezal-panel p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-dim">
                    {selectedRoutine.scope === "project"
                      ? t("routinesOverlay.scopeProject")
                      : t("routinesOverlay.scopeGlobal")}
                  </span>
                  {selectedRoutine.schedule && (
                    <span className="rounded-md bg-codezal-accent-dim px-1.5 py-0.5 text-sm font-medium text-codezal-accent">
                      {describe(cronToFriendly(selectedRoutine.schedule))}
                    </span>
                  )}
                  {selectedRoutine.disabled && (
                    <span className="rounded-md bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-mute">
                      {t("routinesOverlay.pausedBadge")}
                    </span>
                  )}
                  {(selectedRoutine.provider || selectedRoutine.model) && (
                    <span className="rounded-md bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-dim">
                      {selectedRoutine.provider ?? "—"}/{selectedRoutine.model ?? "—"}
                      {selectedRoutine.reasoningEffort ? ` · ${selectedRoutine.reasoningEffort}` : ""}
                    </span>
                  )}
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => void toggleDisabled(selectedRoutine)}
                    className="rounded-md border border-codezal px-2 py-1 text-sm text-codezal-text transition-colors hover:bg-codezal-panel-2"
                  >
                    {selectedRoutine.disabled
                      ? t("routinesOverlay.resume")
                      : t("routinesOverlay.pause")}
                  </button>
                  {pendingDelete === selectedRoutine.path ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void onDelete(selectedRoutine.path)}
                        className="rounded-md bg-destructive/90 px-2 py-1 text-sm font-medium text-white transition hover:bg-destructive"
                      >
                        {t("common.delete")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(null)}
                        className="rounded-md border border-codezal px-2 py-1 text-sm text-codezal-text transition-colors hover:bg-codezal-panel-2"
                      >
                        {t("common.cancel")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingDelete(selectedRoutine.path)}
                      aria-label={t("common.delete")}
                      className="rounded-md p-1.5 text-codezal-mute transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
                {selectedRoutine.description && (
                  <div className="mt-2 text-sm text-codezal-dim">{selectedRoutine.description}</div>
                )}
                <pre className="mt-3 max-h-[300px] overflow-auto whitespace-pre-wrap rounded-md bg-codezal-input p-3 text-sm text-codezal-text">
                  {selectedRoutine.prompt}
                </pre>
              </section>

              <section className="rounded-lg border border-codezal-hair bg-codezal-panel p-4">
                <SectionLabel>
                  {t("routinesOverlay.runsTitle")} ({runs.length})
                </SectionLabel>
                {runsLoading ? (
                  <div className="text-sm text-codezal-mute">…</div>
                ) : runs.length === 0 ? (
                  <div className="text-sm text-codezal-mute">{t("routinesOverlay.noRuns")}</div>
                ) : (
                  <ul className="divide-y divide-codezal-hair">
                    {runs.map((rn) => (
                      <li key={rn.id}>
                        <button
                          type="button"
                          onClick={() => {
                            void useSessionsStore.getState().open(rn.id)
                            onClose()
                          }}
                          className="flex w-full items-center justify-between gap-3 px-1 py-2 text-left transition-colors hover:bg-codezal-panel-2"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm text-codezal-text">
                            {rn.title}
                          </span>
                          <span className="shrink-0 text-sm text-codezal-mute">
                            {new Date(rn.updatedAt).toLocaleString()}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <section className="min-w-0">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <SectionLabel>
                      {t("routinesOverlay.queueTitle")} ({routines?.length ?? 0})
                    </SectionLabel>
                    <p className="text-sm text-codezal-mute">{t("routinesOverlay.heroTagline")}</p>
                  </div>
                </div>

                {!routines ? (
                  <div className="rounded-lg border border-codezal-hair bg-codezal-panel px-3 py-3 text-sm text-codezal-mute">
                    …
                  </div>
                ) : routines.length === 0 ? (
                  <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-codezal bg-codezal-panel px-4 py-10 text-center">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-codezal-accent-dim text-codezal-accent">
                      <Zap className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="text-sm text-codezal-mute">{t("routinesOverlay.noRoutinesBlock")}</span>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {routines.map((r) => (
                      <li
                        key={r.path}
                        role="button"
                        tabIndex={0}
                        onClick={() => startDetail(r)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            startDetail(r)
                          }
                        }}
                        className="cursor-pointer rounded-lg border border-codezal-hair bg-codezal-panel p-3 transition-colors hover:border-codezal-strong"
                      >
                        <div className="flex flex-wrap items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-base font-semibold text-codezal-text">{r.name}</span>
                              <span className="rounded-md bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-dim">
                                {r.scope === "project"
                                  ? t("routinesOverlay.scopeProject")
                                  : t("routinesOverlay.scopeGlobal")}
                              </span>
                              {r.disabled && (
                                <span className="rounded-md bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-mute">
                                  {t("routinesOverlay.pausedBadge")}
                                </span>
                              )}
                              {r.schedule &&
                                (() => {
                                  const err = validateCron(r.schedule)
                                  if (err) {
                                    return (
                                      <span
                                        className="rounded-md bg-destructive/15 px-1.5 py-0.5 text-sm text-destructive"
                                        title={err}
                                      >
                                        {t("routinesOverlay.cronInvalid")}
                                      </span>
                                    )
                                  }
                                  const next = nextFireAt(parseCron(r.schedule))
                                  return (
                                    <span
                                      className="rounded-md bg-codezal-accent-dim px-1.5 py-0.5 text-sm font-medium text-codezal-accent"
                                      title={
                                        next
                                          ? t("routinesOverlay.cronNextLabel", { next: next.toLocaleString() })
                                          : undefined
                                      }
                                    >
                                      {describe(cronToFriendly(r.schedule))}
                                    </span>
                                  )
                                })()}
                            </div>
                            {r.description && <div className="mt-1 text-sm text-codezal-dim">{r.description}</div>}
                          </div>

                          {pendingDelete === r.path ? (
                            <div
                              className="flex shrink-0 items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => void onDelete(r.path)}
                                className="rounded-md bg-destructive/90 px-2 py-1 text-sm font-medium text-white transition hover:bg-destructive"
                              >
                                {t("common.delete")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDelete(null)}
                                className="rounded-md border border-codezal px-2 py-1 text-sm text-codezal-text transition-colors hover:bg-codezal-panel-2"
                              >
                                {t("common.cancel")}
                              </button>
                            </div>
                          ) : (
                            <div
                              className="flex shrink-0 items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  onRun(r.prompt, {
                                    provider: r.provider ?? settings.defaultProvider,
                                    model: r.model ?? settings.defaultModel,
                                  })
                                  onClose()
                                }}
                                className={primaryBtn}
                                title={t("routinesOverlay.runTitle")}
                              >
                                <Play className="h-4 w-4" /> {t("routinesOverlay.runNow")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDelete(r.path)}
                                aria-label={t("common.delete")}
                                title={t("routinesOverlay.deleteConfirm")}
                                className="rounded-md p-1.5 text-codezal-mute transition-colors hover:bg-destructive/10 hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </button>
                            </div>
                          )}
                        </div>

                        <pre className="mt-2 max-h-[110px] overflow-auto whitespace-pre-wrap rounded-md bg-codezal-input p-2.5 text-sm text-codezal-dim">
                          {r.prompt.slice(0, 600)}
                          {r.prompt.length > 600 && "\n…"}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <aside className="flex min-w-0 flex-col gap-5">
                <section>
                  <SectionLabel>{t("routinesOverlay.backgroundTitle")}</SectionLabel>
                  <div className="divide-y divide-codezal-hair overflow-hidden rounded-lg border border-codezal-hair bg-codezal-panel">
                    <ToggleRow
                      on={!!ap.runInBackground}
                      onChange={(v) => updateAp({ runInBackground: v })}
                      label={t("routinesOverlay.runInBackground")}
                      hint={t("routinesOverlay.runInBackgroundHint")}
                    />
                    <ToggleRow
                      on={!!ap.autostart}
                      onChange={(v) => updateAp({ autostart: v })}
                      label={t("routinesOverlay.autostart")}
                    />
                    <ToggleRow
                      on={!!ap.keepAwake}
                      onChange={(v) => updateAp({ keepAwake: v })}
                      label={t("routinesOverlay.keepAwake")}
                    />
                    {connections.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5 text-sm text-codezal-mute">
                        <Plug className="h-3.5 w-3.5" aria-hidden />
                        <span>{t("routinesOverlay.connectionsLabel")}:</span>
                        {connections.map((c) => (
                          <span key={c} className="rounded-md bg-codezal-chip px-1.5 py-0.5 text-codezal-dim">
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                <section>
                  <SectionLabel>{t("routinesOverlay.templatesTitle")}</SectionLabel>
                  <div className="flex flex-col gap-2">
                    {AUTOPILOT_TEMPLATES.map((tpl) => {
                      const Icon = TPL_ICON[tpl.id] ?? Zap
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => applyTemplate(tpl)}
                          className="group flex gap-3 rounded-lg border border-codezal-hair bg-codezal-panel p-3 text-left transition-colors hover:border-codezal-strong hover:bg-codezal-panel-2"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-codezal-accent-dim text-codezal-accent">
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-codezal-text">
                              {tpl.name}
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-sm leading-relaxed text-codezal-mute">
                              {tpl.description}
                            </span>
                            <span className="mt-2 inline-flex rounded-md bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-dim">
                              {describe(cronToFriendly(tpl.schedule))}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              </aside>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-codezal px-5 py-2 text-sm text-codezal-mute">
        {t("routinesOverlay.footerNote")}
      </div>
    </div>
  )
}
