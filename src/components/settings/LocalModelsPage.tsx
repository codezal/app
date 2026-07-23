// LocalModelsPage — Ayarlar'da "Yerel Modeller" sekmesi. Local (in-process)
//
import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { confirm } from "@tauri-apps/plugin-dialog"
import { platform } from "@tauri-apps/plugin-os"
import { displayModelName } from "@/lib/local-llm"
import { MLX_CATALOG } from "@/lib/mlx-models"
import { refreshLocalModels } from "@/lib/providers/local"
import { Download } from "@/lib/icons"
import { useSettingsStore } from "@/store/settings"
import { useLocalRuntimeStore } from "@/store/local-runtime"
import { LocalServerTab } from "./LocalServerTab"
import type { LocalLlmSettings } from "@/store/types"

type ModelInfo = { name: string; size: number }
type MlxModelInfo = { id: string; size: number }
type MlxStatus = { available: boolean; reason?: string }

const DEFAULT_PROFILE: LocalLlmSettings = {
  contextWindow: 32768,
  flashAttention: "enabled",
  batchSize: 2048,
  threads: 0,
  batchThreads: 0,
  speculativeMode: "off",
  draftTokens: 4,
  draftModel: "",
  agentMode: true,
}

function parseHfUrl(input: string): { repo: string; path: string; revision: string } | null {
  const s = input.trim()
  const m = s.match(/huggingface\.co\/([^/]+\/[^/]+)\/(?:resolve|blob)\/([^/]+)\/(.+?)(?:\?.*)?$/)
  if (!m) return null
  return { repo: m[1], revision: m[2], path: m[3] }
}

