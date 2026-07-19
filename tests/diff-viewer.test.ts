import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DiffViewer } from "@/components/DiffViewer"
import { makeDiffUri } from "@/lib/diff-uri"

describe("DiffViewer", () => {
  it("keeps the diff body inside a shrinkable scroll viewport", () => {
    const html = renderToStaticMarkup(
      createElement(DiffViewer, {
        uri: makeDiffUri({ mode: "worktree", ref: null, path: "src/App.tsx" }),
      }),
    )
    const scrollViewport = html.match(/class="([^"]*overflow-auto[^"]*)"/)?.[1]

    expect(scrollViewport?.split(" ")).toContain("min-h-0")
  })
})
