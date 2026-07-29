// Credential resolution for the bench harness — reads the SAME secrets the
// desktop app stores (OS keychain via src-tauri/src/secrets.rs, service
// "codezal", account "apiKey.<providerId>") so a registered provider can be
// selected with --provider without exporting anything. Env vars take
// precedence (CI-friendly override).
//
// Platform notes:
// - macOS: `security find-generic-password -s <service> -a <account> -w`
//   (matches keyring crate's Entry::new(service, account)).
// - Windows: CredRead via PowerShell; the keyring crate stores the target
//   name as "<account>.<service>" (see keyring-3.x windows.rs).
import { execFile, spawn } from "node:child_process"

const SERVICE = "codezal"
const INDEX_ACCOUNT = "__index__"

function execText(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    // 30s: the first read of an app-stored item can trigger the macOS keychain
    // access prompt, which needs human time to click "Always Allow".
    execFile(cmd, args, { timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve(error ? null : stdout)
    })
  })
}

async function keychainGetMacOS(account: string): Promise<string | null> {
  const out = await execText("security", [
    "find-generic-password",
    "-s",
    SERVICE,
    "-a",
    account,
    "-w",
  ])
  if (out === null) return null
  const value = out.replace(/\r?\n$/, "")
  return value ? value : null
}

// CredRead P/Invoke — prints the credential blob (UTF-16) for the given
// target name, or nothing when missing. Kept as a single -EncodedCommand so
// no quoting/escaping issues arise.
const WIN_CREDREAD_PS = `
param([string]$Target)
$src = @'
using System;
using System.Runtime.InteropServices;
public static class CredMan {
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  public static string Read(string target) {
    IntPtr ptr;
    if (!CredRead(target, 1, 0, out ptr)) return null;
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
      if (c.CredentialBlob == IntPtr.Zero || c.CredentialBlobSize <= 0) return "";
      return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
    } finally { CredFree(ptr); }
  }
}
'@
Add-Type -TypeDefinition $src
$r = [CredMan]::Read($Target)
if ($null -ne $r) { [Console]::Out.Write($r) }
`

function runPowerShell(script: string, target: string): Promise<string | null> {
  return new Promise((resolve) => {
    const ps = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 15_000,
    } as never)
    let out = ""
    ps.stdout.on("data", (d) => (out += d))
    ps.on("error", () => resolve(null))
    ps.on("close", (code) => resolve(code === 0 ? out : null))
    ps.stdin.end(`${script}\n-Target ${JSON.stringify(target)}\n`)
  })
}

async function keychainGetWindows(account: string): Promise<string | null> {
  // keyring crate target format: "<account>.<service>". Try it first, then
  // the plain account (in case a future crate version changes the format).
  for (const target of [`${account}.${SERVICE}`, account]) {
    const out = await runPowerShell(WIN_CREDREAD_PS, target)
    if (out) return out
  }
  return null
}

export async function keychainGet(account: string): Promise<string | null> {
  try {
    if (process.platform === "darwin") return await keychainGetMacOS(account)
    if (process.platform === "win32") return await keychainGetWindows(account)
    return null // Linux: no secret-service reader here — use env vars.
  } catch {
    return null
  }
}

// Provider ids that have an API key stored in the keychain (from the index
// entry the app maintains — mirrors src/lib/providers/secret-store.ts).
export async function listKeychainApiKeyIds(): Promise<string[]> {
  const raw = await keychainGet(INDEX_ACCOUNT)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { apiKeys?: unknown }
    return Array.isArray(parsed.apiKeys)
      ? parsed.apiKeys.filter((x): x is string => typeof x === "string")
      : []
  } catch {
    return []
  }
}

// Resolution order: BENCH_API_KEY (generic override) → provider env vars →
// OS keychain entry written by the app. Returns null when nothing is found.
export async function resolveApiKey(
  providerId: string,
  envVars: string[],
): Promise<{ value: string; source: "env" | "keychain" } | null> {
  if (process.env.BENCH_API_KEY) return { value: process.env.BENCH_API_KEY, source: "env" }
  for (const name of envVars) {
    const v = process.env[name]
    if (v) return { value: v, source: "env" }
  }
  // Retry once: a transient keychain failure (e.g. the macOS access prompt
  // timing out) should not fail the lookup — after the user approves, the
  // second read succeeds instantly.
  const account = `apiKey.${providerId}`
  const stored = (await keychainGet(account)) ?? (await keychainGet(account))
  if (stored) return { value: stored, source: "keychain" }
  return null
}
