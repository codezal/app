import type { ProviderId } from "@/lib/providers"

export type SendOverride = { provider?: ProviderId; model?: string; disallowedTools?: string[] }
