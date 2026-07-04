// First-launch onboarding overlay — 4 screens: welcome + language + mascot,
// connect a provider (slim), workspace + capability toggles, and privacy + start.
// Shown once on first launch (gated by settings.onboardingCompleted in App.tsx)
// and writes the flag on finish/skip so it never reappears. Reuses existing infra
// (providers registry, settings store, workspace picker, Mascot) — no new backend.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react"
import { DEFAULT_MASCOT, MASCOT_CHARACTERS, isMascotEnabled, mascotSrc, type MascotState } from "@/lib/mascots"
import { DEFAULT_APPEARANCE } from "@/lib/theme"
import { useT } from "@/lib/i18n/useT"
import { LOCALES } from "@/lib/i18n"
import { Select } from "@/components/Select"
import { useSettingsStore } from "@/store/settings"
import { listProviderAdapters, defaultModelFor } from "@/lib/providers"
import type { ProviderId } from "@/lib/providers/types"
import type { ProvidersCatalog } from "@/lib/providers-catalog"
import { pickWorkspaceFolder, basename } from "@/lib/workspace"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight, Check, X, FolderOpen, KeyRound, ShieldCheck } from "@/lib/icons"

// Slim provider list — the three most common bring-your-own-key providers.
// Everything else lives behind the "other providers" link → Settings · Models.
const POPULAR_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "google",
  // Anthropic-compatible "coding plan" subscription endpoints (catalog-derived,
  // API-key auth; runtime gating handled in provider-quirks.ts).
  "zai-coding-plan",
  "kimi-for-coding",
  "minimax-coding-plan",
] as const
const TOTAL_STEPS = 4

// Onboarding always shows the default mascot as a branded welcome, even when the
// user has the floating desktop mascot disabled (appearance.mascotCharacter
// "none"). The shared <Mascot> is setting-aware and renders nothing when
// disabled, so render the image directly here.
function OnboardingMascot({ state, size }: { state: MascotState; size: number }): ReactElement {
  const character = useSettingsStore((s) => s.settings.appearance?.mascotCharacter)
  // Show the user's chosen character, falling back to the default when the
  // floating mascot is disabled ("none") so the welcome never has an empty slot.
  const id = character && isMascotEnabled(character) ? character : DEFAULT_MASCOT
  return (
    <img
      src={mascotSrc(id, state)}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      className="mascot-float select-none object-contain"
      style={{ width: size, height: size }}
    />
  )
}

// A single capability toggle row for the workspace step.
function CapabilityRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (next: boolean) => void
}): ReactElement {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-codezal bg-codezal-panel px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-base font-medium text-codezal-text">{label}</div>
        <p className="mt-0.5 text-sm leading-relaxed text-codezal-dim">{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-codezal-accent",
          checked ? "bg-codezal-accent" : "bg-codezal-chip",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 block h-4 w-4 rounded-full bg-white transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  )
}

