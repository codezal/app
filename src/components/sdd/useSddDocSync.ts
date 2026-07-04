import { useEffect, useRef, useState } from "react"
import { exists } from "@tauri-apps/plugin-fs"
import { sddProtoDir } from "@/lib/sdd-store"
import { invalidateFileContent, normalizeFsPath } from "@/lib/file-content-cache"
import { isDirty } from "@/lib/editor-dirty"
import { statusForStage } from "@/lib/sdd-trace"
import { useSddStore } from "@/store/sdd"
import { useSessionsStore } from "@/store/sessions"
import type { SddStage } from "@/store/types"

export function useSddDocSync(args: {
  draftId?: string
  draftWorkspace?: string
  draftStage?: SddStage
  reqPath: string | null
  planPath: string | null
  linkedSid?: string
  onOpenPreview?: (absPath: string) => void
}): { reloadKey: number; planExists: boolean; requestPreviewOnNextTurn: () => void } {
  const { draftId, draftWorkspace, draftStage, reqPath, planPath, linkedSid, onOpenPreview } = args

  const linkedStreaming = useSessionsStore((s) => (linkedSid ? !!s.streamingIds?.[linkedSid] : false))
  const traceTarget = draftStage ? statusForStage(draftStage) : null

  const [reloadKey, setReloadKey] = useState(0)
  const [planExists, setPlanExists] = useState(false)
  const prevStreamingRef = useRef(false)
  const expectPreviewRef = useRef(false)

  useEffect(() => {
    if (reqPath) invalidateFileContent(normalizeFsPath(reqPath))
    if (planPath) invalidateFileContent(normalizeFsPath(planPath))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReloadKey((k) => k + 1)
  }, [reqPath, planPath])

  useEffect(() => {
    if (!planPath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPlanExists(false)
      return
    }
    let alive = true
    void exists(planPath)
      .then((ok) => {
        if (alive) setPlanExists(ok)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [planPath, reloadKey])

  useEffect(() => {
    const ended = prevStreamingRef.current && !linkedStreaming
    if (ended) {
      if (reqPath && !isDirty(reqPath)) invalidateFileContent(normalizeFsPath(reqPath))
      if (planPath && !isDirty(planPath)) invalidateFileContent(normalizeFsPath(planPath))
      setReloadKey((k) => k + 1)
    }
    if (ended && expectPreviewRef.current && draftWorkspace && draftId && onOpenPreview) {
      const protoPath = `${sddProtoDir(draftWorkspace, draftId)}/prototype.html`
      void exists(protoPath)
        .then((ok) => {
          if (ok) {
            expectPreviewRef.current = false
            onOpenPreview(protoPath)
          }
        })
        .catch(() => {})
    }
    if (ended && draftId && traceTarget) {
      void useSddStore
        .getState()
        .applyTrace(draftId, traceTarget)
        .then((changed) => {
          if (changed && reqPath) {
            invalidateFileContent(normalizeFsPath(reqPath))
            setReloadKey((k) => k + 1)
          }
        })
    }
    prevStreamingRef.current = linkedStreaming
  }, [linkedStreaming, reqPath, planPath, draftId, draftWorkspace, traceTarget, onOpenPreview])

  return {
    reloadKey,
    planExists,
    requestPreviewOnNextTurn: () => {
      expectPreviewRef.current = true
    },
  }
}
