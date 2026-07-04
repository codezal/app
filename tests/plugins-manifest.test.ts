import { describe, it, expect } from "vitest"
import {
  parsePluginManifest,
  parseMarketplacePluginManifest,
  parseMarketplaceIndex,
  satisfiesMinVersion,
} from "@/lib/plugins/manifest"

const BASE_MANIFEST = {
  name: "my-plugin",
  version: "1.0.0",
  description: "A test plugin",
  license: "MIT",
  author: { name: "Test Author" },
  permissions: [],
  contributes: {},
}

function json(obj: object) {
  return JSON.stringify(obj)
}

describe("parsePluginManifest", () => {
  it("geçerli manifest parse edilir", () => {
    const r = parsePluginManifest(json(BASE_MANIFEST))
    expect(r.name).toBe("my-plugin")
    expect(r.version).toBe("1.0.0")
  })

  it("geçersiz JSON → fırlatır", () => {
    expect(() => parsePluginManifest("{bad")).toThrow(/parse/)
  })

  it("name kebab-case değilse → fırlatır", () => {
    expect(() =>
      parsePluginManifest(json({ ...BASE_MANIFEST, name: "MyPlugin" })),
    ).toThrow(/kebab/)
  })

  it("name _ içerirse → fırlatır", () => {
    expect(() =>
      parsePluginManifest(json({ ...BASE_MANIFEST, name: "my_plugin" })),
    ).toThrow(/kebab/)
  })

  it("version semver değilse → fırlatır", () => {
    expect(() =>
      parsePluginManifest(json({ ...BASE_MANIFEST, version: "v1.0" })),
    ).toThrow(/semver/)
  })

  it("pre-release semver kabul edilir", () => {
    const r = parsePluginManifest(json({ ...BASE_MANIFEST, version: "1.0.0-beta.1" }))
    expect(r.version).toBe("1.0.0-beta.1")
  })

  it("description eksik → fırlatır", () => {
    expect(() =>
      parsePluginManifest(json({ ...BASE_MANIFEST, description: undefined })),
    ).toThrow(/description/)
  })

  it("license boş → fırlatır", () => {
    expect(() =>
      parsePluginManifest(json({ ...BASE_MANIFEST, license: "" })),
    ).toThrow(/license/)
  })

  it("author.name eksik → fırlatır", () => {
    expect(() =>
      parsePluginManifest(json({ ...BASE_MANIFEST, author: { email: "x@y.com" } })),
    ).toThrow(/author/)
  })

  it("permissions array değilse → fırlatır", () => {
    expect(() =>
      parsePluginManifest(json({ ...BASE_MANIFEST, permissions: "shell.exec" })),
    ).toThrow(/permissions/)
  })

  it("geçersiz permission → fırlatır", () => {
    expect(() =>
      parsePluginManifest(json({ ...BASE_MANIFEST, permissions: ["invalid.perm"] })),
    ).toThrow(/permission/)
  })

  it("geçerli permission kabul edilir", () => {
    const r = parsePluginManifest(
      json({ ...BASE_MANIFEST, permissions: ["shell.exec", "filesystem.read"] }),
    )
    expect(r.permissions).toContain("shell.exec")
  })

  it("contributes eksik → fırlatır", () => {
    expect(() =>
      parsePluginManifest(json({ ...BASE_MANIFEST, contributes: undefined })),
    ).toThrow(/contributes/)
  })

  it("network.allowedHosts string array → kabul edilir", () => {
    const r = parsePluginManifest(
      json({ ...BASE_MANIFEST, network: { allowedHosts: ["api.example.com"] } }),
    )
    expect(r).toBeTruthy()
  })

  it("network.allowedHosts string array değilse → fırlatır", () => {
    expect(() =>
      parsePluginManifest(json({ ...BASE_MANIFEST, network: { allowedHosts: "host" } })),
    ).toThrow(/allowedHosts/)
  })

  it("signature string → kabul edilir", () => {
    const r = parsePluginManifest(
      json({ ...BASE_MANIFEST, signature: "base64sighere" }),
    )
    expect(r).toBeTruthy()
  })

  it("signature string değilse → fırlatır", () => {
    expect(() =>
      parsePluginManifest(json({ ...BASE_MANIFEST, signature: 123 })),
    ).toThrow(/signature/)
  })

  it("requires.codezalMinVersion semver → kabul edilir", () => {
    const r = parsePluginManifest(
      json({ ...BASE_MANIFEST, requires: { codezalMinVersion: "0.2.0" } }),
    )
    expect(r.requires?.codezalMinVersion).toBe("0.2.0")
  })

  it("requires.codezalMinVersion semver değilse → fırlatır", () => {
    expect(() =>
      parsePluginManifest(json({ ...BASE_MANIFEST, requires: { codezalMinVersion: "0.2" } })),
    ).toThrow(/codezalMinVersion/)
  })

  it("requires obje değilse → fırlatır", () => {
    expect(() =>
      parsePluginManifest(json({ ...BASE_MANIFEST, requires: "0.2.0" })),
    ).toThrow(/requires/)
  })
})

