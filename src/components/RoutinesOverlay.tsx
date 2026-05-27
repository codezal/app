// Routines overlay — listele + manuel çalıştır.
// "Çalıştır" yeni session açar, routine prompt'unu yollar.
import { useEffect, useState } from "react"
import { Play, X, Zap } from "lucide-react"
import { readWorkspaceRoutines, readUserRoutines, type Routine } from "@/lib/routines"
import { nextFireAt, parseCron, validateCron } from "@/lib/cron"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"

type Props = {
  open: boolean
  onClose: () => void
  // Yeni session aç + bu prompt'u "kullanıcı mesajı" olarak gönder
  onRun: (prompt: string, opts?: { provider?: string; model?: string }) => void
}

export function RoutinesOverlay({ open, onClose, onRun }: Props) {
  const [routines, setRoutines] = useState<Routine[] | null>(null)
  const active = useSessionsStore((s) => s.active)
  const settings = useSettingsStore((s) => s.settings)

  useEffect(() => {
    if (!open) return
    let alive = true
    setRoutines(null)
    Promise.all([
      readWorkspaceRoutines(active?.workspacePath),
      readUserRoutines(),
    ])
      .then(([p, u]) => alive && setRoutines([...p, ...u]))
      .catch(() => alive && setRoutines([]))
    return () => {
      alive = false
    }
  }, [open, active?.workspacePath])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-[14vh] flex h-[64vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose()
        }}
      >
        <header className="flex items-center gap-2 border-b border-codezal px-3 py-2.5">
          <Zap className="h-4 w-4 text-codezal-accent" />
          <span className="text-[13px] font-medium text-codezal-text">Rutinler</span>
          <span className="text-[11px] text-codezal-mute">
            ({routines?.length ?? 0})
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-codezal-mute hover:text-codezal-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="flex-1 overflow-auto px-3 py-3">
          {!routines ? (
            <div className="px-2 py-3 text-[12px] text-codezal-mute">…</div>
          ) : routines.length === 0 ? (
            <div className="px-2 py-8 text-center text-[12px] text-codezal-mute">
              Rutin yok.
              <br />
              <code className="text-codezal-text">~/.codezal/routines/&lt;name&gt;.md</code> (global) veya{" "}
              <code className="text-codezal-text">&lt;ws&gt;/.codezal/routines/&lt;name&gt;.md</code> ekle.
              <br />
              Frontmatter: <code className="text-codezal-text">name</code>,{" "}
              <code className="text-codezal-text">description</code>, opsiyonel{" "}
              <code className="text-codezal-text">model</code>,{" "}
              <code className="text-codezal-text">provider</code>.
              <br />
              Body = prompt.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {routines.map((r) => (
                <li
                  key={r.path}
                  className="rounded-md border border-codezal bg-codezal-input/30 p-3"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-[13px] font-medium text-codezal-text">
                      {r.name}
                    </span>
                    <span className="rounded bg-codezal-chip px-1.5 py-0.5 text-[10.5px] text-codezal-dim">
                      {r.scope === "project" ? "proje" : "global"}
                    </span>
                    {r.model && (
                      <span className="font-mono text-[10.5px] text-codezal-mute">
                        {r.provider ? `${r.provider}/${r.model}` : r.model}
                      </span>
                    )}
                    {r.schedule && (() => {
                      const err = validateCron(r.schedule)
                      if (err) {
                        return (
                          <span
                            className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10.5px] text-destructive"
                            title={err}
                          >
                            cron geçersiz
                          </span>
                        )
                      }
                      const next = nextFireAt(parseCron(r.schedule))
                      return (
                        <span
                          className="rounded bg-codezal-accent-dim px-1.5 py-0.5 text-[10.5px] text-codezal-accent"
                          title={next ? `Sıradaki: ${next.toLocaleString()}` : undefined}
                        >
                          cron: {r.schedule}
                        </span>
                      )
                    })()}
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => {
                        onRun(r.prompt, {
                          provider: r.provider ?? settings.defaultProvider,
                          model: r.model ?? settings.defaultModel,
                        })
                        onClose()
                      }}
                      className="flex items-center gap-1 rounded-md bg-codezal-accent px-2 py-1 text-[11.5px] font-medium text-[#1a1106]"
                      title="Yeni session açıp çalıştır"
                    >
                      <Play className="h-3 w-3" /> Çalıştır
                    </button>
                  </div>
                  {r.description && (
                    <div className="mb-1.5 text-[11.5px] text-codezal-dim">
                      {r.description}
                    </div>
                  )}
                  <pre className="max-h-[120px] overflow-auto whitespace-pre-wrap rounded bg-codezal-bg/60 p-2 text-[11.5px] text-codezal-dim">
                    {r.prompt.slice(0, 600)}
                    {r.prompt.length > 600 && "\n…"}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-codezal px-3 py-1.5 text-[10.5px] text-codezal-mute">
          Cron alanı dolu rutinler uygulama açıkken otomatik tetiklenir (kaçırılan tetiklemeler telafi edilmez).
        </footer>
      </div>
    </div>
  )
}
