// Config module — settings validation, migration, and the project-config layer.
//
// Note: the settings store imports the pure submodules (./schema, ./migrate)
// directly, NOT this barrel, to avoid a cycle through ./effective (which imports
// the store). External consumers should import from here.

export { parseSettings, parseProjectConfig, type ProjectConfig } from "./schema"
export { migrateSettings, CURRENT_SCHEMA_VERSION } from "./migrate"
export { parseJsonc, ConfigParseError } from "./parse"
export { resolveSecret, substituteText } from "./variable"
export { mergeProjectConfig } from "./merge"
export { loadProjectConfig, getCachedProjectConfig, invalidateProjectConfig } from "./project"
export { getEffectiveSettings, resolveEffectiveSettings } from "./effective"
