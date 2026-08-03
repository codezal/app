import { useEffect, useState } from "react"
import type { MessageImage } from "@/store/types"
import { loadImageObjectUrl } from "@/lib/image-store"

type Props = {
  image: MessageImage
  className?: string
  alt?: string
  onClick?: () => void
}

export function StoredImage({ image, className, alt, onClick }: Props) {
  const [resolved, setResolved] = useState<string | null>(null)

  useEffect(() => {
    if (image.dataUrl || !image.ref) return
    let alive = true
    let url = ""
    void loadImageObjectUrl(image.ref, image.mime)
      .then((u) => {
        if (alive) {
          url = u
          setResolved(u)
        } else {
          URL.revokeObjectURL(u)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [image.dataUrl, image.ref, image.mime])

  const src = image.dataUrl ?? resolved
  if (!src) return null
  return <img src={src} alt={alt ?? image.name ?? ""} className={className} onClick={onClick} />
}
