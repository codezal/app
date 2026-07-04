//
import { useEffect, useMemo, useRef, useState } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { convertFileSrc } from "@tauri-apps/api/core"
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  Eye,
  RefreshCcw,
  X,
} from "@/lib/icons"
import { usePreviewStore } from "@/store/preview"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"

type Props = { workspacePath?: string; onClose?: () => void }

type DeviceId = "responsive" | "mobile" | "tablet" | "custom"
const DEVICE_SIZE: Record<Exclude<DeviceId, "responsive" | "custom">, { w: number; h: number }> = {
  mobile: { w: 375, h: 812 },
  tablet: { w: 768, h: 1024 },
}

type ConsoleEntry = { level: string; text: string; ts: number }

const IFRAME_SANDBOX = "allow-same-origin allow-scripts allow-forms allow-popups allow-modals"

const CONSOLE_SNIPPET = `<script>
(function () {
  if (window.parent === window) return;
  var send = function (level, args) {
    try {
      window.parent.postMessage(
        { __codezalPreview: true, level: level, args: Array.prototype.map.call(args, String) },
        "*"
      );
    } catch (e) {}
  };
  ["log", "info", "warn", "error", "debug"].forEach(function (lvl) {
    var orig = console[lvl];
    console[lvl] = function () { send(lvl, arguments); return orig.apply(console, arguments); };
  });
  window.addEventListener("error", function (e) { send("error", [e.message]); });
  window.addEventListener("unhandledrejection", function (e) { send("error", ["[unhandled] " + e.reason]); });
})();
</script>`

function fileUrlToPath(u: string): string {
  try {
    const url = new URL(u)
    let p = decodeURIComponent(url.pathname)
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1)
    return p
  } catch {
    return u
  }
}

