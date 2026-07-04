import { describe, it, expect } from "vitest"
import { buildTools, CORE_TOOL_NAMES, deferredToolNames, READONLY_ALLOW } from "@/lib/tools"

describe("READONLY_ALLOW drift guard", () => {
  it("allowlist'teki her isim gerçek bir tool adıdır", () => {
    const keys = new Set(
      Object.keys(
        buildTools("/tmp/readonly-allowlist-test", "readonly-allowlist-test"),
      ),
    )
    const conditional = new Set([
      "mcp_resource",
      "tool_search",
      "code_search",
      "code_callers",
      "code_callees",
      "code_trace",
      "code_impact",
    ])
    const orphans = [...READONLY_ALLOW].filter(
      (name) => !keys.has(name) && !conditional.has(name),
    )
    expect(orphans).toEqual([])
  })

  it("keeps orientation and code-intel tools in the eager core set", () => {
    const expectedCore = [
      "repo_overview",
      "code_query",
      "code_search",
      "code_callers",
      "code_callees",
      "code_trace",
      "code_impact",
      "code_context",
      "load_skill",
    ]

    for (const name of expectedCore) expect(CORE_TOOL_NAMES.has(name)).toBe(true)

    const fakeTools = Object.fromEntries(
      [...expectedCore, "browser_screenshot"].map((name) => [name, {}]),
    )
    expect(
      deferredToolNames(fakeTools as Parameters<typeof deferredToolNames>[0]),
    ).toEqual(["browser_screenshot"])
  })

  it("allows list_dir with empty input as workspace root", () => {
    const tools = buildTools(
      "/tmp/readonly-allowlist-test",
      "readonly-allowlist-test",
    )
    const schema = (
      tools.list_dir as {
        inputSchema?: { safeParse?: (value: unknown) => { success: boolean } }
      }
    ).inputSchema
    expect(schema?.safeParse?.({}).success).toBe(true)
  })
})
