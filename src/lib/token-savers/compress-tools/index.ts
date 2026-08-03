//

import type { ToolSet } from "ai"
import { estimateTextTokens } from "@/lib/tokens"
import { compressProse } from "./prose"

//
// M84: compress on a COPY — the old version mutated tool definitions in place
// with no restore, so a ToolSet handed to (or cached by) another consumer kept
// the mangled descriptions forever once the setting was toggled off. Returns
// the NEW ToolSet (original untouched) plus the token savings.
export function compactToolDescriptions(
  tools: ToolSet,
  countFor?: ReadonlySet<string>,
): { tools: ToolSet; saved: number } {
  const next: ToolSet = { ...tools }
  let saved = 0
  for (const [name, t] of Object.entries(next)) {
    const desc = (t as { description?: unknown }).description
    if (typeof desc !== "string" || !desc.trim()) continue
    const compressed = compressProse(desc)
    if (compressed.length < desc.length) {
      // Only the description changes; keep inputSchema/execute/other refs.
      next[name] = { ...(t as object), description: compressed } as ToolSet[string]
      if (!countFor || countFor.has(name)) {
        saved += Math.max(0, estimateTextTokens(desc) - estimateTextTokens(compressed))
      }
    }
  }
  return { tools: next, saved }
}
