import { type Child } from "@tauri-apps/plugin-shell"
import { invoke } from "@tauri-apps/api/core"
import { shellInvocation, spawnProgram } from "../exec"
import { createId } from "../id"

export function lineMatches(line: string, pattern: string | undefined): boolean {
  if (!pattern) return true
  try {
    return new RegExp(pattern).test(line)
  } catch {
    return line.includes(pattern)
  }
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

type MonitorHandle = {
  id: string
  command: string
  child: Child
  startedAt: number
}

const monitors = new Map<string, MonitorHandle>()

export type MonitorStartArgs = {
  workspace: string
  command: string
  pattern?: string
  onEvent: (line: string) => void
}

export async function startMonitor(args: MonitorStartArgs): Promise<string> {
  const id = createId("monitor")
  const { program, flag } = await shellInvocation()
  const wrapped = `cd ${shellQuote(args.workspace)} && ${args.command}`
  const cmd = await spawnProgram(program, [flag, wrapped])

  const handle = (line: string) => {
    if (lineMatches(line, args.pattern)) args.onEvent(line)
  }
  cmd.stdout.on("data", handle)
  cmd.stderr.on("data", handle)
  cmd.on("close", () => {
    monitors.delete(id)
  })
  cmd.on("error", () => {
    monitors.delete(id)
  })

  const child = await cmd.spawn()
  monitors.set(id, { id, command: args.command, child, startedAt: Date.now() })
  return id
}

export async function stopMonitor(id: string): Promise<boolean> {
  const m = monitors.get(id)
  if (!m) return false
  await invoke("proc_kill_tree", { pid: m.child.pid }).catch(() => {})
  await m.child.kill().catch(() => {})
  monitors.delete(id)
  return true
}

export function listMonitors(): Array<{ id: string; command: string; startedAt: number }> {
  return [...monitors.values()].map((m) => ({
    id: m.id,
    command: m.command,
    startedAt: m.startedAt,
  }))
}
