// System prompt birleştirici — base persona + memory dosyaları + workspace meta.
import { readProjectMemory, readUserMemory, buildMemorySystemPrompt } from "./memory"
import { readWorkspaceSkills, readUserSkills, buildSkillsCatalog } from "./skills"
import { listPluginSkills } from "./skills/plugin"
import { readWorkspaceAgents, readUserAgents, buildAgentsCatalog } from "./agents"
import { listPluginAgents } from "./agents/plugin"
import type { OrchestraConfig } from "./orchestra/types"
import { briefModeSection } from "./token-savers"
import type { TokenSaverSettings } from "./token-savers/types"

const BASE_SYSTEM = `Sen Codezal'sun — bir geliştirme asistanısın.
Kullanıcı sana bir görev verdiğinde, doğru sonucu üretmek için araçları kullan.
Konuşma Türkçe, kod ve teknik terimler İngilizce kalır.

Yönergeler:
- Önce planı sözle özetle; sonra araçları çağır.
- Dosya değiştirmeden önce mevcut içeriği oku.
- edit_file için old_string eşsiz olacak şekilde bağlam ekle.
- bash komutlarını workspace dışına çıkarma.
- Tool sonucunu kısa yorumla, gerek yoksa tekrarlama.
- Belirsizlik veya kritik karar varsa varsayım yapma — question tool ile kullanıcıya sor (max 1-2 soru, kritik olanları seç).`

export type SystemPromptInput = {
  workspacePath?: string
  modelLabel?: string
  mode?: "plan" | "build" | "orchestra"
  orchestra?: OrchestraConfig
  // Token-saver toggles — when Brief Mode is enabled, an extra directive is
  // injected so the model responds in compressed style.
  tokenSavers?: TokenSaverSettings
}

// Orkestra modu için worker havuzu kataloğu — parent LLM dispatch_workers çağrırken bu listeyi kullanır.
function buildOrchestraCatalog(cfg: OrchestraConfig): string {
  const lines = [
    "## ORKESTRA MODU AKTİF",
    "Sen bir orkestra şefisin — kendi tool döngün yanında worker havuzundan paralel iş çıkarabilirsin.",
    "Worker havuzunda mevcut ajanlar:",
    "",
  ]
  for (const w of cfg.workers) {
    const modelInfo =
      w.kind === "sdk"
        ? `${w.provider ?? "?"}/${w.model ?? "?"}`
        : `${w.kind} CLI${w.model ? ` (model hint: ${w.model})` : ""}`
    const yoloTag = w.yolo ? " · YOLO" : ""
    const presetTag = w.presetAgent ? ` · preset: ${w.presetAgent}` : ""
    lines.push(`- **worker-${w.idx}** (${modelInfo}${yoloTag}${presetTag})`)
  }
  lines.push("")
  lines.push(
    "Görev karmaşıksa `dispatch_workers([{workerIdx, task}, ...])` ile 1-5 worker'a paralel iş ver. " +
      "Tool dönüşü her worker için status/output JSON'ı içerir. Sen sentezi yap, gerekirse yeni dispatch çağır.",
  )
  return lines.join("\n")
}

// İstemi tek string olarak üret — streamText({ system }) için.
export async function buildSystemPrompt({
  workspacePath,
  modelLabel,
  mode = "build",
  orchestra,
  tokenSavers,
}: SystemPromptInput): Promise<string> {
  const parts: string[] = [BASE_SYSTEM]

  // Brief Mode directive — placed near the top so the style rule frames every
  // later section (memory blocks, catalogs). Falls through cleanly when disabled.
  const brief = briefModeSection(tokenSavers?.briefMode)
  if (brief) parts.push("\n" + brief)

  if (workspacePath) {
    parts.push(`\nÇalışma klasörü: ${workspacePath}`)
  }
  if (modelLabel) {
    parts.push(`Aktif model: ${modelLabel}`)
  }

  if (mode === "plan") {
    parts.push(
      "\n## PLAN MODU AKTİF\n" +
        "Salt-okunur moddasın. write_file/edit_file/bash/apply_patch reddedilir — çağırma.\n" +
        "Görevini şu adımlarla yürüt:\n" +
        "1. Kodu read_file/list_dir/grep ile incele.\n" +
        "2. Belirsizlik varsa question tool ile sor.\n" +
        "3. Bir uygulama planı yaz: hangi dosyalar, hangi değişiklik, hangi sırayla.\n" +
        "4. Kullanıcı planı onaylayıp build moduna geçince (⌘M) uygulamaya başla.",
    )
  }

  if (mode === "orchestra" && orchestra) {
    parts.push("\n" + buildOrchestraCatalog(orchestra))
  }

  // Memory dosyaları (proje + global)
  try {
    const projectFiles = workspacePath ? await readProjectMemory(workspacePath) : []
    const userFiles = await readUserMemory()
    const memoryBlock = buildMemorySystemPrompt([...projectFiles, ...userFiles])
    if (memoryBlock) {
      parts.push("\n" + memoryBlock)
    }
  } catch {
    // memory okunamazsa sessiz geç
  }

  // Skills katalogu (workspace + user + plugin)
  try {
    const [proj, user] = await Promise.all([
      readWorkspaceSkills(workspacePath),
      readUserSkills(),
    ])
    const catalog = buildSkillsCatalog([...proj, ...user, ...listPluginSkills()])
    if (catalog) parts.push("\n" + catalog)
  } catch {
    // sessiz geç
  }

  // Agents katalogu (workspace + user + plugin)
  try {
    const [proj, user] = await Promise.all([
      readWorkspaceAgents(workspacePath),
      readUserAgents(),
    ])
    const catalog = buildAgentsCatalog([...proj, ...user, ...listPluginAgents()])
    if (catalog) parts.push("\n" + catalog)
  } catch {
    // sessiz geç
  }

  return parts.join("\n")
}
