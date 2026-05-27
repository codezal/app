// Permission helper'ları — UI ve loader paylaşılan kontrol noktası.
import type { Permission } from "./types"
import { isHighRisk, PERMISSION_LABELS } from "./types"

// Permission listesinde yüksek-risk olanları döndür — UI install onayında kırmızı uyarı için.
export function highRiskPermissions(perms: Permission[]): Permission[] {
  return perms.filter(isHighRisk)
}

// İnsan-okunur açıklama — UI'da rozet/satır.
export function describePermission(p: Permission): string {
  return PERMISSION_LABELS[p] ?? p
}

export { isHighRisk, PERMISSION_LABELS }
