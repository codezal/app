import { describe, expect, it } from "vitest"
import {
  claimsCompletion,
  needsCompletionNudge,
  requestsChanges,
  turnRanWriteTool,
} from "@/lib/stream/completion-guard"
import type { Part } from "@/store/types"

const text = (t: string): Part => ({ type: "text", text: t })
const call = (toolName: string): Part => ({
  type: "tool-call",
  toolCallId: "c1",
  toolName,
  input: {},
})

describe("turnRanWriteTool", () => {
  it("write aracı çağrısını yakalar", () => {
    expect(turnRanWriteTool([call("edit_file")])).toBe(true)
    expect(turnRanWriteTool([call("write_file")])).toBe(true)
    expect(turnRanWriteTool([call("apply_patch")])).toBe(true)
    expect(turnRanWriteTool([call("bash")])).toBe(true)
  })

  it("salt-okunur araçlar yazar sayılmaz", () => {
    expect(turnRanWriteTool([call("read_file"), call("grep")])).toBe(false)
    expect(turnRanWriteTool([])).toBe(false)
  })

  it("tool-result üzerinden de yakalar", () => {
    const result: Part = {
      type: "tool-result",
      toolCallId: "c1",
      toolName: "write_file",
      output: "ok",
    }
    expect(turnRanWriteTool([result])).toBe(true)
  })
})

describe("claimsCompletion", () => {
  it("TR tamamlama iddialarını yakalar", () => {
    expect(claimsCompletion("Hepsi tamamlandı. İşte eklenen her şey:")).toBe(true)
    expect(claimsCompletion("Özelliği ekledim ve test ettim.")).toBe(true)
    expect(claimsCompletion("Hata düzeltildi, dosya güncellendi.")).toBe(true)
  })

  it("EN tamamlama iddialarını yakalar", () => {
    expect(claimsCompletion("All done — everything is implemented.")).toBe(true)
    expect(claimsCompletion("I've added the new feature.")).toBe(true)
    expect(claimsCompletion("We have fixed the bug.")).toBe(true)
  })

  it("nötr anlatımı iddia saymaz", () => {
    expect(claimsCompletion("Bu fonksiyon listeye eleman ekler.")).toBe(false)
    expect(claimsCompletion("The function adds an item to the list.")).toBe(false)
    expect(claimsCompletion("Şunları yapabilirim: ekleme, silme.")).toBe(false)
  })
})

describe("requestsChanges", () => {
  it("TR emir kiplerini yakalar", () => {
    expect(requestsChanges(["Hepsini planla sırasıyla yap"])).toBe(true)
    expect(requestsChanges(["Şu hatayı düzelt"])).toBe(true)
    expect(requestsChanges(["Yeni düşman tipleri ekle"])).toBe(true)
  })

  it("EN emirleri yakalar", () => {
    expect(requestsChanges(["implement the super ability"])).toBe(true)
    expect(requestsChanges(["fix this bug"])).toBe(true)
  })

  it("soru kalıplarını emir saymaz", () => {
    expect(requestsChanges(["neler yapabilirsin?"])).toBe(false)
    expect(requestsChanges(["neyi değiştirdin?"])).toBe(false)
  })

  it("son mesajlardan biri emir içeriyorsa yeterli", () => {
    // Kullanıcının gerçek senaryosu: önce emir, sonra saf özellik listesi.
    expect(
      requestsChanges([
        "Hepsini planla sırasıyla yap",
        "Süper yetenek — hasarla dolan bar\n3 farklı harita",
      ]),
    ).toBe(true)
  })
})

describe("needsCompletionNudge", () => {
  it("asıl senaryo: iddia var, yazma yok → nudge", () => {
    expect(
      needsCompletionNudge({
        parts: [text("Hepsi tamamlandı. İşte eklenen her şey: Süper yetenek…")],
        finalText: "Hepsi tamamlandı. İşte eklenen her şey: Süper yetenek…",
        recentUserTexts: ["Hepsini planla sırasıyla yap"],
      }),
    ).toBe(true)
  })

  it("yazma aracı çalıştıysa nudge yok", () => {
    expect(
      needsCompletionNudge({
        parts: [call("edit_file"), text("Tamamlandı, özelliği ekledim.")],
        finalText: "Tamamlandı, özelliği ekledim.",
        recentUserTexts: ["özelliği ekle"],
      }),
    ).toBe(false)
  })

  it("iddia yoksa nudge yok (salt soru-cevap)", () => {
    expect(
      needsCompletionNudge({
        parts: [text("Bu fonksiyon listeye eleman ekler.")],
        finalText: "Bu fonksiyon listeye eleman ekler.",
        recentUserTexts: ["bu kod ne yapıyor"],
      }),
    ).toBe(false)
  })

  it("kullanıcı değişiklik istemediyse nudge yok", () => {
    expect(
      needsCompletionNudge({
        parts: [text("İnceledim: 3 hata var.")],
        finalText: "İnceledim: 3 hata var.",
        recentUserTexts: ["şu dosyayı incele"],
      }),
    ).toBe(false)
  })

  it("boş final metni nudge tetiklemez", () => {
    expect(
      needsCompletionNudge({
        parts: [],
        finalText: "  ",
        recentUserTexts: ["bunu düzelt"],
      }),
    ).toBe(false)
  })
})
