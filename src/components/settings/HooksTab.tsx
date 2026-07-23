import { useState } from "react"
import { Plus, ShieldCheck, Trash2 } from "@/lib/icons"
import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"
import { Select } from "@/components/Select"
import { createId } from "@/lib/id"
import { listPluginHooks, isPluginHookTrusted, setPluginHookTrusted } from "@/lib/hooks"
import { Section } from "./primitives"

type HookEventLocal = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop" | "SubagentStop" | "PreCompact"

export function HooksTab() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const hooks = settings.hooks ?? []

  function addHook() {
    const id = createId("hook")
    void update({
      hooks: [
        ...hooks,
        {
          id,
          event: "PreToolUse",
          matcher: "*",
          command: "",
          timeoutMs: 10000,
          blocking: false,
          enabled: true,
          description: "",
        },
      ],
    })
  }

  function patchHook(idx: number, patch: Partial<(typeof hooks)[number]>) {
    const next = hooks.map((h, i) => (i === idx ? { ...h, ...patch } : h))
    void update({ hooks: next })
  }

  function removeHook(idx: number) {
    void update({ hooks: hooks.filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-6">
      <Section title={t("settings.drawer.hooksTitle")}>
        <p className="mb-3 text-base leading-relaxed text-codezal-mute">
          {t("settings.drawer.hooksHint")}
        </p>

        {hooks.length === 0 && (
          <div className="rounded-lg border border-dashed border-codezal px-3 py-5 text-center text-base text-codezal-mute">
            {t("settings.drawer.hooksNoHooks")}
          </div>
        )}

        <div className="space-y-2.5">
          {hooks.map((h, idx) => (
            <div key={h.id} className="rounded-lg border border-codezal bg-codezal-panel-2 p-3">
              <div className="flex items-center gap-1.5">
                <Select
                  compact
                  value={h.event}
                  onChange={(v) => patchHook(idx, { event: v as HookEventLocal })}
                  options={[
                    { value: "PreToolUse", label: "PreToolUse" },
                    { value: "PostToolUse", label: "PostToolUse" },
                    { value: "UserPromptSubmit", label: "UserPromptSubmit" },
                    { value: "Stop", label: "Stop" },
                    { value: "SubagentStop", label: "SubagentStop" },
                    { value: "PreCompact", label: "PreCompact" },
                  ]}
                />
                <input
                  type="text"
                  placeholder={t("settings.drawer.hookMatcherPlaceholder")}
                  value={h.matcher ?? ""}
                  onChange={(e) => patchHook(idx, { matcher: e.target.value })}
                  className="w-36 rounded-md border border-codezal bg-codezal-input px-2.5 py-1 text-base text-codezal-text outline-none focus:border-codezal-accent"
                />
                <label className="ml-1 flex items-center gap-1.5 text-base text-codezal-dim">
                  <input
                    type="checkbox"
                    checked={h.enabled ?? true}
                    onChange={(e) => patchHook(idx, { enabled: e.target.checked })}
                  />
                  {t("settings.drawer.hookActiveLabel")}
                </label>
                {h.event === "PreToolUse" && (
                  <label className="ml-1 flex items-center gap-1.5 text-base text-codezal-dim">
                    <input
                      type="checkbox"
                      checked={h.blocking ?? false}
                      onChange={(e) => patchHook(idx, { blocking: e.target.checked })}
                    />
                    {t("settings.drawer.hookBlockLabel")}
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => removeHook(idx)}
                  className="ml-auto rounded p-1 text-codezal-mute hover:bg-codezal-panel hover:text-codezal-text"
                  title={t("settings.drawer.hookDeleteTitle")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <input
                type="text"
                placeholder={t("settings.drawer.hookDescPlaceholder")}
                value={h.description ?? ""}
                onChange={(e) => patchHook(idx, { description: e.target.value })}
                className="mt-2 w-full rounded-md border border-codezal bg-codezal-input px-2.5 py-1.5 text-base text-codezal-text outline-none focus:border-codezal-accent"
              />
              <textarea
                placeholder={t("settings.drawer.hookCmdPlaceholder")}
                value={h.command}
                onChange={(e) => patchHook(idx, { command: e.target.value })}
                rows={2}
                className="mt-2 w-full rounded-md border border-codezal bg-codezal-input px-2.5 py-1.5 font-mono text-base text-codezal-text outline-none focus:border-codezal-accent"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addHook}
          className="mt-3 flex h-8 items-center gap-1.5 rounded-md border border-codezal px-3 text-base text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
        >
          <Plus className="h-4 w-4" />
          {t("settings.drawer.hookAdd")}
        </button>

        <PluginHooksTrust />
      </Section>
    </div>
  )
}

function PluginHooksTrust() {
  const t = useT()
  const pluginHooks = listPluginHooks()
  const [, force] = useState(0)
  if (pluginHooks.length === 0) return null
  return (
    <div className="mt-5 border-t border-codezal pt-4">
      <div className="mb-2 flex items-center gap-2 text-base font-medium text-codezal-text">
        <ShieldCheck className="h-4 w-4 text-codezal-accent" />
        {t("settings.drawer.pluginHooksTitle")}
      </div>
      <p className="mb-2.5 text-base leading-relaxed text-codezal-mute">{t("settings.drawer.pluginHooksHint")}</p>
      <div className="space-y-2.5">
        {pluginHooks.map((h) => {
          const trusted = isPluginHookTrusted(h.id)
          return (
            <div key={h.id} className="rounded-lg border border-codezal bg-codezal-panel-2 p-3">
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-codezal-chip px-1.5 py-0.5 text-base text-codezal-dim">
                  {h.event}
                </span>
                {h.matcher && h.matcher !== "*" && (
                  <span className="font-mono text-base text-codezal-dim">{h.matcher}</span>
                )}
                <span className="ml-1 rounded bg-codezal-chip px-1.5 py-0.5 text-base text-codezal-mute">
                  {h.pluginId}
                </span>
                <label className="ml-auto flex items-center gap-1.5 text-base text-codezal-dim">
                  <input
                    type="checkbox"
                    checked={trusted}
                    onChange={(e) => {
                      setPluginHookTrusted(h.id, e.target.checked)
                      force((n) => n + 1)
                    }}
                  />
                  {t("settings.drawer.pluginHookTrust")}
                </label>
              </div>
              {h.description && (
                <div className="mt-1.5 text-base text-codezal-mute">{h.description}</div>
              )}
              <code className="mt-2 block overflow-x-auto whitespace-pre rounded bg-codezal-input px-2 py-1.5 font-mono text-base text-codezal-text">
                {h.command}
              </code>
            </div>
          )
        })}
      </div>
    </div>
  )
}

