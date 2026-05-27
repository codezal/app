// Otomatik bağlam sıkıştırma.
//
// Strateji:
// 1) shouldCompact: effectiveContextTokens >= cap * (triggerPct/100) → tetikle
// 2) compactMessages: eski mesajları yapılandırılmış bir "memory" özetine dönüştür
//    - Son `keepLast` mesaj olduğu gibi korunur (yakın bağlam)
//    - Daha eski mesajlar tek bir ucuz model çağrısıyla yapısal özete dönüştürülür
//    - Çıktı yeni ModelMessage[]: [systemMemoryMsg, ...keptMessages]
// 3) Hysteresis: target %50 (trigger %75'ten küçük) — sonsuz loop yok
//
// Düz prose summary yerine structured memory: zaman içinde bilgi çürümesi azalır.

import { generateText, type ModelMessage } from "ai"
import type { ProviderId, ApiKeys } from "./providers"
import { buildModel } from "./providers"
import { compactionModelFor, contextCap } from "./pricing"
import type { AutoCompactSettings } from "@/store/types"

// Eşik kontrolü.
export function shouldCompact(
  effectiveTokens: number,
  model: string,
  settings: AutoCompactSettings,
): boolean {
  if (!settings.enabled) return false
  if (effectiveTokens <= 0) return false
  const cap = contextCap(model)
  const trigger = Math.floor(cap * (settings.triggerPct / 100))
  return effectiveTokens >= trigger
}

// Compaction sonrası hedeflenen token boyutu.
export function targetTokensAfterCompact(
  model: string,
  settings: AutoCompactSettings,
): number {
  return Math.floor(contextCap(model) * (settings.targetPct / 100))
}

// Aktif modelin provider'ına göre, kullanıcı override etmediyse ucuz model seç.
function resolveCompactModel(
  activeProvider: ProviderId,
  activeModel: string,
  override: string | undefined,
): { provider: ProviderId; model: string } {
  if (override && override.includes("/")) {
    const [p, m] = override.split("/", 2)
    return { provider: p as ProviderId, model: m }
  }
  const cm = compactionModelFor(activeProvider)
  // Eğer flash model bilinmezse aktif modele düş
  if (!cm.model) return { provider: activeProvider, model: activeModel }
  return { provider: cm.provider as ProviderId, model: cm.model }
}

// Yapısal memory şablonu — düz özet yerine kategorize bilgi.
const STRUCTURED_MEMORY_PROMPT = `Görevin: Aşağıdaki sohbet geçmişini AŞAĞIDAKİ BAŞLIKLAR ile yapısal bir "memory" notuna dönüştürmek.
Bu memory, devam eden coding/agentic sohbette modelin kayıp bilgi olmadan çalışmasını sağlayacak.

Çıktı formatı (Markdown, başlıkları aynen koru, boş başlık varsa "—" yaz):

## Aktif Hedefler
- (kullanıcının şu anda tamamlanmasını istediği görevler)

## Mimari Kararlar
- (proje yapısı, paternler, framework seçimleri, dosya organizasyonu)

## Önemli API'ler / Semboller
- (sıkça referans verilen fonksiyon/sınıf/dosya/endpoint isimleri ve kısa açıklamaları)

## Çözülmemiş Sorunlar
- (bilinen bug, başarısız test, eksik özellik)

## Açık Dosyalar / Bağlam
- (üzerinde aktif çalışılan dosyalar ve hangi durumdalar)

## Kısıtlar ve Tercihler
- (kullanıcının belirttiği stil/teknoloji/davranış kuralları, yapılması/yapılmaması gerekenler)

## Son Eylemler (kronolojik, kısa)
- (asistanın yaptığı en kritik 5-10 eylem: ne, hangi dosya, sonuç)

KURALLAR:
- Olgu odaklı yaz, dolgu yok.
- Sohbet üslubunu KORUMA — özet bir not gibi yaz.
- Kod parçalarını sadece kritik ise kısalt; uzun snippet'leri "dosya: X" şeklinde referansla geç.
- Karar verilmemiş şeyleri "?" ile işaretle.
- Türkçe yaz.`

