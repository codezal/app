
export type MascotState = "greet" | "idle" | "thinking" | "working" | "sleeping"

export const MASCOT_STATES: readonly MascotState[] = [
  "greet",
  "idle",
  "thinking",
  "working",
  "sleeping",
]

export type MascotCharacter = {
  id: string
  label: string
}

export const MASCOT_NONE = "none"

export const MASCOT_CHARACTERS: readonly MascotCharacter[] = [
  { id: "istanbul-simit", label: "İstanbul Simitçi" },
  { id: "ege-zeybek", label: "Ege Zeybek" },
  { id: "karadeniz-kemence", label: "Karadeniz Kemençe" },
  { id: "kapadokya-balon", label: "Kapadokya Balon" },
  { id: "anadolu-kilim", label: "Anadolu Kilim" },
]

export const DEFAULT_MASCOT = "istanbul-simit"

export function isMascotEnabled(id: string | undefined | null): boolean {
  return !!id && id !== MASCOT_NONE && MASCOT_CHARACTERS.some((c) => c.id === id)
}

export function mascotSrc(characterId: string, state: MascotState): string {
  return `/mascots/${characterId}/${state}.webp`
}