export function Onboarding(): ReactElement {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const setApiKey = useSettingsStore((s) => s.setApiKey)

  const [step, setStep] = useState(0)

  // Mascot picker (welcome step). Highlight the active character, defaulting when
  // the user has the mascot disabled.
  const appearance = settings.appearance ?? DEFAULT_APPEARANCE
  const currentMascot =
    appearance.mascotCharacter && isMascotEnabled(appearance.mascotCharacter)
      ? appearance.mascotCharacter
      : DEFAULT_MASCOT

  const catalog = settings.providerCatalog?.data as ProvidersCatalog | undefined
  const allProviders = useMemo(() => listProviderAdapters(catalog), [catalog])
  const popularProviders = useMemo(
    () =>
      POPULAR_PROVIDER_IDS.map((id) => allProviders.find((p) => p.id === id)).filter(
        (p): p is NonNullable<typeof p> => !!p,
      ),
    [allProviders],
  )
  const otherProvidersCount = Math.max(0, allProviders.length - popularProviders.length)

  // Provider-connect local state.
  const [selected, setSelected] = useState<ProviderId | null>(null)
  const [keyInput, setKeyInput] = useState("")
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  // Tracked locally so a successful connect shows a checkmark regardless of
  // whether the in-memory apiKeys map mirrors the keychain write.
  const [connected, setConnected] = useState<Set<string>>(
    () => new Set(Object.keys(settings.apiKeys ?? {})),
  )

  async function finish(): Promise<void> {
    // feedbackNoticeSeen folded in — the privacy step already surfaced the crash
    // toggle, so the separate first-launch beta notice is redundant.
    await update({ onboardingCompleted: true, feedbackNoticeSeen: true })
  }

  function next(): void {
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1))
  }
  function back(): void {
    setStep((s) => Math.max(s - 1, 0))
  }

  async function connect(id: ProviderId): Promise<void> {
    const key = keyInput.trim()
    if (!key) return
    setConnecting(true)
    setConnectError(null)
    try {
      await setApiKey(id, key)
      await update({ defaultProvider: id, defaultModel: defaultModelFor(id, catalog) })
      setConnected((prev) => new Set(prev).add(id))
      setSelected(null)
      setKeyInput("")
    } catch (e) {
      setConnectError(errorMessage(e))
    } finally {
      setConnecting(false)
    }
  }

  // Esc closes an open provider-key field — it must NOT skip the whole flow.
  // A stray Escape (e.g. dismissing the native <select> dropdown or cancelling
  // key entry) would otherwise discard onboarding for good. The × in the header
  // is the explicit skip.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && selected) {
        setSelected(null)
        setConnectError(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected])

  // Move focus into the dialog on mount — keyboard users land inside the overlay,
  // not on the shell behind it.
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    cardRef.current?.focus()
  }, [])

  // Focus trap — keep Tab within the dialog (the shell behind stays unreachable).
  function onCardKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "Tab") return
    const root = cardRef.current
    if (!root) return
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null)
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={
          step === 0
            ? t("onboarding.welcome.title")
            : step === 1
              ? t("onboarding.provider.title")
              : step === 2
                ? t("onboarding.workspace.title")
                : t("onboarding.privacy.title")
        }
        tabIndex={-1}
        onKeyDown={onCardKeyDown}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-codezal-hair bg-codezal-bg shadow-2xl outline-none"
      >
        {/* Header — back / step indicator / skip */}
        <div className="relative flex items-center justify-between gap-2 px-5 py-3.5">
          {step > 0 ? (
            <button
              type="button"
              onClick={back}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-base text-codezal-dim hover:text-codezal-text"
            >
              <ChevronLeft className="h-4 w-4" />
              {t("onboarding.back")}
            </button>
          ) : (
            <span className="w-16" />
          )}
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-sm text-codezal-mute">
            {t("onboarding.step", { n: step + 1, total: TOTAL_STEPS })}
          </span>
          <button
            type="button"
            onClick={() => void finish()}
            title={t("onboarding.skip")}
            aria-label={t("onboarding.skip")}
            className="rounded-md p-1.5 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 px-8 pb-2 pt-2">
          {step === 0 && (
            <div className="flex flex-col items-center text-center">
              <div className="mb-1 flex items-center justify-center gap-1.5">
                {MASCOT_CHARACTERS.map((c) => {
                  const active = currentMascot === c.id
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => void update({ appearance: { ...appearance, mascotCharacter: c.id } })}
                      title={c.label}
                      aria-label={c.label}
                      aria-pressed={active}
                      className={cn(
                        "rounded-2xl p-1.5 outline-none transition focus-visible:ring-2 focus-visible:ring-codezal-accent",
                        active ? "bg-codezal-panel-2 ring-2 ring-codezal-accent" : "opacity-50 hover:opacity-100",
                      )}
                    >
                      <img
                        src={mascotSrc(c.id, "idle")}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                        className="h-20 w-20 object-contain"
                      />
                    </button>
                  )
                })}
              </div>
              <h2 className="mt-4 text-2xl font-semibold text-codezal-text">
                {t("onboarding.welcome.title")}
              </h2>
              <p className="mt-2 max-w-md text-base leading-relaxed text-codezal-dim">
                {t("onboarding.welcome.subtitle")}
              </p>
              <div className="mt-6 w-full max-w-xs text-left">
                <label className="mb-1.5 block text-base font-medium text-codezal-text">
                  {t("onboarding.welcome.language")}
                </label>
                <Select
                  value={settings.language ?? "en"}
                  onChange={(code) => void update({ language: code as (typeof LOCALES)[number]["code"] })}
                  options={LOCALES.map((l) => ({ value: l.code, label: l.nativeName }))}
                  wrapperClassName="w-full"
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col">
              <h2 className="text-xl font-semibold text-codezal-text">{t("onboarding.provider.title")}</h2>
              <p className="mt-1.5 text-base leading-relaxed text-codezal-dim">
                {t("onboarding.provider.subtitle")}
              </p>
              <div className="mt-4 flex max-h-[44vh] flex-col gap-2 overflow-y-auto">
                {popularProviders.map((p) => {
                  const isConnected = connected.has(p.id)
                  const isOpen = selected === p.id
                  return (
                    <div
                      key={p.id}
                      className="rounded-lg border border-codezal bg-codezal-panel px-3.5 py-3"
                    >
                      <button
                        type="button"
                        disabled={isConnected}
                        onClick={() => setSelected(isOpen ? null : p.id)}
                        className="flex w-full items-center gap-3 text-left disabled:cursor-default"
                      >
                        <KeyRound className="h-4 w-4 shrink-0 text-codezal-accent" />
                        <span className="flex-1 text-base font-medium text-codezal-text">{p.label}</span>
                        {isConnected ? (
                          <span className="flex items-center gap-1 text-sm text-codezal-accent">
                            <Check className="h-4 w-4" />
                            {t("onboarding.provider.connected")}
                          </span>
                        ) : (
                          <ChevronRight
                            className={cn("h-4 w-4 text-codezal-mute transition-transform", isOpen && "rotate-90")}
                          />
                        )}
                      </button>
                      {isOpen && !isConnected && (
                        <div className="mt-3 flex items-center gap-2">
                          <input
                            type="password"
                            autoFocus
                            value={keyInput}
                            onChange={(e) => setKeyInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void connect(p.id)
                            }}
                            placeholder={t("onboarding.provider.keyPlaceholder", { name: p.label })}
                            className="min-w-0 flex-1 rounded-md border border-codezal bg-codezal-bg px-3 py-2 text-base text-codezal-text"
                          />
                          <button
                            type="button"
                            disabled={connecting || !keyInput.trim()}
                            onClick={() => void connect(p.id)}
                            className="shrink-0 rounded-md bg-codezal-accent px-3.5 py-2 text-base font-medium text-accent-foreground disabled:opacity-50"
                          >
                            {t("onboarding.provider.connect")}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {connectError && <p className="mt-2 text-sm text-destructive">{connectError}</p>}
              {otherProvidersCount > 0 && (
                <p className="mt-4 text-center text-sm leading-relaxed text-codezal-mute">
                  {t("onboarding.provider.more", { count: otherProvidersCount })}
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col">
              <h2 className="text-xl font-semibold text-codezal-text">{t("onboarding.workspace.title")}</h2>
              <p className="mt-1.5 text-base leading-relaxed text-codezal-dim">
                {t("onboarding.workspace.subtitle")}
              </p>
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-codezal bg-codezal-panel px-3.5 py-3">
                <FolderOpen className="h-5 w-5 shrink-0 text-codezal-accent" />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-base",
                    settings.defaultWorkspacePath ? "text-codezal-text" : "text-codezal-mute",
                  )}
                >
                  {settings.defaultWorkspacePath
                    ? basename(settings.defaultWorkspacePath)
                    : t("onboarding.workspace.noFolder")}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void pickWorkspaceFolder().then((path) => {
                      if (path) void update({ defaultWorkspacePath: path })
                    })
                  }
                  className="shrink-0 rounded-md border border-codezal px-3 py-1.5 text-base text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
                >
                  {settings.defaultWorkspacePath
                    ? t("onboarding.workspace.change")
                    : t("onboarding.workspace.pickFolder")}
                </button>
              </div>

              <div className="mt-6">
                <div className="text-base font-medium text-codezal-text">
                  {t("onboarding.workspace.skillsTitle")}
                </div>
                <p className="mt-0.5 text-sm leading-relaxed text-codezal-mute">
                  {t("onboarding.workspace.skillsDesc")}
                </p>
                <div className="mt-3 flex max-h-[34vh] flex-col gap-1.5 overflow-y-auto">
                  <CapabilityRow
                    label={t("onboarding.caps.suggestions.label")}
                    desc={t("onboarding.caps.suggestions.desc")}
                    checked={settings.suggestionsEnabled ?? false}
                    onChange={(v) => void update({ suggestionsEnabled: v })}
                  />
                  <CapabilityRow
                    label={t("onboarding.caps.security.label")}
                    desc={t("onboarding.caps.security.desc")}
                    checked={settings.securityScan ?? true}
                    onChange={(v) => void update({ securityScan: v })}
                  />
                  <CapabilityRow
                    label={t("onboarding.caps.autolint.label")}
                    desc={t("onboarding.caps.autolint.desc")}
                    checked={settings.autoLintOnEdit ?? true}
                    onChange={(v) => void update({ autoLintOnEdit: v })}
                  />
                  <CapabilityRow
                    label={t("onboarding.caps.narrate.label")}
                    desc={t("onboarding.caps.narrate.desc")}
                    checked={settings.narrateProgress ?? true}
                    onChange={(v) => void update({ narrateProgress: v })}
                  />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center text-center">
              <OnboardingMascot state="idle" size={96} />
              <h2 className="mt-4 text-xl font-semibold text-codezal-text">{t("onboarding.privacy.title")}</h2>
              <p className="mt-2 max-w-md text-base leading-relaxed text-codezal-dim">
                {t("onboarding.privacy.body")}
              </p>
              <label className="mt-6 flex w-full max-w-md items-start gap-3 rounded-lg border border-codezal bg-codezal-panel px-3.5 py-3 text-left">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-codezal-accent" />
                <div className="min-w-0 flex-1">
                  <div className="text-base font-medium text-codezal-text">{t("onboarding.privacy.crashLabel")}</div>
                  <p className="mt-0.5 text-sm leading-relaxed text-codezal-mute">
                    {t("onboarding.privacy.crashDesc")}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.crashReporting ?? true}
                  onChange={(e) => void update({ crashReporting: e.target.checked })}
                  className="mt-1 h-4 w-4 shrink-0 accent-codezal-accent"
                />
              </label>
            </div>
          )}
        </div>

        {/* Footer — primary action */}
        <div className="flex justify-end px-8 py-4">
          <button
            type="button"
            onClick={() => (step === TOTAL_STEPS - 1 ? void finish() : next())}
            className="flex items-center gap-1.5 rounded-lg bg-codezal-accent px-5 py-2.5 text-base font-medium text-accent-foreground hover:opacity-90"
          >
            {step === 0
              ? t("onboarding.welcome.getStarted")
              : step === TOTAL_STEPS - 1
                ? t("onboarding.privacy.start")
                : t("onboarding.next")}
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
