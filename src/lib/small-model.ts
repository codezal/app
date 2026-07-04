//
import { modelsForProvider, modelDetail, type ProvidersCatalog } from "./providers-catalog"
import type { ProviderId } from "./providers"

const SMALL_MODEL_RE = /\b(nano|flash|lite|mini|haiku|small|fast)\b/

const MONTH_MS = 1000 * 60 * 60 * 24 * 30

type Scored = { id: string; cost: number; age: number; small: boolean }

export function pickSmallModel(
  catalog: ProvidersCatalog | undefined,
  providerId: ProviderId,
): string | null {
  if (!catalog) return null
  const ids = modelsForProvider(catalog, providerId)
  if (ids.length === 0) return null

  const now = Date.now()
  const scored: Scored[] = ids.map((id) => {
    const d = modelDetail(catalog, providerId, id)
    const cost = d?.cost ? (d.cost.input ?? 0) + (d.cost.output ?? 0) : 0
    const rel = d?.release_date ? Date.parse(d.release_date) : NaN
    const age = Number.isFinite(rel) ? (now - rel) / MONTH_MS : 999
    const hay = `${id} ${d?.family ?? ""} ${d?.name ?? ""}`.toLowerCase()
    return { id, cost, age, small: SMALL_MODEL_RE.test(hay) }
  })

  // cost>0 ve <=18 ay: skorlanabilir adaylar (opencode parite).
  const costed = scored.filter((s) => s.cost > 0 && s.age <= 18)

  const pick = (items: Scored[]): string | null => {
    if (items.length === 0) return null
    const maxCost = Math.max(...items.map((i) => i.cost), 0.01)
    const maxAge = Math.max(...items.map((i) => i.age), 0.01)
    const score = (i: Scored) => (i.cost / maxCost) * 0.8 + (i.age / maxAge) * 0.2
    return [...items].sort((a, b) => score(a) - score(b))[0]!.id
  }

  const smallCosted = costed.filter((s) => s.small)
  if (smallCosted.length > 0) return pick(smallCosted)
  if (costed.length > 0) return pick(costed)

  const smallNamed = scored.find((s) => s.small)
  return smallNamed ? smallNamed.id : null
}
