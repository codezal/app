// Re-export shim — providers/ dizinine taşındı. Public API'yi tek noktadan
// dışarı sunar. Yeni kod doğrudan "@/lib/providers/index" import edebilir.
export {
  PROVIDERS,
  buildModel,
  buildLanguageModel,
  defaultModelFor,
  modelsFor,
  listProviderAdapters,
  getProviderAdapter,
  _registerPluginProvider,
  _unregisterPluginProvider,
  _unregisterPluginProvidersByPlugin,
} from "./providers/index"
export {
  isModelEnabled,
  listModelStatus,
  buildBulkStatus,
  buildRecommendedStatus,
} from "./providers/model-status"
export { resolveAuth, isConnectedSync, activeAuthLabel } from "./providers/auth"
export { readEnvVar, probeEnvVars, clearEnvCache } from "./providers/env-reader"
export { getOAuthFlow, listOAuthFlows } from "./providers/oauth"
export type { OAuthFlow, OAuthStartResult } from "./providers/oauth"
export type {
  ApiKeys,
  ProviderAdapter,
  ProviderId,
  ProviderSpec,
  ProviderInfo,
  ProviderConfig,
  ResolvedAuth,
  OAuthCredential,
  AuthMethod,
  LegacyProviderAdapter,
} from "./providers/types"
