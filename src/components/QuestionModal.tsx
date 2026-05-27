// Soru modali — agent question tool'unu çağırınca açılır.
// Kuyruktaki ilk soruyu render eder; cevap verilince bir sonraki sıraya geçer.
// Seçenek varsa buton listesi, yoksa textarea.
import { useEffect, useRef, useState } from "react"
import { HelpCircle, Send, X } from "lucide-react"
import { useQuestionsStore } from "@/store/questions"
import { useT } from "@/lib/i18n/useT"

export function QuestionModal() {
  const t = useT()
  const queue = useQuestionsStore((s) => s.queue)
  const answer = useQuestionsStore((s) => s.answer)
  const cancel = useQuestionsStore((s) => s.cancel)
  const req = queue[0]
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // Yeni soruya geçince input temizle ve focus
  useEffect(() => {
    setText("")
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [req?.id])

  if (!req) return null

  function submit(value: string) {
    const v = value.trim()
    if (!v) return
    answer(req!.id, v)
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit(text)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[520px] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl">
        <header className="flex items-center gap-2 border-b border-codezal px-3 py-2.5">
          <HelpCircle className="h-4 w-4 text-codezal-accent" />
          <span className="text-[13px] font-medium text-codezal-text">{t("questionModal.agentAsking")}</span>
          <div className="flex-1" />
          {queue.length > 1 && (
            <span className="text-[11px] text-codezal-mute">{t("questionModal.pendingMore", { count: queue.length - 1 })}</span>
          )}
          <button
            type="button"
            onClick={() => cancel(req.id)}
            className="rounded p-1 text-codezal-dim hover:text-codezal-text"
            title={t("questionModal.closeNoAnswerTitle")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="px-3 py-3">
          <p className="mb-3 whitespace-pre-wrap text-[13px] leading-[1.55] text-codezal-text">
            {req.prompt}
          </p>

          {req.choices && req.choices.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {req.choices.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => submit(c)}
                  className="rounded-md border border-codezal bg-codezal-chip px-3 py-2 text-left text-[12px] text-codezal-text hover:border-codezal-strong hover:bg-codezal-panel-2"
                >
                  <span className="mr-2 font-mono text-[11px] text-codezal-mute">
                    {i + 1}.
                  </span>
                  {c}
                </button>
              ))}
            </div>
          ) : (
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              rows={3}
              placeholder={t("questionModal.placeholder")}
              className="w-full resize-none rounded-md border border-codezal bg-codezal-code px-3 py-2 font-mono text-[12px] leading-[1.55] text-codezal-text outline-none focus:border-codezal-strong"
            />
          )}
        </div>

        {(!req.choices || req.choices.length === 0) && (
          <footer className="flex items-center justify-end gap-2 border-t border-codezal px-3 py-2.5">
            <button
              type="button"
              onClick={() => submit(text)}
              disabled={!text.trim()}
              className="flex items-center gap-1 rounded-md bg-codezal-accent px-3 py-1.5 text-[12px] font-medium text-[#1a1106] disabled:opacity-50"
            >
              <Send className="h-3 w-3" /> {t("questionModal.submit")}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}
