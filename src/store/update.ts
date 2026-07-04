import { create } from "zustand"
import { type Update } from "@tauri-apps/plugin-updater"
import { downloadAndRelaunch } from "@/lib/updater"

export type UpdatePhase = "idle" | "available" | "downloading" | "installing" | "error"

type UpdateState = {
  update: Update | null
  phase: UpdatePhase
  downloaded: number // byte
  total: number // byte (0 = belirsiz)
  error: string | null
  present: (update: Update) => void
  beginDownload: () => Promise<void>
  dismiss: () => void
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  update: null,
  phase: "idle",
  downloaded: 0,
  total: 0,
  error: null,

  present: (update) => set({ update, phase: "available", downloaded: 0, total: 0, error: null }),

  beginDownload: async () => {
    const { update } = get()
    if (!update) return
    set({ phase: "downloading", downloaded: 0, total: 0, error: null })
    try {
      await downloadAndRelaunch(update, (downloaded, total) => {
        const phase: UpdatePhase = total > 0 && downloaded >= total ? "installing" : "downloading"
        set({ downloaded, total, phase })
      })
    } catch (e) {
      set({ phase: "error", error: e instanceof Error ? e.message : String(e) })
    }
  },

  dismiss: () => set({ update: null, phase: "idle", downloaded: 0, total: 0, error: null }),
}))
