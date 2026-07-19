import { beforeEach, describe, expect, it } from "vitest"
import { useTerminalsStore } from "@/store/terminals"

beforeEach(() => {
  useTerminalsStore.setState({ sessions: [], activeId: null })
})

describe("terminals store workspace scoping", () => {
  it("creates separate terminals for separate chat workspaces", () => {
    const salesId = useTerminalsStore.getState().ensureOne("sales-chat", "/projects/Satış")
    const coilsId = useTerminalsStore.getState().ensureOne("coils-chat", "/projects/CoilsStudio")

    expect(coilsId).not.toBe(salesId)
    expect(useTerminalsStore.getState().sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: salesId, chatSessionId: "sales-chat", workspacePath: "/projects/Satış" }),
        expect.objectContaining({ id: coilsId, chatSessionId: "coils-chat", workspacePath: "/projects/CoilsStudio" }),
      ]),
    )
  })

  it("replaces a terminal when its chat moves to another workspace", () => {
    const salesId = useTerminalsStore.getState().ensureOne("chat", "/projects/Satış")
    const coilsId = useTerminalsStore.getState().ensureOne("chat", "/projects/CoilsStudio")

    expect(coilsId).not.toBe(salesId)
    expect(useTerminalsStore.getState().sessions).toEqual([
      expect.objectContaining({ id: coilsId, chatSessionId: "chat", workspacePath: "/projects/CoilsStudio" }),
    ])
  })

  it("restores owned terminals and drops ambiguous legacy snapshots", () => {
    useTerminalsStore.getState().hydrate(
      [
        {
          id: "sales-terminal",
          name: "Terminal 1",
          chatSessionId: "sales-chat",
          workspacePath: "/projects/Satış",
        },
        { id: "legacy-terminal", name: "Terminal 1" },
      ],
      "legacy-terminal",
    )

    expect(useTerminalsStore.getState().sessions).toEqual([
      expect.objectContaining({
        id: "sales-terminal",
        chatSessionId: "sales-chat",
        workspacePath: "/projects/Satış",
      }),
    ])
    expect(useTerminalsStore.getState().activeId).toBe("sales-terminal")
  })

  it("keeps active replacement inside the same chat workspace", () => {
    const firstId = useTerminalsStore.getState().ensureOne("chat", "/projects/codezal")
    const secondId = useTerminalsStore.getState().create("chat", "/projects/codezal")
    useTerminalsStore.getState().create("other-chat", "/projects/other")

    useTerminalsStore.getState().setActive(secondId)
    useTerminalsStore.getState().remove(secondId)

    expect(useTerminalsStore.getState().activeId).toBe(firstId)
  })

  it("keeps terminals created while snapshot hydration is pending", () => {
    const runtimeId = useTerminalsStore.getState().create("chat", "/projects/codezal")

    useTerminalsStore.getState().hydrate(
      [
        {
          id: "restored-terminal",
          name: "Terminal 1",
          chatSessionId: "saved-chat",
          workspacePath: "/projects/saved",
        },
      ],
      "restored-terminal",
    )

    expect(useTerminalsStore.getState().sessions.map((session) => session.id)).toEqual([
      "restored-terminal",
      runtimeId,
    ])
    expect(useTerminalsStore.getState().activeId).toBe(runtimeId)
  })

  it("creates uniquely named CLI terminal tabs with launch metadata", () => {
    const firstId = useTerminalsStore.getState().create("chat", "/projects/codezal", {
      name: "Codex",
      toolId: "codex",
      launchCommand: "codex",
    })
    const secondId = useTerminalsStore.getState().create("chat", "/projects/codezal", {
      name: "Codex",
      toolId: "codex",
      launchCommand: "codex",
    })

    expect(useTerminalsStore.getState().sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstId, name: "Codex", launchCommand: "codex" }),
        expect.objectContaining({ id: secondId, name: "Codex 2", toolId: "codex" }),
      ]),
    )
  })
})
