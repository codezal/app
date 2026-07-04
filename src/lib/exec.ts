//   runShell(script, opts)          — arbitrary shell script (Bucket B). bash (Windows'ta
//
import { Command, type Child } from "@tauri-apps/plugin-shell"
import { invoke } from "@tauri-apps/api/core"

export type ExecResult = { code: number; stdout: string; stderr: string }

// ─── Platform + PATH (lazy-cache, invoke bir kez) ──────────────────────────────

let _platform: string | null = null
export async function osPlatform(): Promise<string> {
  if (_platform === null) {
    try {
      _platform = await invoke<string>("os_platform")
    } catch {
      _platform = ""
    }
  }
  return _platform
}

export async function isWindows(): Promise<boolean> {
  return (await osPlatform()) === "windows"
}

let _loginPath: string | null = null
async function loginPath(): Promise<string> {
  if (_loginPath === null) {
    try {
      _loginPath = await invoke<string>("login_path")
    } catch {
      _loginPath = ""
    }
  }
  return _loginPath
}

export async function resolveProgram(name: string): Promise<string | null> {
  try {
    return (await invoke<string | null>("resolve_program", { name })) ?? null
  } catch {
    return null
  }
}

export async function copyDir(src: string, dest: string): Promise<void> {
  await invoke("fs_copy_dir", { src, dest })
}

export async function removeDir(path: string): Promise<void> {
  await invoke("fs_remove_dir", { path })
}

async function buildEnv(
  extraEnv?: Record<string, string>,
  pathPrepend?: string[],
): Promise<Record<string, string> | undefined> {
  const base = await loginPath()
  const sep = (await isWindows()) ? ";" : ":"
  const parts = [...(pathPrepend ?? []), base].filter(Boolean)
  const env: Record<string, string> = {}
  const PATH = parts.join(sep)
  if (PATH) env.PATH = PATH
  if (extraEnv) Object.assign(env, extraEnv)
  return Object.keys(env).length ? env : undefined
}


export type RunProgramOpts = {
  cwd?: string
  env?: Record<string, string>
  pathPrepend?: string[]
  timeoutMs?: number
}

export async function runProgram(
  program: string,
  args: string[],
  opts: RunProgramOpts = {},
): Promise<ExecResult> {
  const env = await buildEnv(opts.env, opts.pathPrepend)
  // encoding: "utf-8" ZORUNLU — verilmezse plugin-shell strict `String::from_utf8`
  // verilince encoding_rs lossy decode eder (bozuk byte → U+FFFD, asla patlamaz).
  const cmd = Command.create(program, args, { cwd: opts.cwd, env, encoding: "utf-8" })
  if (opts.timeoutMs) return await executeKillable(cmd, opts.timeoutMs, program)
  const out = await cmd.execute()
  return { code: out.code ?? -1, stdout: out.stdout, stderr: out.stderr }
}


export type SpawnProgramOpts = {
  cwd?: string
  env?: Record<string, string>
  pathPrepend?: string[]
}

export async function spawnProgram(
  program: string,
  args: string[],
  opts: SpawnProgramOpts = {},
): Promise<Command<string>> {
  const env = await buildEnv(opts.env, opts.pathPrepend)
  return Command.create(program, args, { cwd: opts.cwd, env, encoding: "utf-8" })
}

// ─── runShell — arbitrary shell script (Bucket B) ──────────────────────────────

export type RunShellOpts = {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  onTimeout?: (cmd: Command<string>, child: Child, partial: string[]) => void
}

export async function shellInvocation(): Promise<{ program: string; flag: string }> {
  if (await isWindows()) {
    const bash = await resolveProgram("bash")
    if (!bash) return { program: "cmd", flag: "/c" }
  }
  return { program: "bash", flag: "-lc" }
}

async function executeKillable(
  cmd: Command<string>,
  timeoutMs: number,
  label: string,
  onTimeout?: (cmd: Command<string>, child: Child, partial: string[]) => void,
): Promise<ExecResult> {
  // streaming-eviction (keep = maxBytes*2) paritesi.
  const RING_MAX_BYTES = 1024 * 1024
  const makeRing = (maxBytes: number) => {
    const lines: string[] = []
    let bytes = 0
    return {
      lines,
      push(l: string) {
        lines.push(l)
        bytes += l.length + 1
        while (bytes > maxBytes && lines.length > 1) {
          bytes -= lines.shift()!.length + 1
        }
      },
    }
  }
  const out = makeRing(RING_MAX_BYTES)
  const err = makeRing(RING_MAX_BYTES)
  cmd.stdout.on("data", (l) => out.push(l))
  cmd.stderr.on("data", (l) => err.push(l))
  return await new Promise<ExecResult>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn()
    }
    cmd.on("close", (p) =>
      finish(() => resolve({ code: p.code ?? -1, stdout: out.lines.join("\n"), stderr: err.lines.join("\n") })),
    )
    cmd.on("error", (e) => finish(() => reject(new Error(String(e)))))
    cmd.spawn().then(
      (child) => {
        if (settled) return // close/error zaten geldi
        timer = setTimeout(() => {
          finish(() => {
            if (onTimeout) {
              onTimeout(cmd, child, [...out.lines])
              reject(new Error(`__detached__:${label}`))
            } else {
              void invoke("proc_kill_tree", { pid: child.pid }).catch(() => {})
              void child.kill().catch(() => {})
              reject(new Error(`Timeout (${timeoutMs}ms): ${label}`))
            }
          })
        }, timeoutMs)
      },
      (e) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))),
    )
  })
}

export async function runShell(script: string, opts: RunShellOpts = {}): Promise<ExecResult> {
  const env = await buildEnv(opts.env)
  const { program, flag } = await shellInvocation()
  const cmd = Command.create(program, [flag, script], { cwd: opts.cwd, env, encoding: "utf-8" })
  if (opts.timeoutMs) return await executeKillable(cmd, opts.timeoutMs, program, opts.onTimeout)
  const out = await cmd.execute()
  return { code: out.code ?? -1, stdout: out.stdout, stderr: out.stderr }
}
