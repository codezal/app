import { create } from "zustand"
import { createId } from "@/lib/id"
import { useSessionsStore } from "./sessions"
import { getEffectiveSettings } from "@/lib/config"
import { scanToolInput, hasCriticalFinding, type SecurityFinding } from "@/lib/security/scan"
import { sensitiveWriteFindings } from "@/lib/security/sensitive-paths"
import { dangerousBashFindings } from "@/lib/security/dangerous-bash"
import { db, loadProjectPermission, saveProjectPermission } from "@/lib/db"
import { evaluate, merge, subjectFor, legacyRulesToRuleset } from "@/lib/permission"
import { defaultsRuleset, modePresetRuleset, agentModeRuleset } from "@/lib/permission/presets"
import { permissionKey } from "@/lib/permission-keys"
import type { PermissionRule, Ruleset } from "@/lib/permission/types"
import type { ApprovalDecision, ApprovalReply, ApprovalRule, Settings, Session } from "./types"

export type { ApprovalDecision, ApprovalReply, ApprovalRule } from "./types"

export type ApprovalRequest = {
  id: string
  tool: string
  input: unknown
  sessionId?: string
  runId?: string
  agentId?: string
  workerLabel?: string
  // Pre-write security scan findings (write_file/edit_file). Present when the
  // scan surfaced leaked credentials or risky patterns in the proposed content;
  // rendered as a banner in the modal. A critical finding is what forced this
  // request to the modal in the first place (escalation).
  findings?: SecurityFinding[]
  resolve: (d: ApprovalDecision) => void
}

type ApprovalsState = {
  queue: ApprovalRequest[]
  bypassWorkerIds: Set<string>
  projectApproved: Record<string, PermissionRule[]>
  request: (
    tool: string,
    input: unknown,
    opts?: {
      workerId?: string
      workerLabel?: string
      sessionId?: string
      runId?: string
      agentId?: string
    },
  ) => Promise<ApprovalDecision>
  decide: (id: string, reply: ApprovalReply) => void
  addBypassWorker: (workerId: string) => void
  removeBypassWorker: (workerId: string) => void
  clearBypassWorkers: () => void
  loadProjectApproved: (wsPath: string) => Promise<void>
  setProjectApproved: (wsPath: string, rules: PermissionRule[]) => void
  appendProjectApproved: (wsPath: string, rule: PermissionRule) => void
  removeProjectApprovedAt: (wsPath: string, idx: number) => void
}

