// Sağ panel — TabBar'dan seçilen tek mod görüntülenir.
import { useEffect, useState } from "react"
import { ChevronRight, File, FileText, Folder, FolderOpen, ShieldCheck, Sparkles, Bot, X } from "lucide-react"
import { useSessionsStore } from "@/store/sessions"
import { readWorkspaceDir, type FsEntry } from "@/lib/workspace-tree"
import { readProjectMemory, readUserMemory, type MemoryFile } from "@/lib/memory"
import { readWorkspaceSkills, readUserSkills, type Skill } from "@/lib/skills"
import { readWorkspaceAgents, readUserAgents, type AgentDef } from "@/lib/agents"
import { GitPanel } from "./GitPanel"
import { TerminalPanel } from "./TerminalPanel"
import type { PanelMode } from "./TabBar"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStaticCtx } from "@/lib/i18n"

function titleFor(mode: PanelMode, tt: ReturnType<typeof useT>): string {
  switch (mode) {
    case "files": return tt("contextPanel.titleFiles")
    case "git": return tt("contextPanel.titleGit")
    case "agents": return tt("contextPanel.titleAgents")
    case "skills": return tt("contextPanel.titleSkills")
    case "memory": return tt("contextPanel.titleMemory")
    case "rules": return tt("contextPanel.titleRules")
    case "terminal": return tt("contextPanel.titleTerminal")
  }
}

type Props = {
  mode: PanelMode
  onClose: () => void
}

const PANEL_W_KEY = "codezal.contextPanel.width"
const PANEL_W_MIN = 240
const PANEL_W_MAX = 1200
const PANEL_W_DEFAULT = 320
// Terminal needs more cols; bump default and per-mode key so non-terminal panels stay compact.
const PANEL_W_KEY_TERMINAL = "codezal.contextPanel.terminalWidth"
const PANEL_W_TERMINAL_DEFAULT = 560

