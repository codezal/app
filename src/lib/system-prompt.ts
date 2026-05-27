// System prompt birleştirici — base persona + memory dosyaları + workspace meta.
import { readProjectMemory, readUserMemory, buildMemorySystemPrompt } from "./memory"
import { readWorkspaceSkills, readUserSkills, buildSkillsCatalog } from "./skills"
import { readWorkspaceAgents, readUserAgents, buildAgentsCatalog } from "./agents"

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
  mode?: "plan" | "build"
}

// İstemi tek string olarak üret — streamText({ system }) için.
export async function buildSystemPrompt({
  workspacePath,
  modelLabel,
  mode = "build",
}: SystemPromptInput): Promise<string> {
  const parts: string[] = [BASE_SYSTEM]

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

  // Skills katalogu (sadece isim+açıklama; body load_skill ile yüklenir)
  try {
    const [proj, user] = await Promise.all([
      readWorkspaceSkills(workspacePath),
      readUserSkills(),
    ])
    const catalog = buildSkillsCatalog([...proj, ...user])
    if (catalog) parts.push("\n" + catalog)
  } catch {
    // sessiz geç
  }

  // Agents katalogu (spawn_agent ile delegate edilir)
  try {
    const [proj, user] = await Promise.all([
      readWorkspaceAgents(workspacePath),
      readUserAgents(),
    ])
    const catalog = buildAgentsCatalog([...proj, ...user])
    if (catalog) parts.push("\n" + catalog)
  } catch {
    // sessiz geç
  }

  return parts.join("\n")
}
