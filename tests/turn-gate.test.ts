import { describe, expect, it } from "vitest"
import { decideTurnGate } from "@/lib/stream/turn-gate"

describe("decideTurnGate", () => {
  it("idle session → run", () => {
    expect(
      decideTurnGate({ streaming: false, preparing: false, hasAttachments: false }),
    ).toBe("run")
  })

  it("streaming + plain text → queue", () => {
    expect(
      decideTurnGate({ streaming: true, preparing: false, hasAttachments: false }),
    ).toBe("queue")
  })

  it("streaming + attachments → reject (queue is text-only)", () => {
    expect(
      decideTurnGate({ streaming: true, preparing: false, hasAttachments: true }),
    ).toBe("reject")
  })

  it("preparing (hooks/auto-compaction in flight) + text → queue", () => {
    expect(
      decideTurnGate({ streaming: false, preparing: true, hasAttachments: false }),
    ).toBe("queue")
  })

  it("preparing + attachments → reject", () => {
    expect(
      decideTurnGate({ streaming: false, preparing: true, hasAttachments: true }),
    ).toBe("reject")
  })
})
