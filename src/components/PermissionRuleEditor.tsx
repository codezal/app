import { Plus, Trash2 } from "@/lib/icons"
import { PERMISSION_KEYS } from "@/lib/permission-keys"
import type { PermissionRule, PermissionAction } from "@/lib/permission/types"
import { useT } from "@/lib/i18n/useT"
import { cn } from "@/lib/utils"

const ACTIONS: PermissionAction[] = ["ask", "allow", "deny"]

export function PermissionRuleEditor({
  rules,
  onChange,
}: {
  rules: PermissionRule[]
  onChange: (rules: PermissionRule[]) => void
}) {
  const t = useT()
  const update = (i: number, patch: Partial<PermissionRule>) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const remove = (i: number) => onChange(rules.filter((_, idx) => idx !== i))
  const add = () => onChange([...rules, { permission: "edit", pattern: "*", action: "ask" }])

  const actionLabel = (a: PermissionAction) =>
    a === "allow"
      ? t("settings.drawer.ruleAllow")
      : a === "deny"
        ? t("settings.drawer.ruleDeny")
        : t("settings.drawer.permActionAsk")

  return (
    <div className="flex flex-col gap-1.5">
      {rules.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            list="codezal-perm-keys"
            value={r.permission}
            onChange={(e) => update(i, { permission: e.target.value })}
            placeholder={t("settings.drawer.permKeyPlaceholder")}
            className="h-7 w-28 rounded-md border border-codezal bg-codezal-input px-2 font-mono text-sm text-codezal-text"
          />
          <input
            value={r.pattern}
            onChange={(e) => update(i, { pattern: e.target.value })}
            placeholder={t("settings.drawer.permPatternPlaceholder")}
            className="h-7 flex-1 rounded-md border border-codezal bg-codezal-input px-2 font-mono text-sm text-codezal-text"
          />
          <div className="flex h-7 overflow-hidden rounded-md border border-codezal text-sm">
            {ACTIONS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => update(i, { action: a })}
                className={cn(
                  "px-2",
                  r.action === a
                    ? a === "deny"
                      ? "bg-destructive/15 text-destructive"
                      : "bg-codezal-accent-dim text-codezal-accent"
                    : "text-codezal-dim hover:text-codezal-text",
                )}
              >
                {actionLabel(a)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            className="rounded p-1 text-codezal-mute hover:text-destructive"
            title={t("settings.drawer.ruleDeleteTitle")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <datalist id="codezal-perm-keys">
        {PERMISSION_KEYS.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      <button
        type="button"
        onClick={add}
        className="flex w-fit items-center gap-1 rounded-md border border-codezal px-2 py-1 text-sm text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
      >
        <Plus className="h-3.5 w-3.5" /> {t("settings.drawer.permAddRule")}
      </button>
    </div>
  )
}