export const useApprovalsStore = create<ApprovalsState>((set, get) => ({
  queue: [],
  bypassWorkerIds: new Set<string>(),
  projectApproved: {},

  request: async (tool, input, opts) => {
    const sessions = useSessionsStore.getState()
    const session = opts?.sessionId ? sessions.sessions[opts.sessionId] : sessions.active
    const wsPath = session?.workspacePath
    const settings = getEffectiveSettings(wsPath)

    // Pre-write/exec security gate. Three critical classes ESCALATE — they force
    // the approval modal even when the mode, a rule, OR a worker-YOLO bypass would
    // auto-approve, because each is irreversible or destructive:
    //   1. scanToolInput — leaked secrets in the NEW content (write/edit/patch).
    //   2. sensitiveWriteFindings — the write DESTINATION can execute code (shell
    //      rc, Git config/hooks, build-tool configs).
    //   3. dangerousBashFindings — destructive/exfiltration bash (rm -rf / or
    //      $HOME, dd/mkfs, fork bomb, curl|sh, piping data to the network). Under
    //      the default "bypass" mode bash is otherwise auto-run with no check.
    // Computed BEFORE the YOLO bypass so a YOLO worker can't silently run a
    // destructive command that a bypass-mode session would have to confirm.
    // Warnings are attached for display only and never change the flow.
    const findings =
      settings.securityScan !== false
        ? [
            ...scanToolInput(tool, input),
            ...sensitiveWriteFindings(tool, input),
            ...dangerousBashFindings(tool, input),
          ]
        : []
    const critical = hasCriticalFinding(findings)

    const bypassIds = get().bypassWorkerIds
    const selfId = opts?.workerId ?? opts?.sessionId
    if (selfId && bypassIds.has(selfId) && !critical) {
      return "allow"
    }

    if (wsPath && !(wsPath in get().projectApproved)) {
      await get().loadProjectApproved(wsPath)
    }

    const ruleset = buildEffectiveRuleset(settings, session, get().projectApproved[wsPath ?? ""] ?? [])
    const rule = evaluate(permissionKey(tool), subjectFor(tool, input), ruleset)

    if (!critical) {
      if (rule.action === "allow") return Promise.resolve("allow")
      if (rule.action === "deny") return Promise.resolve("deny")
    } else if (rule.action === "deny") {
      return Promise.resolve("deny")
    }

    return new Promise<ApprovalDecision>((resolve) => {
      const id = createId("approval")
      set((st) => ({
        queue: [
          ...st.queue,
          {
            id,
            tool,
            input,
            sessionId: opts?.sessionId,
            runId: opts?.runId,
            agentId: opts?.agentId,
            workerLabel: opts?.workerLabel,
            findings: findings.length ? findings : undefined,
            resolve,
          },
        ],
      }))
    })
  },

  decide: (id, reply) => {
    const req = get().queue.find((r) => r.id === id)
    if (!req) return

    if (reply === "deny") {
      set((st) => ({ queue: st.queue.filter((r) => r.id !== id) }))
      req.resolve("deny")
      if (req.sessionId) {
        const toReject = get().queue.filter((r) => r.sessionId === req.sessionId)
        if (toReject.length > 0) {
          const ids = new Set(toReject.map((r) => r.id))
          set((st) => ({ queue: st.queue.filter((r) => !ids.has(r.id)) }))
          for (const r of toReject) r.resolve("deny")
        }
      }
      return
    }

    // "once" veya "always" — bu request'e izin ver
    set((st) => ({ queue: st.queue.filter((r) => r.id !== id) }))
    req.resolve("allow")

    if (reply === "always" && req.sessionId) {
      const sessions = useSessionsStore.getState()
      const session = sessions.sessions[req.sessionId] ?? sessions.active
      const wsPath = session?.workspacePath
      const settings = getEffectiveSettings(wsPath)
      const ruleset = buildEffectiveRuleset(settings, session, get().projectApproved[wsPath ?? ""] ?? [])
      const sameSess = get().queue.filter((r) => r.sessionId === req.sessionId)
      const toAutoResolve = sameSess.filter(
        (r) => evaluate(permissionKey(r.tool), subjectFor(r.tool, r.input), ruleset).action === "allow",
      )
      if (toAutoResolve.length > 0) {
        const ids = new Set(toAutoResolve.map((r) => r.id))
        set((st) => ({ queue: st.queue.filter((r) => !ids.has(r.id)) }))
        for (const r of toAutoResolve) r.resolve("allow")
      }
    }
  },

  addBypassWorker: (workerId) => {
    set((st) => {
      const next = new Set(st.bypassWorkerIds)
      next.add(workerId)
      return { bypassWorkerIds: next }
    })
  },

  removeBypassWorker: (workerId) => {
    set((st) => {
      const next = new Set(st.bypassWorkerIds)
      next.delete(workerId)
      return { bypassWorkerIds: next }
    })
  },

  clearBypassWorkers: () => {
    set({ bypassWorkerIds: new Set<string>() })
  },

  loadProjectApproved: async (wsPath) => {
    let rules: PermissionRule[] = []
    try {
      rules = await loadProjectPermission(db, wsPath)
    } catch (e) {
      console.error("[approvals] proje izinleri yüklenemedi:", e)
    }
    set((st) => ({ projectApproved: { ...st.projectApproved, [wsPath]: rules } }))
  },
  setProjectApproved: (wsPath, rules) => {
    set((st) => ({ projectApproved: { ...st.projectApproved, [wsPath]: rules } }))
    void saveProjectPermission(db, wsPath, rules, Date.now()).catch((e) =>
      console.error("[approvals] proje izni kaydedilemedi:", e),
    )
  },
  appendProjectApproved: (wsPath, rule) => {
    const next = [...(get().projectApproved[wsPath] ?? []), rule]
    set((st) => ({ projectApproved: { ...st.projectApproved, [wsPath]: next } }))
    void saveProjectPermission(db, wsPath, next, Date.now()).catch((e) =>
      console.error("[approvals] proje izni kaydedilemedi:", e),
    )
  },
  removeProjectApprovedAt: (wsPath, idx) => {
    const next = (get().projectApproved[wsPath] ?? []).filter((_, i) => i !== idx)
    set((st) => ({ projectApproved: { ...st.projectApproved, [wsPath]: next } }))
    void saveProjectPermission(db, wsPath, next, Date.now()).catch((e) =>
      console.error("[approvals] proje izni kaydedilemedi:", e),
    )
  },
}))

function buildEffectiveRuleset(
  settings: Settings,
  session: Session | null | undefined,
  projectApproved: PermissionRule[],
): Ruleset {
  return merge(
    defaultsRuleset(),
    modePresetRuleset(settings.approvalMode),
    legacyRulesToRuleset(settings.approvalRules),
    settings.permission ?? [],
    agentModeRuleset(session?.mode),
    session?.permission ?? [],
    projectApproved,
  )
}

export function matchRule(
  rules: ApprovalRule[],
  tool: string,
  input: unknown,
): ApprovalDecision | null {
  const rule = evaluate(permissionKey(tool), subjectFor(tool, input), legacyRulesToRuleset(rules))
  if (rule.action === "allow") return "allow"
  if (rule.action === "deny") return "deny"
  return null
}
