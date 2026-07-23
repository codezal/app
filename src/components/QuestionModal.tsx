//
//
import { useEffect, useRef, useState } from "react"
import { Check, ChevronLeft, ChevronRight, HelpCircle, Send, X } from "@/lib/icons"
import { useQuestionsStore, type QuestionItem, type QuestionRequest } from "@/store/questions"
import { useSessionsStore } from "@/store/sessions"
import { useT } from "@/lib/i18n/useT"
import { Markdown } from "@/components/Markdown"

function isQuickSingle(questions: QuestionItem[]): boolean {
  if (questions.length !== 1) return false
  const q = questions[0]
  return !!q.options && q.options.length > 0 && !q.multiple
}

export function QuestionModal() {
  const queue = useQuestionsStore((s) => s.queue)
  const answer = useQuestionsStore((s) => s.answer)
  const cancel = useQuestionsStore((s) => s.cancel)
  const setPanelHeight = useQuestionsStore((s) => s.setPanelHeight)
  const activeId = useSessionsStore((s) => s.activeId)
  const req = queue.find((r) => r.sessionId === activeId)

  const [shown, setShown] = useState<QuestionRequest | null>(req ?? null)
  const [open, setOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (req) {
      // animasyonu bitene dek). Cascading render kabul edildi.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShown(req)
      const raf = requestAnimationFrame(() => setOpen(true))
      return () => cancelAnimationFrame(raf)
    } else {
      setOpen(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.id])

  function handleTransitionEnd() {
    if (!open) {
      setShown(null)
      setPanelHeight(0)
    }
  }

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const report = () => setPanelHeight(el.offsetHeight + 8)
    const ro = new ResizeObserver(report)
    ro.observe(el)
    report()
    return () => ro.disconnect()
  }, [shown?.id, setPanelHeight])

  if (!shown) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[calc(100%+3px)] z-20 overflow-hidden">
      <div
        onTransitionEnd={handleTransitionEnd}
        className={`transition-transform duration-200 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto w-full max-w-[860px] px-6 pb-0 pt-10">
          <div
            ref={cardRef}
            className="pointer-events-auto flex max-h-[60vh] flex-col overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.20)]"
          >
            <QuestionForm
              key={shown.id}
              req={shown}
              pendingCount={queue.length - 1}
              onAnswer={answer}
              onSkip={() => cancel(shown.id)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function QuestionForm({
  req,
  pendingCount,
  onAnswer,
  onSkip,
}: {
  req: QuestionRequest
  pendingCount: number
  onAnswer: (id: string, answers: string[][]) => void
  onSkip: () => void
}) {
  const t = useT()
  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [customText, setCustomText] = useState<Record<number, string>>({})
  const [other, setOther] = useState<Record<number, boolean>>({})
  const [page, setPage] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const quick = isQuickSingle(req.questions)
  const total = req.questions.length
  const singleQ = total === 1
  const isLast = page === total - 1

  const hasOpts = (q: QuestionItem) => !!q.options && q.options.length > 0
  const showOtherChip = (q: QuestionItem) => hasOpts(q) && !!q.custom
  const otherInputVisible = (qi: number, q: QuestionItem): boolean =>
    hasOpts(q) ? (showOtherChip(q) ? !!other[qi] : false) : true

  function pickOption(qi: number, q: QuestionItem, label: string) {
    if (quick) {
      onAnswer(req.id, [[label]])
      return
    }
    setSelected((prev) => {
      const cur = prev[qi] ?? []
      if (q.multiple) {
        const next = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]
        return { ...prev, [qi]: next }
      }
      return { ...prev, [qi]: [label] }
    })
    if (!q.multiple) setOther((p) => ({ ...p, [qi]: false }))
  }

  function clickOther(qi: number, q: QuestionItem) {
    setOther((prev) => ({ ...prev, [qi]: !prev[qi] }))
    if (!q.multiple) setSelected((p) => ({ ...p, [qi]: [] }))
  }

  const isAnswered = (qi: number, q: QuestionItem): boolean => {
    if ((selected[qi]?.length ?? 0) > 0) return true
    if (otherInputVisible(qi, q)) return (customText[qi] ?? "").trim().length > 0
    return false
  }
  const allAnswered = req.questions.every((q, qi) => isAnswered(qi, q))
  const cur = req.questions[page]
  const currentAnswered = isAnswered(page, cur)

  function submit() {
    const answers = req.questions.map((q, qi) => {
      const picked = selected[qi] ?? []
      const txt = otherInputVisible(qi, q) ? (customText[qi] ?? "").trim() : ""
      return txt ? [...picked, txt] : picked
    })
    if (answers.some((a) => a.length === 0)) return
    onAnswer(req.id, answers)
  }

  const goNext = () => setPage((p) => Math.min(p + 1, total - 1))
  const goBack = () => setPage((p) => Math.max(p - 1, 0))

  useEffect(() => {
    if (hasOpts(cur)) rootRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  function typingInField(): boolean {
    const el = document.activeElement as HTMLElement | null
    if (!el) return false
    return el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable
  }

  function onPanelKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault()
      onSkip()
      return
    }
    if (typingInField()) return
    if (e.key === "Enter") {
      e.preventDefault()
      if (isLast) {
        if (allAnswered) submit()
      } else if (currentAnswered) {
        goNext()
      }
      return
    }
    if (/^[1-9]$/.test(e.key)) {
      if (!hasOpts(cur)) return
      const opts = cur.options!
      const n = Number(e.key)
      if (n <= opts.length) {
        e.preventDefault()
        pickOption(page, cur, opts[n - 1].label)
      } else if (showOtherChip(cur) && n === opts.length + 1) {
        e.preventDefault()
        clickOther(page, cur)
      }
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (isLast) {
        if (allAnswered) submit()
      } else if (currentAnswered) {
        goNext()
      }
    }
  }

  const hasOptions = hasOpts(cur)
  const sel = selected[page] ?? []
  const otherOn = !!other[page]
  const isDecision = !!cur.body

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-labelledby="question-current-title"
      onKeyDown={onPanelKey}
      className="flex min-h-0 flex-1 flex-col outline-none"
    >
      <div className="flex items-start gap-2 border-b border-codezal px-3 py-2.5">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-codezal-accent" aria-hidden />
        {!singleQ && (
          <span className="mt-px shrink-0 rounded bg-codezal-chip px-1.5 py-0.5 text-sm font-medium text-codezal-accent">
            {t("questionModal.pageOf", { cur: page + 1, total })}
          </span>
        )}
        <span
          id="question-current-title"
          className="flex-1 whitespace-pre-wrap text-sm font-medium text-codezal-text"
        >
          {cur.question}
        </span>
        {pendingCount > 0 && (
          <span className="mt-0.5 shrink-0 text-sm text-codezal-mute">
            {t("questionModal.pendingMore", { count: pendingCount })}
          </span>
        )}
        <button
          type="button"
          onClick={onSkip}
          className="rounded p-1 text-codezal-dim hover:text-codezal-text"
          title={t("questionModal.closeNoAnswerTitle")}
          aria-label={t("questionModal.closeNoAnswerTitle")}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {isDecision ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <Markdown content={cur.body!} />
          </div>
          {otherInputVisible(page, cur) && (
            <div className="shrink-0 border-t border-codezal px-3 pt-2.5">
              <textarea
                autoFocus
                value={customText[page] ?? ""}
                onChange={(e) => setCustomText((p) => ({ ...p, [page]: e.target.value }))}
                onKeyDown={onKey}
                rows={2}
                placeholder={t("questionModal.revisePlaceholder")}
                className="w-full resize-none rounded-md border border-codezal bg-codezal-code px-3 py-2 text-sm leading-[1.55] text-codezal-text outline-none focus:border-codezal-strong"
              />
            </div>
          )}
          <div className="flex shrink-0 items-center gap-2 border-t border-codezal px-3 py-2.5">
            <button
              type="button"
              onClick={onSkip}
              className="rounded-md px-3 py-1.5 text-sm text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
            >
              {t("questionModal.skip")}
            </button>
            <div className="flex-1" />
            {otherOn ? (
              <>
                <button
                  type="button"
                  onClick={() => clickOther(page, cur)}
                  className="rounded-md px-3 py-1.5 text-sm text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
                >
                  {t("questionModal.back")}
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!currentAnswered}
                  className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed enabled:bg-accent enabled:text-accent-foreground disabled:bg-codezal-panel-2 disabled:text-codezal-mute"
                >
                  <Send className="h-4 w-4" /> {t("questionModal.submit")}
                </button>
              </>
            ) : (
              <>
                {cur.options!.slice(1).map((opt, oi) => (
                  <button
                    key={oi}
                    type="button"
                    onClick={() => pickOption(page, cur, opt.label)}
                    title={opt.description}
                    className="rounded-md border border-codezal bg-codezal-chip px-3 py-1.5 text-sm text-codezal-text transition-colors hover:border-codezal-strong hover:bg-codezal-panel-2"
                  >
                    {opt.label}
                  </button>
                ))}
                {showOtherChip(cur) && (
                  <button
                    type="button"
                    onClick={() => clickOther(page, cur)}
                    className="rounded-md border border-codezal bg-codezal-chip px-3 py-1.5 text-sm text-codezal-text transition-colors hover:border-codezal-strong hover:bg-codezal-panel-2"
                  >
                    {t("questionModal.revise")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => pickOption(page, cur, cur.options![0].label)}
                  title={cur.options![0].description}
                  className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition-colors hover:opacity-90"
                >
                  <Check className="h-4 w-4" /> {cur.options![0].label}
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
        {hasOptions && (
          <div className="flex flex-col gap-1.5">
            {cur.multiple && (
              <span className="text-sm text-codezal-mute">{t("questionModal.multiSelectHint")}</span>
            )}
            {cur.options!.map((opt, oi) => {
              const isSel = sel.includes(opt.label)
              return (
                <button
                  key={oi}
                  type="button"
                  onClick={() => pickOption(page, cur, opt.label)}
                  className={`flex items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    isSel
                      ? "border-codezal-accent bg-codezal-panel-2 text-codezal-text"
                      : "border-codezal bg-codezal-chip text-codezal-text hover:border-codezal-strong hover:bg-codezal-panel-2"
                  }`}
                >
                  <span
                    className={`mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${
                      isSel
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-codezal-strong"
                    }`}
                  >
                    {isSel && <Check className="h-3 w-3" aria-hidden />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{opt.label}</span>
                    {opt.description && (
                      <span className="text-sm leading-[1.5] text-codezal-mute">
                        {opt.description}
                      </span>
                    )}
                  </span>
                  <kbd className="ml-2 mt-[1px] flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded border border-codezal bg-codezal-panel px-1 text-sm font-medium text-codezal-mute">
                    {oi + 1}
                  </kbd>
                </button>
              )
            })}

            {showOtherChip(cur) && (
              <button
                type="button"
                onClick={() => clickOther(page, cur)}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  otherOn
                    ? "border-codezal-accent bg-codezal-panel-2 text-codezal-text"
                    : "border-codezal bg-codezal-chip text-codezal-text hover:border-codezal-strong hover:bg-codezal-panel-2"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${
                    otherOn
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-codezal-strong"
                  }`}
                >
                  {otherOn && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1 font-medium">{t("questionModal.otherOption")}</span>
                <kbd className="ml-2 flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded border border-codezal bg-codezal-panel px-1 text-sm font-medium text-codezal-mute">
                  {cur.options!.length + 1}
                </kbd>
              </button>
            )}
          </div>
        )}

        {otherInputVisible(page, cur) && (
          <textarea
            autoFocus={!hasOptions}
            value={customText[page] ?? ""}
            onChange={(e) => setCustomText((p) => ({ ...p, [page]: e.target.value }))}
            onKeyDown={onKey}
            rows={hasOptions ? 2 : 3}
            placeholder={
              hasOptions ? t("questionModal.customPlaceholder") : t("questionModal.placeholder")
            }
            className="w-full resize-none rounded-md border border-codezal bg-codezal-code px-3 py-2 font-mono text-sm leading-[1.55] text-codezal-text outline-none focus:border-codezal-strong"
          />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-codezal px-3 py-2.5">
        {page > 0 && (
          <button
            type="button"
            onClick={goBack}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <ChevronLeft className="h-4 w-4" /> {t("questionModal.back")}
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onSkip}
          className="rounded-md px-3 py-1.5 text-sm text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          {t("questionModal.skip")}
        </button>
        {isLast ? (
          <button
            type="button"
            onClick={submit}
            disabled={!allAnswered}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed enabled:bg-accent enabled:text-accent-foreground disabled:bg-codezal-panel-2 disabled:text-codezal-mute"
          >
            <Send className="h-4 w-4" /> {t("questionModal.submit")}
          </button>
        ) : (
          <button
            type="button"
            onClick={goNext}
            disabled={!currentAnswered}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed enabled:bg-accent enabled:text-accent-foreground disabled:bg-codezal-panel-2 disabled:text-codezal-mute"
          >
            {t("questionModal.next")} <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
        </>
      )}
    </div>
  )
}