// Eski mesajları yapısal memory'e dönüştür.
async function summarizeOldMessages(
  oldMessages: ModelMessage[],
  apiKeys: ApiKeys,
  activeProvider: ProviderId,
  activeModel: string,
  overrideModel: string | undefined,
): Promise<string> {
  const { provider, model } = resolveCompactModel(activeProvider, activeModel, overrideModel)
  const llm = buildModel(provider, model, apiKeys)

  // Mesajları düz metne çevir — ucuz model için sade input
  const transcript = renderTranscript(oldMessages)

  const result = await generateText({
    model: llm,
    system: STRUCTURED_MEMORY_PROMPT,
    prompt: `Sohbet transkripti:\n\n${transcript}\n\nYukarıdaki şablonu doldur.`,
  })
  return result.text
}

function renderTranscript(messages: ModelMessage[]): string {
  const lines: string[] = []
  for (const m of messages) {
    const role = m.role.toUpperCase()
    if (typeof m.content === "string") {
      lines.push(`[${role}] ${m.content}`)
      continue
    }
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        const p = part as Record<string, unknown>
        if (typeof p.text === "string") {
          lines.push(`[${role}] ${p.text}`)
        } else if (p.type === "tool-call") {
          lines.push(`[${role}/tool-call ${String(p.toolName)}] ${safeJson(p.input)}`)
        } else if (p.type === "tool-result") {
          const out = typeof p.output === "string" ? p.output : safeJson(p.output)
          // Çok uzun outputlar trim et — özet için tam içerik gerekmez
          const trimmed = out.length > 2000 ? out.slice(0, 2000) + " …[trim]" : out
          lines.push(`[${role}/tool-result ${String(p.toolName)}] ${trimmed}`)
        } else if (typeof p.reasoning === "string") {
          lines.push(`[${role}/reasoning] ${p.reasoning}`)
        }
      }
    }
  }
  return lines.join("\n\n")
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? ""
  } catch {
    return String(v ?? "")
  }
}

// Ana compaction fonksiyonu.
// Son `keepLast` mesajı korur, kalanları yapısal memory'e çevirir.
// Dönüş: [memorySystemMsg, ...keptMessages]
export async function compactMessages(args: {
  messages: ModelMessage[]
  apiKeys: ApiKeys
  activeProvider: ProviderId
  activeModel: string
  settings: AutoCompactSettings
}): Promise<{ messages: ModelMessage[]; memoryText: string }> {
  const { messages, apiKeys, activeProvider, activeModel, settings } = args
  const keepLast = Math.max(2, settings.keepLast)

  // Hiç sıkıştırılacak şey yoksa olduğu gibi dön
  if (messages.length <= keepLast) {
    return { messages, memoryText: "" }
  }

  // Son user mesajına geri sayıyoruz — daima en yakın user/assistant sıralamasını koru
  const cutoff = messages.length - keepLast
  const oldPart = messages.slice(0, cutoff)
  const keepPart = messages.slice(cutoff)

  if (oldPart.length === 0) {
    return { messages, memoryText: "" }
  }

  const memoryText = await summarizeOldMessages(
    oldPart,
    apiKeys,
    activeProvider,
    activeModel,
    settings.model,
  )

  const memoryMsg: ModelMessage = {
    role: "system",
    content:
      `<compacted-memory>\nAşağıdaki yapısal not, ${oldPart.length} adet eski mesajın özetidir. ` +
      `Devam eden konuşmada bu bilgiyi gerçek bağlam gibi kullan.\n\n` +
      memoryText +
      `\n</compacted-memory>`,
  }

  return {
    messages: [memoryMsg, ...keepPart],
    memoryText,
  }
}
