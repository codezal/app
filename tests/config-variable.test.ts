import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
}))
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(),
}))
vi.mock("@/lib/providers/env-reader", () => ({
  readEnvVar: vi.fn(),
}))

import { readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import { readEnvVar } from "@/lib/providers/env-reader"
import { resolveSecret, substituteText } from "@/lib/config/variable"

const mockReadTextFile = vi.mocked(readTextFile)
const mockHomeDir = vi.mocked(homeDir)
const mockReadEnvVar = vi.mocked(readEnvVar)

beforeEach(() => {
  vi.resetAllMocks()
  mockHomeDir.mockResolvedValue("/home/user")
})

// ─── resolveSecret ────────────────────────────────────────────────────────────

describe("resolveSecret", () => {
  it("undefined → undefined döner", async () => {
    expect(await resolveSecret(undefined)).toBeUndefined()
  })

  it("token içermeyen string değişmeden döner", async () => {
    expect(await resolveSecret("sk-plaintext-key")).toBe("sk-plaintext-key")
  })

  it("{env:VAR} → readEnvVar sonucu", async () => {
    mockReadEnvVar.mockResolvedValue("my-secret")
    expect(await resolveSecret("{env:API_KEY}")).toBe("my-secret")
    expect(mockReadEnvVar).toHaveBeenCalledWith("API_KEY")
  })

  it("{env:VAR} boşluklu isim trim edilir", async () => {
    mockReadEnvVar.mockResolvedValue("val")
    await resolveSecret("{env:  SPACED  }")
    expect(mockReadEnvVar).toHaveBeenCalledWith("SPACED")
  })

  it("{env:VAR} bulunamazsa boş string döner", async () => {
    mockReadEnvVar.mockResolvedValue(undefined)
    expect(await resolveSecret("{env:MISSING}")).toBe("")
  })

  it("{file:path} → dosya içeriği trim edilmiş döner", async () => {
    mockReadTextFile.mockResolvedValue("  file-secret\n")
    expect(await resolveSecret("{file:/abs/path/key}")).toBe("file-secret")
  })

  it("{file:~/path} → homeDir ile expand edilir", async () => {
    mockReadTextFile.mockResolvedValue("home-val")
    await resolveSecret("{file:~/.secrets/key}")
    expect(mockReadTextFile).toHaveBeenCalledWith("/home/user/.secrets/key")
  })

  it("{file:path} dosya yoksa boş string döner", async () => {
    mockReadTextFile.mockRejectedValue(new Error("not found"))
    expect(await resolveSecret("{file:/missing/file}")).toBe("")
  })

  it("token değil ama süslü parantez içeren string değişmeden döner", async () => {
    expect(await resolveSecret("{notatoken}")).toBe("{notatoken}")
  })

  it("token + ek metin — pure-token eşleşmez, değişmez", async () => {
    expect(await resolveSecret("prefix {env:KEY}")).toBe("prefix {env:KEY}")
  })
})

// ─── substituteText ───────────────────────────────────────────────────────────

describe("substituteText", () => {
  it("token içermeyen metin değişmez", async () => {
    expect(await substituteText('{"k":"v"}')).toBe('{"k":"v"}')
  })

  it("{env:VAR} process.env'den çözülür", async () => {
    process.env._TEST_SUB_VAR = "hello"
    const result = await substituteText('{"k":"{env:_TEST_SUB_VAR}"}')
    delete process.env._TEST_SUB_VAR
    expect(result).toBe('{"k":"hello"}')
  })

  it("bilinmeyen {env:VAR} varsayılan missing:empty → boş string", async () => {
    delete process.env._MISSING_VAR
    const result = await substituteText("{env:_MISSING_VAR}")
    expect(result).toBe("")
  })

  it("bilinmeyen {env:VAR} missing:keep → token korunur", async () => {
    delete process.env._MISSING_VAR
    const result = await substituteText("{env:_MISSING_VAR}", { missing: "keep" })
    expect(result).toBe("{env:_MISSING_VAR}")
  })

  it("{file:path} dosya içeriğiyle değiştirilir", async () => {
    mockReadTextFile.mockResolvedValue("secret\n")
    const result = await substituteText('{"k":"{file:/tmp/s}"}')
    expect(result).toBe('{"k":"secret"}')
  })

  it("{file:~/path} homeDir ile expand edilir", async () => {
    mockReadTextFile.mockResolvedValue("v")
    await substituteText("{file:~/.key}")
    expect(mockReadTextFile).toHaveBeenCalledWith("/home/user/.key")
  })

  it("{file:path} dosya yoksa missing:empty → boş string", async () => {
    mockReadTextFile.mockRejectedValue(new Error("enoent"))
    const result = await substituteText('{"k":"{file:/no}"}')
    expect(result).toBe('{"k":""}')
  })

  it("{file:path} dosya yoksa missing:keep → token korunur", async () => {
    mockReadTextFile.mockRejectedValue(new Error("enoent"))
    const result = await substituteText("{file:/no}", { missing: "keep" })
    expect(result).toBe("{file:/no}")
  })

  it("çok satırlı dosya içeriği JSON string'e escape edilir", async () => {
    mockReadTextFile.mockResolvedValue('line1\nline2')
    const result = await substituteText('{"k":"{file:/f}"}')
    // JSON.stringify ile escape edilmeli → \n
    expect(result).toBe('{"k":"line1\\nline2"}')
  })

  it("aynı metinde birden fazla token çözülür", async () => {
    process.env._T1 = "A"
    process.env._T2 = "B"
    const result = await substituteText("{env:_T1} and {env:_T2}")
    delete process.env._T1
    delete process.env._T2
    expect(result).toBe("A and B")
  })

  it("env ve file token aynı metinde birlikte çalışır", async () => {
    process.env._EVAR = "from-env"
    mockReadTextFile.mockResolvedValue("from-file")
    const result = await substituteText("{env:_EVAR}:{file:/f}")
    delete process.env._EVAR
    expect(result).toBe("from-env:from-file")
  })

  // ─── P2: async env (Tauri-only env) ──────────────────────────────────────────

  it("{env:VAR} önce Tauri readEnvVar'dan çözülür (process.env'i geçersiz kılar)", async () => {
    mockReadEnvVar.mockResolvedValue("tauri-only")
    delete process.env._TAURI_ONLY
    const result = await substituteText("{env:_TAURI_ONLY}")
    expect(result).toBe("tauri-only")
    expect(mockReadEnvVar).toHaveBeenCalledWith("_TAURI_ONLY")
  })

  it("{env:VAR} Tauri null ise process.env'e düşer", async () => {
    mockReadEnvVar.mockResolvedValue(null)
    process.env._PROC_FALLBACK = "proc-val"
    const result = await substituteText("{env:_PROC_FALLBACK}")
    delete process.env._PROC_FALLBACK
    expect(result).toBe("proc-val")
  })


  it("// yorum satırındaki {file:} token resolve edilmez", async () => {
    const result = await substituteText('// örnek: {file:/secret}\n{"k":"v"}')
    expect(result).toBe('// örnek: {file:/secret}\n{"k":"v"}')
    expect(mockReadTextFile).not.toHaveBeenCalled()
  })

  it("// yorum satırındaki {env:} token resolve edilmez (env sızdırmaz)", async () => {
    mockReadEnvVar.mockResolvedValue("leak")
    const result = await substituteText('// {env:SECRET}\n{"k":"v"}')
    expect(result).toBe('// {env:SECRET}\n{"k":"v"}')
    expect(mockReadEnvVar).not.toHaveBeenCalled()
  })

  it("aynı satırda yorum olmayan token normal çözülür", async () => {
    mockReadTextFile.mockResolvedValue("real")
    const result = await substituteText('// {file:/commented}\n{"k":"{file:/active}"}')
    expect(result).toBe('// {file:/commented}\n{"k":"real"}')
    expect(mockReadTextFile).toHaveBeenCalledTimes(1)
    expect(mockReadTextFile).toHaveBeenCalledWith("/active")
  })


  it("dir verilince relative {file:} configDir'e göre çözülür", async () => {
    mockReadTextFile.mockResolvedValue("v")
    await substituteText("{file:sub/key}", { dir: "/workspace/.codezal" })
    expect(mockReadTextFile).toHaveBeenCalledWith("/workspace/.codezal/sub/key")
  })

  it("dir verilse de absolute {file:} path değişmeden kalır", async () => {
    mockReadTextFile.mockResolvedValue("v")
    await substituteText("{file:/abs/key}", { dir: "/workspace/.codezal" })
    expect(mockReadTextFile).toHaveBeenCalledWith("/abs/key")
  })

  it("dir yokken relative {file:} ham path olarak kalır (geriye uyumlu)", async () => {
    mockReadTextFile.mockResolvedValue("v")
    await substituteText("{file:rel/key}")
    expect(mockReadTextFile).toHaveBeenCalledWith("rel/key")
  })
})


describe("substituteText untrusted scope", () => {
  const opts = { dir: "/ws/.codezal", untrusted: true as const }

  it("absolute {file:} okunmaz (workspace dışı dosya sızdırmaz)", async () => {
    mockReadTextFile.mockResolvedValue("SECRET")
    const out = await substituteText('{"m":"{file:/etc/passwd}"}', opts)
    expect(mockReadTextFile).not.toHaveBeenCalled()
    expect(out).toBe('{"m":""}')
  })

  it("~ ile başlayan {file:} okunmaz (home dosyası sızdırmaz)", async () => {
    mockReadTextFile.mockResolvedValue("KEY")
    await substituteText("{file:~/.ssh/id_rsa}", opts)
    expect(mockReadTextFile).not.toHaveBeenCalled()
  })

  it(".. ile workspace dışına kaçan {file:} okunmaz", async () => {
    mockReadTextFile.mockResolvedValue("X")
    await substituteText("{file:../../etc/passwd}", opts)
    expect(mockReadTextFile).not.toHaveBeenCalled()
  })

  it("{env:} çözülmez (host env sızdırmaz)", async () => {
    mockReadEnvVar.mockResolvedValue("AKIA-leak")
    const out = await substituteText('{"m":"{env:AWS_SECRET_ACCESS_KEY}"}', opts)
    expect(mockReadEnvVar).not.toHaveBeenCalled()
    expect(out).toBe('{"m":""}')
  })

  it("güvenli workspace-göreli {file:} HÂLÂ okunur (özellik korunur)", async () => {
    mockReadTextFile.mockResolvedValue("v")
    await substituteText("{file:sub/key}", opts)
    expect(mockReadTextFile).toHaveBeenCalledWith("/ws/.codezal/sub/key")
  })
})
