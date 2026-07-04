import type { Permission } from "./types"
import { isHighRisk, PERMISSION_LABELS } from "./types"

export function highRiskPermissions(perms: Permission[]): Permission[] {
  return perms.filter(isHighRisk)
}

export function describePermission(p: Permission): string {
  return PERMISSION_LABELS[p] ?? p
}

export { isHighRisk, PERMISSION_LABELS }
