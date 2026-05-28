// System-prompt injector for Brief Mode.
// Returns the directive string if Brief Mode is enabled, null otherwise.

import type { BriefModeSettings } from "../types"
import { briefDirective } from "./levels"

export function briefModeSection(s: BriefModeSettings | undefined): string | null {
  if (!s || !s.enabled) return null
  return briefDirective(s.level)
}