export function PreviewPanel({ workspacePath, onClose }: Props) {
  const t = useT()
  const wsKey = workspacePath ?? ""
  const detected = usePreviewStore((s) => s.detectedByWs[wsKey])
  const setUrl = usePreviewStore((s) => s.setUrl)

  const [nav, setNav] = useState<{ stack: string[]; idx: number }>({ stack: [], idx: -1 })
  const [inputUrl, setInputUrl] = useState("")
  const [reloadKey, setReloadKey] = useState(0)
  const [device, setDevice] = useState<DeviceId>("responsive")
  const [customW, setCustomW] = useState(1280)
  const [customH, setCustomH] = useState(800)
  const [zoom, setZoom] = useState(1)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [logs, setLogs] = useState<ConsoleEntry[]>([])
  const [copied, setCopied] = useState(false)
  const lastAppliedRef = useRef("")

  const current = nav.idx >= 0 ? nav.stack[nav.idx] ?? "" : ""
  const canBack = nav.idx > 0
  const canForward = nav.idx >= 0 && nav.idx < nav.stack.length - 1

  const iframeSrc = useMemo(
    () => (current.startsWith("file://") ? convertFileSrc(fileUrlToPath(current)) : current),
    [current],
  )

  useEffect(() => {
    const u = usePreviewStore.getState().urlByWs[wsKey] ?? ""
    lastAppliedRef.current = u
    /* eslint-disable react-hooks/set-state-in-effect -- external store sync; resetting on workspace change is intentional */
    setNav({ stack: u ? [u] : [], idx: u ? 0 : -1 })
    setInputUrl(u)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [wsKey])

  const storeUrl = usePreviewStore((s) => s.urlByWs[wsKey] ?? "")
  useEffect(() => {
    if (!storeUrl || storeUrl === lastAppliedRef.current) return
    lastAppliedRef.current = storeUrl
    setNav((n) => {
      const base = n.stack.slice(0, n.idx + 1)
      const next = base[base.length - 1] === storeUrl ? base : [...base, storeUrl]
      return { stack: next, idx: next.length - 1 }
    })
    setInputUrl(storeUrl)
    setReloadKey((k) => k + 1)
  }, [storeUrl])

  // sahte log enjekte edemesin).
  useEffect(() => {
    if (!iframeSrc) return
    let origin = ""
    try {
      origin = new URL(iframeSrc).origin
    } catch {
      return
    }
    function onMsg(e: MessageEvent) {
      if (e.origin !== origin) return
      const d = e.data as { __codezalPreview?: boolean; level?: string; args?: unknown }
      if (!d || d.__codezalPreview !== true) return
      const level = typeof d.level === "string" ? d.level : "log"
      const text = Array.isArray(d.args) ? d.args.join(" ") : String(d.args ?? "")
      setLogs((l) => [...l.slice(-199), { level, text, ts: Date.now() }])
    }
    window.addEventListener("message", onMsg)
    return () => window.removeEventListener("message", onMsg)
  }, [iframeSrc])

  function load(url: string) {
    lastAppliedRef.current = url
    setUrl(wsKey, url)
    setInputUrl(url)
    setReloadKey((k) => k + 1)
  }

  function commit(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) return
    const full = /^(https?|file):\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
    setNav((n) => {
      const base = n.stack.slice(0, n.idx + 1)
      const next = base[base.length - 1] === full ? base : [...base, full]
      return { stack: next, idx: next.length - 1 }
    })
    load(full)
  }

  function go(idx: number) {
    const u = nav.stack[idx]
    if (!u) return
    setNav((n) => ({ ...n, idx }))
    load(u)
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(CONSOLE_SNIPPET)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Intentionally ignored.
    }
  }

  const size = useMemo(() => {
    if (device === "responsive") return null
    if (device === "custom") return { w: customW, h: customH }
    return DEVICE_SIZE[device]
  }, [device, customW, customH])

  const btn = "rounded p-1 text-codezal-mute hover:text-codezal-text disabled:opacity-40"

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex min-h-[44px] flex-wrap items-center gap-1 border-b border-codezal-hair bg-codezal-sidebar px-3.5 py-1.5">
        <button type="button" className={btn} disabled={!canBack} onClick={() => go(nav.idx - 1)} title={t("preview.back")}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" className={btn} disabled={!canForward} onClick={() => go(nav.idx + 1)} title={t("preview.forward")}>
          <ChevronRight className="h-4 w-4" />
        </button>
        <button type="button" className={btn} disabled={!current} onClick={() => setReloadKey((k) => k + 1)} title={t("preview.reload")}>
          <RefreshCcw className="h-4 w-4" />
        </button>
        <form
          className="flex min-w-[120px] flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            commit(inputUrl)
          }}
        >
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder={t("preview.urlPlaceholder")}
            spellCheck={false}
            className="w-full rounded border border-codezal-hair bg-codezal-bg px-2 py-1 text-sm text-codezal-text outline-none focus:border-codezal-accent"
          />
        </form>
        {!!detected?.length && (
          <select
            value=""
            onChange={(e) => e.target.value && commit(e.target.value)}
            title={t("preview.detectedPorts")}
            className="max-w-[140px] rounded border border-codezal-hair bg-codezal-bg px-1 py-1 text-sm text-codezal-text"
          >
            <option value="">{t("preview.detectedPorts")}</option>
            {detected.map((d) => (
              <option key={d.url} value={d.url}>
                :{d.port}
              </option>
            ))}
          </select>
        )}
        <select
          value={device}
          onChange={(e) => setDevice(e.target.value as DeviceId)}
          title={t("preview.device")}
          className="rounded border border-codezal-hair bg-codezal-bg px-1 py-1 text-sm text-codezal-text"
        >
          <option value="responsive">{t("preview.responsive")}</option>
          <option value="mobile">{t("preview.mobile")}</option>
          <option value="tablet">{t("preview.tablet")}</option>
          <option value="custom">{t("preview.custom")}</option>
        </select>
        {device === "custom" && (
          <span className="flex items-center gap-1">
            <input
              type="number"
              value={customW}
              onChange={(e) => setCustomW(Math.max(1, Number(e.target.value) || 0))}
              className="w-14 rounded border border-codezal-hair bg-codezal-bg px-1 py-1 text-sm text-codezal-text"
              aria-label="width"
            />
            <span className="text-sm text-codezal-mute">×</span>
            <input
              type="number"
              value={customH}
              onChange={(e) => setCustomH(Math.max(1, Number(e.target.value) || 0))}
              className="w-14 rounded border border-codezal-hair bg-codezal-bg px-1 py-1 text-sm text-codezal-text"
              aria-label="height"
            />
          </span>
        )}
        {size && (
          <span className="flex items-center gap-0.5 text-sm text-codezal-mute">
            <button type="button" className={btn} onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))} title={t("preview.zoomOut")}>
              −
            </button>
            <span className="w-9 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button type="button" className={btn} onClick={() => setZoom((z) => Math.min(2, +(z + 0.25).toFixed(2)))} title={t("preview.zoomIn")}>
              +
            </button>
          </span>
        )}
        <button
          type="button"
          className={cn(btn, consoleOpen && "text-codezal-accent")}
          onClick={() => setConsoleOpen((v) => !v)}
          title={t("preview.console")}
        >
          <Eye className="h-4 w-4" />
        </button>
        <button type="button" className={btn} disabled={!current} onClick={() => { if (current) void openUrl(current).catch(() => {}) }} title={t("preview.openExternal")}>
          <ExternalLink className="h-4 w-4" />
        </button>
        {onClose && (
          <button type="button" className={btn} onClick={onClose} title={t("tabBar.closePanel")}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Body */}
      {!current ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="text-sm font-medium text-codezal-text">{t("preview.noServerTitle")}</div>
          <div className="max-w-[280px] text-sm text-codezal-mute">{t("preview.noServerHint")}</div>
          {!!detected?.length && (
            <div className="flex flex-wrap justify-center gap-2">
              {detected.map((d) => (
                <button
                  key={d.url}
                  type="button"
                  onClick={() => commit(d.url)}
                  className="rounded border border-codezal-hair px-2 py-1 text-sm text-codezal-text hover:border-codezal-accent hover:text-codezal-accent"
                >
                  {d.url}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-codezal-bg p-2">
          {size ? (
            <div
              style={{ width: size.w, height: size.h, transform: `scale(${zoom})`, transformOrigin: "top center" }}
              className="shrink-0 border border-codezal-hair bg-white shadow"
            >
              <iframe key={reloadKey} src={iframeSrc} title="preview" sandbox={IFRAME_SANDBOX} className="h-full w-full border-0" />
            </div>
          ) : (
            <iframe key={reloadKey} src={iframeSrc} title="preview" sandbox={IFRAME_SANDBOX} className="h-full w-full border-0 bg-white" />
          )}
        </div>
      )}

      {consoleOpen && (
        <div className="flex max-h-48 min-h-[80px] flex-col border-t border-codezal-hair">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-sm font-semibold uppercase tracking-wider text-codezal-dim">{t("preview.console")}</span>
            {logs.length > 0 && (
              <button type="button" className="text-sm text-codezal-mute hover:text-codezal-text" onClick={() => setLogs([])}>
                {t("preview.consoleClear")}
              </button>
            )}
          </div>
          {logs.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-2 text-center">
              <div className="text-sm text-codezal-mute">{t("preview.consoleEmpty")}</div>
              <button
                type="button"
                onClick={copySnippet}
                className="flex items-center gap-1 rounded border border-codezal-hair px-2 py-1 text-sm text-codezal-text hover:border-codezal-accent"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("preview.snippetCopied") : t("preview.snippetCopy")}
              </button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto px-2 pb-2 font-mono text-sm leading-relaxed">
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={cn(
                    "whitespace-pre-wrap break-words",
                    l.level === "error" ? "text-destructive" : l.level === "warn" ? "text-amber-500" : "text-codezal-text",
                  )}
                >
                  {l.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
