// Plugin sistemi public API.
export {
  loadPlugin,
  unloadPlugin,
  loadAllInstalled,
} from "./loader"
export {
  parsePluginManifest,
  parseMarketplacePluginManifest,
  parseMarketplaceIndex,
} from "./manifest"
export {
  readInstalled,
  writeInstalled,
  upsertInstalled,
  removeInstalled,
  setEnabled,
  readMarketplaces,
  writeMarketplaces,
  upsertMarketplace,
  removeMarketplaceRegistration,
} from "./installed"
export {
  describePermission,
  highRiskPermissions,
  isHighRisk,
  PERMISSION_LABELS,
} from "./permissions"
export {
  addMarketplace,
  pullMarketplace,
  removeMarketplace,
  readMarketplaceIndex,
  readMarketplacePluginManifest,
  ensureDefaultMarketplace,
  DEFAULT_MARKETPLACE_ID,
} from "./marketplace"
export {
  installPlugin,
  uninstallPlugin,
  togglePluginEnabled,
  readPluginFile,
} from "./install"
export {
  appendAudit,
  readAudit,
  clearAudit,
} from "./audit"
export type { AuditEntry, AuditEvent } from "./audit"
export {
  verifyManifestSignature,
  canonicalManifest,
  CODEZAL_SIGNING_PUBKEY,
} from "./signing"
export type { VerifyResult } from "./signing"
export { hostAllowed, checkUrlAllowed, hostFromUrl } from "./network"
export { computeDirFingerprint } from "./fingerprint"
export type {
  Permission,
  PluginManifest,
  PluginSource,
  Channel,
  MarketplaceIndex,
  MarketplaceIndexEntry,
  MarketplacePluginManifest,
  RegisteredMarketplace,
  InstalledPlugin,
  PluginAPI,
  LoadResult,
} from "./types"
