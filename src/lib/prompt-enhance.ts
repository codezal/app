import { streamText, tool, stepCountIs } from "ai"
import { z } from "zod"
import { buildLanguageModel, type ProviderId } from "@/lib/providers"
import { isCodingAgentGated } from "@/lib/providers/provider-quirks"
import { pickSmallModel } from "@/lib/small-model"
import type { ProvidersCatalog } from "@/lib/providers-catalog"
import type { Settings } from "@/store/types"

const SYSTEM =
  "Sen bir prompt geliştirme asistanısın. Kullanıcının yazdığı ham prompt'u daha NET, " +
  "yapılandırılmış ve eyleme dönük hale getir: amacı KORU, kullanıcının yazdığı DİLİ " +
  "koru, eksik bağlamı makul biçimde aç. YENİ gereksinim uydurma, varsayım ekleme, soru " +
  "SORMA ve cevabı yazma. Yalnız geliştirilmiş prompt METNİNİ döndür — markdown çiti, " +
  "açıklama, ön söz veya tırnak YOK."

function stripFence(raw: string): string {
  const t = raw.replace(/\r\n/g, "\n").trim()
  const m = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(t)
  return m ? m[1].trim() : t
}

export async function enhancePrompt(args: {
  text: string
  providerId: ProviderId
  settings: Settings
  fallbackModel?: string
  signal?: AbortSignal
}): Promise<string> {
  const catalog = args.settings.providerCatalog?.data as ProvidersCatalog | undefined
  const modelId = pickSmallModel(catalog, args.providerId) ?? args.fallbackModel
  if (!modelId) throw new Error("Kullanılabilir model yok")

  const model = await buildLanguageModel({
    providerId: args.providerId,
    modelId,
    settings: args.settings,
  })
  // Gated provider'lar (Kimi For Coding, Z.AI Coding) bare generate'i 403'ler →
  const gated = isCodingAgentGated(args.providerId)
  const tools = gated
    ? { noop: tool({ description: "unused", inputSchema: z.object({}), execute: async () => "" }) }
    : undefined
  const result = streamText({
    model,
    system: SYSTEM,
    prompt: `Ham prompt:\n\n${args.text}\n\nGeliştirilmiş prompt:`,
    tools,
    toolChoice: gated ? "none" : undefined,
    stopWhen: stepCountIs(1),
    abortSignal: args.signal,
  })
  let text = ""
  for await (const chunk of result.fullStream) {
    if (chunk.type === "text-delta") text += chunk.text ?? ""
  }
  return stripFence(text)
}
