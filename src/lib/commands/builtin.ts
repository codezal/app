// Built-in slash komutları — App.tsx onSlashAction dispatcher'ı bu listeyi okur.
import type { SlashCommand } from "./types"

export const BUILTINS: SlashCommand[] = [
  { name: "clear", description: "Aktif sohbet mesajlarını temizle", scope: "builtin", action: "clear" },
  { name: "branch", description: "Bu sohbetten çatal (yeni session)", scope: "builtin", action: "branch" },
  { name: "model", description: "Model değiştir (palette aç)", scope: "builtin", action: "model" },
  { name: "agent", description: "Bir ajan ile sohbet et", scope: "builtin", action: "agent", needsArg: true },
  { name: "skill", description: "Skill yükle ve devam et", scope: "builtin", action: "skill", needsArg: true },
  { name: "workspace", description: "Workspace klasörü seç", scope: "builtin", action: "workspace" },
  { name: "search", description: "Workspace içinde ara", scope: "builtin", action: "search" },
  { name: "routines", description: "Rutinleri aç", scope: "builtin", action: "routines" },
  { name: "orchestra", description: "Orkestra modu — worker havuzu konfigüre et", scope: "builtin", action: "orchestra" },
  { name: "agents-init", description: "~/.codezal/agents/ altına default agent havuzu yaz", scope: "builtin", action: "agents-init" },
  { name: "plugins", description: "Eklentileri yönet (SettingsDrawer)", scope: "builtin", action: "plugins" },
  { name: "settings", description: "Ayarları aç", scope: "builtin", action: "settings" },
  { name: "stop", description: "Devam eden stream'i durdur", scope: "builtin", action: "stop" },
  { name: "help", description: "Tüm komutları göster", scope: "builtin", action: "help" },
]
