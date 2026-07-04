// Status forward-only ilerler: draft → planned → building → done → verified.
import type { SddStage } from "@/store/types"

export type SddStatus = "draft" | "planned" | "building" | "done" | "verified"

const STATUS_RANK: Record<SddStatus, number> = {
  draft: 0,
  planned: 1,
  building: 2,
  done: 3,
  verified: 4,
}

export type RequirementBlock = {
  id: string // "R-1"
  title: string
  status: SddStatus
  line: number
}

const HEADING_RE = /^(#{2,4})\s+(R-\d+)\b(.*)$/
const STATUS_TOKEN_RE = /\{(draft|planned|building|done|verified)\}/

// requirement.md → R-blok listesi.
export function parseRequirementBlocks(md: string): RequirementBlock[] {
  const lines = md.split("\n")
  const out: RequirementBlock[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i])
    if (!m) continue
    const rest = m[3]
    const statusM = STATUS_TOKEN_RE.exec(rest)
    const status = (statusM?.[1] as SddStatus | undefined) ?? "draft"
    const title = rest.replace(STATUS_TOKEN_RE, "").trim()
    out.push({ id: m[2], title, status, line: i })
  }
  return out
}

// plan.md → `(covers: R-1, R-2)` etiketlerinden kapsanan R-id seti.
export function parseCoveredRequirementIds(planMd: string): Set<string> {
  const ids = new Set<string>()
  const re = /\(covers:\s*([^)]+)\)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(planMd)) !== null) {
    for (const raw of m[1].split(/[,\s]+/)) {
      const id = raw.match(/R-\d+/)?.[0]
      if (id) ids.add(id)
    }
  }
  return ids
}

export function computeCoverage(
  blocks: RequirementBlock[],
  covered: Set<string>,
): { coveredIds: string[]; uncoveredIds: string[] } {
  const coveredIds: string[] = []
  const uncoveredIds: string[] = []
  for (const b of blocks) {
    if (covered.has(b.id)) coveredIds.push(b.id)
    else uncoveredIds.push(b.id)
  }
  return { coveredIds, uncoveredIds }
}

export function setRequirementStatuses(md: string, updates: Record<string, SddStatus>): string {
  if (Object.keys(updates).length === 0) return md
  const lines = md.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i])
    if (!m) continue
    const target = updates[m[2]]
    if (!target) continue
    const statusM = STATUS_TOKEN_RE.exec(m[3])
    const cur = (statusM?.[1] as SddStatus | undefined) ?? "draft"
    if (STATUS_RANK[cur] >= STATUS_RANK[target]) continue // forward-only
    lines[i] = statusM
      ? lines[i].replace(STATUS_TOKEN_RE, `{${target}}`)
      : `${lines[i].trimEnd()} {${target}}`
  }
  return lines.join("\n")
}

export function statusForStage(stage: SddStage): SddStatus | null {
  if (stage === "plan") return "planned"
  if (stage === "build") return "building"
  return null
}
