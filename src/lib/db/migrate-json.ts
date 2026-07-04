// node:sqlite ile test edilebilir.
import type { Db } from "./driver"
import { getMeta, setMeta } from "./schema"
import { insertMessageInto, persistModelMessages, upsertProject, upsertSessionRow } from "./sessions-db"
import type { ProjectMeta, Session } from "@/store/types"

export type JsonIndex = {
  order?: string[]
  projects?: string[]
  projectMeta?: Record<string, ProjectMeta>
}

export type JsonSource = {
  loadIndex: () => Promise<JsonIndex>
  loadSession: (id: string) => Promise<Session | null>
}

export type MigrateResult =
  | { status: "skipped" }
  | { status: "migrated"; sessions: number; messages: number; projects: number; errors: number }

export async function migrateJsonToSqlite(db: Db, src: JsonSource): Promise<MigrateResult> {
  if (await getMeta(db, "json_imported")) return { status: "skipped" }

  const idx = await src.loadIndex()
  const ids = idx.order ?? []
  let sessions = 0
  let messages = 0
  let errors = 0

  for (const id of ids) {
    try {
      const s = await src.loadSession(id)
      if (!s) continue
      const msgs = s.messages ?? []
      await db.tx(async (t) => {
        await upsertSessionRow(t, { ...s, id })
        for (let i = 0; i < msgs.length; i++) await insertMessageInto(t, id, i, msgs[i])
        if (s.modelMessages?.length) await persistModelMessages(t, id, s.modelMessages)
      })
      sessions++
      messages += msgs.length
    } catch (e) {
      errors++
      console.error(`[migrate-json] session ${id} atlandı:`, e)
    }
  }

  const projects = idx.projects ?? []
  for (let i = 0; i < projects.length; i++) {
    await upsertProject(db, projects[i], idx.projectMeta?.[projects[i]] ?? {}, i)
  }

  await setMeta(db, "json_imported", "1")
  return { status: "migrated", sessions, messages, projects: projects.length, errors }
}
