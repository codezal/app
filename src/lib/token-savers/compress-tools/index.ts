//

import type { ToolSet } from "ai"
import { estimateTextTokens } from "@/lib/tokens"
import { compressProse } from "./prose"

//
export function compactToolDescriptionsInPlace(
  tools: ToolSet,
  countFor?: ReadonlySet<string>,
): number {
  let saved = 0
  for (const [name, t] of Object.entries(tools)) {
    const desc = (t as { description?: unknown }).description
    if (typeof desc !== "string" || !desc.trim()) continue
    const compressed = compressProse(desc)
    if (compressed.length < desc.length) {
      ;(t as { description?: string }).description = compressed
      if (!countFor || countFor.has(name)) {
        saved += Math.max(0, estimateTextTokens(desc) - estimateTextTokens(compressed))
      }
    }
  }
  return saved
}
