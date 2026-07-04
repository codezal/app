// Composer — chip butonlar, workspace/branch/permission, model + effort, send.
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useMenu } from "@/lib/useMenu"
import {
  AlertCircle,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  File as FileIcon,
  FileText,
  Folder,
  FolderPlus,
  ClockClockwise,
  HandIcon,
  MessageSquare,
  Music,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Send,
  Sparkles,
  Target,
  Trash2,
  X,
} from "@/lib/icons"
import { useSessionsStore } from "@/store/sessions"
import { useSuggestionsStore } from "@/store/suggestions"
import { useSettingsStore } from "@/store/settings"
import { useVim } from "@/lib/vim/useVim"
import { isMacOS, fmtKbd } from "@/lib/platform"
import type { ApprovalMode, MessageImage, MessageFile, MessagePdf, SessionGoal } from "@/store/types"
import { Dialog } from "./Dialog"
import { fileToMessageImage, type ImageAttachResult } from "@/lib/image"
import { fileToMessagePdf } from "@/lib/pdf"
import { isBinary, isImage, isPdf, mimeForImage } from "@/lib/file-type"
import { registerComposerDrop, registerComposerInsert, setFocusedComposer } from "@/lib/composer-drop"
import { stat } from "@tauri-apps/plugin-fs"
import { StoredImage } from "./StoredImage"
import { ImageLightbox } from "./ImageLightbox"
import { PromptHistorySearch } from "./PromptHistorySearch"
import { pushPrompt } from "@/lib/prompt-history"
import {
  listProviderAdapters,
  modelsFor,
  defaultModelFor,
  isConnectedSync,
  probeEnvVars,
  reasoningEfforts,
  resolveReasoningEffort,
  type ProviderId,
  type ReasoningEffort,
} from "@/lib/providers"
import { modelDetail, modelAcceptsImages, modelAcceptsPdf, resolveContextCap, type ProvidersCatalog } from "@/lib/providers-catalog"
import { resolveLocalLlm, displayModelName } from "@/lib/local-llm"
import { useLocalRuntimeStore } from "@/store/local-runtime"
import { toast } from "@/store/toast"
import { errorMessage } from "@/lib/errors"
import { enhancePrompt } from "@/lib/prompt-enhance"
import { basename, pickWorkspaceFolder } from "@/lib/workspace"
import { listDirShallow, type DirEntry } from "@/lib/fs-browse"
import { gitCurrentBranch, gitListBranches } from "@/lib/git"
import { listAllSkills } from "@/lib/skills"
import { detectEditors, openInEditor } from "@/lib/editors"
import { watchFile } from "@/lib/file-watcher"
import { readFileSafe, readTextFileSafe, writeTextFileSafe } from "@/lib/fs-safe"
import { appDataDir, join as joinPath } from "@tauri-apps/api/path"
import { registerDropTarget } from "@/lib/internal-drag"
import {
  listAllCommands,
  parseSlashInput,
  renderTemplate,
  dedupeCommands,
  type SlashCommand,
} from "@/lib/commands"
import {
  getMcpPrompt,
  listConnectedMcpPrompts,
  listConnectedMcpResources,
  listPluginMcps,
  readMcpResource,
} from "@/lib/mcp"
import { SlashMenu } from "./SlashMenu"
import { MentionMenu, type MentionItem, type MentionMcpItem } from "./MentionMenu"
import { monaco } from "@/lib/monaco/setup"
import { BranchPicker } from "./BranchPicker"
import { filterCommands, filterMentions } from "@/lib/menu-filters"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"

const MAX_TEXTAREA_PX = 400

// SendOverride moved to @/lib/stream/types (shared with run-stream, which as a
// lib module must not import from components). Re-exported for back-compat.
import type { SendOverride } from "@/lib/stream/types"
export type { SendOverride } from "@/lib/stream/types"

function collectProblems(): { text: string; count: number } {
  const markers = monaco.editor
    .getModelMarkers({})
    .filter((m) => m.severity >= monaco.MarkerSeverity.Warning)
  if (markers.length === 0) return { text: "", count: 0 }
  const byFile = new Map<string, string[]>()
  for (const m of markers) {
    const sev = m.severity === monaco.MarkerSeverity.Error ? "error" : "warning"
    const arr = byFile.get(m.resource.path) ?? []
    arr.push(`  ${sev} [${m.startLineNumber}:${m.startColumn}] ${m.message}`)
    byFile.set(m.resource.path, arr)
  }
  const out: string[] = []
  for (const [path, lines] of byFile) {
    out.push(`${path}:`)
    out.push(...lines.slice(0, 30))
  }
  return { text: out.join("\n"), count: markers.length }
}

// Parse a command's `model:` frontmatter. "provider/id" splits into both;
// a bare id keeps the session's provider.
function parseModelOverride(model?: string): SendOverride | undefined {
  if (!model) return undefined
  const slash = model.indexOf("/")
  if (slash > 0) {
    return { provider: model.slice(0, slash) as ProviderId, model: model.slice(slash + 1) }
  }
  return { model }
}

function highlightSegments(text: string, valid: Set<string>): { text: string; cmd: boolean }[] {
  const segs: { text: string; cmd: boolean }[] = []
  const re = /(^|\s)(\/[^\s]+)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (!valid.has(m[2].slice(1))) continue
    const tokenStart = m.index + m[1].length
    if (tokenStart > last) segs.push({ text: text.slice(last, tokenStart), cmd: false })
    segs.push({ text: m[2], cmd: true })
    last = tokenStart + m[2].length
  }
  if (last < text.length) segs.push({ text: text.slice(last), cmd: false })
  return segs
}

async function pathToMessageImage(path: string): Promise<ImageAttachResult> {
  try {
    const bytes = await readFileSafe(path)
    const name = path.split(/[\\/]/).pop() || "image"
    const file = new File([bytes], name, { type: mimeForImage(name) })
    return await fileToMessageImage(file)
  } catch (e) {
    console.warn("[composer-drop] görsel okunamadı:", path, e)
    return { ok: false, reason: "decode-failed" }
  }
}

async function pathToMessageFile(path: string): Promise<MessageFile> {
  const name = path.split(/[\\/]/).pop() || path
  let isDir = false
  try {
    isDir = (await stat(path)).isDirectory
  } catch {
    // Intentionally ignored.
  }
  return { id: path, path, name, isDir }
}

type Props = {
  streaming: boolean
  compacting?: boolean
  onSend: (
    text: string,
    images?: MessageImage[],
    override?: SendOverride,
    meta?: string,
    files?: MessageFile[],
    pdfs?: MessagePdf[],
  ) => void
  onAbort: () => void
  disabled?: boolean
  placeholder?: string
  sessionId?: string
  onSlashAction?: (action: NonNullable<SlashCommand["action"]>, args: string) => void
  onOpenOrchestra?: () => void
  onRemember?: (text: string, scope: "project" | "global") => void
  queued?: string[]
  onQueue?: (text: string) => void
  onUnqueue?: (idx: number) => void
  // footer zeminini (kart: codezal-sidebar / sayfa: codezal-bg) hem yatay padding'i
  inCard?: boolean
}

