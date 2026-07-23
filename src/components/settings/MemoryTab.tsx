import { useState } from "react"
import { X } from "@/lib/icons"
import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"
import { DEFAULT_MEMORY } from "@/lib/memory-settings"
import { Section, Row, Toggle, NumberField } from "./primitives"

export function MemoryTab() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const t = useT()

  return (
    <div className="space-y-6">
      <Section title={t("settings.memory.title")}>
        <Row
          label={t("settings.memory.dynamicAttachLabel")}
          description={t("settings.memory.dynamicAttachDesc")}
        >
          <Toggle
            label={t("settings.memory.dynamicAttachLabel")}
            checked={settings.memory?.dynamicAttach ?? true}
            onChange={(v) =>
              void update({ memory: { ...(settings.memory ?? DEFAULT_MEMORY), dynamicAttach: v } })
            }
          />
        </Row>
        <Row
          label={t("settings.memory.autonomousRememberLabel")}
          description={t("settings.memory.autonomousRememberDesc")}
        >
          <Toggle
            label={t("settings.memory.autonomousRememberLabel")}
            checked={settings.memory?.autonomousRemember ?? true}
            onChange={(v) =>
              void update({
                memory: { ...(settings.memory ?? DEFAULT_MEMORY), autonomousRemember: v },
              })
            }
          />
        </Row>
        <Row
          label={t("settings.memory.autoLearnLabel")}
          description={t("settings.memory.autoLearnDesc")}
        >
          <Toggle
            label={t("settings.memory.autoLearnLabel")}
            checked={settings.memory?.autoLearn ?? true}
            onChange={(v) =>
              void update({ memory: { ...(settings.memory ?? DEFAULT_MEMORY), autoLearn: v } })
            }
          />
        </Row>
        <Row
          label={t("settings.memory.autoLearnSkipToolsLabel")}
          description={t("settings.memory.autoLearnSkipToolsDesc")}
        >
          <Toggle
            label={t("settings.memory.autoLearnSkipToolsLabel")}
            checked={settings.memory?.autoLearnSkipToolChats ?? false}
            onChange={(v) =>
              void update({
                memory: { ...(settings.memory ?? DEFAULT_MEMORY), autoLearnSkipToolChats: v },
              })
            }
          />
        </Row>
        <Row label={t("settings.memory.instructionsLabel")} description="">
          <span />
        </Row>
        <MemoryInstructions
          value={settings.memory?.instructions ?? []}
          onChange={(list) =>
            void update({ memory: { ...(settings.memory ?? DEFAULT_MEMORY), instructions: list } })
          }
        />
      </Section>

      <Section title={t("settings.memoryStore.label")} description={t("settings.memoryStore.desc")}>
        <Row label={t("settings.memoryStore.label")} description={t("settings.memoryStore.desc")}>
          <Toggle
            label={t("settings.memoryStore.label")}
            checked={settings.memory?.memoryStoreEnabled ?? true}
            onChange={(v) =>
              void update({ memory: { ...(settings.memory ?? DEFAULT_MEMORY), memoryStoreEnabled: v } })
            }
          />
        </Row>
        <Row label={t("settings.memoryStore.budgetLabel")} description={t("settings.memoryStore.budgetDesc")}>
          <NumberField
            label={t("settings.memoryStore.budgetLabel")}
            name="memory-token-budget"
            value={settings.memory?.memoryStoreBudgetTokens ?? 800}
            min={100}
            max={4000}
            fallback={800}
            onChange={(v) =>
              void update({ memory: { ...(settings.memory ?? DEFAULT_MEMORY), memoryStoreBudgetTokens: v } })
            }
          />
        </Row>
      </Section>
    </div>
  )
}

function MemoryInstructions({
  value,
  onChange,
}: {
  value: string[]
  onChange: (list: string[]) => void
}) {
  const t = useT()
  const [draft, setDraft] = useState("")

  function add() {
    const v = draft.trim()
    if (!v) return
    onChange([...value, v])
    setDraft("")
  }

  return (
    <div className="space-y-2 px-1 pb-1">
      <div className="text-base leading-relaxed text-codezal-mute">{t("settings.memory.instructionsDesc")}</div>
      {value.length === 0 ? (
        <div className="text-base text-codezal-mute">{t("settings.memory.instructionsEmpty")}</div>
      ) : (
        <ul className="space-y-1.5">
          {value.map((item, i) => (
            <li key={`${item}-${i}`} className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-codezal-panel-2 px-2.5 py-1.5 text-base text-codezal-text">
                {item}
              </code>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                title={t("settings.memory.instructionsRemove")}
                className="shrink-0 rounded p-1 text-codezal-mute hover:text-red-400"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              add()
            }
          }}
          placeholder={t("settings.memory.instructionsPlaceholder")}
          className="flex-1 rounded-md border border-codezal bg-codezal-panel-2 px-3 py-2 text-base text-codezal-text outline-none focus:border-codezal-accent"
        />
        <button
          type="button"
          onClick={add}
          className="shrink-0 rounded-md bg-codezal-chip px-3 py-2 text-base text-codezal-text hover:bg-codezal-panel-2"
        >
          {t("settings.memory.instructionsAdd")}
        </button>
      </div>
    </div>
  )
}

// Default provider/model picker — catalog-aware replacement for the old
// PROVIDERS[id].models lookup. Lists only connected providers (otherwise
// the user couldn't actually run the selected default). Falls back to the
// raw model id when models.dev has no friendly name.
