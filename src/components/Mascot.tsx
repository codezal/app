import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react"
import { useSettingsStore } from "@/store/settings"
import { useMascotState } from "@/lib/hooks/use-mascot-state"
import {
  DEFAULT_MASCOT,
  isMascotEnabled,
  mascotSrc,
  type MascotState,
} from "@/lib/mascots"

export function Mascot({
  state,
  size = 96,
  className = "",
  float = false,
}: {
  state: MascotState
  size?: number
  className?: string
  float?: boolean
}): ReactElement | null {
  const character = useSettingsStore(
    (s) => s.settings.appearance?.mascotCharacter ?? DEFAULT_MASCOT,
  )

  if (!isMascotEnabled(character)) return null

  return (
    <img
      src={mascotSrc(character, state)}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      className={["select-none object-contain", float ? "mascot-float" : "", className]
        .filter(Boolean)
        .join(" ")}
      style={{ width: size, height: size }}
    />
  )
}

const MASCOT_POS_KEY = "codezal.mascotPos"
const MASCOT_KEY_STEP = 16

type MascotPos = { left: number; top: number }

function loadMascotPos(): MascotPos | null {
  try {
    const raw = localStorage.getItem(MASCOT_POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<MascotPos>
    if (typeof p?.left === "number" && typeof p?.top === "number") {
      return { left: p.left, top: p.top }
    }
  } catch {
    // Intentionally ignored.
  }
  return null
}

export function MascotOverlay({
  size = 104,
  hidden = false,
}: {
  size?: number
  hidden?: boolean
}): ReactElement | null {
  const character = useSettingsStore(
    (s) => s.settings.appearance?.mascotCharacter ?? DEFAULT_MASCOT,
  )
  const state = useMascotState()
  const [pos, setPos] = useState<MascotPos | null>(() => loadMascotPos())
  const [dragging, setDragging] = useState(false)
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null)
  const posRef = useRef<MascotPos | null>(pos)

  function clamp(left: number, top: number): MascotPos {
    return {
      left: Math.max(0, Math.min(left, window.innerWidth - size)),
      top: Math.max(0, Math.min(top, window.innerHeight - size)),
    }
  }

  function commit(next: MascotPos): void {
    posRef.current = next
    setPos(next)
  }

  function persist(): void {
    if (!posRef.current) return
    try {
      localStorage.setItem(MASCOT_POS_KEY, JSON.stringify(posRef.current))
    } catch {
      // Intentionally ignored.
    }
  }

  useEffect(() => {
    if (posRef.current) return
    commit(clamp(window.innerWidth - size - 24, window.innerHeight - size - 160))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])

  useEffect(() => {
    function onResize(): void {
      if (!posRef.current) return
      commit(clamp(posRef.current.left, posRef.current.top))
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])

  if (hidden || !isMascotEnabled(character) || !pos) return null
  const current = pos // erken-return'den sonra non-null (assertion gerekmez)

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const cur = posRef.current ?? current
    dragOffsetRef.current = { dx: e.clientX - cur.left, dy: e.clientY - cur.top }
    setDragging(true)
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    const off = dragOffsetRef.current
    if (!off) return
    commit(clamp(e.clientX - off.dx, e.clientY - off.dy))
  }
  function endDrag(e: ReactPointerEvent<HTMLDivElement>): void {
    if (!dragOffsetRef.current) return
    dragOffsetRef.current = null
    setDragging(false)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    persist()
  }
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): void {
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-MASCOT_KEY_STEP, 0],
      ArrowRight: [MASCOT_KEY_STEP, 0],
      ArrowUp: [0, -MASCOT_KEY_STEP],
      ArrowDown: [0, MASCOT_KEY_STEP],
    }
    const move = delta[e.key]
    if (!move) return
    e.preventDefault()
    const cur = posRef.current ?? current
    commit(clamp(cur.left + move[0], cur.top + move[1]))
    persist()
  }

  return (
    <div
      className="pointer-events-none fixed z-40"
      style={{ left: current.left, top: current.top }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label="Maskot — sürükleyerek taşı, ok tuşlarıyla oynat"
        title="Maskotu sürükle"
        className="pointer-events-auto touch-none select-none outline-none"
        style={{ cursor: dragging ? "grabbing" : "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <Mascot state={state} size={size} float={!dragging} />
      </div>
    </div>
  )
}