// HF repo ref → "org/model". Kabul: https://huggingface.co/org/model[/...],
function parseHfRepo(input: string): string | null {
  const s = input.trim()
  const m = s.match(/huggingface\.co\/([^/\s]+\/[^/\s?#]+)/)
  if (m) return m[1]
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return s
  return null
}

function fmtSize(bytes: number): string {
  if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(1) + " GB"
  if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(0) + " MB"
  return (bytes / 1024).toFixed(0) + " KB"
}

type QuantGroup = {
  key: string
  label: string
  quant: string
  tier: string
  total: number
  parts: string[]
  companionParts?: string[]
}

function quantInfo(name: string): { quant: string; tier: string } {
  const m = name.match(/\b(IQ\d[A-Z_]*|Q\d[_A-Z0-9]*|BF16|F16|F32|TQ\d_\d)\b/i)
  const quant = m ? m[1].toUpperCase() : "?"
  const tier = /^(BF16|F16|F32)/.test(quant)
    ? "tam hassasiyet · en büyük"
    : /^Q8/.test(quant)
      ? "en yüksek kalite"
      : /^Q6/.test(quant)
        ? "çok yüksek kalite"
        : /^Q5/.test(quant)
          ? "yüksek kalite"
          : /^Q4/.test(quant)
            ? "dengeli · önerilen"
            : /^(Q3|IQ3)/.test(quant)
              ? "küçük · kalite düşer"
              : /^(Q2|IQ2|IQ1|TQ1)/.test(quant)
                ? "aşırı küçük · düşük kalite"
                : ""
  return { quant, tier }
}

function isMtpPath(path: string): boolean {
  const lower = path.toLowerCase()
  const name = lower.split("/").pop() ?? lower
  return (
    lower.includes("/mtp/") ||
    name.startsWith("mtp-") ||
    name.includes("-mtp.") ||
    name.includes("-mtp-")
  )
}

function mtpRank(path: string): number {
  const name = path.toUpperCase()
  if (name.includes("Q8_0")) return 0
  if (name.includes("Q6")) return 1
  if (name.includes("Q5")) return 2
  if (name.includes("Q4")) return 3
  if (name.includes("BF16") || name.includes("F16")) return 4
  return 5
}

function groupGguf(files: { path: string; size: number }[]): QuantGroup[] {
  const mtp = files
    .filter((f) => isMtpPath(f.path))
    .sort((a, b) => mtpRank(a.path) - mtpRank(b.path) || a.size - b.size)[0]
  const mainFiles = files.filter((f) => !isMtpPath(f.path))
  const map = new Map<string, QuantGroup>()
  for (const f of mainFiles) {
    const base = f.path.replace(/-\d{5}-of-\d{5}\.gguf$/, "")
    const key = base === f.path ? f.path : base
    const name = (key.split("/").pop() ?? f.path).replace(/\.gguf$/, "")
    let g = map.get(key)
    if (!g) {
      const { quant, tier } = quantInfo(name)
      g = { key, label: name, quant, tier, total: 0, parts: [] }
      map.set(key, g)
    }
    g.total += f.size
    g.parts.push(f.path)
  }
  for (const g of map.values()) {
    g.parts.sort()
    if (mtp) {
      g.companionParts = [mtp.path]
      g.parts.push(mtp.path)
      g.total += mtp.size
    }
  }
  return [...map.values()].sort((a, b) => a.total - b.total)
}

function ramFit(total: number, ram: number): { icon: string; text: string; cls: string } | null {
  if (!ram || !total) return null
  const needed = total + 2 * (1 << 30)
  if (needed <= ram * 0.72) return { icon: "✓", text: "sığar", cls: "text-emerald-500" }
  if (needed <= ram * 0.9) return { icon: "⚠", text: "sınırda", cls: "text-amber-500" }
  return { icon: "✗", text: "RAM yetmez", cls: "text-red-500" }
}

function fmtParams(n: number | null): string {
  if (!n) return ""
  if (n >= 1e9) return `≈${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B parametre`
  if (n >= 1e6) return `≈${(n / 1e6).toFixed(0)}M parametre`
  return ""
}

type CuratedModel = {
  label: string
  repo: string
  quant: string
  category: string
  blurb: string
  approxGB: number
  installedKey?: string
}

const CURATED: CuratedModel[] = [
  {
    label: "Qwen3.5-4B",
    repo: "unsloth/Qwen3.5-4B-GGUF",
    quant: "Q4_K_M",
    category: "genel",
    blurb: "Küçük + hızlı, düşük RAM'e uygun",
    approxGB: 2.7,
  },
  {
    label: "Qwen3-8B",
    repo: "unsloth/Qwen3-8B-GGUF",
    quant: "Q4_K_M",
    category: "genel",
    blurb: "Qwen3 8B, dengeli; düşük-orta RAM",
    approxGB: 5.0,
  },
  {
    label: "Qwen3.5-9B",
    repo: "unsloth/Qwen3.5-9B-GGUF",
    quant: "Q4_K_M",
    category: "genel",
    blurb: "Dengeli genel amaçlı",
    approxGB: 5.7,
  },
  {
    label: "gemma-4-12B Agentic v2",
    repo: "yuxinlu1/gemma-4-12B-agentic-fable5-composer2.5-v2-3.5x-tau2-GGUF",
    quant: "Q4_K_M",
    category: "kodlama",
    blurb: "gemma-4 12B agentic/kodlama fine-tune (v2)",
    approxGB: 7.4,
    installedKey: "gemma4-v2",
  },
  {
    label: "Qwen3.6-27B",
    repo: "unsloth/Qwen3.6-27B-GGUF",
    quant: "Q4_K_M",
    category: "genel",
    blurb: "Dense 27B, güçlü; çok RAM ister",
    approxGB: 16.8,
  },
  {
    label: "gemma-4 26B-A4B",
    repo: "unsloth/gemma-4-26B-A4B-it-GGUF",
    quant: "Q4_K_M",
    category: "MoE",
    blurb: "Google MoE (26B / 4B aktif), güçlü",
    approxGB: 16.9,
  },
  {
    label: "Qwen3.6-35B-A3B",
    repo: "unsloth/Qwen3.6-35B-A3B-GGUF",
    quant: "Q4_K_M",
    category: "MoE",
    blurb: "Büyük MoE (35B / 3B aktif), en güçlü",
    approxGB: 22.1,
  },
]

function curatedInstalled(m: CuratedModel, names: string[]): boolean {
  const key = m.installedKey ?? (m.repo.split("/").pop() ?? "").replace(/-GGUF$/i, "")
  return names.some((n) => n.includes(key) && n.includes(m.quant))
}

const SELECT_CLS =
  "w-48 rounded-md border border-codezal bg-codezal-input px-3 py-1.5 outline-none focus:border-codezal-accent"

function fmtGb(bytes: number): string {
  return (bytes / 1e9).toFixed(1)
}

function fmtCtx(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)
}

function ModelAdvisor({ name }: { name: string }): React.ReactElement | null {
  const info = useLocalRuntimeStore((s) => s.modelInfo[name])
  const tps = useLocalRuntimeStore((s) => s.tokPerSec[name])
  if (!info) return null
  const clamped = info.effectiveCtx < info.requestedCtx
  const tooSmall = info.effectiveCtx < 8192
  const total = info.weights + info.kv + info.compute
  const overBudget = total > info.ram

  let tone: "ok" | "warn" | "bad"
  let verdict: string
  if (tooSmall) {
    tone = "bad"
    verdict = `Agent için önerilmez — pencere ${fmtCtx(info.effectiveCtx)} (tool'lar sığmaz). Daha küçük bir model (ör. Qwen3-8B) öner.`
  } else if (clamped) {
    tone = "warn"
    verdict = `Pencere ${fmtCtx(info.requestedCtx)} → ${fmtCtx(info.effectiveCtx)}'e düştü (bellek). Agent çalışır ama sınırlı.`
  } else {
    tone = "ok"
    verdict = `Agent uygun · ${fmtCtx(info.effectiveCtx)} context.`
  }
  const toneCls =
    tone === "ok" ? "text-green-500" : tone === "warn" ? "text-yellow-500" : "text-red-500"

  return (
    <div className="mx-3 mb-2 flex flex-col gap-1 rounded-md border border-codezal bg-codezal-input/40 px-3 py-2 text-base">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-codezal-mute">
        <span>
          Model <strong className="text-codezal-dim">{fmtGb(info.weights)} GB</strong>
        </span>
        <span>
          + KV({fmtCtx(info.effectiveCtx)}){" "}
          <strong className="text-codezal-dim">{fmtGb(info.kv)} GB</strong>
        </span>
        <span>
          + compute <strong className="text-codezal-dim">{fmtGb(info.compute)} GB</strong>
        </span>
        <span>
          ={" "}
          <strong className={overBudget ? "text-red-500" : "text-codezal-dim"}>
            {fmtGb(total)} GB
          </strong>{" "}
          / {fmtGb(info.ram)} GB RAM
        </span>
        {tps ? <span>· ~{tps.toFixed(0)} tok/s</span> : null}
      </div>
      <div className={`flex items-start gap-1 ${toneCls}`}>
        <span>{tone === "ok" ? "✓" : "⚠"}</span>
        <span>{verdict}</span>
      </div>
    </div>
  )
}

function ProfileControls({
  value,
  onChange,
}: {
  value: LocalLlmSettings
  onChange: (patch: Partial<LocalLlmSettings>) => void
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      {/* Agent modu */}
      <label className="flex items-start gap-2 text-base text-codezal-mute">
        <input
          type="checkbox"
          checked={value.agentMode}
          onChange={(e) => onChange({ agentMode: e.target.checked })}
          className="mt-1"
        />
        <span>
          <strong className="text-codezal-dim">Agent modu</strong> — açıkken model dosya
          okuma/arama/çalıştırma tool'larını kullanır ve projeyi kendi keşfeder (çok-adımlı).
          Kapalıyken tek-tur düz sohbet (tool yok). Kodlama işleri için açık tut.
        </span>
      </label>

      {/* Flash attention */}
      <label className="flex flex-col gap-1">
        <span className="text-base font-medium text-codezal-dim">Flash attention</span>
        <select
          value={value.flashAttention}
          onChange={(e) =>
            onChange({ flashAttention: e.target.value as LocalLlmSettings["flashAttention"] })
          }
          className={SELECT_CLS}
        >
          <option value="enabled">enabled (önerilen)</option>
          <option value="auto">auto</option>
          <option value="disabled">disabled</option>
        </select>
      </label>

      {/* Context penceresi */}
      <label className="flex flex-col gap-1">
        <span className="text-base font-medium text-codezal-dim">Context penceresi</span>
        <select
          value={String(value.contextWindow)}
          onChange={(e) => onChange({ contextWindow: Number(e.target.value) })}
          className={SELECT_CLS}
        >
          <option value="8192">8192</option>
          <option value="16384">16384</option>
          <option value="32768">32768 (önerilen)</option>
          <option value="65536">65536</option>
          <option value="131072">131072</option>
        </select>
        <span className="text-base text-codezal-mute">
          Modelin bir oturumda hatırlayabileceği token sayısı. Büyük pencere daha çok bellek
          (KV) kullanır; modelin train ctx'ini aşarsa otomatik YaRN, bellek yetmezse otomatik
          kısma + bildirim devreye girer. Değişiklik bir sonraki model yüklemesinde geçerli olur.
        </span>
      </label>

      {/* Speculative / MTP */}
      <label className="flex flex-col gap-1">
        <span className="text-base font-medium text-codezal-dim">Speculative / MTP</span>
        <select
          value={value.speculativeMode}
          onChange={(e) =>
            onChange({ speculativeMode: e.target.value as LocalLlmSettings["speculativeMode"] })
          }
          className={SELECT_CLS}
        >
          <option value="off">kapalı</option>
          <option value="mtp">MTP açık</option>
        </select>
        <span className="text-base text-codezal-mute">
          MTP için ana modelin yanında <code className="rounded bg-codezal-input px-1">mtp-*.gguf</code>{" "}
          dosyası olmalı. Değişiklik bir sonraki model yüklemesinde geçerli olur.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-base font-medium text-codezal-dim">Draft token</span>
        <select
          value={String(value.draftTokens)}
          onChange={(e) => onChange({ draftTokens: Number(e.target.value) })}
          className={SELECT_CLS}
          disabled={value.speculativeMode !== "mtp"}
        >
          <option value="2">2</option>
          <option value="4">4 (önerilen)</option>
          <option value="6">6</option>
          <option value="8">8</option>
        </select>
      </label>
    </div>
  )
}

export function LocalModelsPage(): React.ReactElement {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [mlxModels, setMlxModels] = useState<MlxModelInfo[]>([])
  const [mlxStatus, setMlxStatus] = useState<MlxStatus | null>(null)
  const [osPlatform] = useState(() => platform())
  const [url, setUrl] = useState("")
  const [status, setStatus] = useState("")
  const [ggufList, setGgufList] = useState<{
    repo: string
    params: number | null
    groups: QuantGroup[]
  } | null>(null)
  const [hits, setHits] = useState<{ id: string; downloads: number }[] | null>(null)
  const [listing, setListing] = useState(false)
  const [ramBytes, setRamBytes] = useState(0)
  const download = useLocalRuntimeStore((s) => s.download)
  const [expanded, setExpanded] = useState<string | null>(null)

  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const defaultProfile: LocalLlmSettings = settings.localLlm ?? DEFAULT_PROFILE
  const byModel = settings.localLlmByModel ?? {}

  const setDefault = (patch: Partial<LocalLlmSettings>) =>
    void update({ localLlm: { ...defaultProfile, ...patch } })

  const setModelProfile = (name: string, patch: Partial<LocalLlmSettings> | null) => {
    if (patch === null) {
      const next = { ...byModel }
      delete next[name]
      void update({ localLlmByModel: next })
      return
    }
    const base = byModel[name] ?? defaultProfile
    void update({ localLlmByModel: { ...byModel, [name]: { ...base, ...patch } } })
  }

  async function refresh() {
    try {
      const list = await invoke<ModelInfo[]>("llm_models_info")
      setModels(Array.isArray(list) ? list : [])
      await refreshLocalModels()
    } catch (e) {
      setStatus(`liste hatası: ${String(e)}`)
    }
    const nextMlxStatus = await invoke<MlxStatus>("mlx_status").catch((e: unknown) => ({
      available: false,
      reason: String(e),
    }))
    setMlxStatus(nextMlxStatus)
    try {
      if (nextMlxStatus?.available === false) {
        setMlxModels([])
        return
      }
      const list = await invoke<MlxModelInfo[]>("mlx_list_models")
      setMlxModels(Array.isArray(list) ? list : [])
    } catch {
      setMlxModels([])
    }
  }

  useEffect(() => {
    // Mount-time load + picker sync — a one-shot fetch from an external system
    // (Tauri). setState lands after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    void invoke<number>("llm_system_ram")
      .then(setRamBytes)
      .catch(() => {})
  }, [])

  const dlState = download?.state
  useEffect(() => {
    if (!download || download.state === "downloading") return
    /* eslint-disable react-hooks/set-state-in-effect */
    if (download.state === "done") {
      setStatus(`kuruldu: ${download.label} ✓`)
      setUrl("")
      void refresh()
    } else if (download.state === "cancelled") {
      setStatus("iptal — kısmi dosya korundu (tekrar denersen kaldığı yerden)")
    } else {
      setStatus(`indirme hatası: ${download.error ?? ""}`)
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    useLocalRuntimeStore.getState().clearLocalDownload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dlState, download?.id])

  function startDownload(repo: string, group: QuantGroup, revision = "main") {
    setGgufList(null)
    setHits(null)
    useLocalRuntimeStore.getState().startLocalDownload(repo, group, revision)
  }

  function startMlxDownload(model: string, label: string) {
    if (mlxStatus?.available !== true) {
      setStatus(mlxStatus?.reason ?? "MLX durumu kontrol ediliyor")
      return
    }
    setGgufList(null)
    setHits(null)
    useLocalRuntimeStore.getState().startMlxDownload(model, label)
  }

  async function listRepo(repo: string): Promise<boolean> {
    const res = await invoke<{
      params: number | null
      files: { path: string; size: number }[]
    }>("hf_list_gguf", { repo })
    if (res.files.length === 0) return false
    const groups = groupGguf(res.files)
    setGgufList({ repo, params: res.params, groups })
    setStatus(`${groups.length} quant bulundu — seç:`)
    return true
  }

  async function onDownload() {
    const parsed = parseHfUrl(url)
    if (parsed) {
      const name = (parsed.path.split("/").pop() ?? parsed.path).replace(/\.gguf$/, "")
      const { quant, tier } = quantInfo(name)
      try {
        const res = await invoke<{
          params: number | null
          files: { path: string; size: number }[]
        }>("hf_list_gguf", { repo: parsed.repo })
        const group = groupGguf(res.files).find((g) => g.parts.includes(parsed.path))
        if (group) {
          void startDownload(parsed.repo, group, parsed.revision)
          return
        }
      } catch {
        // Direct GGUF links still work when repo listing is unavailable.
      }
      void startDownload(
        parsed.repo,
        { key: parsed.path, label: name, quant, tier, total: 0, parts: [parsed.path] },
        parsed.revision,
      )
      return
    }
    setGgufList(null)
    setHits(null)
    const repo = parseHfRepo(url)
    if (repo) {
      setListing(true)
      setStatus(`${repo} taranıyor…`)
      try {
        if (!(await listRepo(repo))) {
          const name = repo.split("/").pop() ?? repo
          const found = await invoke<{ id: string; downloads: number }[]>("hf_search_gguf", {
            query: name,
          })
          setHits(found)
          setStatus(found.length ? "Bu repo'da GGUF yok — bir GGUF repo'su seç:" : "GGUF bulunamadı")
        }
      } catch (e) {
        setStatus(`tarama hatası: ${String(e)}`)
      } finally {
        setListing(false)
      }
      return
    }
    const q = url.trim()
    if (!q) {
      setStatus("Repo linki, org/model ya da arama metni yapıştır")
      return
    }
    setListing(true)
    setStatus(`"${q}" aranıyor…`)
    try {
      const found = await invoke<{ id: string; downloads: number }[]>("hf_search_gguf", { query: q })
      setHits(found)
      setStatus(found.length ? "Sonuçlar — bir repo seç:" : "Sonuç yok")
    } catch (e) {
      setStatus(`arama hatası: ${String(e)}`)
    } finally {
      setListing(false)
    }
  }

  async function pickRepo(id: string) {
    setHits(null)
    setListing(true)
    setStatus(`${id} taranıyor…`)
    try {
      if (!(await listRepo(id))) setStatus("Bu repo'da GGUF yok")
    } catch (e) {
      setStatus(`tarama hatası: ${String(e)}`)
    } finally {
      setListing(false)
    }
  }

  async function installCurated(m: CuratedModel) {
    setGgufList(null)
    setHits(null)
    setListing(true)
    setStatus(`${m.label} hazırlanıyor…`)
    let group: QuantGroup | undefined
    try {
      const res = await invoke<{
        params: number | null
        files: { path: string; size: number }[]
      }>("hf_list_gguf", { repo: m.repo })
      const groups = groupGguf(res.files)
      group =
        groups.find((g) => g.quant === m.quant) ??
        groups.find((g) => g.quant.startsWith(m.quant.slice(0, 2))) ??
        groups[0]
    } catch (e) {
      setStatus(`${m.label}: ${String(e)}`)
      setListing(false)
      return
    }
    setListing(false)
    if (!group) {
      setStatus(`${m.label}: GGUF bulunamadı`)
      return
    }
    void startDownload(m.repo, group)
  }

  function onCancelDownload() {
    useLocalRuntimeStore.getState().cancelLocalDownload()
  }

  async function onDelete(name: string) {
    if (!(await confirm(`${name} silinsin mi?`))) return
    try {
      await invoke("llm_delete_model", { file: name })
      if (byModel[name]) setModelProfile(name, null)
      void refresh()
    } catch (e) {
      setStatus(`silme hatası: ${String(e)}`)
    }
  }

  async function onDeleteMlx(id: string) {
    if (!(await confirm(`${id} ve yerel MLX cache dosyaları silinsin mi?`))) return
    try {
      await invoke("mlx_delete_model", { args: { model: id } })
      setStatus(`silindi: ${id}`)
      void refresh()
    } catch (e) {
      setStatus(`silme hatası: ${String(e)}`)
    }
  }

  const downloading = download?.state === "downloading"
  const pct =
    download && download.total > 0 ? Math.floor((download.done / download.total) * 100) : 0
  const isMac = osPlatform === "macos"
  const showGguf = !isMac
  const mlxAvailable = mlxStatus?.available === true
  const mlxUnavailable = isMac && mlxStatus?.available === false

  return (
    <div className="flex flex-col gap-6 text-base text-codezal-text">
      <LocalServerTab />

      <section className="flex flex-col gap-2">
        <h3 className="text-md font-semibold text-codezal-dim">Model indir</h3>
        {isMac ? (
          <>
            <p className="text-base text-codezal-mute">
              Apple Silicon üzerinde yerel modeller MLX olarak indirilir. MLX modelleri Apple
              cache'ine iner; Codezal kurulu bilgisini aşağıdaki listeden takip eder.
            </p>
            {mlxUnavailable && (
              <p className="text-base text-amber-500">
                MLX bu derlemede kapalı — {mlxStatus.reason ?? "llm-mlx feature gerekli"}.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-base text-codezal-mute">
              Hugging Face repo linki (
              <code className="rounded bg-codezal-input px-1">org/model</code>), model adı ya da
              tam <code className="rounded bg-codezal-input px-1">.gguf</code> linki yapıştır →
              uygun GGUF'ler listelenir, quant seç. Repo'da MTP dosyası varsa beraber iner.
              Model <code className="rounded bg-codezal-input px-1">~/.cache/codezal/models</code>{" "}
              altına iner.
            </p>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://huggingface.co/<repo>/resolve/main/model.gguf"
              className="rounded-md border border-codezal bg-codezal-input px-3 py-1.5 outline-none focus:border-codezal-accent"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={onDownload}
                disabled={downloading || listing}
                className="inline-flex items-center gap-1.5 rounded-md bg-codezal-accent px-3 py-1.5 text-base font-medium text-white hover:bg-codezal-accent/90 disabled:opacity-40"
              >
                <Download className="size-3.5" />
                {downloading ? `İndiriliyor ${pct}%` : listing ? "Aranıyor…" : "İndir"}
              </button>
              {downloading && (
                <button
                  onClick={onCancelDownload}
                  className="rounded-md border border-codezal px-3 py-1.5 text-base text-codezal-dim hover:bg-codezal-input hover:text-codezal-text"
                >
                  İptal
                </button>
              )}
            </div>
          </>
        )}
        {isMac && downloading && (
          <div className="flex items-center gap-2">
            <button
              onClick={onCancelDownload}
              className="rounded-md border border-codezal px-3 py-1.5 text-base text-codezal-dim hover:bg-codezal-input hover:text-codezal-text"
            >
              İptal
            </button>
          </div>
        )}
        {downloading && (
          <div className="h-1.5 overflow-hidden rounded bg-codezal-input">
            <div
              className="h-full bg-codezal-accent transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        {downloading && download ? (
          <div className="text-base text-codezal-mute">
            indiriliyor: {download.label}
            {download.partsTotal > 1
              ? ` (parça ${download.partIndex + 1}/${download.partsTotal})`
              : ""}
            …
          </div>
        ) : (
          status && <div className="text-base text-codezal-mute">{status}</div>
        )}
        {showGguf && ggufList && (
          <div className="flex flex-col gap-1">
            {ggufList.params != null && (
              <div className="text-base text-codezal-mute">{fmtParams(ggufList.params)}</div>
            )}
            <ul className="flex flex-col divide-y divide-codezal/60 overflow-hidden rounded-md border border-codezal bg-codezal-panel">
              {ggufList.groups.map((g) => {
                const fit = ramFit(g.total, ramBytes)
                const companionCount = g.companionParts?.length ?? 0
                const modelParts = g.parts.length - companionCount
                return (
                  <li key={g.key}>
                    <button
                      onClick={() => void startDownload(ggufList.repo, g)}
                      disabled={downloading}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-base hover:bg-codezal-input disabled:opacity-40"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-codezal-text" title={g.label}>
                          {g.quant}
                          {modelParts > 1 ? ` · ${modelParts} parça` : ""}
                          {companionCount > 0 ? " · + MTP" : ""}
                        </span>
                        {g.tier && <span className="text-base text-codezal-mute">{g.tier}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {fit && (
                          <span className={`text-base ${fit.cls}`}>
                            {fit.icon} {fit.text}
                          </span>
                        )}
                        <span className="text-codezal-mute">{fmtSize(g.total)}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {showGguf && hits && hits.length > 0 && (
          <ul className="flex flex-col divide-y divide-codezal/60 overflow-hidden rounded-md border border-codezal bg-codezal-panel">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  onClick={() => void pickRepo(h.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-base hover:bg-codezal-input"
                >
                  <span className="min-w-0 truncate" title={h.id}>
                    {h.id}
                  </span>
                  <span className="shrink-0 text-codezal-mute">↓ {h.downloads.toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-md font-semibold text-codezal-dim">Önerilen modeller</h3>
        <ul className="flex flex-col divide-y divide-codezal/60 overflow-hidden rounded-md border border-codezal bg-codezal-panel">
          {isMac
            ? MLX_CATALOG.map((m) => {
                const installed = mlxModels.some((x) => x.id === m.id)
                const fit = ramFit(m.approxGB * 1e9, ramBytes)
                return (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium text-codezal-text" title={m.label}>
                          {m.label}
                        </span>
                        <span className="shrink-0 rounded bg-codezal-input px-1.5 text-base text-codezal-mute">
                          {m.category}
                        </span>
                      </span>
                      <span className="truncate text-base text-codezal-mute">{m.blurb}</span>
                    </span>
                    <span className="shrink-0 text-base text-codezal-mute">{m.approxGB} GB</span>
                    {fit && (
                      <span className={`shrink-0 text-base ${fit.cls}`}>
                        {fit.icon} {fit.text}
                      </span>
                    )}
                    {installed ? (
                      <span className="shrink-0 text-base text-emerald-500">✓ kurulu</span>
                    ) : (
                      <button
                        onClick={() => startMlxDownload(m.id, m.label)}
                        disabled={downloading || listing || !mlxAvailable}
                        title={!mlxAvailable ? (mlxStatus?.reason ?? "MLX hazır değil") : undefined}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-codezal px-2.5 py-1 text-base text-codezal-dim hover:bg-codezal-input hover:text-codezal-text disabled:opacity-40"
                      >
                        <Download className="size-3.5" />
                        Kur
                      </button>
                    )}
                  </li>
                )
              })
            : CURATED.map((m) => {
                const installed = curatedInstalled(
                  m,
                  models.map((x) => x.name),
                )
                const fit = ramFit(m.approxGB * 1e9, ramBytes)
                return (
                  <li key={m.repo} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium text-codezal-text" title={m.label}>
                          {m.label}
                        </span>
                        <span className="shrink-0 rounded bg-codezal-input px-1.5 text-base text-codezal-mute">
                          {m.category}
                        </span>
                      </span>
                      <span className="truncate text-base text-codezal-mute">{m.blurb}</span>
                    </span>
                    <span className="shrink-0 text-base text-codezal-mute">{m.approxGB} GB</span>
                    {fit && (
                      <span className={`shrink-0 text-base ${fit.cls}`}>
                        {fit.icon} {fit.text}
                      </span>
                    )}
                    {installed ? (
                      <span className="shrink-0 text-base text-emerald-500">✓ kurulu</span>
                    ) : (
                      <button
                        onClick={() => void installCurated(m)}
                        disabled={downloading || listing}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-codezal px-2.5 py-1 text-base text-codezal-dim hover:bg-codezal-input hover:text-codezal-text disabled:opacity-40"
                      >
                        <Download className="size-3.5" />
                        Kur
                      </button>
                    )}
                  </li>
                )
              })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-md font-semibold text-codezal-dim">Kurulu modeller</h3>
        {isMac ? (
          mlxModels.length === 0 ? (
            <p className="text-base text-codezal-mute">Henüz MLX model yok — yukarıdan indir.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-codezal/60 overflow-hidden rounded-md border border-codezal bg-codezal-panel">
              {mlxModels.map((m) => {
                const meta = MLX_CATALOG.find((x) => x.id === m.id)
                return (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium text-codezal-text" title={m.id}>
                        {meta?.label ?? m.id}
                      </span>
                      <span className="truncate text-base text-codezal-mute">{m.id}</span>
                    </span>
                    <span className="shrink-0 text-base text-codezal-mute">
                      {m.size > 0 ? fmtSize(m.size) : meta ? `${meta.approxGB} GB` : ""}
                    </span>
                    <button
                      onClick={() => void onDeleteMlx(m.id)}
                      className="shrink-0 rounded-md border border-codezal px-2 py-0.5 text-base text-codezal-dim hover:bg-red-600 hover:text-white"
                    >
                      Sil
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        ) : models.length === 0 ? (
          <p className="text-base text-codezal-mute">Henüz model yok — yukarıdan indir.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-codezal/60 overflow-hidden rounded-md border border-codezal bg-codezal-panel">
            {models.map((m) => {
              const custom = !!byModel[m.name]
              const isOpen = expanded === m.name
              return (
                <li key={m.name} className="flex flex-col">
                  <div className="flex items-center gap-3 px-3 py-2">
                    <button
                      onClick={() => setExpanded(isOpen ? null : m.name)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-codezal-accent"
                      title="Profil ayarları"
                    >
                      <span className="shrink-0 text-codezal-mute">{isOpen ? "▾" : "▸"}</span>
                      <span className="min-w-0 truncate" title={m.name}>
                        {displayModelName(m.name)}
                      </span>
                      {custom && (
                        <span className="shrink-0 rounded bg-codezal-accent/20 px-1.5 py-0.5 text-base text-codezal-accent">
                          özel profil
                        </span>
                      )}
                    </button>
                    <span className="shrink-0 text-base text-codezal-mute">{fmtSize(m.size)}</span>
                    <button
                      onClick={() => onDelete(m.name)}
                      className="shrink-0 rounded-md border border-codezal px-2 py-0.5 text-base text-codezal-dim hover:bg-red-600 hover:text-white"
                    >
                      Sil
                    </button>
                  </div>
                  <ModelAdvisor name={m.name} />
                  {isOpen && (
                    <div className="flex flex-col gap-3 border-t border-codezal/60 bg-codezal-input/30 px-4 py-3">
                      <label className="flex items-center gap-2 text-base text-codezal-mute">
                        <input
                          type="checkbox"
                          checked={custom}
                          onChange={(e) => setModelProfile(m.name, e.target.checked ? {} : null)}
                        />
                        <span>
                          Bu modele özel profil — kapalıyken <strong>Varsayılan profil</strong>{" "}
                          kullanılır.
                        </span>
                      </label>
                      {custom && (
                        <ProfileControls
                          value={byModel[m.name] ?? defaultProfile}
                          onChange={(p) => setModelProfile(m.name, p)}
                        />
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {showGguf && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-md font-semibold text-codezal-dim">Varsayılan GGUF profili</h3>
            <p className="text-base text-codezal-mute">
              Kendi profili olmayan tüm yerel modeller bu ayarları kullanır. Bir modele özel ayar
              vermek için yukarıdaki listede modeli aç.
            </p>
          </div>
          <ProfileControls value={defaultProfile} onChange={setDefault} />
        </section>
      )}
    </div>
  )
}
