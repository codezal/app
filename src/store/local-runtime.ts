//
import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import { createId } from "@/lib/id"
import { bufferedListen } from "@/lib/tauri-events"

type DlEvent =
  | { kind: "notice"; message: string; model?: string }
  | { kind: "progress"; downloaded: number; total: number }
  | { kind: "done" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string }

export type LocalDownload = {
  id: string
  kind: "gguf" | "mlx"
  label: string
  partIndex: number
  partsTotal: number
  done: number
  total: number
  state: "downloading" | "done" | "cancelled" | "error"
  error?: string
}

type DownloadGroup = { label: string; parts: string[] }

let activeDispose: (() => void) | null = null

// total_physical_ram'den hesaplar.
export type LocalModelInfo = {
  requestedCtx: number // istenen pencere (ayar)
  effectiveCtx: number
  nTrain: number
  weights: number
  kv: number // effectiveCtx'te KV cache
  compute: number
  ram: number // toplam fiziksel RAM
}

type LocalRuntimeState = {
  effectiveCtx: Record<string, number>
  setEffectiveCtx: (model: string, n: number) => void
  modelInfo: Record<string, LocalModelInfo>
  setModelInfo: (model: string, info: LocalModelInfo) => void
  tokPerSec: Record<string, number>
  setTokPerSec: (model: string, n: number) => void
  lastStats: { model: string; tokPerSec: number; tokens: number; ttftMs: number } | null
  setLastStats: (
    s: { model: string; tokPerSec: number; tokens: number; ttftMs: number } | null,
  ) => void
  download: LocalDownload | null
  startLocalDownload: (repo: string, group: DownloadGroup, revision?: string) => void
  startMlxDownload: (model: string, label: string) => void
  cancelLocalDownload: () => void
  clearLocalDownload: () => void
}

export const useLocalRuntimeStore = create<LocalRuntimeState>((set, get) => ({
  effectiveCtx: {},
  setEffectiveCtx: (model, n) =>
    set((s) =>
      s.effectiveCtx[model] === n ? s : { effectiveCtx: { ...s.effectiveCtx, [model]: n } },
    ),
  modelInfo: {},
  setModelInfo: (model, info) =>
    set((s) => ({ modelInfo: { ...s.modelInfo, [model]: info } })),
  tokPerSec: {},
  setTokPerSec: (model, n) =>
    set((s) => (s.tokPerSec[model] === n ? s : { tokPerSec: { ...s.tokPerSec, [model]: n } })),
  lastStats: null,
  setLastStats: (stats) => set({ lastStats: stats }),

  download: null,
  startLocalDownload: (repo, group, revision = "main") => {
    if (get().download?.state === "downloading") return // zaten aktif indirme var
    const partsTotal = group.parts.length
    void (async () => {
      for (let i = 0; i < partsTotal; i++) {
        const id = createId("llm")
        set({
          download: {
            id,
            kind: "gguf",
            label: group.label,
            partIndex: i,
            partsTotal,
            done: 0,
            total: 0,
            state: "downloading",
          },
        })
        let result: "done" | "cancelled"
        try {
          result = await new Promise<"done" | "cancelled">((resolve, reject) => {
            void (async () => {
              const dl = await bufferedListen<DlEvent>(`llm:download:${id}`)
              activeDispose = () => {
                dl.dispose()
                activeDispose = null
              }
              dl.attach((p) => {
                if (p.kind === "progress") {
                  set((s) =>
                    s.download && s.download.id === id
                      ? { download: { ...s.download, done: p.downloaded, total: p.total } }
                      : s,
                  )
                } else if (p.kind === "done") {
                  activeDispose?.()
                  resolve("done")
                } else if (p.kind === "cancelled") {
                  activeDispose?.()
                  resolve("cancelled")
                } else if (p.kind === "notice") {
                  return
                } else {
                  activeDispose?.()
                  reject(new Error(p.message))
                }
              })
              try {
                await invoke("llm_download", { args: { id, repo, path: group.parts[i], revision } })
              } catch (e) {
                activeDispose?.()
                reject(e instanceof Error ? e : new Error(String(e)))
              }
            })()
          })
        } catch (e) {
          set({
            download: {
              id,
              kind: "gguf",
              label: group.label,
              partIndex: i,
              partsTotal,
              done: 0,
              total: 0,
              state: "error",
              error: e instanceof Error ? e.message : String(e),
            },
          })
          return
        }
        if (result === "cancelled") {
          set((s) => (s.download ? { download: { ...s.download, state: "cancelled" } } : s))
          return
        }
      }
      set((s) => (s.download ? { download: { ...s.download, state: "done" } } : s))
    })()
  },
  startMlxDownload: (model, label) => {
    if (get().download?.state === "downloading") return
    const id = createId("llm")
    set({
      download: {
        id,
        kind: "mlx",
        label,
        partIndex: 0,
        partsTotal: 1,
        done: 0,
        total: 0,
        state: "downloading",
      },
    })
    void (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          void (async () => {
            const dl = await bufferedListen<DlEvent>(`mlx:download:${id}`)
            activeDispose = () => {
              dl.dispose()
              activeDispose = null
            }
            dl.attach((p) => {
              if (p.kind === "progress") {
                set((s) =>
                  s.download && s.download.id === id
                    ? { download: { ...s.download, done: p.downloaded, total: p.total } }
                    : s,
                )
              } else if (p.kind === "done") {
                activeDispose?.()
                resolve()
              } else if (p.kind === "cancelled") {
                activeDispose?.()
                set((s) => (s.download ? { download: { ...s.download, state: "cancelled" } } : s))
                resolve()
              } else if (p.kind === "notice") {
                return
              } else {
                activeDispose?.()
                reject(new Error(p.message))
              }
            })
            try {
              await invoke("mlx_download", { args: { id, model } })
            } catch (e) {
              activeDispose?.()
              reject(e instanceof Error ? e : new Error(String(e)))
            }
          })()
        })
        set((s) =>
          s.download && s.download.id === id && s.download.state === "downloading"
            ? { download: { ...s.download, state: "done" } }
            : s,
        )
      } catch (e) {
        set({
          download: {
            id,
            kind: "mlx",
            label,
            partIndex: 0,
            partsTotal: 1,
            done: 0,
            total: 0,
            state: "error",
            error: e instanceof Error ? e.message : String(e),
          },
        })
      }
    })()
  },
  cancelLocalDownload: () => {
    const download = get().download
    if (!download) return
    if (download.kind === "mlx") {
      void invoke("mlx_cancel", { args: { genId: download.id } }).catch(() => {})
    } else {
      void invoke("llm_cancel_download", { id: download.id }).catch(() => {})
    }
  },
  clearLocalDownload: () => set({ download: null }),
}))

export function effectiveLocalCtx(settingWindow: number, model?: string): number {
  if (!model) return settingWindow
  const eff = useLocalRuntimeStore.getState().effectiveCtx[model]
  return eff && eff > 0 ? Math.min(eff, settingWindow) : settingWindow
}
