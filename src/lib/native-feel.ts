//
//
//

function stripTitles(root: ParentNode): void {
  const els = root.querySelectorAll<HTMLElement>("[title]")
  els.forEach(moveTitleToAria)
}

function moveTitleToAria(el: HTMLElement): void {
  const t = el.getAttribute("title")
  if (t && t.trim() && !el.getAttribute("aria-label")) {
    el.setAttribute("aria-label", t)
  }
  if (el.hasAttribute("title")) el.removeAttribute("title")
}

let observer: MutationObserver | null = null

export function installTooltipSuppressor(): () => void {
  if (typeof document === "undefined" || !document.body) return () => {}

  stripTitles(document.body)

  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes" && r.target instanceof HTMLElement) {
        moveTitleToAria(r.target)
      } else if (r.type === "childList") {
        r.addedNodes.forEach((n) => {
          if (n instanceof HTMLElement) stripTitles(n)
        })
      }
    }
  })
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["title"],
  })

  return () => {
    observer?.disconnect()
    observer = null
  }
}
