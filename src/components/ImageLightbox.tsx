import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronRight, Download, X } from "@/lib/icons"
import type { MessageImage } from "@/store/types"
import { loadImageObjectUrl } from "@/lib/image-store"
import { useT } from "@/lib/i18n/useT"
import { StoredImage } from "./StoredImage"

type Props = {
  images: MessageImage[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}

const MIN_SCALE = 1
const MAX_SCALE = 6

export function ImageLightbox({ images, index, onIndex, onClose }: Props) {
  const t = useT()
  const count = images.length
  const closeRef = useRef<HTMLButtonElement>(null)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => prev?.focus?.()
  }, [])

  const [shownIndex, setShownIndex] = useState(index)
  if (shownIndex !== index) {
    setShownIndex(index)
    setScale(1)
    setPan({ x: 0, y: 0 })
    setDragging(false)
  }

  const cur = images[index]

  const download = useCallback(async () => {
    if (!cur) return
    let href = cur.dataUrl
    let revoke = false
    if (!href && cur.ref) {
      try {
        href = await loadImageObjectUrl(cur.ref, cur.mime)
        revoke = true
      } catch {
        return
      }
    }
    if (!href) return
    const a = document.createElement("a")
    a.href = href
    const ext = (cur.mime.split("/")[1] || "png").split(";")[0].split("+")[0]
    a.download = cur.name || `image.${ext}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    if (revoke) setTimeout(() => URL.revokeObjectURL(href), 10_000)
  }, [cur])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowLeft") onIndex((index - 1 + count) % count)
      else if (e.key === "ArrowRight") onIndex((index + 1) % count)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [index, count, onIndex, onClose])

  if (!cur) return null

  const arrow =
    "absolute top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
  const topBtn =
    "flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"

  const onWheel = (e: React.WheelEvent) => {
    e.stopPropagation()
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
    setScale(next)
    if (next === 1) setPan({ x: 0, y: 0 })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (scale <= 1) return
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: pan.x, oy: pan.y }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    setPan({ x: d.ox + (e.clientX - d.startX), y: d.oy + (e.clientY - d.startY) })
  }
  const onPointerUp = () => {
    dragRef.current = null
    setDragging(false)
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("imageLightbox.preview")}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void download()
          }}
          aria-label={t("imageLightbox.download")}
          className={topBtn}
        >
          <Download className="h-5 w-5" aria-hidden />
        </button>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className={topBtn}
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      {count > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onIndex((index - 1 + count) % count)
          }}
          aria-label={t("imageLightbox.prevImage")}
          className={`${arrow} left-4 rotate-180`}
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setScale((s) => (s > 1 ? 1 : 2))
          setPan({ x: 0, y: 0 })
        }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex items-center justify-center"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in",
          touchAction: "none",
        }}
      >
        <StoredImage image={cur} className="max-h-[85vh] max-w-[92vw] select-none rounded-lg object-contain" />
      </div>

      {count > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onIndex((index + 1) % count)
          }}
          aria-label={t("imageLightbox.nextImage")}
          className={`${arrow} right-4`}
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      )}

      {count > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-sm tabular-nums text-white/70">
          {index + 1} / {count}
        </div>
      )}
    </div>,
    document.body,
  )
}