export function Composer({
  streaming,
  compacting,
  onSend,
  onAbort,
  disabled,
  placeholder,
  sessionId,
  onSlashAction,
  onOpenOrchestra,
  onRemember,
  queued,
  onQueue,
  onUnqueue,
  inCard = false,
}: Props) {
  const t = useT()
  const suggestionCount = useSuggestionsStore((s) =>
    sessionId ? (s.bySession[sessionId]?.items.length ?? 0) : 0,
  )
  const [text, setText] = useState("")
  const [enhancing, setEnhancing] = useState(false)
  const [histOpen, setHistOpen] = useState(false)
  const [goalModal, setGoalModal] = useState<{ open: boolean; mode: "new" | "edit" }>({
    open: false,
    mode: "new",
  })
  const [images, setImages] = useState<MessageImage[]>([])
  const [imgLightbox, setImgLightbox] = useState<number | null>(null)
  const [fileRefs, setFileRefs] = useState<MessageFile[]>([])
  const [pdfs, setPdfs] = useState<MessagePdf[]>([])
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [slashIdx, setSlashIdx] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const undoStack = useRef<string[]>([""])
  const undoIdx = useRef(0)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const slashWrapRef = useRef<HTMLDivElement>(null)
  // Highlight mirror — textarea text-transparent; bu katman /komut'u mavi boyar.
  const mirrorRef = useRef<HTMLDivElement>(null)
  const updateActiveMeta = useSessionsStore((s) => s.updateActiveMeta)
  const updateMetaFor = useSessionsStore((s) => s.updateMetaFor)
  const setProjectMeta = useSessionsStore((s) => s.setProjectMeta)
  const setMode = useSessionsStore((s) => s.setMode)
  const setModeFor = useSessionsStore((s) => s.setModeFor)
  const setGoalFor = useSessionsStore((s) => s.setGoalFor)
  const editGoalTextFor = useSessionsStore((s) => s.editGoalTextFor)
  const pauseGoalFor = useSessionsStore((s) => s.pauseGoalFor)
  const resumeGoalFor = useSessionsStore((s) => s.resumeGoalFor)
  const clearGoalFor = useSessionsStore((s) => s.clearGoalFor)
  const applyMeta = (patch: Parameters<typeof updateActiveMeta>[0]) =>
    sessionId ? updateMetaFor(sessionId, patch) : updateActiveMeta(patch)
  const applyMode = (m: Parameters<typeof setMode>[0]) =>
    sessionId ? setModeFor(sessionId, m) : setMode(m)
  const hasActive = useSessionsStore((s) =>
    sessionId ? s.sessions[sessionId] != null : s.active != null,
  )
  const isDraft = useSessionsStore((s) => s.isDraft)
  const effIsDraft = sessionId ? false : isDraft
  const sess = (s: ReturnType<typeof useSessionsStore.getState>) =>
    sessionId ? s.sessions[sessionId] : s.active
  const mode = useSessionsStore((s) => sess(s)?.mode ?? "build")
  const goal = useSessionsStore((s) => sess(s)?.goal)
  const activeId = useSessionsStore((s) => s.activeId)
  const goalSid = sessionId ?? activeId
  const workspacePath = useSessionsStore((s) => sess(s)?.workspacePath)
  const workspaceReadOnly = useSessionsStore((s) => sess(s)?.workspaceReadOnly)
  const provider = useSessionsStore((s) => sess(s)?.provider)
  const model = useSessionsStore((s) => sess(s)?.model)
  const msgCount = useSessionsStore((s) => sess(s)?.messages.length ?? 0)
  const effectiveTok = useSessionsStore((s) => sess(s)?.usage?.effectiveContextTokens)
  const lastInputTok = useSessionsStore((s) => sess(s)?.usage?.lastInputTokens)
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)
  const approvalMode = settings.approvalMode
  const sessionEffort = useSessionsStore((s) => sess(s)?.reasoningEffort)
  const reasoningProvider = (provider ?? settings.defaultProvider) as ProviderId
  const reasoningModel = model ?? settings.defaultModel
  const reasoningCapable =
    modelDetail(
      settings.providerCatalog?.data as ProvidersCatalog | undefined,
      reasoningProvider,
      reasoningModel,
    )?.reasoning === true
  const effort: ReasoningEffort = resolveReasoningEffort({
    providerId: reasoningProvider,
    modelId: reasoningModel,
    reasoningCapable,
    sessionEffort,
    byModel: settings.reasoningEffortByModel,
  })
  const setEffort = (e: ReasoningEffort) => {
    if (hasActive) applyMeta({ reasoningEffort: e })
    void updateSettings({
      reasoningEffortByModel: {
        ...(settings.reasoningEffortByModel ?? {}),
        [`${reasoningProvider}/${reasoningModel}`]: e,
      },
    })
  }
  const efforts = reasoningEfforts(reasoningProvider, reasoningModel, reasoningCapable)
  const supportsReasoning = efforts.length > 0
  const shownEffort = efforts.includes(effort) ? effort : efforts[efforts.length - 1] ?? effort

  // (codezal:commands-changed) + skill enable/disable (codezal:skills-changed)
  useEffect(() => {
    let alive = true
    function refresh() {
      void listAllCommands(workspacePath).then((cmds) => {
        if (alive) setCommands(cmds)
      })
    }
    refresh()
    window.addEventListener("codezal:commands-changed", refresh)
    window.addEventListener("codezal:skills-changed", refresh)
    return () => {
      alive = false
      window.removeEventListener("codezal:commands-changed", refresh)
      window.removeEventListener("codezal:skills-changed", refresh)
    }
  }, [workspacePath])

  const slashState = useMemo(() => {
    const m = /(?:^|\s)\/(\S*)$/.exec(text)
    if (!m) return { open: false, query: "", start: -1 }
    return { open: true, query: m[1], start: text.length - m[1].length - 1 }
  }, [text])

  const [slashDismissed, setSlashDismissed] = useState(false)
  const [prevTextForSlash, setPrevTextForSlash] = useState(text)
  if (text !== prevTextForSlash) {
    setPrevTextForSlash(text)
    if (slashDismissed) setSlashDismissed(false)
  }
  const slashOpen = slashState.open && !slashDismissed
  useEffect(() => {
    if (!slashOpen) return
    function onDown(e: MouseEvent) {
      const root = slashWrapRef.current
      if (root && !root.contains(e.target as Node)) setSlashDismissed(true)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [slashOpen])

  const hashState = useMemo(() => {
    if (!onRemember || !text.startsWith("#")) return { open: false, note: "" }
    const note = text.slice(1).trim()
    return { open: note.length > 0, note }
  }, [text, onRemember])

  function commitRemember(scope: "project" | "global") {
    const note = text.slice(1).trim()
    if (!note || !onRemember) return
    onRemember(note, scope)
    setText("")
    setImages([])
  }

  // MCP prompts of connected servers → slash commands. Recomputed each time the
  // menu opens (cache read, no network); stays empty until a server connects.
  const mcpCmds = useMemo<SlashCommand[]>(() => {
    if (!slashState.open) return []
    const cmds: SlashCommand[] = []
    for (const c of listConnectedMcpPrompts()) {
      for (const p of c.prompts) {
        cmds.push({
          name: p.name,
          description: p.description ?? `MCP prompt · ${c.server}`,
          scope: "mcp",
          mcpServer: c.server,
          mcpPrompt: p.name,
        })
      }
    }
    return cmds
  }, [slashState.open])
  // Existing commands win over MCP prompts on name collision (dedupe keeps first).
  const allCommands = useMemo(
    () => dedupeCommands([...commands, ...mcpCmds]),
    [commands, mcpCmds],
  )
  const validNames = useMemo(() => new Set(allCommands.map((c) => c.name)), [allCommands])

  const filteredCount = useMemo(
    () => filterCommands(allCommands, slashState.query).length,
    [allCommands, slashState.query],
  )
  const slashResetKey = `${slashState.query} ${filteredCount}`
  const [prevSlashResetKey, setPrevSlashResetKey] = useState(slashResetKey)
  if (slashResetKey !== prevSlashResetKey) {
    setPrevSlashResetKey(slashResetKey)
    setSlashIdx(0)
  }

  // @-mention: a trailing `@token` (preceded by start/space) opens the MCP
  // resource picker. Avoids emails (a@b) since `@` must follow whitespace/start.
  const mentionState = useMemo(() => {
    const m = /(?:^|\s)@(\S*)$/.exec(text)
    if (!m) return { open: false, query: "", start: -1 }
    return { open: true, query: m[1], start: text.length - m[1].length - 1 }
  }, [text])
  const [mentionIdx, setMentionIdx] = useState(0)
  const [mentionFiles, setMentionFiles] = useState<DirEntry[]>([])
  const [mentionBranches, setMentionBranches] = useState<{ name: string; current: boolean }[]>([])
  const [mentionSkills, setMentionSkills] = useState<{ name: string; description?: string }[]>([])
  useEffect(() => {
    if (!mentionState.open) return
    let alive = true
    if (workspacePath) {
      void listDirShallow(workspacePath).then((entries) => {
        if (alive) setMentionFiles(entries)
      })
      void Promise.all([gitListBranches(workspacePath), gitCurrentBranch(workspacePath)]).then(
        ([names, cur]) => {
          if (alive) setMentionBranches(names.map((name) => ({ name, current: name === cur })))
        },
      )
    }
    void listAllSkills(workspacePath).then((skills) => {
      if (alive) setMentionSkills(skills.map((s) => ({ name: s.name, description: s.description })))
    })
    return () => {
      alive = false
    }
  }, [mentionState.open, workspacePath])
  const mentionItems = useMemo<MentionItem[]>(() => {
    if (!mentionState.open) return []
    const items: MentionItem[] = []
    if (workspacePath) {
      for (const e of mentionFiles) {
        items.push({ kind: "file", name: e.name, path: e.path, rel: e.rel, isDir: e.isDir })
      }
    }
    for (const b of mentionBranches) {
      items.push({ kind: "branch", name: b.name, current: b.current })
    }
    for (const s of mentionSkills) {
      items.push({ kind: "skill", name: s.name, description: s.description })
    }
    for (const c of listConnectedMcpResources()) {
      for (const r of c.resources) {
        items.push({ kind: "mcp", server: c.server, name: r.name, uri: r.uri, description: r.description })
      }
    }
    const problemCount = collectProblems().count
    if (problemCount > 0) items.push({ kind: "problems", count: problemCount })
    return items
  }, [mentionState.open, workspacePath, mentionFiles, mentionBranches, mentionSkills])
  const mentionFilteredCount = useMemo(
    () => filterMentions(mentionItems, mentionState.query).length,
    [mentionItems, mentionState.query],
  )
  const mentionResetKey = `${mentionState.query} ${mentionFilteredCount}`
  const [prevMentionResetKey, setPrevMentionResetKey] = useState(mentionResetKey)
  if (mentionResetKey !== prevMentionResetKey) {
    setPrevMentionResetKey(mentionResetKey)
    setMentionIdx(0)
  }

  // Render a template command and dispatch it. agent → spawn that named agent in
  // the right panel (reuses the /agent prose path); subtask → spawn a generic
  // sub-agent; otherwise a normal turn, optionally with a model override.
  function dispatchTemplateCommand(cmd: SlashCommand, args: string) {
    if (cmd.template === undefined) return
    const rendered = renderTemplate(cmd.template, args).trim()
    if (!rendered) return
    const compact = `/${cmd.name}${args ? ` ${args}` : ""}`
    if (cmd.agent) {
      onSlashAction?.("agent", `${cmd.agent} ${rendered}`)
      return
    }
    if (cmd.subtask) {
      const body = `Bunu bir alt-görev olarak \`spawn_agent\` ile çalıştır ve sonucu özetle:\n\n${rendered}`
      onSend(compact, undefined, undefined, body)
      return
    }
    const ov = parseModelOverride(cmd.model)
    const override = cmd.disallowedTools?.length
      ? { ...ov, disallowedTools: cmd.disallowedTools }
      : ov
    onSend(compact, undefined, override, rendered)
  }

  function insertSlashText(name: string) {
    const before = slashState.start >= 0 ? text.slice(0, slashState.start) : ""
    setText(`${before}/${name} `)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.selectionStart = el.selectionEnd = el.value.length
    })
  }

  function pickSlash(cmd: SlashCommand) {
    if (slashState.start > 0 || cmd.scope !== "builtin" || cmd.needsArg === true) {
      insertSlashText(cmd.name)
      return
    }
    const args = parseSlashInput(text)?.args ?? ""
    if (cmd.action) {
      onSlashAction?.(cmd.action, args)
    } else if (cmd.template !== undefined) {
      dispatchTemplateCommand(cmd, args)
    }
    setText("")
    setImages([])
  }

  // Fetch an MCP prompt's rendered text and send it as a turn. The server config
  // is resolved from settings or the plugin registry by name.
  async function runMcpPrompt(server: string, promptName: string) {
    const cfg =
      (settings.mcpServers ?? []).find((s) => s.name === server) ??
      listPluginMcps().find((s) => s.name === server)
    if (!cfg) return
    try {
      const res = await getMcpPrompt(cfg, promptName)
      const rendered = (res.messages ?? [])
        .map((m) => {
          const c = m.content as { type?: string; text?: string }
          return c?.type === "text" ? c.text ?? "" : ""
        })
        .filter(Boolean)
        .join("\n\n")
        .trim()
      if (rendered) onSend(`/${promptName}`, undefined, undefined, rendered)
    } catch (e) {
      console.warn(`[mcp] getPrompt failed: ${server}/${promptName}`, e)
    }
  }

  function handlePickMention(item: MentionItem) {
    if (item.kind === "file") {
      const before = mentionState.start >= 0 ? text.slice(0, mentionState.start) : text
      setFileRefs((prev) =>
        prev.some((f) => f.path === item.path)
          ? prev
          : [...prev, { id: item.path, path: item.path, name: item.name, isDir: item.isDir }],
      )
      setText(before)
      pushUndo(before)
      setMentionIdx(0)
      ref.current?.focus()
      return
    }
    if (item.kind === "branch") {
      const before = mentionState.start >= 0 ? text.slice(0, mentionState.start) : text
      const nv = `${before}\`${item.name}\` `
      setText(nv)
      pushUndo(nv)
      setMentionIdx(0)
      ref.current?.focus()
      return
    }
    if (item.kind === "skill") {
      const before = mentionState.start >= 0 ? text.slice(0, mentionState.start) : text
      const nv = `${before}/${item.name} `
      setText(nv)
      pushUndo(nv)
      setMentionIdx(0)
      ref.current?.focus()
      return
    }
    if (item.kind === "problems") {
      const before = mentionState.start >= 0 ? text.slice(0, mentionState.start) : text
      const { text: probs } = collectProblems()
      const nv = `${before}Mevcut tanılar (LSP):\n\`\`\`\n${probs.slice(0, 6000)}\n\`\`\`\n`
      setText(nv)
      pushUndo(nv)
      setMentionIdx(0)
      ref.current?.focus()
      return
    }
    void pickMcpResource(item)
  }

  // Read an MCP resource and splice its text content into the composer,
  // replacing the `@query` token that opened the picker.
  async function pickMcpResource(item: MentionMcpItem) {
    const cfg =
      (settings.mcpServers ?? []).find((s) => s.name === item.server) ??
      listPluginMcps().find((s) => s.name === item.server)
    if (!cfg) return
    const before = mentionState.start >= 0 ? text.slice(0, mentionState.start) : text
    try {
      const res = await readMcpResource(cfg, item.uri)
      const contents = (res.contents ?? []) as Array<{ text?: string }>
      const body = contents
        .map((c) => c.text ?? "")
        .filter(Boolean)
        .join("\n")
        .trim()
      const nv = before + (body || `[resource: ${item.name}]`) + " "
      setText(nv)
      pushUndo(nv)
    } catch (e) {
      console.warn(`[mcp] readResource failed: ${item.server}/${item.uri}`, e)
      const nv = before + `[resource: ${item.name}] `
      setText(nv)
      pushUndo(nv)
    }
    setMentionIdx(0)
    ref.current?.focus()
  }

  async function onEnhance() {
    const raw = text.trim()
    if (!raw || enhancing || !provider) return
    setEnhancing(true)
    try {
      const improved = await enhancePrompt({
        text: raw,
        providerId: provider,
        settings,
        fallbackModel: model,
      })
      if (improved.trim()) {
        setText(improved)
        pushUndo(improved)
        ref.current?.focus()
      }
    } catch (e) {
      toast.error(`${t("composer.enhanceFailed")}: ${errorMessage(e)}`)
    } finally {
      setEnhancing(false)
    }
  }

  async function pickWorkspace() {
    const path = await pickWorkspaceFolder()
    if (!path) return
    if (hasActive) applyMeta({ workspacePath: path, workspaceReadOnly: false })
    void updateSettings({ defaultWorkspacePath: path })
  }

  async function pickFolderAttachment() {
    const path = await pickWorkspaceFolder()
    if (!path) return
    await handleDroppedPaths([path])
  }

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const autosize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`
    el.style.overflowX = "hidden"
    el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_PX ? "auto" : "hidden"
  }
  useLayoutEffect(autosize, [text])
  useEffect(() => {
    window.addEventListener("resize", autosize)
    return () => window.removeEventListener("resize", autosize)
  }, [])

  function collectImageResults(results: ImageAttachResult[], names: string[]): MessageImage[] {
    const ok: MessageImage[] = []
    results.forEach((r, i) => {
      if (r.ok && r.image) {
        ok.push(r.image)
        return
      }
      if (!r.reason || r.reason === "not-image") return
      toast.error(
        r.reason === "unsupported-format"
          ? t("composer.imageUnsupportedFormat", { name: names[i] })
          : t("composer.imageDecodeFailed", { name: names[i] }),
      )
    })
    return ok
  }

  async function addFiles(files: FileList | File[] | null) {
    if (!files) return
    const arr = Array.from(files)
    if (arr.length === 0) return
    const imgFiles = arr.filter((f) => f.type.startsWith("image/") || isImage(f.name))
    const pdfFiles = arr.filter((f) => f.type === "application/pdf" || isPdf(f.name))
    if (imgFiles.length) {
      const results = await Promise.all(imgFiles.map(fileToMessageImage))
      const ok = collectImageResults(
        results,
        imgFiles.map((f) => f.name),
      )
      if (ok.length) setImages((prev) => [...prev, ...ok])
    }
    if (pdfFiles.length) await addPdfFiles(pdfFiles)
  }
  async function addPdfFiles(files: File[]) {
    for (const f of files) {
      const res = await fileToMessagePdf(f)
      if (res.ok && res.pdf) {
        const pdf = res.pdf
        setPdfs((prev) => [...prev, pdf])
        continue
      }
      const msg =
        res.reason === "too-large"
          ? t("composer.pdfTooLarge", { name: f.name })
          : res.reason === "too-many-pages"
            ? t("composer.pdfTooManyPages", { name: f.name })
            : t("composer.pdfDecodeFailed", { name: f.name })
      toast.error(msg)
    }
  }
  function removeImage(id: string) {
    setImages((prev) => prev.filter((im) => im.id !== id))
  }
  function removePdf(id: string) {
    setPdfs((prev) => prev.filter((p) => p.id !== id))
  }

  const MAX_PASTE_FILE_BYTES = 256 * 1024
  async function addPastedTextFiles(files: File[]) {
    const blocks: string[] = []
    for (const f of files) {
      if (isBinary(f.name)) {
        toast.error(t("composer.pasteBinary", { name: f.name }))
        continue
      }
      if (f.size > MAX_PASTE_FILE_BYTES) {
        toast.error(t("composer.pasteTooLarge", { name: f.name }))
        continue
      }
      try {
        blocks.push(`\n\`\`\`${f.name}\n${await f.text()}\n\`\`\`\n`)
      } catch {
        toast.error(t("composer.pasteUnreadable", { name: f.name }))
      }
    }
    if (blocks.length) {
      const joined = blocks.join("")
      setText((t) => {
        const nv = t + joined
        queueMicrotask(() => pushUndo(nv))
        return nv
      })
      ref.current?.focus()
    }
  }

  async function handleDroppedPaths(paths: string[]) {
    const imgPaths: string[] = []
    const otherPaths: string[] = []
    for (const p of paths) {
      const name = p.split(/[\\/]/).pop() ?? p
      if (isImage(name)) imgPaths.push(p)
      else otherPaths.push(p)
    }
    if (imgPaths.length) {
      const results = await Promise.all(imgPaths.map(pathToMessageImage))
      const ok = collectImageResults(
        results,
        imgPaths.map((p) => p.split(/[\\/]/).pop() ?? p),
      )
      if (ok.length) setImages((prev) => [...prev, ...ok])
    }
    if (otherPaths.length) {
      let refs = await Promise.all(otherPaths.map(pathToMessageFile))
      if (!workspacePath || workspaceReadOnly) {
        const dir = refs.find((r) => r.isDir)
        if (dir) {
          applyMeta({ workspacePath: dir.path, workspaceReadOnly: true })
          toast.success(t("composer.readonlyWorkspaceOpened", { name: dir.name }))
          refs = refs.filter((r) => r !== dir)
        }
      }
      if (refs.length) {
        setFileRefs((prev) => {
          const seen = new Set(prev.map((f) => f.path))
          const fresh = refs.filter((f) => !seen.has(f.path))
          return fresh.length ? [...prev, ...fresh] : prev
        })
      }
    }
    ref.current?.focus()
  }
  function removeFileRef(id: string) {
    setFileRefs((prev) => prev.filter((f) => f.id !== id))
  }

  const composerKey = sessionId ?? "__global__"
  const onDropPathsRef = useRef<(paths: string[]) => void>(() => {})
  useEffect(() => {
    onDropPathsRef.current = (paths) => void handleDroppedPaths(paths)
  })
  useEffect(() => {
    return registerComposerDrop(composerKey, (paths) => onDropPathsRef.current(paths))
  }, [composerKey])
  useEffect(() => {
    return registerComposerInsert(composerKey, (snippet) => {
      setText((t) => {
        const nv = (t ? t + "\n" : "") + snippet
        queueMicrotask(() => pushUndo(nv))
        return nv
      })
      setFocusedComposer(composerKey)
      ref.current?.focus()
    })
  }, [composerKey])
  useEffect(() => {
    const el = dropZoneRef.current
    if (!el) return
    return registerDropTarget({ el, accepts: "file", onDrop: (path) => onDropPathsRef.current([path]) })
  }, [])

  function trySend() {
    const body = text.trim()
    const imgs = images
    const refs = fileRefs
    const pdfList = pdfs
    if (disabled || compacting) return
    if (!body && imgs.length === 0 && refs.length === 0 && pdfList.length === 0) return
    if (body) pushPrompt(body)
    if (onRemember && body.startsWith("#") && body.slice(1).trim()) {
      commitRemember("project")
      return
    }
    if (streaming) {
      if (
        onQueue &&
        body &&
        !body.startsWith("/") &&
        imgs.length === 0 &&
        refs.length === 0 &&
        pdfList.length === 0
      ) {
        onQueue(body)
        setText("")
      }
      return
    }
    const slash = body ? parseSlashInput(body) : null
    if (slash) {
      const cmd = allCommands.find((c) => c.name === slash.name)
      if (cmd) {
        if (cmd.scope === "builtin" && cmd.action) {
          onSlashAction?.(cmd.action, slash.args)
          setText("")
          setImages([])
          return
        }
        if (cmd.scope === "mcp" && cmd.mcpServer && cmd.mcpPrompt) {
          void runMcpPrompt(cmd.mcpServer, cmd.mcpPrompt)
          setText("")
          setImages([])
          return
        }
        if (cmd.scope === "workflow" && cmd.path) {
          onSlashAction?.("workflow-run", JSON.stringify({ path: cmd.path, args: slash.args }))
          setText("")
          setImages([])
          return
        }
        if (cmd.template !== undefined) {
          dispatchTemplateCommand(cmd, slash.args)
          setText("")
          setImages([])
          return
        }
      }
    }
    setText("")
    setImages([])
    setFileRefs([])
    setPdfs([])
    if (
      imgs.length > 0 &&
      !modelAcceptsImages(
        settings.providerCatalog?.data as ProvidersCatalog | undefined,
        provider,
        model ?? "",
      )
    ) {
      toast.info(t("composer.imageUnsupported"))
    }
    if (
      pdfList.length > 0 &&
      !modelAcceptsPdf(
        settings.providerCatalog?.data as ProvidersCatalog | undefined,
        provider,
        model ?? "",
      )
    ) {
      toast.info(t("composer.pdfFallbackNote"))
    }
    onSend(
      body,
      imgs.length ? imgs : undefined,
      undefined,
      undefined,
      refs.length ? refs : undefined,
      pdfList.length ? pdfList : undefined,
    )
  }

  function pushUndo(val: string) {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => {
      const stack = undoStack.current
      const idx = undoIdx.current
      const trimmed = stack.slice(0, idx + 1)
      if (trimmed[trimmed.length - 1] === val) return
      undoStack.current = [...trimmed, val]
      undoIdx.current = trimmed.length
    }, 300)
  }

  function performUndo() {
    if (undoTimer.current) { clearTimeout(undoTimer.current); undoTimer.current = null }
    const idx = undoIdx.current
    if (idx <= 0) return
    undoIdx.current = idx - 1
    setText(undoStack.current[idx - 1]!)
  }

  function performRedo() {
    if (undoTimer.current) { clearTimeout(undoTimer.current); undoTimer.current = null }
    const idx = undoIdx.current
    if (idx >= undoStack.current.length - 1) return
    undoIdx.current = idx + 1
    setText(undoStack.current[idx + 1]!)
  }

  async function openInExternalEditor() {
    if (!text.trim()) return
    try {
      const editors = await detectEditors()
      if (editors.length === 0) {
        toast.error(t("composer.externalEditorNotFound"))
        return
      }
      const dir = await appDataDir()
      const path = await joinPath(dir, "composer-draft.md")
      await writeTextFileSafe(path, text)
      const unwatch = await watchFile(path, () => {
        void readTextFileSafe(path)
          .then((t2) => {
            setText(t2)
            queueMicrotask(() => pushUndo(t2))
          })
          .catch(() => {})
      })
      await openInEditor(editors[0]!, path)
      setTimeout(() => unwatch(), 300_000)
    } catch {
      toast.error(t("composer.externalEditorFailed"))
    }
  }

  const vim = useVim({
    enabled: settings.vimMode === true,
    textareaRef: ref,
    text,
    setText,
    onEnter: trySend,
    onUndo: performUndo,
    menuOpen: (slashOpen && filteredCount > 0) || (mentionState.open && mentionFilteredCount > 0),
  })

  // (her stream frame'inde re-render tetikliyordu).
  const tokenCount = effectiveTok ?? lastInputTok ?? 0
  const localEff = useLocalRuntimeStore((s) => (model ? s.effectiveCtx[model] : undefined))
  const localWin = resolveLocalLlm(settings, model ?? "").contextWindow
  const contextCapValue = resolveContextCap(
    settings.providerCatalog?.data as ProvidersCatalog | undefined,
    provider,
    model ?? "",
    localEff && localEff > 0 ? Math.min(localEff, localWin) : localWin,
  )

  const acListboxId =
    slashOpen && filteredCount > 0
      ? "composer-slash-listbox"
      : mentionState.open && mentionFilteredCount > 0
        ? "composer-mention-listbox"
        : undefined
  const acActiveId =
    slashOpen && filteredCount > 0
      ? `composer-slash-opt-${slashIdx}`
      : mentionState.open && mentionFilteredCount > 0
        ? `composer-mention-opt-${mentionIdx}`
        : undefined

  return (
    <footer className={cn("relative z-10 pb-2", inCard ? "bg-codezal-sidebar" : "bg-codezal-bg")}>
      <div
        ref={slashWrapRef}
        className={cn("cz-meta relative mx-auto w-full max-w-[1024px]", inCard ? "px-4" : "px-8")}
      >
        <SlashMenu
          open={slashOpen}
          query={slashState.query}
          commands={allCommands}
          selectedIndex={slashIdx}
          onSelectIndex={setSlashIdx}
          onPick={pickSlash}
        />
        <MentionMenu
          open={mentionState.open}
          query={mentionState.query}
          items={mentionItems}
          selectedIndex={mentionIdx}
          onSelectIndex={setMentionIdx}
          onPick={handlePickMention}
        />
        {hashState.open && (
          <div className="absolute bottom-full left-0 right-0 mb-1 flex items-center gap-2 rounded-md border border-codezal bg-codezal-panel px-3 py-2 shadow-xl">
            <span className="text-sm text-codezal-mute">{t("composer.rememberLabel")}</span>
            <button
              type="button"
              onClick={() => commitRemember("project")}
              className="rounded bg-codezal-chip px-2 py-0.5 text-sm text-codezal-text hover:bg-codezal-panel-2"
            >
              {t("composer.rememberProject")}
            </button>
            <button
              type="button"
              onClick={() => commitRemember("global")}
              className="rounded bg-codezal-chip px-2 py-0.5 text-sm text-codezal-text hover:bg-codezal-panel-2"
            >
              {t("composer.rememberGlobal")}
            </button>
          </div>
        )}
        {suggestionCount > 0 && !streaming && !slashOpen && !mentionState.open && !hashState.open && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("codezal:open-suggestions"))}
            className="absolute bottom-full left-0 right-0 mb-1 flex items-center gap-2 rounded-md border border-codezal bg-codezal-panel px-3 py-1.5 text-sm text-codezal-mute shadow-xl hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-codezal-accent" />
            <span className="truncate">{t("composer.suggestionsNudge", { count: suggestionCount })}</span>
            <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" />
          </button>
        )}
        {goal && goalSid && (
          <GoalCard
            goal={goal}
            onEdit={() => setGoalModal({ open: true, mode: "edit" })}
            onPause={() => pauseGoalFor(goalSid)}
            onResume={() => {
              resumeGoalFor(goalSid)
              if (!streaming) void onSend("Continue.")
            }}
            onDelete={() => clearGoalFor(goalSid)}
          />
        )}
      <div
        ref={dropZoneRef}
        className="relative rounded-2xl border border-codezal-strong bg-codezal-input shadow-[0_4px_24px_-6px_rgba(0,0,0,0.14)]"
        // Finder drop → Tauri native event (composer-drop); ContextPanel drag →
        onDragOver={(e) => {
          if ((e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault()
        }}
        onDrop={(e) => {
          if (e.dataTransfer?.files?.length) {
            e.preventDefault()
            void addFiles(e.dataTransfer.files)
          }
        }}
      >
        {histOpen && (
          <PromptHistorySearch
            onSelect={(t) => {
              setText(t)
              setHistOpen(false)
            }}
            onClose={() => setHistOpen(false)}
          />
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            void addFiles(e.target.files)
            e.target.value = ""
          }}
        />
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {images.map((im, i) => (
              <div key={im.id} className="group/thumb relative">
                <button
                  type="button"
                  onClick={() => setImgLightbox(i)}
                  title={t("a11y.attachedImage")}
                  className="block cursor-zoom-in"
                >
                  <StoredImage
                    image={im}
                    alt={im.name || t("a11y.attachedImage")}
                    className="h-16 w-16 rounded-lg border border-codezal-hair object-cover"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => removeImage(im.id)}
                  title={t("common.remove")}
                  aria-label={t("common.remove")}
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-codezal-hair bg-codezal-bg text-codezal-dim opacity-0 transition group-hover/thumb:opacity-100 hover:text-codezal-text"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
        {imgLightbox !== null && images[imgLightbox] && (
          <ImageLightbox
            images={images}
            index={imgLightbox}
            onIndex={setImgLightbox}
            onClose={() => setImgLightbox(null)}
          />
        )}
        {fileRefs.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {fileRefs.map((f) => (
              <div
                key={f.id}
                className="group/file relative flex items-center gap-2 rounded-lg border border-codezal-hair bg-codezal-chip py-1.5 pl-2 pr-7 text-sm text-codezal-text"
                title={f.path}
              >
                {f.isDir ? (
                  <Folder className="h-4 w-4 shrink-0 text-codezal-accent" aria-hidden />
                ) : (
                  <FileIcon className="h-4 w-4 shrink-0 text-codezal-mute" aria-hidden />
                )}
                <span className="max-w-[160px] truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeFileRef(f.id)}
                  title={t("common.remove")}
                  aria-label={t("common.remove")}
                  className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-codezal-dim opacity-0 transition group-hover/file:opacity-100 hover:text-codezal-text"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
        {pdfs.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {pdfs.map((p) => (
              <div
                key={p.id}
                className="group/pdf relative flex items-center gap-2 rounded-lg border border-codezal-hair bg-codezal-chip py-1.5 pl-2 pr-7 text-sm text-codezal-text"
                title={p.name}
              >
                <FileText className="h-4 w-4 shrink-0 text-codezal-accent" aria-hidden />
                <span className="max-w-[160px] truncate">{p.name}</span>
                {p.pages ? (
                  <span className="shrink-0 text-sm text-codezal-dim">
                    {t("composer.pdfPages", { n: String(p.pages) })}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => removePdf(p.id)}
                  title={t("common.remove")}
                  aria-label={t("common.remove")}
                  className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-codezal-dim opacity-0 transition group-hover/pdf:opacity-100 hover:text-codezal-text"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
        {queued && queued.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {queued.map((qm, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onUnqueue?.(i)}
                title={`${qm}\n(${t("common.remove")})`}
                className="group/q flex max-w-[240px] items-center gap-1 rounded-md border border-codezal-hair bg-codezal-chip py-1 pl-2 pr-1.5 text-sm text-codezal-dim hover:border-destructive/40 hover:text-destructive"
              >
                <span className="text-codezal-mute" aria-hidden>⏳</span>
                <span className="truncate">{qm}</span>
                <X className="h-3 w-3 shrink-0 opacity-60 group-hover/q:opacity-100" aria-hidden />
              </button>
            ))}
          </div>
        )}
        <div className="relative min-h-[56px] px-4 pb-2 pt-3.5">
          <div
            ref={mirrorRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 select-none overflow-hidden whitespace-pre-wrap break-words px-4 pb-2 pt-3.5 text-md leading-[1.5] text-codezal-text"
          >
            {highlightSegments(text, validNames).map((s, i) =>
              s.cmd ? (
                <span key={i} className="text-codezal-cmd">
                  {s.text}
                </span>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
            {"\n"}
          </div>
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => { setText(e.target.value); pushUndo(e.target.value) }}
            onScroll={(e) => {
              if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop
            }}
            onFocus={() => setFocusedComposer(composerKey)}
            onPaste={(e) => {
              const items = e.clipboardData?.items
              if (!items) return
              const all = Array.from(items)
                .filter((it) => it.kind === "file")
                .map((it) => it.getAsFile())
                .filter((f): f is File => f !== null)
              if (all.length === 0) return
              const imgs = all.filter((f) => f.type.startsWith("image/"))
              const pdfFiles = all.filter((f) => f.type === "application/pdf" || isPdf(f.name))
              const others = all.filter(
                (f) =>
                  !f.type.startsWith("image/") &&
                  f.type !== "application/pdf" &&
                  !isPdf(f.name),
              )
              e.preventDefault()
              if (imgs.length) void addFiles(imgs)
              if (pdfFiles.length) void addPdfFiles(pdfFiles)
              if (others.length) void addPastedTextFiles(others)
            }}
            onKeyDown={(e) => {
              if (vim.onKeyDown(e)) return
              if (e.ctrlKey && e.key === "r") {
                e.preventDefault()
                setHistOpen(true)
                return
              }
              if (slashOpen && filteredCount > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setSlashIdx((i) => (i + 1) % filteredCount)
                  return
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setSlashIdx((i) => (i - 1 + filteredCount) % filteredCount)
                  return
                }
                if (e.key === "Tab" || e.key === "Enter") {
                  e.preventDefault()
                  const filtered = filterCommands(allCommands, slashState.query)
                  const pick = filtered[slashIdx]
                  if (pick) pickSlash(pick)
                  return
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  setText(slashState.start >= 0 ? text.slice(0, slashState.start) : "")
                  return
                }
              }
              if (mentionState.open && mentionFilteredCount > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setMentionIdx((i) => (i + 1) % mentionFilteredCount)
                  return
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setMentionIdx((i) => (i - 1 + mentionFilteredCount) % mentionFilteredCount)
                  return
                }
                if (e.key === "Tab" || e.key === "Enter") {
                  e.preventDefault()
                  const filtered = filterMentions(mentionItems, mentionState.query)
                  const pick = filtered[mentionIdx]
                  if (pick) handlePickMention(pick)
                  return
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  setText(text.slice(0, mentionState.start))
                  return
                }
              }
              if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
                e.preventDefault()
                performUndo()
                return
              }
              if (
                ((e.key === "y" || e.key === "Y") && (e.ctrlKey || e.metaKey)) ||
                ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && e.shiftKey)
              ) {
                e.preventDefault()
                performRedo()
                return
              }
              if ((e.key === "g" || e.key === "G") && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void openInExternalEditor()
                return
              }
              // ikinci ESC durdurur).
              if (e.key === "Escape" && streaming) {
                e.preventDefault()
                onAbort()
                return
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                trySend()
              }
            }}
            placeholder={placeholder ?? t("composer.defaultPlaceholder")}
            aria-label={placeholder ?? t("composer.defaultPlaceholder")}
            role={acListboxId ? "combobox" : undefined}
            aria-expanded={acListboxId ? true : undefined}
            aria-controls={acListboxId}
            aria-activedescendant={acActiveId}
            aria-autocomplete={acListboxId ? "list" : undefined}
            rows={1}
            disabled={disabled}
            className="relative z-[1] block w-full resize-none overflow-hidden bg-transparent text-md leading-[1.5] text-transparent caret-codezal-text placeholder:text-codezal-mute focus:outline-none disabled:opacity-50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 pr-12 pt-1.5">
          <AttachMenu
            onPickFile={() => fileInputRef.current?.click()}
            onPickFolder={() => void pickFolderAttachment()}
            agentMode={mode}
            onAgentModeChange={applyMode}
            onOpenOrchestra={onOpenOrchestra}
            onOpenGoal={() => setGoalModal({ open: true, mode: goal ? "edit" : "new" })}
          />

          <button
            type="button"
            onClick={() => void onEnhance()}
            disabled={enhancing || !text.trim()}
            title={t("composer.enhance")}
            aria-label={t("composer.enhance")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-codezal-mute transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Sparkles className={cn("h-4 w-4", enhancing && "animate-pulse text-codezal-accent")} />
          </button>

          {settings.vimMode && (
            <span
              className={cn(
                "select-none rounded px-1.5 py-0.5 font-mono text-sm font-semibold uppercase tracking-wide",
                vim.mode === "normal"
                  ? "bg-codezal-accent/15 text-codezal-accent"
                  : "bg-codezal-chip text-codezal-mute",
              )}
              title="Vim modu"
            >
              {vim.mode}
            </span>
          )}

          <div className="flex-1" />

          <ModelPicker
            providerId={(provider ?? settings.defaultProvider) as ProviderId}
            modelId={model ?? settings.defaultModel}
            catalog={settings.providerCatalog?.data as ProvidersCatalog | undefined}
            onPickProvider={(id, sessionOnly) => {
              const defaultModel = defaultModelFor(
                id,
                settings.providerCatalog?.data as ProvidersCatalog | undefined,
              )
              if (hasActive) applyMeta({ provider: id, model: defaultModel, reasoningEffort: undefined })
              else void updateSettings({ defaultProvider: id, defaultModel })
              if (hasActive && !effIsDraft && workspacePath && !sessionOnly) {
                void setProjectMeta(workspacePath, { defaultProvider: id, defaultModel })
              }
            }}
            onPickModel={(m, sessionOnly) => {
              if (hasActive) applyMeta({ model: m, reasoningEffort: undefined })
              else void updateSettings({ defaultModel: m })
              if (hasActive && !effIsDraft && workspacePath && !sessionOnly) {
                const prov = (provider ?? settings.defaultProvider) as ProviderId
                void setProjectMeta(workspacePath, { defaultProvider: prov, defaultModel: m })
              }
            }}
            canScopeToSession={hasActive && !effIsDraft && !!workspacePath}
          />

          {supportsReasoning && (
            <EffortMenu efforts={efforts} value={shownEffort} onChange={setEffort} />
          )}
        </div>

        {streaming ? (
          <button
            type="button"
            onClick={onAbort}
            title={t("composer.stop")}
            aria-label={t("composer.stop")}
            className="group/stop absolute bottom-2 right-2 flex h-[26px] w-[30px] items-center justify-center rounded-lg bg-codezal-accent/10 text-codezal-accent hover:bg-destructive/15 hover:text-destructive"
          >
            <svg
              aria-hidden
              className="absolute inset-0 h-full w-full animate-spin-slow"
              viewBox="0 0 28 28"
              fill="none"
            >
              <circle
                cx="14"
                cy="14"
                r="11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeOpacity="0.25"
              />
              <circle
                cx="14"
                cy="14"
                r="11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="18 100"
              />
            </svg>
            <span className="relative z-10 inline-flex h-2 w-2 rounded-[2px] bg-current transition-transform group-hover/stop:scale-110" />
          </button>
        ) : (
          <button
            type="button"
            onClick={trySend}
            disabled={(!text.trim() && images.length === 0 && fileRefs.length === 0 && pdfs.length === 0) || disabled || compacting}
            title={t("composer.sendHint")}
            aria-label={t("composer.send")}
            className={cn(
              "absolute bottom-2 right-2 z-10 flex h-[26px] w-[30px] items-center justify-center rounded-lg transition-colors",
              (!text.trim() && images.length === 0 && fileRefs.length === 0 && pdfs.length === 0) || disabled || compacting
                ? "border border-codezal bg-codezal-panel-2 text-codezal-mute"
                : "border border-codezal-strong bg-codezal-panel-2 text-codezal-text shadow-sm hover:bg-codezal-chip",
            )}
          >
            <Send className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2 px-1 text-sm text-codezal-mute">
        {msgCount === 0 && (
          <WorkspacePicker
            current={hasActive ? workspacePath : settings.defaultWorkspacePath}
            onPick={(p) => {
              if (hasActive) applyMeta({ workspacePath: p })
              void updateSettings({ defaultWorkspacePath: p })
            }}
            onPickNew={pickWorkspace}
            onClear={() => {
              if (hasActive) applyMeta({ workspacePath: undefined })
              void updateSettings({ defaultWorkspacePath: undefined })
            }}
          />
        )}
        {(hasActive ? workspacePath : settings.defaultWorkspacePath) && (
          <BranchPicker workspace={hasActive ? workspacePath : settings.defaultWorkspacePath} />
        )}
        <ApprovalModeMenu
          mode={approvalMode}
          onChange={(m) => void updateSettings({ approvalMode: m })}
        />
        {(mode === "plan" || mode === "orchestra") && (
          <ModePill agentMode={mode} onExit={() => applyMode("build")} />
        )}
        <span
          className="ml-auto"
          title={t("composer.contextUsedTitle")}
        >
          {formatK(tokenCount)} / {formatK(contextCapValue)}
        </span>
        <span className="flex items-center gap-1">{fmtKbd("⌘⏎")}</span>
      </div>
      </div>
      {goalModal.open && goalSid && (
        <GoalModal
          mode={goalModal.mode}
          initialText={goalModal.mode === "edit" ? (goal?.text ?? "") : ""}
          onCancel={() => setGoalModal((m) => ({ ...m, open: false }))}
          onSave={(text) => {
            if (goalModal.mode === "edit") {
              editGoalTextFor(goalSid, text)
            } else {
              setGoalFor(goalSid, text)
              if (!streaming) void onSend(`Start working on the goal. Goal: ${text}`)
            }
            setGoalModal((m) => ({ ...m, open: false }))
          }}
        />
      )}
    </footer>
  )
}

type ApprovalModeOption = {
  value: ApprovalMode
  label: string
  hint: string
  Icon: typeof HandIcon
  danger?: boolean
}

function buildApprovalOptions(
  tt: (k: Parameters<ReturnType<typeof useT>>[0]) => string,
): ApprovalModeOption[] {
  return [
    {
      value: "ask",
      label: tt("composer.approvalAsk"),
      hint: tt("composer.approvalAskHint"),
      Icon: HandIcon,
    },
    {
      value: "auto-review",
      label: tt("composer.approvalAutoReview"),
      hint: tt("composer.approvalAutoReviewHint"),
      Icon: Eye,
    },
    {
      value: "bypass",
      label: tt("composer.approvalBypass"),
      hint: tt("composer.approvalBypassHint"),
      Icon: AlertCircle,
      danger: true,
    },
  ]
}

function ApprovalModeMenu({
  mode,
  onChange,
}: {
  mode: ApprovalMode
  onChange: (m: ApprovalMode) => void
}) {
  const t = useT()
  const { open, setOpen, wrapRef, triggerProps, menuProps } = useMenu()
  const APPROVAL_OPTIONS = buildApprovalOptions(t)
  const current = APPROVAL_OPTIONS.find((o) => o.value === mode) ?? APPROVAL_OPTIONS[0]
  const Icon = current.Icon
  const danger = current.danger
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        {...triggerProps}
        title={current.hint}
        className={cn(
          "flex h-[26px] items-center gap-1.5 rounded-md px-1 text-sm font-medium transition-colors",
          danger
            ? "text-amber-600 hover:text-amber-700 dark:text-amber-500 dark:hover:text-amber-400"
            : "text-codezal-dim hover:text-codezal-text",
        )}
      >
        <Icon
          className={cn("h-4 w-4", danger && "text-amber-600 dark:text-amber-500")}
        />
        <span>{current.label}</span>
        <ChevronDown className="h-2 w-2" />
      </button>
      {open && (
        <div {...menuProps} className="absolute bottom-[32px] left-0 z-50 w-[240px] overflow-hidden cz-menu py-1">
          {APPROVAL_OPTIONS.map((opt) => {
            const active = opt.value === mode
            const OptIcon = opt.Icon
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm",
                  active
                    ? "bg-codezal-panel-2/60 text-codezal-text"
                    : "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
                )}
                title={opt.hint}
              >
                <OptIcon
                  className={cn("h-4 w-4 shrink-0", opt.danger && "text-amber-600 dark:text-amber-500")}
                />
                <span className="flex-1">{opt.label}</span>
                {active && <Check className="h-4 w-4 shrink-0 text-codezal-accent" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ModePill({
  agentMode,
  onExit,
}: {
  agentMode: "plan" | "orchestra"
  onExit: () => void
}) {
  const t = useT()
  const isPlan = agentMode === "plan"
  const Icon = isPlan ? Brain : Music
  const label = isPlan ? t("composer.modePlan") : t("composer.modeOrchestra")
  const hint = isPlan ? t("composer.planModeTitle") : t("composer.orchestraModeTitle")
  return (
    <span
      className="flex h-[26px] items-center gap-1 rounded-md bg-codezal-accent/15 px-1.5 text-sm font-medium text-codezal-accent"
      title={hint}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
      <button
        type="button"
        onClick={onExit}
        className="ml-0.5 rounded p-0.5 text-codezal-accent/70 hover:bg-codezal-accent/20 hover:text-codezal-accent"
        title={t("common.close")}
        aria-label={t("common.close")}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

function useElapsed(createdAt: number): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const totalSec = Math.max(0, Math.floor((now - createdAt) / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}sa ${m}dk ${s}sn`
  if (m > 0) return `${m}dk ${s}sn`
  return `${s}sn`
}

function GoalCard({
  goal,
  onEdit,
  onPause,
  onResume,
  onDelete,
}: {
  goal: SessionGoal
  onEdit: () => void
  onPause: () => void
  onResume: () => void
  onDelete: () => void
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const elapsed = useElapsed(goal.createdAt)
  const paused = goal.paused === true
  return (
    <div className="mb-2 rounded-xl border border-codezal-strong bg-codezal-panel px-3 py-2 shadow-md">
      <div className="flex items-center gap-2 text-sm">
        <Target
          className={cn("h-4 w-4 shrink-0", paused ? "text-codezal-mute" : "text-codezal-accent")}
        />
        <span className={cn("font-medium", paused ? "text-codezal-mute" : "text-codezal-text")}>
          {paused ? t("composer.goalCardPaused") : t("composer.goalCardActive")}
        </span>
        <span className="flex items-center gap-1 text-codezal-mute">
          <ClockClockwise className="h-3 w-3" />
          {elapsed}
        </span>
        <span
          className="text-codezal-mute"
          title={t("composer.goalCardIterTitle", { iter: goal.iter, max: goal.maxIter })}
        >
          {goal.iter}/{goal.maxIter}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={onEdit}
            title={t("composer.goalCardEditTitle")}
            aria-label={t("composer.goalCardEditTitle")}
            className="rounded p-1 text-codezal-mute hover:bg-codezal-panel-2/60 hover:text-codezal-text"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={paused ? onResume : onPause}
            title={paused ? t("composer.goalCardResume") : t("composer.goalCardPause")}
            aria-label={paused ? t("composer.goalCardResume") : t("composer.goalCardPause")}
            className="rounded p-1 text-codezal-mute hover:bg-codezal-panel-2/60 hover:text-codezal-text"
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            title={t("composer.goalCardDeleteTitle")}
            aria-label={t("composer.goalCardDeleteTitle")}
            className="rounded p-1 text-codezal-mute hover:bg-destructive/15 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? t("composer.goalCardCollapse") : t("composer.goalCardExpand")}
            aria-label={expanded ? t("composer.goalCardCollapse") : t("composer.goalCardExpand")}
            className="rounded p-1 text-codezal-mute hover:bg-codezal-panel-2/60 hover:text-codezal-text"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
      </div>
      <p
        className={cn(
          "mt-1 whitespace-pre-wrap text-sm text-codezal-dim",
          !expanded && "line-clamp-2",
        )}
      >
        {goal.text}
      </p>
    </div>
  )
}

function GoalModal({
  mode,
  initialText,
  onCancel,
  onSave,
}: {
  mode: "new" | "edit"
  initialText: string
  onCancel: () => void
  onSave: (text: string) => void
}) {
  const t = useT()
  const [text, setText] = useState(initialText)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const trimmed = text.trim()
  return (
    <Dialog
      onClose={onCancel}
      label={mode === "edit" ? t("composer.goalModalEditTitle") : t("composer.goalModalNewTitle")}
      initialFocus={taRef}
      panelClassName="w-[min(92vw,520px)] rounded-2xl border border-codezal-strong bg-codezal-panel p-4 shadow-xl"
    >
      <div className="flex items-center gap-2">
        <Target className="h-5 w-5 text-codezal-accent" />
        <h2 className="text-md font-semibold text-codezal-text">
          {mode === "edit" ? t("composer.goalModalEditTitle") : t("composer.goalModalNewTitle")}
        </h2>
      </div>
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // ⌘/Ctrl+Enter → kaydet
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && trimmed) {
            e.preventDefault()
            onSave(trimmed)
          }
        }}
        rows={5}
        placeholder={t("composer.goalModalPlaceholder")}
        className="mt-3 w-full resize-y rounded-lg border border-codezal-strong bg-codezal-input px-3 py-2 text-sm text-codezal-text placeholder:text-codezal-mute focus:border-codezal-accent focus:outline-none"
      />
      <p className="mt-2 text-sm text-codezal-mute">{t("composer.goalModalHint")}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-codezal px-3 py-1.5 text-sm text-codezal-dim hover:bg-codezal-panel-2/60 hover:text-codezal-text"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          disabled={!trimmed}
          onClick={() => onSave(trimmed)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm font-medium",
            trimmed
              ? "bg-codezal-accent text-white hover:opacity-90"
              : "cursor-not-allowed bg-codezal-panel-2 text-codezal-mute",
          )}
        >
          {t("common.save")}
        </button>
      </div>
    </Dialog>
  )
}

function AttachMenu({
  onPickFile,
  onPickFolder,
  agentMode,
  onAgentModeChange,
  onOpenOrchestra,
  onOpenGoal,
}: {
  onPickFile: () => void
  onPickFolder: () => void
  agentMode: "build" | "plan" | "orchestra"
  onAgentModeChange: (m: "build" | "plan" | "orchestra") => void
  onOpenOrchestra?: () => void
  onOpenGoal: () => void
}) {
  const t = useT()
  const { open, setOpen, wrapRef, triggerProps, menuProps } = useMenu()
  const planActive = agentMode === "plan"
  const orchestraActive = agentMode === "orchestra"

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        {...triggerProps}
        title={t("common.add")}
        aria-label={t("composer.attach")}
        className="flex h-[26px] shrink-0 items-center justify-center rounded-md border border-codezal px-1.5 text-codezal-dim hover:border-codezal-strong"
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div {...menuProps} className="absolute bottom-[32px] left-0 z-50 w-[260px] overflow-hidden cz-menu py-1">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onPickFile()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <Paperclip className="h-4 w-4 shrink-0" />
            <span className="flex-1">{t("composer.attachFileOrPhoto")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onPickFolder()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <FolderPlus className="h-4 w-4 shrink-0" />
            <span className="flex-1">{t("composer.attachFolder")}</span>
          </button>

          <div className="my-1 border-t border-codezal" />
          <button
            type="button"
            role="menuitemradio"
            aria-checked={planActive}
            onClick={() => {
              onAgentModeChange(planActive ? "build" : "plan")
              setOpen(false)
            }}
            title={t("composer.planMenuHint")}
            className={cn(
              "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm",
              planActive
                ? "bg-codezal-panel-2/60 text-codezal-accent"
                : "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
            )}
          >
            <Brain className={cn("h-4 w-4 shrink-0", planActive && "text-codezal-accent")} />
            <span className="flex-1">{t("composer.planMode")}</span>
            {planActive && <Check className="h-4 w-4 shrink-0 text-codezal-accent" />}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={orchestraActive}
            onClick={() => {
              setOpen(false)
              if (orchestraActive) onAgentModeChange("build")
              else onOpenOrchestra?.()
            }}
            title={t("composer.orchestraMenuHint")}
            className={cn(
              "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm",
              orchestraActive
                ? "bg-codezal-panel-2/60 text-codezal-accent"
                : "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
            )}
          >
            <Music className={cn("h-4 w-4 shrink-0", orchestraActive && "text-codezal-accent")} />
            <span className="flex-1">
              {orchestraActive ? t("composer.orchestraModeClose") : t("composer.modeOrchestra")}
            </span>
            {orchestraActive && <Check className="h-4 w-4 shrink-0 text-codezal-accent" />}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onOpenGoal()
            }}
            title={t("composer.goalMenuHint")}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <Target className="h-4 w-4 shrink-0" />
            <span className="flex-1">{t("composer.modeGoal")}</span>
          </button>
        </div>
      )}
    </div>
  )
}

function EffortMenu({
  efforts,
  value,
  onChange,
}: {
  efforts: ReasoningEffort[]
  value: ReasoningEffort
  onChange: (e: ReasoningEffort) => void
}) {
  const t = useT()
  const { open, setOpen, wrapRef, triggerProps, menuProps } = useMenu()

  const labelFor = (e: ReasoningEffort) =>
    ({
      off: t("composer.effortOff"),
      low: t("composer.effortLow"),
      medium: t("composer.effortMedium"),
      high: t("composer.effortHigh"),
      max: t("composer.effortMax"),
    })[e]

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        {...triggerProps}
        title={t("composer.effortTitle")}
        aria-label={t("composer.effortLabel")}
        className="flex h-[30px] shrink-0 items-center gap-[7px] whitespace-nowrap rounded-lg border border-transparent px-[9px] text-base font-medium text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
      >
        <Brain className="h-3.5 w-3.5" />
        <span className="cz-meta-label">{labelFor(value)}</span>
        <ChevronDown className="h-2 w-2" />
      </button>
      {open && (
        <div {...menuProps} className="absolute bottom-[32px] right-0 z-50 w-[160px] overflow-hidden cz-menu py-1">
          {efforts.map((e) => {
            const active = e === value
            return (
              <button
                key={e}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(e)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm",
                  active
                    ? "bg-codezal-panel-2/60 text-codezal-text"
                    : "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
                )}
              >
                <span className="flex-1">{labelFor(e)}</span>
                {active && <Check className="h-4 w-4 shrink-0 text-codezal-accent" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Chip — forwardRef + rest spread: useMenu triggerProps (ref + aria-haspopup/expanded
const Chip = forwardRef<
  HTMLButtonElement,
  {
    children: React.ReactNode
    accent?: boolean
    mono?: boolean
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function Chip({ children, accent, mono, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cn(
        "flex h-[30px] shrink-0 items-center gap-[7px] whitespace-nowrap rounded-lg border px-[9px] text-base font-medium",
        accent
          ? "border-transparent text-codezal-accent"
          : "border-transparent text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
        mono && "text-sm",
        className,
      )}
    >
      {children}
    </button>
  )
})

function WorkspacePicker({
  current,
  onPick,
  onPickNew,
  onClear,
}: {
  current?: string
  onPick: (path: string) => void
  onPickNew: () => Promise<void>
  onClear: () => void
}) {
  const t = useT()
  const knownProjects = useSessionsStore((s) => s.projects)
  const { open, setOpen, wrapRef, triggerProps, menuRef, onMenuKeyDown } = useMenu()
  const [q, setQ] = useState("")

  const projects = knownProjects

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return projects
    return projects.filter((p) => basename(p).toLowerCase().includes(t) || p.toLowerCase().includes(t))
  }, [projects, q])

  return (
    <div ref={wrapRef} className="relative">
      <Chip {...triggerProps} title={current ?? t("composer.pickProject")}>
        <Folder className="h-3.5 w-3.5" />
        <span className="cz-meta-label">{basename(current) || t("composer.pickProject")}</span>
        <ChevronDown className="h-2 w-2" />
      </Chip>
      {open && (
        <div ref={menuRef} onKeyDown={onMenuKeyDown} className="absolute bottom-[32px] left-0 z-50 w-[280px] cz-menu">
          <div className="border-b border-codezal-hair p-1.5">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("composer.searchProject")}
              className="w-full bg-transparent px-1.5 py-1 text-sm text-codezal-text placeholder:text-codezal-mute outline-none"
            />
          </div>
          <div className="max-h-[240px] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-2.5 py-2 text-sm text-codezal-mute">
                {projects.length === 0 ? t("composer.noProjects") : t("common.noResults")}
              </div>
            )}
            {filtered.map((p) => (
              <button
                key={p}
                type="button"
                aria-current={p === current ? "true" : undefined}
                onClick={() => {
                  onPick(p)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-sm",
                  p === current
                    ? "bg-codezal-panel-2/60 text-codezal-text"
                    : "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
                )}
                title={p}
              >
                <Folder className="h-3.5 w-3.5 shrink-0 text-codezal-mute" />
                <span className="truncate">{basename(p)}</span>
                {p === current && <span className="ml-auto text-codezal-accent">✓</span>}
              </button>
            ))}
          </div>
          <div className="border-t border-codezal-hair py-1">
            <button
              type="button"
              onClick={() => {
                onClear()
                setOpen(false)
              }}
              className={cn(
                "flex w-full items-center gap-1.5 px-2.5 py-1 text-sm",
                current
                  ? "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
                  : "bg-codezal-panel-2/60 text-codezal-text",
              )}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-codezal-mute" />
              <span>{t("composer.chatOnly")}</span>
              {!current && <span className="ml-auto text-codezal-accent">✓</span>}
            </button>
            <button
              type="button"
              onClick={async () => {
                await onPickNew()
                setOpen(false)
              }}
              className="flex w-full items-center gap-1.5 px-2.5 py-1 text-sm text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              {t("composer.addNewProject")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ModelPicker({
  providerId,
  modelId,
  catalog,
  onPickProvider,
  onPickModel,
  canScopeToSession,
}: {
  providerId: ProviderId
  modelId: string
  catalog: ProvidersCatalog | undefined
  onPickProvider: (id: ProviderId, sessionOnly?: boolean) => void
  onPickModel: (m: string, sessionOnly?: boolean) => void
  canScopeToSession?: boolean
}) {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const { open, setOpen, wrapRef, menuRef, onMenuKeyDown } = useMenu()
  const [q, setQ] = useState("")
  // Selected provider in the popover. `null` means "follow the committed
  // providerId"; lets the user browse another provider's models without
  // committing the switch until they pick one. Reset to null whenever the
  // popover closes (handled in the event handlers, not an effect, to avoid
  // setState-in-effect).
  const [browseTab, setBrowseTab] = useState<ProviderId | null>(null)
  const activeTab = browseTab ?? providerId

  function closePopover() {
    setOpen(false)
    setBrowseTab(null)
    setQ("")
  }


  // Connected providers only — the model picker should never offer a
  // provider the user has no credentials for. Sort: popular first, then
  // alphabetical. Env fallback counts as connected, so probe env vars.
  // settings.customProviders is a dep so custom (user-defined) providers appear
  // here after being added — they live in the registry's module state, synced
  // by the settings store before this re-render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const adapters = useMemo(() => listProviderAdapters(catalog), [catalog, settings.customProviders])
  const [envHits, setEnvHits] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!open) return
    const unique = Array.from(new Set(adapters.flatMap((p) => p.envVars)))
    if (unique.length === 0) return
    void probeEnvVars(unique).then(setEnvHits)
  }, [open, adapters])
  const connected = useMemo(
    () =>
      adapters
        .filter((p) => isConnectedSync(p, settings, envHits))
        .sort((a, b) => {
          if (Boolean(a.popular) !== Boolean(b.popular)) return a.popular ? -1 : 1
          return a.label.localeCompare(b.label)
        }),
    [adapters, settings, envHits],
  )

  // Use the tab provider for the model list. If the user clicked a tab
  // without committing, this lets them search within it.
  const models = useMemo(
    () => modelsFor(activeTab, catalog, settings.modelStatus),
    [activeTab, catalog, settings.modelStatus],
  )
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return models
    return models.filter((m) => {
      if (m.toLowerCase().includes(needle)) return true
      const name = modelDetail(catalog, activeTab, m)?.name
      return Boolean(name && name.toLowerCase().includes(needle))
    })
  }, [models, q, catalog, activeTab])

  const [hovered, setHovered] = useState(false)
  const detail = modelDetail(catalog, providerId, modelId)
  const activeDisplay = detail?.name || displayModelName(modelId)
  const ctxCap = resolveContextCap(catalog, providerId, modelId, resolveLocalLlm(settings, modelId).contextWindow)
  const ctxLabel = ctxCap >= 1_000_000
    ? `${ctxCap / 1_000_000}M`
    : ctxCap >= 1_000
      ? `${Math.round(ctxCap / 1_000)}K`
      : String(ctxCap)

  return (
    <div ref={wrapRef} className="relative">
      {hovered && !open && (
        <div className="absolute bottom-[34px] right-0 z-50 w-56 rounded-lg border border-codezal-strong bg-codezal-panel p-2.5 shadow-lg text-sm text-codezal-dim pointer-events-none">
          <div className="mb-1.5 font-medium text-codezal-text">{detail?.name ?? displayModelName(modelId)}</div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-codezal-mute">Context</span>
              <span>{ctxLabel} tokens</span>
            </div>
            {detail?.cost?.input != null && (
              <div className="flex justify-between">
                <span className="text-codezal-mute">Input / 1M</span>
                <span>${+detail.cost.input.toFixed(3)}</span>
              </div>
            )}
            {detail?.cost?.output != null && (
              <div className="flex justify-between">
                <span className="text-codezal-mute">Output / 1M</span>
                <span>${+detail.cost.output.toFixed(3)}</span>
              </div>
            )}
            {(detail?.reasoning || detail?.tool_call || detail?.modalities?.input?.includes("image")) && (
              <div className="mt-0.5 flex gap-1.5 flex-wrap">
                {detail?.reasoning && (
                  <span className="rounded bg-codezal-panel-2 px-1.5 py-px">reasoning</span>
                )}
                {detail?.tool_call && (
                  <span className="rounded bg-codezal-panel-2 px-1.5 py-px">tools</span>
                )}
                {detail?.modalities?.input?.includes("image") && (
                  <span className="rounded bg-codezal-panel-2 px-1.5 py-px">vision</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? closePopover() : setOpen(true))}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex h-[30px] items-center gap-[7px] rounded-lg border border-transparent px-[9px] text-base font-medium text-codezal-text hover:bg-codezal-panel-2"
      >
        <span className="max-w-[180px] truncate">{activeDisplay}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-codezal-mute" />
      </button>
      {open && (
        <div ref={menuRef} onKeyDown={onMenuKeyDown} className="absolute bottom-[32px] right-0 z-50 w-[420px] overflow-hidden cz-menu">
          {connected.length === 0 ? (
            <div className="px-3 py-3 text-sm text-codezal-mute">
              {t("composer.noProvidersConnected")}
            </div>
          ) : (
            <>
              {/* Search bar spans the full width — searches model names + ids
                  within the active provider. */}
              <div className="flex items-center gap-2 border-b border-codezal-hair px-2.5 py-1.5">
                <Search className="h-4 w-4 shrink-0 text-codezal-mute" aria-hidden />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("composer.searchModel")}
                  className="w-full bg-transparent py-0.5 text-sm text-codezal-text outline-none placeholder:text-codezal-mute"
                />
              </div>
              {/* Two-column layout: left = providers (vertical scroll),
                  right = models for the active provider (vertical scroll).
                  Fixed height so the popover doesn't jitter when a provider
                  has only a couple of models — both columns scroll instead. */}
              <div className="flex h-[320px]">
                <div className="w-[140px] shrink-0 overflow-y-auto border-r border-codezal-hair py-1">
                  {connected.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-current={p.id === activeTab ? "true" : undefined}
                      onClick={() => setBrowseTab(p.id)}
                      className={cn(
                        "block w-full truncate px-2.5 py-1 text-left text-sm font-medium transition-colors",
                        p.id === activeTab
                          ? "bg-codezal-accent/15 text-codezal-accent"
                          : "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
                      )}
                      title={p.label}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto py-1">
                  {filtered.length === 0 && (
                    <div className="px-2.5 py-2 text-sm text-codezal-mute">
                      {t("common.noResults")}
                    </div>
                  )}
                  {filtered.map((m) => {
                    const name = modelDetail(catalog, activeTab, m)?.name?.trim()
                    const display = name || displayModelName(m)
                    const isActive = m === modelId && activeTab === providerId
                    return (
                      <button
                        key={m}
                        type="button"
                        aria-current={isActive ? "true" : undefined}
                        onClick={(e) => {
                          const sessionOnly = e.altKey
                          // Switching provider implicitly commits the tab.
                          if (activeTab !== providerId) onPickProvider(activeTab, sessionOnly)
                          onPickModel(m, sessionOnly)
                          closePopover()
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
                          isActive
                            ? "bg-codezal-panel-2/60 text-codezal-text"
                            : "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
                        )}
                        title={m}
                      >
                        <span className="truncate text-sm text-codezal-text">
                          {display}
                        </span>
                        {isActive && (
                          <Check className="ml-auto h-4 w-4 shrink-0 text-codezal-accent" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
              {canScopeToSession && (
                <div className="border-t border-codezal-hair px-2.5 py-1.5 text-sm text-codezal-mute">
                  {t("composer.modelPickDefaultHint", { key: isMacOS() ? "⌥" : "Alt" })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function formatK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M"
  if (n >= 1000) return (n / 1000).toFixed(1) + "K"
  return String(n)
}
