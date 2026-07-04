import { describe, it, expect } from "vitest"
import { parseMcpServersJson } from "@/lib/mcp"

describe("parseMcpServersJson", () => {
  it("mcpServers kapsayıcılı stdio entry", () => {
    const txt = JSON.stringify({
      mcpServers: {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "$HOME"],
        },
      },
    })
    const out = parseMcpServersJson(txt)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      name: "filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "$HOME"],
      enabled: true,
    })
  })

  it("üst kapsayıcısız map", () => {
    const txt = JSON.stringify({
      remote: { url: "https://mcp.example.com/v1/mcp" },
    })
    const out = parseMcpServersJson(txt)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      name: "remote",
      transport: "http",
      url: "https://mcp.example.com/v1/mcp",
    })
  })

  it("http + headers", () => {
    const txt = JSON.stringify({
      mcpServers: {
        gh: {
          url: "https://api.github.com/mcp",
          headers: { Authorization: "Bearer xyz" },
        },
      },
    })
    const out = parseMcpServersJson(txt)
    expect(out[0].transport).toBe("http")
    expect(out[0].headers).toEqual({ Authorization: "Bearer xyz" })
  })

  it("type=sse explicit override", () => {
    const txt = JSON.stringify({
      legacy: { url: "https://x.com", type: "sse" },
    })
    const out = parseMcpServersJson(txt)
    expect(out[0].transport).toBe("sse")
  })

  it("transport=stdio explicit (url da olsa stdio kazanır)", () => {
    const txt = JSON.stringify({
      x: { url: "", command: "node", transport: "stdio" },
    })
    const out = parseMcpServersJson(txt)
    expect(out[0].transport).toBe("stdio")
  })

  it("disabled=true → enabled:false", () => {
    const txt = JSON.stringify({
      x: { url: "https://x", disabled: true },
    })
    const out = parseMcpServersJson(txt)
    expect(out[0].enabled).toBe(false)
  })

  it("stdio env + cwd", () => {
    const txt = JSON.stringify({
      mcpServers: {
        x: {
          command: "uvx",
          args: ["mcp-server"],
          env: { API_KEY: "k" },
          cwd: "/tmp",
        },
      },
    })
    const out = parseMcpServersJson(txt)
    expect(out[0].env).toEqual({ API_KEY: "k" })
    expect(out[0].cwd).toBe("/tmp")
  })

  it("çoklu sunucu", () => {
    const txt = JSON.stringify({
      mcpServers: {
        a: { command: "npx", args: ["a"] },
        b: { url: "https://b" },
      },
    })
    const out = parseMcpServersJson(txt)
    expect(out).toHaveLength(2)
    expect(out.map((s) => s.name).sort()).toEqual(["a", "b"])
  })

  it("geçersiz JSON → hata", () => {
    expect(() => parseMcpServersJson("{not json")).toThrow(/Invalid JSON/)
  })

  it("command + url ikisi de yoksa → hata", () => {
    const txt = JSON.stringify({ x: { name: "x" } })
    expect(() => parseMcpServersJson(txt)).toThrow(/command or url/)
  })

  it("boş map → hata", () => {
    expect(() => parseMcpServersJson("{}")).toThrow(/No servers found/)
  })

  it("kök nesne değil → hata", () => {
    expect(() => parseMcpServersJson("[1,2]")).toThrow(/No servers found/)
  })

  it("oauth:false → http entry'de oauth devre dışı", () => {
    const txt = JSON.stringify({ x: { url: "https://x", oauth: false } })
    const out = parseMcpServersJson(txt)
    expect(out[0].oauth).toBe(false)
  })

  it("oauth objesi → clientId/scope korunur", () => {
    const txt = JSON.stringify({
      x: { url: "https://x", oauth: { clientId: "cid", scope: "read" } },
    })
    const out = parseMcpServersJson(txt)
    expect(out[0].oauth).toMatchObject({ clientId: "cid", scope: "read" })
  })

  it("pozitif timeout sayısı parse edilir", () => {
    const txt = JSON.stringify({ x: { url: "https://x", timeout: 5000 } })
    const out = parseMcpServersJson(txt)
    expect(out[0].timeout).toBe(5000)
  })

  it("0/negatif timeout yok sayılır", () => {
    const txt = JSON.stringify({ x: { url: "https://x", timeout: 0 } })
    const out = parseMcpServersJson(txt)
    expect(out[0].timeout).toBeUndefined()
  })

  it("stdio entry oauth alanı almaz", () => {
    const txt = JSON.stringify({ x: { command: "npx", args: ["s"], oauth: false } })
    const out = parseMcpServersJson(txt)
    expect(out[0].oauth).toBeUndefined()
  })
})