describe("satisfiesMinVersion", () => {
  it("current > min → true", () => {
    expect(satisfiesMinVersion("1.2.3", "1.0.0")).toBe(true)
    expect(satisfiesMinVersion("0.2.0", "0.1.0")).toBe(true)
    expect(satisfiesMinVersion("1.0.0", "0.9.9")).toBe(true)
  })

  it("current == min → true", () => {
    expect(satisfiesMinVersion("0.2.0", "0.2.0")).toBe(true)
  })

  it("current < min → false", () => {
    expect(satisfiesMinVersion("0.1.0", "0.2.0")).toBe(false)
    expect(satisfiesMinVersion("0.1.0", "99.0.0")).toBe(false)
    expect(satisfiesMinVersion("1.2.3", "1.2.4")).toBe(false)
  })

  it("prerelease etiketi yok sayılır (çekirdek karşılaştırılır)", () => {
    expect(satisfiesMinVersion("1.0.0-beta.1", "1.0.0")).toBe(true)
    expect(satisfiesMinVersion("0.2.0", "0.2.0-rc.1")).toBe(true)
  })

  it("geçersiz girdi → false (fail-closed)", () => {
    expect(satisfiesMinVersion("abc", "1.0.0")).toBe(false)
    expect(satisfiesMinVersion("1.0.0", "x.y.z")).toBe(false)
  })
})

const MARKETPLACE_BASE = {
  ...BASE_MANIFEST,
  channel: "community",
  verified: false,
  source: { type: "git-repo", repo: "https://github.com/x/y", sha: "abc123" },
}

describe("parseMarketplacePluginManifest", () => {
  it("geçerli marketplace manifest parse edilir", () => {
    const r = parseMarketplacePluginManifest(json(MARKETPLACE_BASE))
    expect(r.name).toBe("my-plugin")
  })

  it("geçersiz channel → fırlatır", () => {
    expect(() =>
      parseMarketplacePluginManifest(json({ ...MARKETPLACE_BASE, channel: "unknown" })),
    ).toThrow(/channel/)
  })

  it("codezal-curated channel kabul edilir", () => {
    const r = parseMarketplacePluginManifest(
      json({ ...MARKETPLACE_BASE, channel: "codezal-curated" }),
    )
    expect(r).toBeTruthy()
  })

  it("verified bool değilse → fırlatır", () => {
    expect(() =>
      parseMarketplacePluginManifest(json({ ...MARKETPLACE_BASE, verified: "yes" })),
    ).toThrow(/verified/)
  })

  it("git-subdir source path zorunlu", () => {
    expect(() =>
      parseMarketplacePluginManifest(
        json({
          ...MARKETPLACE_BASE,
          source: { type: "git-subdir", repo: "https://x", sha: "abc" },
        }),
      ),
    ).toThrow(/path/)
  })

  it("git-subdir source tam → kabul edilir", () => {
    const r = parseMarketplacePluginManifest(
      json({
        ...MARKETPLACE_BASE,
        source: { type: "git-subdir", repo: "https://x", sha: "abc", path: "plugins/x" },
      }),
    )
    expect(r).toBeTruthy()
  })
})

describe("parseMarketplaceIndex", () => {
  it("geçerli index parse edilir", () => {
    const raw = json({
      version: 1,
      name: "Codezal Marketplace",
      plugins: [
        { id: "my-plugin", name: "My Plugin", manifestPath: "plugins/my-plugin/manifest.json" },
      ],
    })
    const r = parseMarketplaceIndex(raw)
    expect(r.plugins).toHaveLength(1)
  })

  it("geçersiz JSON → fırlatır", () => {
    expect(() => parseMarketplaceIndex("{bad")).toThrow()
  })

  it("version eksik → fırlatır", () => {
    expect(() =>
      parseMarketplaceIndex(json({ name: "x", plugins: [] })),
    ).toThrow(/version/)
  })

  it("plugins array değilse → fırlatır", () => {
    expect(() =>
      parseMarketplaceIndex(json({ version: 1, name: "x", plugins: {} })),
    ).toThrow(/plugins/)
  })

  it("plugin entry eksik alan → fırlatır", () => {
    expect(() =>
      parseMarketplaceIndex(json({ version: 1, name: "x", plugins: [{ id: "x" }] })),
    ).toThrow(/eksik/)
  })
})
