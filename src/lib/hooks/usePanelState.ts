import { useEffect, useRef, useState } from "react"
import type { PanelMode } from "@/components/TabBar"

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
    prevWorkspaceRef.current = workspacePath
    if (!settingsLoaded) return
    if (!prev && workspacePath && openFilesPanelOnLaunch !== false) {
      setPanelMode((m) => m ?? "files")
    } else if (prev && !workspacePath) {
      setPanelMode((m) => (m === "files" ? null : m))
    }
  }, [workspacePath, settingsLoaded, openFilesPanelOnLaunch])

  return { panelMode, setPanelMode }
}
