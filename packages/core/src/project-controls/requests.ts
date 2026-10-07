import { randomUUID } from "node:crypto"
import { ProjectControls } from "../project-controls"
import { ProjectRecords } from "./records"
import { createWorkQueue } from "../util/work-queue"

const queues = new Map<string, { limit: number; queue: ReturnType<typeof createWorkQueue> }>()

export async function admit(input: {
  directory: string
  sessionID: string
  provider: string
  model: string
  endpoint?: string
  content: unknown
}) {
  const controls = await ProjectControls.read(input.directory)
  const endpoint = input.endpoint ? URL.parse(input.endpoint) : null
  const local = endpoint !== null && ["127.0.0.1", "[::1]", "localhost"].includes(endpoint.hostname)
  const denied = (value: typeof controls) => {
    const pinned = value.origins[input.provider]
    return !ProjectControls.providerAllowed(value, input.provider)
      ? "Provider is not allowed by this project"
      : (value.isolate || value.deviceOnly.length > 0) && !local
        ? "This project requires on-device processing"
        : pinned && (!endpoint || !pinned.some((address) => new URL(address).origin === endpoint.origin))
          ? "Provider address does not match the project's approved addresses"
          : undefined
  }
  const reason = denied(controls)
  const content = controls.retainRequests ? JSON.stringify(input.content) : undefined
  await ProjectRecords.save(input.directory, "requests", {
    id: randomUUID(),
    time: Date.now(),
    sessionID: input.sessionID,
    provider: input.provider,
    model: input.model,
    origin: endpoint?.origin ?? "",
    allowed: !reason,
    ...(reason ? { reason } : {}),
    ...(content && content.length <= 2000000 ? { content } : {}),
  })
  if (reason) throw new Error(reason)
  return {
    async acquire(signal: AbortSignal) {
      if (!local) {
        const reason = denied(await ProjectControls.read(input.directory))
        if (reason) throw new Error(reason)
        return () => {}
      }
      const key = endpoint.origin
      const existing = queues.get(key)
      const entry = existing ?? {
        limit: controls.localConcurrency,
        queue: createWorkQueue(() => queues.get(key)?.limit ?? 1),
      }
      entry.limit = controls.localConcurrency
      queues.set(key, entry)
      const release = await entry.queue.acquire(signal)
      try {
        const reason = denied(await ProjectControls.read(input.directory))
        if (reason) throw new Error(reason)
        return release
      } catch (error) {
        release()
        throw error
      }
    },
  }
}

export * as ProjectRequests from "./requests"
