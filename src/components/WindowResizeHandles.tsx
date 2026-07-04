import { useState, type CSSProperties, type PointerEvent } from "react"
import { isMacOS } from "@/lib/platform"

type Dir =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest"

const EDGE = 4
const CORNER = 14

const ZONES: { dir: Dir; style: CSSProperties }[] = [
  { dir: "North", style: { top: 0, left: CORNER, right: CORNER, height: EDGE, cursor: "ns-resize" } },
  { dir: "South", style: { bottom: 0, left: CORNER, right: CORNER, height: EDGE, cursor: "ns-resize" } },
  { dir: "West", style: { top: CORNER, bottom: CORNER, left: 0, width: EDGE, cursor: "ew-resize" } },
  { dir: "East", style: { top: CORNER, bottom: CORNER, right: 0, width: EDGE, cursor: "ew-resize" } },
  { dir: "NorthWest", style: { top: 0, left: 0, width: CORNER, height: CORNER, cursor: "nwse-resize" } },
  { dir: "NorthEast", style: { top: 0, right: 0, width: CORNER, height: CORNER, cursor: "nesw-resize" } },
  { dir: "SouthWest", style: { bottom: 0, left: 0, width: CORNER, height: CORNER, cursor: "nesw-resize" } },
  { dir: "SouthEast", style: { bottom: 0, right: 0, width: CORNER, height: CORNER, cursor: "nwse-resize" } },
]

export function WindowResizeHandles() {
  const [enabled] = useState(() => !isMacOS())

  if (!enabled) return null

  async function startResize(e: PointerEvent, dir: Dir) {
    if (e.button !== 0) return
    try {
      const mod = await import("@tauri-apps/api/window")
      await mod.getCurrentWindow().startResizeDragging(dir)
    } catch {
      /* yoksay */
    }
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]">
      {ZONES.map((z) => (
        <div
          key={z.dir}
          onPointerDown={(e) => void startResize(e, z.dir)}
          className="pointer-events-auto absolute"
          style={z.style}
        />
      ))}
    </div>
  )
}
