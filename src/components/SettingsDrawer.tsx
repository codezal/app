// Settings — full-page view with sidebar tabs. Tab bodies live in ./settings/*.
// Esc / back button returns to chat.
import { useEffect, useState } from "react"
import {
  ArrowLeft,
  BarChart3,
  Bot,
  Brain,
  Cog,
  Coins,
  Cpu,
  Globe,
  ImageIcon,
  Info,
  KeyRound,
  Palette,
  Plug,
  Puzzle,
  ScrollText,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Webhook,
} from "@/lib/icons"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { isMacOS } from "@/lib/platform"
import { GeneralTab } from "./settings/GeneralTab"
import { MemoryTab } from "./settings/MemoryTab"
import { AppearanceTab } from "./settings/AppearanceTab"
import { ProviderCatalogSection } from "./settings/providers-section"
import { ApprovalTab } from "./settings/ApprovalTab"
import { McpTab } from "./settings/McpTab"
import { HooksTab } from "./settings/HooksTab"
import { WebSearchTab } from "./settings/WebSearchTab"
import { ImageGenTab } from "./settings/ImageGenTab"
import { SemanticTab } from "./settings/SemanticTab"
import { AboutTab } from "./settings/AboutTab"
import { StatsTab } from "./settings/StatsTab"
import { PluginsTab } from "./PluginsTab"
import { TokenSavingTab } from "./settings/TokenSavingTab"
import { SkillsTab } from "./settings/SkillsTab"
import { ModelsPage } from "./settings/ModelsPage"
import { LocalModelsPage } from "./settings/LocalModelsPage"
import { PrivacyTab } from "./settings/PrivacyTab"
import { HistoryTab } from "./settings/HistoryTab"
import { CliAgentsTab } from "./settings/CliAgentsTab"

type Props = {
  onClose: () => void
  // Reserve space for native macOS traffic lights when the full sidebar is absent.
  reserveTrafficLights?: boolean
  // Initial selected tab (for example /plugins -> "eklentiler"). Defaults to "genel".
  initialTab?: Tab
}

type Tab =
  | "genel"
  | "istatistik"
  | "gorunum"
  | "modeller"
  | "ajanlar"
  | "yerel"
  | "hafiza"
  | "gizlilik"
  | "onay"
  | "mcp"
  | "hooks"
  | "web"
  | "gorsel"
  | "semantic"
  | "gecmis"
  | "tokens"
  | "skills"
  | "eklentiler"
  | "hakkinda"

export type SettingsTab = Tab

