// Read-only in-editor PR conversation tab. App renders "codezal-pr:" URIs with
// this (parallel to OutputViewer). Shows the PR description + every comment
// (issue + inline review + review summaries) oldest→newest. Posting is out of
// scope. Payload is ephemeral (pr-uri.ts registry) — gone after session reload.
import { openUrl } from "@tauri-apps/plugin-opener"
import { ExternalLink } from "@/lib/icons"
import { getPrConversation, parsePrUri } from "@/lib/pr-uri"
import type { PrComment } from "@/lib/github"
import { useT, useLocale } from "@/lib/i18n/useT"

function openExternal(url: string | null | undefined) {
  if (url && /^https?:\/\//i.test(url)) void openUrl(url).catch(() => {})
}

export function PRConversationViewer({ uri }: { uri: string }) {
  const t = useT()
  const locale = useLocale()
  const parsed = parsePrUri(uri)
  const conv = parsed ? getPrConversation(parsed.id) : undefined

  if (!conv) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-codezal-bg">
        <div className="px-3 py-3 text-sm text-codezal-mute">{t("prConversation.unavailable")}</div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-codezal-bg">
      <div className="flex items-center gap-2 border-b border-codezal-hair px-3 py-1.5">
        <span className="truncate text-sm text-codezal-dim">
          #{conv.number} · {conv.title}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => openExternal(conv.htmlUrl)}
          className="flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-sm text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("prConversation.openOnGitHub")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <CommentCard author={conv.author} createdAt="" subtitle={null} locale={locale}>
            {conv.body.trim() ? (
              <Body text={conv.body} />
            ) : (
              <span className="text-sm text-codezal-mute">{t("prConversation.noDescription")}</span>
            )}
          </CommentCard>

          {conv.comments.length === 0 ? (
            <div className="py-4 text-center text-sm text-codezal-mute">{t("prConversation.noComments")}</div>
          ) : (
            conv.comments.map((c, i) => (
              <CommentCard
                key={i}
                author={c.author}
                createdAt={c.createdAt}
                subtitle={subtitleFor(c, t("prConversation.reviewSummary"))}
                locale={locale}
              >
                <Body text={c.body} />
              </CommentCard>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function subtitleFor(c: PrComment, reviewLabel: string): string | null {
  if (c.kind === "review" && c.path) return `${c.path}${c.line != null ? `:${c.line}` : ""}`
  if (c.kind === "review-summary") return reviewLabel
  return null
}

function fmtDate(iso: string, locale: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(locale)
}

function CommentCard({
  author,
  createdAt,
  subtitle,
  locale,
  children,
}: {
  author: string
  createdAt: string
  subtitle: string | null
  locale: string
  children: React.ReactNode
}) {
  const when = fmtDate(createdAt, locale)
  return (
    <div className="rounded-lg border border-codezal-hair bg-codezal-panel">
      <div className="flex items-center gap-2 border-b border-codezal-hair px-3 py-1.5">
        <span className="text-sm font-medium text-codezal-text">{author}</span>
        {subtitle && (
          <span className="truncate font-mono text-sm text-codezal-mute">{subtitle}</span>
        )}
        {when && <span className="ml-auto shrink-0 text-sm text-codezal-dim">{when}</span>}
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  )
}

function Body({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-codezal-text">
      {text}
    </div>
  )
}
