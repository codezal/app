//
//
export const RESOURCE_INVALID = /resource id \d+ is invalid/i

let installed = false

export function installHttpNoiseFilter(): void {
  if (installed || typeof window === "undefined") return
  installed = true
  window.addEventListener("unhandledrejection", (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "")
    if (RESOURCE_INVALID.test(msg)) {
      e.preventDefault()
      if (import.meta.env.DEV) {
        console.debug("[http] plugin-http stream teardown rejection yutuldu:", msg)
      }
    }
  })
}