export function SettingsPage({ onClose, reserveTrafficLights, initialTab }: Props) {
  const t = useT()
  const [tab, setTab] = useState<Tab>(initialTab ?? "genel")
  const [navQuery, setNavQuery] = useState("")
  const trafficLightInset = reserveTrafficLights && isMacOS()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const tokensLabelRaw = t("settings.tabs.tokens")
  const tokensLabel = tokensLabelRaw === "settings.tabs.tokens" ? "Token Saving" : tokensLabelRaw
  // Local-models tab — fall back to English when a locale lacks the key (added late).
  const localLabelRaw = t("settings.tabs.local")
  const localModelsLabel = localLabelRaw === "settings.tabs.local" ? "Local Models" : localLabelRaw
  const historyLabelRaw = t("settings.tabs.history")
  const historyLabel = historyLabelRaw === "settings.tabs.history" ? "History" : historyLabelRaw
  const cliAgentsLabelRaw = t("settings.tabs.cliAgents")
  const cliAgentsLabel = cliAgentsLabelRaw === "settings.tabs.cliAgents" ? "CLI Agents" : cliAgentsLabelRaw
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; section: number }[] = [
    { id: "genel", label: t("settings.tabs.general"), icon: Cog, section: 0 },
    { id: "gorunum", label: t("settings.tabs.appearance"), icon: Palette, section: 0 },
    { id: "onay", label: t("settings.tabs.approval"), icon: ShieldCheck, section: 0 },
    { id: "gizlilik", label: t("settings.privacy.tab"), icon: Shield, section: 0 },
    { id: "istatistik", label: t("settings.tabs.stats"), icon: BarChart3, section: 0 },
    { id: "hakkinda", label: t("settings.tabs.about"), icon: Info, section: 0 },
    { id: "modeller", label: t("settings.nav.providers"), icon: KeyRound, section: 1 },
    { id: "ajanlar", label: cliAgentsLabel, icon: Bot, section: 1 },
    { id: "yerel", label: localModelsLabel, icon: Cpu, section: 1 },
    { id: "hafiza", label: t("settings.memory.title"), icon: Brain, section: 1 },
    { id: "gecmis", label: historyLabel, icon: Search, section: 1 },
    { id: "tokens", label: tokensLabel, icon: Coins, section: 1 },
    { id: "mcp", label: t("settings.tabs.mcp"), icon: Plug, section: 2 },
    { id: "hooks", label: t("settings.tabs.hooks"), icon: Webhook, section: 2 },
    { id: "web", label: t("settings.web.title"), icon: Globe, section: 2 },
    { id: "gorsel", label: t("settings.tabs.imageGen"), icon: ImageIcon, section: 2 },
    { id: "semantic", label: t("settings.tabs.semantic"), icon: Sparkles, section: 2 },
    { id: "skills", label: t("settings.tabs.skills"), icon: ScrollText, section: 2 },
    { id: "eklentiler", label: t("settings.tabs.plugins"), icon: Puzzle, section: 2 },
  ]
  const sectionLabels = [
    t("settings.drawer.navGroupApp"),
    t("settings.drawer.navGroupModels"),
    t("settings.drawer.navGroupTools"),
  ]

  const activeLabel = tabs.find((tt) => tt.id === tab)?.label ?? ""
  const normalizedNavQuery = navQuery.trim().toLocaleLowerCase()
  const visibleTabs = normalizedNavQuery
    ? tabs.filter((item) => item.label.toLocaleLowerCase().includes(normalizedNavQuery))
    : tabs

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 overflow-hidden bg-codezal-bg",
        trafficLightInset && "mt-[44px] border-t border-codezal-panel",
      )}
    >
      {/* Left nav */}
      <nav className="flex w-[236px] shrink-0 flex-col border-r border-codezal-panel bg-codezal-sidebar">
        <div className="shrink-0 border-b border-codezal-panel px-3 pb-3 pt-3">
          <button
            type="button"
            onClick={onClose}
            title={t("settings.drawer.backBtn")}
            className="mb-2 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-codezal-dim hover:bg-codezal-chip-soft hover:text-codezal-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-codezal-accent/40"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span>{t("settings.drawer.backBtn")}</span>
          </button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-codezal-mute" aria-hidden />
            <label htmlFor="settings-nav-search" className="sr-only">
              {t("common.search")}
            </label>
            <input
              id="settings-nav-search"
              name="settings-search"
              autoComplete="off"
              value={navQuery}
              onChange={(event) => setNavQuery(event.target.value)}
              placeholder={`${t("common.search")}…`}
              className="w-full rounded-md border border-codezal bg-codezal-input py-1.5 pl-8 pr-2 text-sm text-codezal-text placeholder:text-codezal-mute focus:border-codezal-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-codezal-accent/40"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {[0, 1, 2].map((section) => {
            const items = visibleTabs.filter((item) => item.section === section)
            if (items.length === 0) return null
            return (
              <div key={section} className="mb-4 last:mb-0">
                <div className="mb-1 px-2 text-xs font-medium text-codezal-mute">
                  {sectionLabels[section]}
                </div>
                {items.map((tt) => {
                  const Icon = tt.icon
                  const active = tab === tt.id
                  return (
                    <button
                      key={tt.id}
                      type="button"
                      onClick={() => setTab(tt.id)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-codezal-accent/40",
                        active
                          ? "bg-codezal-panel-2 font-medium text-codezal-text"
                          : "text-codezal-dim hover:bg-codezal-chip-soft hover:text-codezal-text",
                      )}
                    >
                      <Icon className={cn("h-4 w-4", active && "text-codezal-accent")} aria-hidden />
                      <span className="truncate">{tt.label}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
          {visibleTabs.length === 0 && (
            <div className="px-2 py-3 text-sm text-codezal-mute">{t("common.noResults")}</div>
          )}
        </div>
      </nav>

      {/* Right content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-codezal-panel bg-codezal-bg px-8 py-4">
          <div className="text-sm font-semibold uppercase tracking-[0.12em] text-codezal-mute">
            {t("settings.title")}
          </div>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-codezal-text">{activeLabel}</h1>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-8 py-8">
            {tab === "genel" && <GeneralTab />}
            {tab === "istatistik" && <StatsTab />}
            {tab === "hafiza" && <MemoryTab />}
            {tab === "gorunum" && <AppearanceTab />}
            {tab === "modeller" && (
              <div className="flex flex-col gap-6">
                <ProviderCatalogSection />
                <ModelsPage />
              </div>
            )}
            {tab === "yerel" && <LocalModelsPage />}
            {tab === "ajanlar" && <CliAgentsTab />}
            {tab === "gizlilik" && <PrivacyTab />}
            {tab === "onay" && <ApprovalTab />}
            {tab === "gecmis" && <HistoryTab />}
            {tab === "mcp" && <McpTab />}
            {tab === "hooks" && <HooksTab />}
            {tab === "web" && <WebSearchTab />}
            {tab === "gorsel" && <ImageGenTab />}
            {tab === "semantic" && <SemanticTab />}
            {tab === "tokens" && <TokenSavingTab />}
            {tab === "skills" && <SkillsTab />}
            {tab === "eklentiler" && <PluginsTab />}
            {tab === "hakkinda" && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  )
}