export function ContextPanel({ mode, onClose }: Props) {
  const t = useT()
  const active = useSessionsStore((s) => s.active)
  const ws = active?.workspacePath
  // Terminal kendi scroll'u olur — diğerlerinde overflow + padding kullan
  const isTerminal = mode === "terminal"

  // Drag-to-resize: sol kenardan sürükleyince panel genişler/daralır.
  // Terminal modu kendi key'inde — kod paneli dar, terminal geniş tutulabilir.
  const storageKey = isTerminal ? PANEL_W_KEY_TERMINAL : PANEL_W_KEY
  const defaultW = isTerminal ? PANEL_W_TERMINAL_DEFAULT : PANEL_W_DEFAULT
  const [width, setWidth] = useState<number>(() => {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n >= PANEL_W_MIN && n <= PANEL_W_MAX ? n : defaultW
  })

  // Mod değişince yeni key'in saved değerine geç
  useEffect(() => {
    const raw = window.localStorage.getItem(storageKey)
    const n = raw ? Number(raw) : NaN
    setWidth(Number.isFinite(n) && n >= PANEL_W_MIN && n <= PANEL_W_MAX ? n : defaultW)
  }, [storageKey, defaultW])

  useEffect(() => {
    window.localStorage.setItem(storageKey, String(width))
  }, [storageKey, width])

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    function onMove(ev: MouseEvent) {
      // Sol kenardan sürüklendiği için: sağa hareket = daralma, sola = genişleme
      const delta = startX - ev.clientX
      const next = Math.min(PANEL_W_MAX, Math.max(PANEL_W_MIN, startW + delta))
      setWidth(next)
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  return (
    <aside
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-l border-codezal bg-codezal-bg"
    >
      {/* Sol kenar drag handle — 6px hit area, idle'de hafif çizgi, hover/drag'de accent */}
      <div
        onMouseDown={startResize}
        className="group absolute left-0 top-0 z-20 h-full w-[6px] -translate-x-[3px] cursor-col-resize"
        title={t("contextPanel.resizeTitle")}
      >
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-codezal-hair transition-colors group-hover:bg-codezal-accent" />
      </div>
      <header className="flex shrink-0 items-center gap-2 border-b border-codezal px-3 py-2">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-codezal-dim">
          {titleFor(mode, t)}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-codezal-mute hover:text-codezal-text"
          title={t("contextPanel.panelClose")}
        >
          <X className="h-3 w-3" />
        </button>
      </header>

      <div
        className={cn(
          "flex-1 min-h-0",
          isTerminal ? "flex" : "overflow-y-auto px-3.5 py-3",
        )}
      >
        {mode === "files" && <FilesSection workspacePath={ws} />}
        {mode === "git" && <GitPanel workspacePath={ws} />}
        {mode === "agents" && <AgentsSection workspacePath={ws} />}
        {mode === "skills" && <SkillsSection workspacePath={ws} />}
        {mode === "memory" && <MemorySection workspacePath={ws} />}
        {mode === "rules" && <RulesSection workspacePath={ws} />}
        {mode === "terminal" && <TerminalPanel workspacePath={ws} />}
      </div>
    </aside>
  )
}

function SectionHead({ label, right }: { label: string; right?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-codezal-dim">
        {label}
      </span>
      {right && (
        <span className="text-[11px] text-codezal-mute">{right}</span>
      )}
    </div>
  )
}

function FilesSection({ workspacePath }: { workspacePath?: string }) {
  const t = useT()
  return (
    <div>
      <SectionHead label={t("contextPanel.workspaceFolder")} />
      {!workspacePath ? (
        <div className="px-1 py-3 text-[12px] text-codezal-mute">
          {t("contextPanel.notConnectedTreeMsg")}
        </div>
      ) : (
        <FileTree root={workspacePath} />
      )}
    </div>
  )
}

// Lazy file tree — root readDir + dizinlere tıklayınca alt seviye yüklenir
function FileTree({ root }: { root: string }) {
  return (
    <div className="text-[12px] text-codezal-text">
      <TreeLevel path={root} depth={0} startExpanded />
    </div>
  )
}

function TreeLevel({
  path,
  depth,
  startExpanded,
}: {
  path: string
  depth: number
  startExpanded?: boolean
}) {
  const [entries, setEntries] = useState<FsEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (!startExpanded && entries !== null) return
    readWorkspaceDir(path)
      .then((es) => {
        if (alive) setEntries(es)
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  if (error) {
    return (
      <div className="px-2 py-1 text-[11px] text-destructive">{error}</div>
    )
  }
  if (entries === null) {
    return <div className="px-2 py-1 text-[11px] text-codezal-mute">…</div>
  }
  if (entries.length === 0) {
    return <div className="px-2 py-1 text-[11px] text-codezal-mute">{tStaticCtx("contextPanel.treeEmpty")}</div>
  }

  return (
    <ul className="flex flex-col">
      {entries.map((e) => (
        <TreeNode key={e.path} entry={e} depth={depth} />
      ))}
    </ul>
  )
}

function TreeNode({ entry, depth }: { entry: FsEntry; depth: number }) {
  const [open, setOpen] = useState(false)
  const openFile = useSessionsStore((s) => s.openFile)
  const pad = { paddingLeft: `${depth * 10 + 4}px` }

  if (!entry.isDir) {
    return (
      <li>
        <button
          type="button"
          onClick={() => openFile(entry.path)}
          style={pad}
          className="flex w-full items-center gap-1.5 truncate rounded px-1 py-[3px] text-left text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
          title={entry.path}
        >
          <File className="h-3 w-3 shrink-0 text-codezal-mute" />
          <span className="truncate">{entry.name}</span>
        </button>
      </li>
    )
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={pad}
        className="flex w-full items-center gap-1 truncate rounded px-1 py-[3px] text-left text-codezal-text hover:bg-codezal-panel-2"
      >
        <ChevronRight
          className={cn(
            "h-2.5 w-2.5 shrink-0 text-codezal-mute transition-transform",
            open && "rotate-90",
          )}
        />
        {open ? (
          <FolderOpen className="h-3 w-3 shrink-0 text-codezal-accent" />
        ) : (
          <Folder className="h-3 w-3 shrink-0 text-codezal-accent" />
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {open && <TreeLevel path={entry.path} depth={depth + 1} />}
    </li>
  )
}

function AgentsSection({ workspacePath }: { workspacePath?: string }) {
  const t = useT()
  const [agents, setAgents] = useState<AgentDef[] | null>(null)
  const openFile = useSessionsStore((s) => s.openFile)

  useEffect(() => {
    let alive = true
    setAgents(null)
    Promise.all([readWorkspaceAgents(workspacePath), readUserAgents()])
      .then(([p, u]) => {
        if (alive) setAgents([...p, ...u])
      })
      .catch(() => {
        if (alive) setAgents([])
      })
    return () => {
      alive = false
    }
  }, [workspacePath])

  return (
    <div>
      <SectionHead label={t("contextPanel.agentsHeading")} right={String(agents?.length ?? 0)} />
      {!agents ? (
        <div className="px-1 py-3 text-[12px] text-codezal-mute">…</div>
      ) : agents.length === 0 ? (
        <div className="px-1 py-3 text-[12px] text-codezal-mute">
          {t("contextPanel.noAgents")}
          <br />
          <code className="text-codezal-text">.codezal/agents/&lt;name&gt;.md</code> (workspace) veya{" "}
          <code className="text-codezal-text">~/.codezal/agents/&lt;name&gt;.md</code> ekle.
          <br />
          Frontmatter: <code className="text-codezal-text">name</code>,{" "}
          <code className="text-codezal-text">description</code>, opsiyonel{" "}
          <code className="text-codezal-text">model</code>,{" "}
          <code className="text-codezal-text">provider</code>,{" "}
          <code className="text-codezal-text">tools</code>,{" "}
          <code className="text-codezal-text">max_steps</code>.
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {agents.map((a) => (
            <button
              key={a.path}
              type="button"
              onClick={() => openFile(a.path)}
              className="flex flex-col gap-0.5 truncate rounded px-1.5 py-1 text-left hover:bg-codezal-panel-2"
              title={a.path}
            >
              <span className="flex items-center gap-2">
                <Bot className="h-3 w-3 shrink-0 text-codezal-accent" />
                <span className="truncate text-[12px] text-codezal-text">{a.name}</span>
                <span className="ml-auto shrink-0 text-[10.5px] text-codezal-mute">
                  {a.scope === "project" ? t("contextPanel.scopeProject") : t("contextPanel.scopeGlobal")}
                </span>
              </span>
              {a.description && (
                <span className="truncate pl-5 text-[11px] text-codezal-dim">
                  {a.description}
                </span>
              )}
              {(a.model || a.tools) && (
                <span className="truncate pl-5 font-mono text-[10.5px] text-codezal-mute">
                  {a.model && <>· {a.model}</>}
                  {a.tools && a.tools.length > 0 && <> · {a.tools.join(",")}</>}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SkillsSection({ workspacePath }: { workspacePath?: string }) {
  const t = useT()
  const [skills, setSkills] = useState<Skill[] | null>(null)
  const openFile = useSessionsStore((s) => s.openFile)

  useEffect(() => {
    let alive = true
    setSkills(null)
    Promise.all([readWorkspaceSkills(workspacePath), readUserSkills()])
      .then(([p, u]) => {
        if (alive) setSkills([...p, ...u])
      })
      .catch(() => {
        if (alive) setSkills([])
      })
    return () => {
      alive = false
    }
  }, [workspacePath])

  return (
    <div>
      <SectionHead label={t("contextPanel.skillsHeading")} right={String(skills?.length ?? 0)} />
      {!skills ? (
        <div className="px-1 py-3 text-[12px] text-codezal-mute">…</div>
      ) : skills.length === 0 ? (
        <div className="px-1 py-3 text-[12px] text-codezal-mute">
          {t("contextPanel.noSkills2")}
          <br />
          <code className="text-codezal-text">.codezal/skills/&lt;name&gt;/SKILL.md</code> (workspace) veya{" "}
          <code className="text-codezal-text">~/.codezal/skills/&lt;name&gt;/SKILL.md</code> ekle.
          <br />
          Frontmatter: <code className="text-codezal-text">name</code>, <code className="text-codezal-text">description</code>, opsiyonel <code className="text-codezal-text">triggers</code>.
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {skills.map((s) => (
            <button
              key={s.path}
              type="button"
              onClick={() => openFile(s.path)}
              className="flex flex-col gap-0.5 truncate rounded px-1.5 py-1 text-left hover:bg-codezal-panel-2"
              title={s.path}
            >
              <span className="flex items-center gap-2">
                <Sparkles className="h-3 w-3 shrink-0 text-codezal-accent" />
                <span className="truncate text-[12px] text-codezal-text">{s.name}</span>
                <span className="ml-auto shrink-0 text-[10.5px] text-codezal-mute">
                  {s.scope === "project" ? t("contextPanel.scopeProject") : t("contextPanel.scopeGlobal")}
                </span>
              </span>
              {s.description && (
                <span className="truncate pl-5 text-[11px] text-codezal-dim">
                  {s.description}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MemorySection({ workspacePath }: { workspacePath?: string }) {
  const t = useT()
  const files = useMemoryFiles(workspacePath, "memory")
  const openFile = useSessionsStore((s) => s.openFile)

  return (
    <div>
      <SectionHead
        label={t("contextPanel.memoryHeading")}
        right={String(files?.length ?? 0)}
      />
      {!files ? (
        <div className="px-1 py-3 text-[12px] text-codezal-mute">…</div>
      ) : files.length === 0 ? (
        <div className="px-1 py-3 text-[12px] text-codezal-mute">
          {t("contextPanel.noMemoryFiles")} <br />
          Workspace içine <code className="text-codezal-text">CODEZAL.md</code> veya{" "}
          <code className="text-codezal-text">CLAUDE.md</code> ekle; system prompt'a otomatik enjekte edilir.
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => openFile(f.path)}
              className="flex items-center gap-2 truncate rounded px-1.5 py-1 text-left text-[12px] text-codezal-text hover:bg-codezal-panel-2"
              title={f.path}
            >
              <FileText className="h-3 w-3 shrink-0 text-codezal-accent" />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-[10.5px] text-codezal-mute">
                {f.scope === "project" ? t("contextPanel.scopeProject") : t("contextPanel.scopeGlobal")}
              </span>
              <span className="shrink-0 text-[10.5px] text-codezal-mute">
                {Math.ceil(f.bytes / 1024)}K
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function RulesSection({ workspacePath }: { workspacePath?: string }) {
  const t = useT()
  const files = useMemoryFiles(workspacePath, "rules")
  const openFile = useSessionsStore((s) => s.openFile)

  return (
    <div>
      <SectionHead label={t("contextPanel.rulesHeading")} right={String(files?.length ?? 0)} />
      {!files ? (
        <div className="px-1 py-3 text-[12px] text-codezal-mute">…</div>
      ) : files.length === 0 ? (
        <div className="px-1 py-3 text-[12px] text-codezal-mute">
          {t("contextPanel.noRulesFiles")} <br />
          <code className="text-codezal-text">.codezal/rules/*.md</code> (workspace) veya{" "}
          <code className="text-codezal-text">~/.codezal/rules/*.md</code> (global) altına ekle.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => openFile(f.path)}
              className="flex items-center gap-2 truncate rounded px-1.5 py-1 text-left text-[12px] text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
              title={f.path}
            >
              <ShieldCheck className="h-3 w-3 shrink-0 text-codezal-accent" />
              <span className="truncate">{f.name}</span>
              <span className="ml-auto shrink-0 text-[10.5px] text-codezal-mute">
                {f.scope === "project" ? t("contextPanel.scopeProject") : t("contextPanel.scopeGlobal")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Memory dosyalarını sekmeye göre filtrele.
function useMemoryFiles(
  workspacePath: string | undefined,
  mode: "memory" | "rules",
): MemoryFile[] | null {
  const [files, setFiles] = useState<MemoryFile[] | null>(null)

  useEffect(() => {
    let alive = true
    setFiles(null)
    Promise.all([
      workspacePath ? readProjectMemory(workspacePath) : Promise.resolve([]),
      readUserMemory(),
    ])
      .then(([p, u]) => {
        if (!alive) return
        const all = [...p, ...u]
        const filtered = all.filter((f) => {
          const isRule =
            f.name.includes("/rules/") ||
            f.name.startsWith("rules/") ||
            f.name.toLowerCase() === "rules.md"
          return mode === "rules" ? isRule : !isRule
        })
        setFiles(filtered)
      })
      .catch(() => {
        if (alive) setFiles([])
      })
    return () => {
      alive = false
    }
  }, [workspacePath, mode])

  return files
}

