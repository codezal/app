import { useState } from "react"
import { X } from "@/lib/icons"
import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"
import { Select } from "@/components/Select"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Section } from "./primitives"

export function WebSearchTab() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const cfg = settings.webSearch
  const [customError, setCustomError] = useState<string | null>(null)

  const provider = cfg?.provider ?? "duckduckgo"
  const apiKey = cfg?.apiKey ?? ""
  const needsKey = provider !== "duckduckgo"
  const customJson = JSON.stringify(cfg?.customProviders ?? [], null, 2)

  function patch(p: Partial<{ provider: "tavily" | "brave" | "exa" | "duckduckgo"; apiKey: string }>) {
    void update({ webSearch: { provider, apiKey, ...p } })
  }

  const providerLinks: Record<string, { label: string; url: string }> = {
    tavily: { label: "tavily.com/api", url: "https://app.tavily.com/home" },
    brave: { label: "brave.com/search/api", url: "https://api.search.brave.com/register" },
    exa: { label: "exa.ai/api-keys", url: "https://dashboard.exa.ai/api-keys" },
  }
  const link = providerLinks[provider]

  // Anahtarlar keychain'de (setToolSecret). Input uncontrolled (defaultValue) + blur'da
  const setToolSecret = useSettingsStore((s) => s.setToolSecret)
  const fcStored = settings.firecrawl?.apiKey ?? ""

  return (
    <div className="space-y-6">
      <Section title={t("settings.web.title")}>
        <p className="mb-4 text-base leading-relaxed text-codezal-mute">{t("settings.web.providerHint")}</p>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-base font-medium text-codezal-dim">{t("settings.web.provider")}</span>
            <Select
              value={provider}
              onChange={(v) => patch({ provider: v as "tavily" | "brave" | "exa" | "duckduckgo" })}
              options={[
                { value: "duckduckgo", label: "DuckDuckGo (anahtarsız)" },
                { value: "tavily", label: "Tavily" },
                { value: "brave", label: "Brave Search" },
                { value: "exa", label: "Exa (Neural)" },
              ]}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-base font-medium text-codezal-dim">{t("settings.web.apiKey")}</span>
            <input
              key={apiKey}
              type="password"
              defaultValue={apiKey}
              placeholder={needsKey ? "sk-..." : "gerekmez"}
              disabled={!needsKey}
              onBlur={(e) => {
                if (e.target.value !== apiKey) void setToolSecret("websearch", e.target.value)
              }}
              className="rounded-md border border-codezal bg-codezal-input px-3 py-2 font-mono text-base text-codezal-text outline-none focus:border-codezal-accent disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
        </div>

        {!needsKey && (
          <p className="mt-3 text-base leading-relaxed text-codezal-mute">
            DuckDuckGo anahtar gerektirmez (best-effort). IP itibarına göre ara sıra bot
            doğrulamasıyla bloklanabilir — bu durumda otomatik olarak Brave/Bing HTML
            kaynaklarına düşer. Sağlam sonuç için anahtarlı bir provider seç.
          </p>
        )}

        <p className="mt-3 text-base leading-relaxed text-codezal-mute">
          Aramalar <code>time_range</code> (gün/hafta/ay/yıl), <code>site</code> ve{" "}
          <code>filetype</code> filtrelerini destekler; model bunları gerektiğinde kullanır.
        </p>

        {link && (
          <p className="mt-3 text-base leading-relaxed text-codezal-mute">
            Get a key at{" "}
            <button
              type="button"
              onClick={() => void openUrl(link.url)}
              className="text-codezal-accent underline hover:opacity-80"
            >
              {link.label}
            </button>
          </p>
        )}

        {cfg && (
          <button
            type="button"
            onClick={() => void update({ webSearch: undefined })}
            className="mt-4 flex h-8 items-center gap-1.5 rounded-md border border-codezal px-3 text-base text-codezal-dim hover:border-destructive hover:text-destructive"
          >
            <X className="h-4 w-4" />
            Clear web search config
          </button>
        )}
      </Section>

      <Section title="Custom search providers (advanced)">
        <p className="mb-3 text-base leading-relaxed text-codezal-mute">
          Kod değiştirmeden kendi arama kaynaklarını ekle. Her tanım bir JSON objesi:{" "}
          <code>searchUrl</code> (ve isteğe bağlı <code>method</code>/<code>headers</code>/
          <code>bodyTemplate</code>) içinde <code>{"{{query}}"}</code>, <code>{"{{max_results}}"}</code>,{" "}
          <code>{"{{api_key}}"}</code>, <code>{"{{time_range}}"}</code> placeholder'ları kullanılabilir.{" "}
          <code>responseMapping</code> sonuç dizisinin yolunu (<code>resultsPath</code>) ve{" "}
          <code>title</code>/<code>url</code>/<code>snippet</code> alan adlarını belirtir. Özel
          provider'lar anahtarsız aramada ilk denenir.
        </p>
        <textarea
          key={customJson}
          spellCheck={false}
          defaultValue={customJson}
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (!v || v === "[]") {
              setCustomError(null)
              if (cfg?.customProviders) void update({ webSearch: { provider, apiKey, customProviders: undefined } })
              return
            }
            try {
              const parsed = JSON.parse(v)
              if (!Array.isArray(parsed)) throw new Error("must be a JSON array")
              setCustomError(null)
              void update({ webSearch: { provider, apiKey, customProviders: parsed } })
            } catch (err) {
              setCustomError(err instanceof Error ? err.message : "invalid JSON")
            }
          }}
          rows={8}
          className="w-full rounded-md border border-codezal bg-codezal-input px-3 py-2 font-mono text-base text-codezal-text outline-none focus:border-codezal-accent"
        />
        {customError && (
          <p className="mt-2 text-base text-destructive">Geçersiz JSON: {customError}</p>
        )}
      </Section>

      <Section title="Firecrawl (web scrape)">
        <p className="mb-4 text-base leading-relaxed text-codezal-mute">
          API anahtarı girilince <code>firecrawl</code> tool'u açılır (yoksa modele
          gönderilmez). JS-ağır/SPA/anti-bot sayfaları temiz markdown'a çevirir — webfetch
          yetersiz kaldığında kullanılır.
        </p>
        <label className="flex max-w-xs flex-col gap-1.5">
          <span className="text-base font-medium text-codezal-dim">API anahtarı</span>
          <input
            key={fcStored}
            type="password"
            defaultValue={fcStored}
            placeholder="fc-..."
            onBlur={(e) => {
              if (e.target.value !== fcStored) void setToolSecret("firecrawl", e.target.value)
            }}
            className="rounded-md border border-codezal bg-codezal-input px-3 py-2 font-mono text-base text-codezal-text outline-none focus:border-codezal-accent"
          />
        </label>
        <p className="mt-3 text-base leading-relaxed text-codezal-mute">
          Anahtar:{" "}
          <button
            type="button"
            onClick={() => void openUrl("https://www.firecrawl.dev/app/api-keys")}
            className="text-codezal-accent underline hover:opacity-80"
          >
            firecrawl.dev/app/api-keys
          </button>
        </p>
      </Section>
    </div>
  )
}

