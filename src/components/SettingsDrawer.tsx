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
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "genel", label: t("settings.tabs.general"), icon: Cog },
    { id: "istatistik", label: t("settings.tabs.stats"), icon: BarChart3 },
    { id: "gorunum", label: t("settings.tabs.appearance"), icon: Palette },
    { id: "modeller", label: t("settings.nav.providers"), icon: KeyRound },
    { id: "ajanlar", label: cliAgentsLabel, icon: Bot },
    { id: "yerel", label: localModelsLabel, icon: Cpu },
    { id: "onay", label: t("settings.tabs.approval"), icon: ShieldCheck },
    { id: "mcp", label: t("settings.tabs.mcp"), icon: Plug },
    { id: "hooks", label: t("settings.tabs.hooks"), icon: Webhook },
    { id: "web", label: t("settings.web.title"), icon: Globe },
    { id: "gorsel", label: t("settings.tabs.imageGen"), icon: ImageIcon },
    { id: "semantic", label: t("settings.tabs.semantic"), icon: Sparkles },
    { id: "gecmis", label: historyLabel, icon: Search },
    { id: "tokens", label: tokensLabel, icon: Coins },
    { id: "skills", label: t("settings.tabs.skills"), icon: ScrollText },
    { id: "eklentiler", label: t("settings.tabs.plugins"), icon: Puzzle },
    { id: "hafiza", label: t("settings.memory.title"), icon: Brain },
    { id: "gizlilik", label: t("settings.privacy.tab"), icon: Shield },
    { id: "hakkinda", label: t("settings.tabs.about"), icon: Info },
  ]

  const activeLabel = tabs.find((tt) => tt.id === tab)?.label ?? ""

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 overflow-hidden bg-codezal-bg",
        trafficLightInset && "mt-[44px] border-t border-codezal-panel",
      )}
    >
      {/* Left nav */}
      <nav
        className={cn(
          "w-[200px] shrink-0 overflow-y-auto border-r border-codezal-hair bg-codezal-sidebar p-3",
        )}
      >
        <button
          type="button"
          onClick={onClose}
          title={t("settings.drawer.backBtn")}
          className="mb-2 flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-md text-codezal-dim hover:bg-codezal-chip-soft hover:text-codezal-text"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{t("settings.drawer.backBtn")}</span>
        </button>
        {tabs.map((tt) => {
          const Icon = tt.icon
          return (
            <button
              key={tt.id}
              type="button"
              onClick={() => setTab(tt.id)}
              className={cn(
                "mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-md",
                tab === tt.id
                  ? "bg-codezal-chip font-medium text-codezal-text"
                  : "text-codezal-dim hover:bg-codezal-chip-soft hover:text-codezal-text",
              )}
            >
              <Icon className="h-4 w-4" />
              {tt.label}
            </button>
          )
        })}
      </nav>

      {/* Right content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-codezal-hair bg-codezal-bg px-6 py-4">
          <h2 className="text-md font-semibold tracking-tight text-codezal-text">{t("settings.drawer.headerPrefix", { tab: activeLabel })}</h2>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-6">
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
