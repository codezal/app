import { describe, it, expect } from "vitest"
import { classifyTurnRisk } from "@/lib/turn-review"

describe("classifyTurnRisk", () => {
  it("treats an empty change set as low", () => {
    expect(classifyTurnRisk([])).toBe("low")
  })

  it("returns low when every file is a doc/test/style/lockfile", () => {
    expect(classifyTurnRisk(["README.md", "src/app.css", "docs/guide.mdx"])).toBe("low")
    expect(classifyTurnRisk(["tests/foo.test.ts", "src/__snapshots__/x.snap"])).toBe("low")
    expect(classifyTurnRisk(["package-lock.json", "src/lib/i18n/locales/en.ts"])).toBe("low")
  })

  it("returns medium for ordinary production code", () => {
    expect(classifyTurnRisk(["src/lib/format-time.ts"])).toBe("medium")
    expect(classifyTurnRisk(["src/components/Sidebar.tsx"])).toBe("medium")
  })

  it("bumps a mixed doc + production turn to medium", () => {
    expect(classifyTurnRisk(["README.md", "src/lib/foo.ts"])).toBe("medium")
    expect(classifyTurnRisk(["tests/a.test.ts", "src/app.css", "src/lib/bar.ts"])).toBe("medium")
  })

  it("returns high for security / auth / crypto / payment areas", () => {
    expect(classifyTurnRisk(["src/auth/login.ts"])).toBe("high")
    expect(classifyTurnRisk(["src/lib/authentication.ts"])).toBe("high")
    expect(classifyTurnRisk(["src/lib/crypto.ts"])).toBe("high")
    expect(classifyTurnRisk(["src/payment/stripe-webhook.ts"])).toBe("high")
    expect(classifyTurnRisk(["src/lib/token-store.ts"])).toBe("high")
    expect(classifyTurnRisk(["db/migrations/0001_init.sql"])).toBe("high")
  })

  it("returns high for execution-granting destinations", () => {
    // classifySensitiveWrite matches these by basename / segment.
    expect(classifyTurnRisk(["~/.zshrc"])).toBe("high")
    expect(classifyTurnRisk([".github/workflows/.npmrc"])).toBe("high")
    expect(classifyTurnRisk([".git/hooks/pre-commit"])).toBe("high")
  })

  it("lets a high-risk file dominate an otherwise low turn", () => {
    expect(classifyTurnRisk(["src/auth/login.test.ts"])).toBe("high")
    expect(classifyTurnRisk(["README.md", "src/lib/secrets.ts"])).toBe("high")
  })

  it("normalizes Windows separators before classifying", () => {
    expect(classifyTurnRisk(["src\\auth\\login.ts"])).toBe("high")
    expect(classifyTurnRisk(["src\\components\\Sidebar.tsx"])).toBe("medium")
  })
})
