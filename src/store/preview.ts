// Browser-preview state — workspace-scoped.
//
// Two things live here, both keyed by workspace path:
//  - detectedByWs: dev-server URLs scraped from terminal output (see
//    src/lib/detect-urls.ts; fed from TerminalPanel's PTY onData tap).
//  - urlByWs: the URL currently shown in that workspace's preview panel.
// Console logs are NOT here — they're ephemeral, panel-local.
import { create } from "zustand"

export type DetectedUrl = { url: string; port: number; ts: number }

const MAX_PER_WS = 8

function portOf(url: string): number {
  try {
    const u = new URL(url)
    if (u.port) return Number(u.port)
    return u.protocol === "https:" ? 443 : 80
  } catch {
    return 0
  }
}

type PreviewState = {
  detectedByWs: Record<string, DetectedUrl[]>
  urlByWs: Record<string, string>
  // Record a detected dev-server URL (dedupe by url, newest first, capped).
  addDetected: (ws: string, url: string) => void
  // Set the URL shown in a workspace's preview panel.
  setUrl: (ws: string, url: string) => void
  // Agent navigate: record detected URL + set current URL in ONE update (1 render).
  recordNavigation: (ws: string, url: string) => void
}

export const usePreviewStore = create<PreviewState>((set) => ({
  detectedByWs: {},
  urlByWs: {},
  addDetected: (ws, url) =>
    set((st) => {
      const prev = st.detectedByWs[ws] ?? []
      if (prev[0]?.url === url) return st // en yeni zaten bu → no-op (gereksiz render yok)
      const next = [
        { url, port: portOf(url), ts: Date.now() },
        ...prev.filter((d) => d.url !== url),
      ].slice(0, MAX_PER_WS)
      return { detectedByWs: { ...st.detectedByWs, [ws]: next } }
    }),
  setUrl: (ws, url) =>
    set((st) => (st.urlByWs[ws] === url ? st : { urlByWs: { ...st.urlByWs, [ws]: url } })),
  recordNavigation: (ws, url) =>
    set((st) => {
      const prev = st.detectedByWs[ws] ?? []
      const detected =
        prev[0]?.url === url
          ? prev
          : [{ url, port: portOf(url), ts: Date.now() }, ...prev.filter((d) => d.url !== url)].slice(
              0,
              MAX_PER_WS,
            )
      const sameUrl = st.urlByWs[ws] === url
      if (detected === prev && sameUrl) return st
      return {
        detectedByWs: detected === prev ? st.detectedByWs : { ...st.detectedByWs, [ws]: detected },
        urlByWs: sameUrl ? st.urlByWs : { ...st.urlByWs, [ws]: url },
      }
    }),
}))
