import { describe, it, expect } from "vitest"
import { classifySensitiveWrite, sensitiveWriteFindings } from "@/lib/security/sensitive-paths"

describe("classifySensitiveWrite", () => {
  it("shell startup files → shell-startup", () => {
    for (const p of [
      "~/.zshrc",
      "/Users/erhan/.zshenv",
      "/home/x/.bashrc",
      "~/.bash_login",
      "~/.profile",
      "config.fish",
      "~/.config/fish/config.fish",
      "~/.config/fish/conf.d/foo.fish",
    ]) {
      expect(classifySensitiveWrite(p)?.rule, p).toBe("shell-startup")
    }
  })

  it("Windows PowerShell $PROFILE → shell-startup (backslash + mixed case)", () => {
    expect(
      classifySensitiveWrite("C:\\Users\\erhan\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1")?.rule,
    ).toBe("shell-startup")
    expect(classifySensitiveWrite("profile.ps1")?.rule).toBe("shell-startup")
  })

  it("direnv .envrc → direnv-envrc", () => {
    expect(classifySensitiveWrite("project/.envrc")?.rule).toBe("direnv-envrc")
  })

  it("Git config → git-config", () => {
    expect(classifySensitiveWrite("~/.config/git/config")?.rule).toBe("git-config")
    expect(classifySensitiveWrite("~/.gitconfig")?.rule).toBe("git-config")
    expect(classifySensitiveWrite("myrepo/.git/config")?.rule).toBe("git-config")
  })

  it("Git hooks → git-hook (checked before .git/config)", () => {
    expect(classifySensitiveWrite("repo/.git/hooks/pre-commit")?.rule).toBe("git-hook")
    expect(classifySensitiveWrite(".githooks/pre-push")?.rule).toBe("git-hook")
  })

  it("build-tool configs → build-config (workspace-relative or absolute)", () => {
    for (const p of [
      ".npmrc",
      "project/.npmrc",
      "C:\\code\\app\\.npmrc",
      ".yarnrc",
      ".yarnrc.yml",
      "bunfig.toml",
      ".bazelrc",
      ".bazelproject",
      ".pre-commit-config.yaml",
    ]) {
      expect(classifySensitiveWrite(p)?.rule, p).toBe("build-config")
    }
  })

  it("devcontainer → devcontainer", () => {
    expect(classifySensitiveWrite(".devcontainer/devcontainer.json")?.rule).toBe("devcontainer")
  })

  it("VS Code tasks/launch → vscode-tasks, but not settings.json", () => {
    expect(classifySensitiveWrite(".vscode/tasks.json")?.rule).toBe("vscode-tasks")
    expect(classifySensitiveWrite(".vscode/launch.json")?.rule).toBe("vscode-tasks")
    expect(classifySensitiveWrite(".vscode/settings.json")).toBeNull()
  })

  it("ordinary files → null (incl. deliberately-excluded package.json / Makefile)", () => {
    for (const p of [
      "src/foo.ts",
      "README.md",
      "package.json",
      "Makefile",
      ".gitignore",
      "notes/.config-notes.txt",
      "",
    ]) {
      expect(classifySensitiveWrite(p), p).toBeNull()
    }
  })
})

describe("sensitiveWriteFindings", () => {
  it("write_file to a shell rc → one critical, path-class finding (line 0)", () => {
    const f = sensitiveWriteFindings("write_file", { path: "~/.zshrc", content: "x" })
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ rule: "shell-startup", severity: "critical", line: 0 })
    expect(f[0].excerpt).toBe("~/.zshrc")
  })

  it("edit_file to an ordinary source file → no findings", () => {
    expect(sensitiveWriteFindings("edit_file", { path: "src/app.ts", new_string: "x" })).toEqual([])
  })

  it("apply_patch: Add/Update/Move targets classified; Delete excluded", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: .npmrc",
      "+ignore-scripts=false",
      "*** Update File: src/main.ts",
      "@@",
      "-a",
      "+b",
      "*** Delete File: ~/.zshrc",
      "*** End Patch",
    ].join("\n")
    const f = sensitiveWriteFindings("apply_patch", { patch })
    // .npmrc (add) flagged; src/main.ts (update) ignored; ~/.zshrc (delete) excluded.
    expect(f.map((x) => x.rule)).toEqual(["build-config"])
    expect(f[0].excerpt).toBe(".npmrc")
  })

  it("apply_patch Move to a shell rc is a write → flagged", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: notes.txt",
      "*** Move to: .bashrc",
      "@@",
      " ctx",
      "*** End Patch",
    ].join("\n")
    expect(sensitiveWriteFindings("apply_patch", { patch }).map((x) => x.rule)).toEqual(["shell-startup"])
  })

  it("dedupes the same destination touched twice", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: .npmrc",
      "+x=1",
      "*** Update File: .npmrc",
      "@@",
      "+y=2",
      "*** End Patch",
    ].join("\n")
    expect(sensitiveWriteFindings("apply_patch", { patch })).toHaveLength(1)
  })

  it("non-write tools → no findings", () => {
    expect(sensitiveWriteFindings("bash", { command: "echo hi > ~/.zshrc" })).toEqual([])
    expect(sensitiveWriteFindings("read_file", { path: "~/.zshrc" })).toEqual([])
  })
})
