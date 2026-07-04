import { describe, it, expect, beforeEach } from "vitest"
import {
  listPluginMcps,
  _registerPluginMcp,
  _unregisterPluginMcps,
  _clearPluginMcps,
} from "@/lib/mcp"
import type { McpServerConfig } from "@/lib/mcp"

function mcpServer(name: string, pluginId?: string): McpServerConfig {
  return {
    name,
    url: "https://mcp.example.com",
    transport: "http",
    enabled: true,
    ...(pluginId ? { pluginId } : {}),
  }
}

beforeEach(() => _clearPluginMcps())

describe("plugin MCP kayıt", () => {
  it("başlangıçta boş", () => {
    expect(listPluginMcps()).toEqual([])
  })

  it("_registerPluginMcp ekler", () => {
    _registerPluginMcp(mcpServer("fs-server", "my-plugin"))
    expect(listPluginMcps()).toHaveLength(1)
    expect(listPluginMcps()[0].name).toBe("fs-server")
  })

  it("aynı name+pluginId → günceller (upsert)", () => {
    _registerPluginMcp(mcpServer("s", "p"))
    _registerPluginMcp({ ...mcpServer("s", "p"), url: "https://new.example.com" })
    const list = listPluginMcps()
    expect(list).toHaveLength(1)
    expect(list[0].url).toBe("https://new.example.com")
  })

  it("farklı pluginId → ayrı kayıt", () => {
    _registerPluginMcp(mcpServer("s", "plugin-a"))
    _registerPluginMcp(mcpServer("s", "plugin-b"))
    expect(listPluginMcps()).toHaveLength(2)
  })

  it("_unregisterPluginMcps plugin'e ait sunucuları kaldırır", () => {
    _registerPluginMcp(mcpServer("a", "plugin-a"))
    _registerPluginMcp(mcpServer("b", "plugin-b"))
    _unregisterPluginMcps("plugin-a")
    const names = listPluginMcps().map((m) => m.name)
    expect(names).not.toContain("a")
    expect(names).toContain("b")
  })

  it("_clearPluginMcps hepsini kaldırır", () => {
    _registerPluginMcp(mcpServer("a", "p1"))
    _registerPluginMcp(mcpServer("b", "p2"))
    _clearPluginMcps()
    expect(listPluginMcps()).toEqual([])
  })

  it("listPluginMcps kopya döner (mutasyon koruması)", () => {
    _registerPluginMcp(mcpServer("a", "p"))
    const list = listPluginMcps()
    list.push(mcpServer("injected"))
    expect(listPluginMcps()).toHaveLength(1) // orijinal etkilenmemeli
  })
})
