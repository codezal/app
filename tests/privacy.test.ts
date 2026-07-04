import { describe, it, expect } from "vitest"
import type { ModelMessage } from "ai"
import { detect, PrivacyScrubber, privacyActive, type PrivacySettings } from "../src/lib/privacy"

const ON: PrivacySettings = { enabled: true }

describe("privacy detect", () => {
  it("detects email, AWS key, and GitHub token", () => {
    const awsKey = "AKIA" + "IOSFODNN7EXAMPLE"
    const ghToken = "ghp_" + "abcdefghijklmnopqrstuvwxyz0123456789"
    const text = `email ali@example.com, key ${awsKey}, token ${ghToken}`
    const types = detect(text, ON).map((d) => d.type).sort()
    expect(types).toEqual(["AWS_KEY", "EMAIL", "GH_TOKEN"])
  })

  it("validates cards with Luhn and skips invalid sequences", () => {
    const valid = detect("card 4111 1111 1111 1111", ON).filter((d) => d.type === "CARD")
    expect(valid).toHaveLength(1)
    const invalid = detect("id 1234 5678 9012 3456", ON).filter((d) => d.type === "CARD")
    expect(invalid).toHaveLength(0)
  })

  it("captures only the value for SECRET patterns, not the label", () => {
    const d = detect('api_key: "sk_live_abcdef123456"', ON).find((x) => x.type === "SECRET")
    expect(d?.value).toBe("sk_live_abcdef123456")
  })

  it("keeps IP disabled by default and enables it by detector setting", () => {
    expect(detect("host 192.168.1.1", ON).some((d) => d.type === "IP")).toBe(false)
    expect(detect("host 192.168.1.1", { enabled: true, detectors: { IP: true } }).some((d) => d.type === "IP")).toBe(true)
  })

  it("deduplicates overlapping matches", () => {
    // If matches overlap, each character should belong to one span.
    const dets = detect("a@b.com a@b.com", ON)
    expect(dets).toHaveLength(2)
    expect(dets[0].end).toBeLessThanOrEqual(dets[1].start)
  })
})

describe("PrivacyScrubber", () => {
  it("uses a stable placeholder for the same value", () => {
    const s = new PrivacyScrubber(ON)
    const out = s.scrubText("ali@x.com and again ali@x.com")
    expect(out).toBe("[EMAIL_1] and again [EMAIL_1]")
  })

  it("scrubs only user and system messages by default", () => {
    const s = new PrivacyScrubber(ON)
    const msgs: ModelMessage[] = [
      { role: "system", content: "admin ali@x.com" },
      { role: "user", content: "my email is veli@y.com" },
      { role: "assistant", content: "ok ayse@z.com" },
    ]
    const out = s.scrubMessages(msgs)
    expect(out[0].content).toBe("admin [EMAIL_1]")
    expect(out[1].content).toBe("my email is [EMAIL_2]")
    expect(out[2].content).toBe("ok ayse@z.com")
  })

  it("scrubs assistant messages when scrubAssistant is enabled", () => {
    const s = new PrivacyScrubber({ enabled: true, scrubAssistant: true })
    const out = s.scrubMessages([{ role: "assistant", content: "ayse@z.com" }])
    expect(out[0].content).toBe("[EMAIL_1]")
  })

  it("unscrubs placeholders back to real values", () => {
    const s = new PrivacyScrubber(ON)
    s.scrubText("ali@x.com")
    expect(s.unscrub("reply sent to [EMAIL_1]")).toBe("reply sent to ali@x.com")
  })

  it("returns no fail-closed signal after a clean scrub", () => {
    const s = new PrivacyScrubber(ON)
    const scrubbed = s.scrubMessages([{ role: "user", content: "email ali@x.com" }])
    expect(s.verify(scrubbed)).toHaveLength(0)
  })

  it("scrubs array text parts and leaves non-text parts untouched", () => {
    const s = new PrivacyScrubber(ON)
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "my email is ali@x.com" },
          { type: "image", image: "data:..." },
        ],
      } as ModelMessage,
    ]
    const out = s.scrubMessages(msgs)
    const parts = out[0].content as Array<{ type: string; text?: string }>
    expect(parts[0].text).toBe("my email is [EMAIL_1]")
    expect(parts[1].type).toBe("image")
  })

  it("uses the custom pattern label in placeholders", () => {
    const s = new PrivacyScrubber({
      enabled: true,
      customPatterns: [{ label: "tckn", pattern: "\\b\\d{11}\\b" }],
    })
    expect(s.scrubText("identity 12345678901")).toBe("identity [TCKN_1]")
  })
})

describe("privacyActive", () => {
  it("returns true only for enabled settings and cloud providers", () => {
    expect(privacyActive(ON, "anthropic")).toBe(true)
    expect(privacyActive(ON, "local")).toBe(false)
    expect(privacyActive({ enabled: false }, "anthropic")).toBe(false)
    expect(privacyActive(undefined, "anthropic")).toBe(false)
  })
})
