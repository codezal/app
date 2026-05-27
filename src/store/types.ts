import type { ProviderId, ApiKeys } from "@/lib/providers"
import type { McpServerConfig } from "@/lib/mcp"
import type { ModelMessage } from "ai"

export type Role = "user" | "assistant" | "system" | "tool"

// Mesaj parçası — assistant turn'lerinde text + tool-call + tool-result karışık olabilir
export type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "tool-result"
      toolCallId: string
      toolName: string
      output: string
      isError?: boolean
    }

export type Message = {
  id: string
  role: Role
  content: string
  // Zengin render için (tool-call/result vs.). Yoksa content kullanılır.
  parts?: Part[]
  createdAt: number
  // Streaming sırasında dolu, tamamlandığında final değer
  pending?: boolean
  // Bu mesajdaki tool çağrılarından önce snapshot alınmış dosyaların workspace-relative yolları.
  // Boş array veya undefined → snapshot yok (revert mümkün değil).
  snapshotPaths?: string[]
}

export type SessionUsage = {
  // Tüm turn'lerin toplamı (kümülatif — ücretlendirme ve istatistik için)
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  // Son turn'ün input tokenları — overwrite (kümülatif DEĞİL).
  // Chat history her turn yeniden gönderildiği için bu, gerçek context doluluğunun
  // bir alt sınırıdır.
  lastInputTokens?: number
  // Estimator ile hesaplanmış efektif bağlam boyutu (system + tool + asst + user).
  // ctx % hesabı bunu kullanır. Her send öncesi ve response sonrası güncellenir.
  effectiveContextTokens?: number
  // Hesaplanmış USD maliyeti (provider pricing × token)
  costUsd: number
  // Bu session'da kullanılan tur sayısı
  turns: number
}

// Otomatik bağlam sıkıştırma ayarı.
// Trigger eşiği aşılınca eski mesajlar yapısal bir özet system mesajına dönüştürülür.
// Hysteresis: trigger > target — sonsuz compaction loop önlenir.
export type AutoCompactSettings = {
  enabled: boolean
  // Tetikleme eşiği (cap'in yüzdesi, 0-100)
  triggerPct: number
  // Compaction sonrası hedeflenen doluluk (0-100). triggerPct'ten küçük olmalı.
  targetPct: number
  // Compaction için kullanılacak ucuz model (boşsa aktif modelin flash varyantı).
  // Format: "provider/model" örn "deepseek/deepseek-v4-flash"
  model?: string
  // Compaction sonrası korunacak en son mesaj sayısı
  keepLast: number
}

// Agent çalışma modu.
// "build" → tam erişim (write/edit/bash/patch dahil tüm araçlar)
// "plan" → salt-okunur (list_dir/read_file/grep/web/question), write/edit/bash/patch reddedilir
export type AgentMode = "build" | "plan"

export type Session = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
  // AI SDK için sahnenin ardındaki ham model mesajları — tool-call/result yapısı doğru korunur
  modelMessages?: ModelMessage[]
  // Bu session'a özgü provider/model (genel ayarın override'ı)
  provider: ProviderId
  model: string
  // Bu session'ın bağlı olduğu çalışma klasörü (absolute path) — tools/memory/skills bu kök altında çalışır
  workspacePath?: string
  // Bu session içinde açılmış dosya tab'ları (absolute path)
  openFiles?: string[]
  // null/undefined = sohbet görünümü; string = belirli dosya
  activeFile?: string | null
  // Kümülatif token/cost (real-time tracking)
  usage?: SessionUsage
  // Agent çalışma modu — geriye dönük uyumluluk için opsiyonel, default "build"
  mode?: AgentMode
}

export type ApprovalDecision = "allow" | "deny"

export type ApprovalRule = {
  tool: string // "*" ya da tool adı
  pattern?: string // prefix (bash command / path)
  decision: ApprovalDecision
  scope?: "session" | "persistent"
}

// "ask" → her tool çağrısında sor (varsayılan izinler)
// "auto-review" → güvenli olanları otomatik onayla, risklileri sor
// "bypass" → tüm tool çağrılarını otomatik onayla (tam erişim)
export type ApprovalMode = "ask" | "auto-review" | "bypass"

// Hook lifecycle event'leri.
// PreToolUse  → tool execute'ten ÖNCE; exit 1 ile blok mümkün, stdout JSON ile karar override.
// PostToolUse → tool execute'ten SONRA; sonucu değiştirmez, format/lint/notify için.
// UserPromptSubmit → kullanıcı mesaj gönderince (stream başlamadan).
// Stop → assistant turn bittiğinde (success veya abort).
export type HookEvent = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop"

// Tek hook tanımı — bir event için bir veya daha fazla matcher + komut.
// matcher: tool adı (PreToolUse/PostToolUse) ya da "*" tümü.
// command: bash -lc ile çalıştırılır, workspace cwd. Timeout default 10s.
// blocking: true ise (sadece PreToolUse) exit≠0 tool'u durdurur ve stderr hata olarak döner.
export type HookConfig = {
  id: string
  event: HookEvent
  matcher?: string
  command: string
  timeoutMs?: number
  blocking?: boolean
  enabled?: boolean
  description?: string
}

// Semantic index — embedding tabanlı kod arama. code_query tool buradaki cfg'i kullanır.
// İndex workspace başına ayrı, <ws>/.codezal/index.json içinde tutulur.
export type SemanticIndexConfig = {
  enabled: boolean
  provider: "openai" | "ollama" | "custom"
  baseUrl?: string
  model: string
  apiKey?: string
  topK?: number
}

// Web arama provider konfigürasyonu — websearch tool buradan key okur.
// Yoksa websearch tool "key gerekli" hatası döner; webfetch ise key gerektirmez.
export type WebSearchConfig = {
  provider: "tavily" | "brave"
  apiKey: string
}

// models.dev'den çekilen provider/model katalog cache'i.
// Yapı korunabilirlik için unknown — runtime'da providers-catalog modülü parse eder.
export type CachedProviderCatalog = {
  data: Record<string, unknown>
  fetchedAt: number
}

export type Settings = {
  apiKeys: ApiKeys
  // Varsayılan yeni session için
  defaultProvider: ProviderId
  defaultModel: string
  theme: "light" | "dark" | "system"
  // Arayüz yazı ölçeği — S/M/L/XL (S=13px, M=14px, L=15px, XL=16px)
  fontScale?: "s" | "m" | "l" | "xl"
  // Yeni session açılınca otomatik bağlanacak klasör (boş = bağlı değil)
  defaultWorkspacePath?: string
  // Tool izin modu
  approvalMode: ApprovalMode
  // Kalıcı onay kuralları
  approvalRules: ApprovalRule[]
  // MCP HTTP/SSE sunucu konfigleri
  mcpServers: McpServerConfig[]
  // Otomatik bağlam sıkıştırma
  autoCompact: AutoCompactSettings
  // Opsiyonel web arama sağlayıcı (Tavily veya Brave)
  webSearch?: WebSearchConfig
  // models.dev katalog cache'i — provider/model listesi runtime'da güncellenir
  providerCatalog?: CachedProviderCatalog
  // Lifecycle hook'ları — bash komutları, opsiyonel bloklama (PreToolUse)
  hooks?: HookConfig[]
  // Semantic index (embedding) — code_query tool için.
  semantic?: SemanticIndexConfig
}

export type SessionMeta = Pick<
  Session,
  "id" | "title" | "createdAt" | "updatedAt" | "workspacePath"
>

