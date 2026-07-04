//
//

const OPEN = "<think>"
const CLOSE = "</think>"

export type ThinkSink = {
  onText: (s: string) => void
  onReasoning: (s: string) => void
}

export type ThinkSplitter = {
  feed: (delta: string) => void
  flush: () => void
}

export function createThinkSplitter(sink: ThinkSink): ThinkSplitter {
  let inThink = false
  let pending = ""

  const write = (s: string) => {
    if (!s) return
    if (inThink) sink.onReasoning(s)
    else sink.onText(s)
  }

  const feed = (delta: string) => {
    let buf = pending + delta
    pending = ""
    for (;;) {
      const tag = inThink ? CLOSE : OPEN
      const idx = buf.indexOf(tag)
      if (idx !== -1) {
        write(buf.slice(0, idx))
        inThink = !inThink
        buf = buf.slice(idx + tag.length)
        continue
      }
      const hold = partialTailLen(buf, tag)
      if (hold > 0) {
        write(buf.slice(0, buf.length - hold))
        pending = buf.slice(buf.length - hold)
      } else {
        write(buf)
      }
      return
    }
  }

  const flush = () => {
    if (!pending) return
    const tag = inThink ? CLOSE : OPEN
    if (!tag.startsWith(pending)) write(pending)
    pending = ""
  }

  return { feed, flush }
}

function partialTailLen(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1)
  for (let n = max; n > 0; n--) {
    if (s.slice(s.length - n) === tag.slice(0, n)) return n
  }
  return 0
}
