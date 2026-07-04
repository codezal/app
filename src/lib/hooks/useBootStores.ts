import { useEffect } from "react"
import { useSettingsStore } from "@/store/settings"
import { useSessionsStore } from "@/store/sessions"
import { db, deleteSessionsOlderThan } from "@/lib/db"
import { cleanupOldOutputs } from "@/lib/tools/truncate"
import { autoSeedOnFirstRun } from "@/lib/agents-seed"
import { ensureDefaultMarketplace, loadAllInstalled } from "@/lib/plugins"
import { toast } from "@/store/toast"
import { t as tStatic } from "@/lib/i18n"

export function useBootStores() {
  const loadSettings = useSettingsStore((s) => s.load)
  const loadAll = useSessionsStore((s) => s.loadAll)

  useEffect(() => {
    void loadSettings()
      .then(async () => {
        const days = useSettingsStore.getState().settings.cleanupPeriodDays
        if (days && days > 0) {
          try {
            const n = await deleteSessionsOlderThan(db, Date.now() - days * 86_400_000)
            if (n > 0) console.info(`[cleanup] ${n} eski session silindi (>${days} gün)`)
          } catch (e) {
            console.error("[cleanup] session retention hatası:", e)
          }
        }
      })
      .finally(() => {
        void loadAll().catch((e) => {
          console.error("[boot] oturumlar yüklenemedi:", e)
          toast.error(tStatic("toast.startupLoadFailed"))
        })
      })
    void cleanupOldOutputs()
    void autoSeedOnFirstRun()
    void ensureDefaultMarketplace().finally(() => {
      void loadAllInstalled().then((results) => {
        const ok = results.filter((r) => r.ok).length
        const fail = results.length - ok
        if (results.length > 0) {
          console.info(`[plugins] yüklendi: ${ok} ok, ${fail} hata`)
        }
      })
    })
  }, [loadSettings, loadAll])
}
