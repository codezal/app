// Offline seed for the models.dev catalog. The raw JSON is produced at build
// time by `scripts/snapshot-catalog.mjs` and bundled so the app has a working
// provider/model catalog on first run or with no network. The runtime fetch in
// providers-catalog.ts replaces it with live data when online.
//
// Import this module dynamically (it pulls in ~2 MB of JSON) so the snapshot
// only loads when actually needed at startup, never eagerly via a static graph.
import snapshot from "./catalog-snapshot.json"
import type { ProvidersCatalog } from "./providers-catalog"

// The JSON is models.dev's api.json verbatim, which is exactly ProvidersCatalog
// shape; cast through unknown to skip structural inference over a 2 MB literal.
export const CATALOG_SNAPSHOT = snapshot as unknown as ProvidersCatalog
