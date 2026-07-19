import { useEffect, useRef, useState } from "react"
import type { PanelMode } from "@/components/TabBar"

type PanelWorkspaceTransition = "wait" | "open-files" | "close-files" | "keep"

export function resolvePanelWorkspaceTransition({
  previousWorkspacePath,
  workspacePath,
  settingsLoaded,
  openFilesPanelOnLaunch,
}: {
  previousWorkspacePath: string | undefined
  workspacePath: string | undefined
  settingsLoaded: boolean
  openFilesPanelOnLaunch: boolean | undefined
}): PanelWorkspaceTransition {
  if (!settingsLoaded) return "wait"
  if (!previousWorkspacePath && workspacePath && openFilesPanelOnLaunch !== false) {
    return "open-files"
  }
  if (previousWorkspacePath && !workspacePath) return "close-files"
  return "keep"
}

//
export function usePanelState(
  workspacePath: string | undefined,
  settingsLoaded: boolean,
  openFilesPanelOnLaunch: boolean | undefined,
) {
  const [panelMode, setPanelMode] = useState<PanelMode | null>(null)
  const prevWorkspaceRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const prev = prevWorkspaceRef.current
    const transition = resolvePanelWorkspaceTransition({
      previousWorkspacePath: prev,
      workspacePath,
      settingsLoaded,
      openFilesPanelOnLaunch,
    })
    if (transition === "wait") return
    prevWorkspaceRef.current = workspacePath
    if (transition === "open-files") {
      setPanelMode((m) => m ?? "files")
    } else if (transition === "close-files") {
      setPanelMode((m) => (m === "files" ? null : m))
    }
  }, [workspacePath, settingsLoaded, openFilesPanelOnLaunch])

  return { panelMode, setPanelMode }
}
