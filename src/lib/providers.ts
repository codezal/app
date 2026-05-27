// Re-export shim — providers/ dizinine taşındı. Geriye uyumluluk için bu dosya
// public API'yı aynı isim/imzayla yeniden export eder. Yeni kod doğrudan
// "@/lib/providers/index" veya "@/lib/providers/types" import edebilir.
export {
  PROVIDERS,
  buildModel,
  defaultModelFor,
  modelsFor,
  listProviderAdapters,
  getProviderAdapter,
  _registerPluginProvider,
  _unregisterPluginProvider,
} from "./providers/index"
export type { ApiKeys, ProviderAdapter, ProviderId, ProviderSpec } from "./providers/types"
