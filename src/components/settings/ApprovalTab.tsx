import { useEffect } from "react"
import { Trash2 } from "@/lib/icons"
import { useSettingsStore } from "@/store/settings"
import { useSessionsStore } from "@/store/sessions"
import { useApprovalsStore } from "@/store/approvals"
import { useT } from "@/lib/i18n/useT"
import { cn } from "@/lib/utils"
import { PermissionRuleEditor } from "../PermissionRuleEditor"
import { Section, Segmented } from "./primitives"

export function ApprovalTab() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const activeWs = useSessionsStore((s) => s.active?.workspacePath)
  const sessionPermission = useSessionsStore((s) => s.active?.permission)
  const hasActiveSession = useSessionsStore((s) => Boolean(s.active))
  const updateActiveMeta = useSessionsStore((s) => s.updateActiveMeta)
  const projectApproved = useApprovalsStore((s) => (activeWs ? s.projectApproved[activeWs] : undefined))
  const loadProjectApproved = useApprovalsStore((s) => s.loadProjectApproved)
  const removeProjectApprovedAt = useApprovalsStore((s) => s.removeProjectApprovedAt)

  useEffect(() => {
    if (activeWs && projectApproved === undefined) void loadProjectApproved(activeWs)
  }, [activeWs, projectApproved, loadProjectApproved])

  function removeRule(idx: number) {
    const next = settings.approvalRules.filter((_, i) => i !== idx)
    void update({ approvalRules: next })
  }

  return (
    <div className="space-y-6">
      <Section title={t("settings.drawer.modeTitle")}>
        <div className="py-1">
          <Segmented
            value={settings.approvalMode}
            options={[
              { value: "ask", label: t("composer.approvalAsk") },
              { value: "auto-review", label: t("composer.approvalAutoReview") },
              { value: "bypass", label: t("composer.approvalBypass") },
            ]}
            onChange={(v) => void update({ approvalMode: v })}
          />
          <p className="mt-2.5 text-base leading-relaxed text-codezal-mute">
            {t("settings.drawer.modeHint")}
          </p>
        </div>
      </Section>

      <Section title={t("settings.drawer.permGlobalTitle")}>
        <p className="mb-2 text-base leading-relaxed text-codezal-mute">{t("settings.drawer.permGlobalHint")}</p>
        <PermissionRuleEditor
          rules={settings.permission ?? []}
          onChange={(rules) => void update({ permission: rules })}
        />
      </Section>

      <Section title={t("settings.drawer.permProjectTitle")}>
        {!activeWs ? (
          <div className="rounded-lg border border-dashed border-codezal px-3 py-5 text-center text-base text-codezal-mute">
            {t("settings.drawer.permProjectNoWorkspace")}
          </div>
        ) : (projectApproved ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-codezal px-3 py-5 text-center text-base text-codezal-mute">
            {t("settings.drawer.permProjectNone")}
          </div>
        ) : (
          <ul className="-mx-4 divide-y divide-codezal-hair border-y border-codezal-hair">
            {(projectApproved ?? []).map((r, i) => (
              <li
                key={`${r.action}-${r.permission}-${r.pattern ?? ""}-${i}`}
                className="flex items-center gap-2 px-4 py-2.5 text-base"
              >
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-base font-medium",
                    r.action === "deny"
                      ? "bg-destructive/15 text-destructive"
                      : "bg-codezal-accent-dim text-codezal-accent",
                  )}
                >
                  {r.action === "allow"
                    ? t("settings.drawer.ruleAllow")
                    : r.action === "deny"
                      ? t("settings.drawer.ruleDeny")
                      : t("settings.drawer.permActionAsk")}
                </span>
                <span className="font-mono text-codezal-text">{r.permission}</span>
                {r.pattern && r.pattern !== "*" && (
                  <span className="truncate font-mono text-base text-codezal-dim">· {r.pattern}</span>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => removeProjectApprovedAt(activeWs, i)}
                  className="rounded p-1 text-codezal-mute hover:text-destructive"
                  title={t("settings.drawer.ruleDeleteTitle")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {hasActiveSession && (
        <Section title={t("composer.sessionPermTitle")}>
          <p className="mb-2 text-base leading-relaxed text-codezal-mute">{t("composer.sessionPermHint")}</p>
          <PermissionRuleEditor
            rules={sessionPermission ?? []}
            onChange={(rules) => updateActiveMeta({ permission: rules })}
          />
        </Section>
      )}

      {settings.approvalRules.length > 0 && (
        <Section title={t("settings.drawer.savedRulesTitle")}>
          <ul className="-mx-4 divide-y divide-codezal-hair border-y border-codezal-hair">
            {settings.approvalRules.map((r, i) => (
              <li
                key={i}
                className="flex items-center gap-2 px-4 py-2.5 text-base"
              >
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-base font-medium",
                    r.decision === "allow"
                      ? "bg-codezal-accent-dim text-codezal-accent"
                      : "bg-destructive/15 text-destructive",
                  )}
                >
                  {r.decision === "allow" ? t("settings.drawer.ruleAllow") : t("settings.drawer.ruleDeny")}
                </span>
                <span className="font-mono text-codezal-text">{r.tool}</span>
                {r.pattern && (
                  <span className="truncate font-mono text-base text-codezal-dim">· {r.pattern}</span>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => removeRule(i)}
                  className="rounded p-1 text-codezal-mute hover:text-destructive"
                  title={t("settings.drawer.ruleDeleteTitle")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
