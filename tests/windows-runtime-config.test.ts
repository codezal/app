import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const readProjectFile = (path: string) => readFileSync(path, "utf8")

describe("Windows runtime configuration", () => {
  it("Tauri filesystem scope changes survive app restarts", () => {
    const cargo = readProjectFile("src-tauri/Cargo.toml")
    const lib = readProjectFile("src-tauri/src/lib.rs")
    const fsPlugin = lib.indexOf(".plugin(tauri_plugin_fs::init())")
    const persistedScopePlugin = lib.indexOf(".plugin(tauri_plugin_persisted_scope::init())")

    expect(cargo).toContain(
      'tauri-plugin-persisted-scope = { version = "2", features = ["protocol-asset"] }',
    )
    expect(fsPlugin).toBeGreaterThan(-1)
    expect(persistedScopePlugin).toBeGreaterThan(fsPlugin)
  })

  it("Windows release bundles Git Bash before the Tauri build", () => {
    const workflow = readProjectFile(".github/workflows/release.yml")
    const bundleStep = workflow.indexOf("name: Bundle PortableGit")
    const buildStep = workflow.indexOf("name: Build NSIS installer + updater artifacts")

    expect(bundleStep).toBeGreaterThan(-1)
    expect(buildStep).toBeGreaterThan(bundleStep)
    expect(workflow).toContain("usr/bin/bash.exe")
  })
})
