import { describe, expect, it } from "vitest"
import { resolvePanelWorkspaceTransition } from "../src/lib/hooks/usePanelState"

describe("panel workspace transition", () => {
  it("waits for settings before consuming the first workspace", () => {
    expect(
      resolvePanelWorkspaceTransition({
        previousWorkspacePath: undefined,
        workspacePath: "/workspace",
        settingsLoaded: false,
        openFilesPanelOnLaunch: true,
      }),
    ).toBe("wait")

    expect(
      resolvePanelWorkspaceTransition({
        previousWorkspacePath: undefined,
        workspacePath: "/workspace",
        settingsLoaded: true,
        openFilesPanelOnLaunch: true,
      }),
    ).toBe("open-files")
  })
})
