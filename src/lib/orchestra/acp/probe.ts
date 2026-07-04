import { AcpConnection } from "./connection"
import {
  ACP_METHOD,
  ACP_PROTOCOL_VERSION,
  type AcpModelOption,
  type NewSessionResult,
} from "./protocol"

export type AcpProbeResult = {
  currentModelId?: string
  models: AcpModelOption[]
}

const PROBE_TIMEOUT_MS = 60_000

export async function probeAcpModels(
  command: string,
  cwd?: string,
): Promise<AcpProbeResult> {
  const conn = new AcpConnection({ command, cwd })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`ACP probe timeout (${PROBE_TIMEOUT_MS / 1000}s)`)),
      PROBE_TIMEOUT_MS,
    )
  })

  const work = (async (): Promise<AcpProbeResult> => {
    await conn.start()
    await conn.request(ACP_METHOD.initialize, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    })
    const sess = (await conn.request(ACP_METHOD.newSession, {
      cwd: cwd ?? ".",
      mcpServers: [],
    })) as NewSessionResult
    return {
      currentModelId: sess?.models?.currentModelId,
      models: sess?.models?.availableModels ?? [],
    }
  })()

  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
    await conn.close()
  }
}
