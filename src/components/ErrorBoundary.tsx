import { Component, type ReactNode } from "react"
import { captureError } from "@/lib/report"

interface ErrorBoundaryProps {
  children: ReactNode
  /** Optional custom fallback. Defaults to a full-screen reload prompt. */
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  error: boolean
}

/**
 * Catches render errors in its subtree — including failed lazy/dynamic-import
 * chunks (e.g. a stale hashed asset after an auto-update, or an antivirus
 * quarantining a freshly written chunk on Windows) — and shows a reload prompt
 * instead of leaving the window blank.
 *
 * Kept dependency-light on purpose: this is last-resort UI that must render
 * even when other modules failed to load, so it avoids importing i18n or stores.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { error: true }
  }

  componentDidCatch(err: unknown) {
    console.error("App render error:", err)
    void captureError(err, "app-render")
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback !== undefined) return this.props.fallback
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-codezal-sidebar px-6 text-center text-codezal-text">
          <div className="text-base font-semibold">Something went wrong</div>
          <p className="max-w-md text-sm text-codezal-dim">
            An unexpected error occurred while rendering this view. Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-codezal-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
