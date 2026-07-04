
export type MethodScope = "project" | "global"

export interface Method {
  id: string
  name: string
  description: string
  steps: string[]
  // Opsiyonel tetikleyici anahtar kelimeler (RAG'a ek sinyal).
  triggers?: string[]
  scope: MethodScope
  createdAt: number
  lastUsedAt: number
  useCount: number
}

export interface MethodStoreFile {
  version: number
  methods: Method[]
}

export const METHODS_VERSION = 1

export interface MethodsConfig {
  topK: number
  maxMethods: number
}

export const DEFAULT_METHODS_CONFIG: MethodsConfig = {
  topK: 3,
  maxMethods: 100,
}
