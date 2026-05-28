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
} from "./marketplace"
export {
  installPlugin,
  uninstallPlugin,
  togglePluginEnabled,
  readPluginFile,
} from "./install"
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
