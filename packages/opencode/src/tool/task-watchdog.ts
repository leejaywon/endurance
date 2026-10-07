import { Clock, Effect } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { SessionStatus } from "@/session/status"
import { SessionID } from "@/session/schema"

export const IDLE_TIMEOUT_MS = 5 * 60_000
const CHECK_INTERVAL_MS = 5_000

// Track real progress, not a worker heartbeat: a hung worker can still be alive.
export const make = Effect.gen(function* () {
  const events = yield* EventV2Bridge.Service
  const permission = yield* Permission.Service
  const question = yield* Question.Service
  const status = yield* SessionStatus.Service

  return (sessionID: SessionID): Effect.Effect<never, Error> =>
    Effect.scoped(
      Effect.gen(function* () {
        const sessions = new Set<string>([sessionID])
        const tools = new Map<string, number>()
        let progress = yield* Clock.currentTimeMillis
        let checked = progress
        const unsubscribe = yield* events.listen((event) =>
          Effect.gen(function* () {
            if (!event.data || typeof event.data !== "object") return
            const data = event.data as Record<string, unknown>
            if (event.type === SessionV1.Event.Created.type) {
              const info = data.info as SessionV1.SessionInfo
              if (info.parentID && sessions.has(info.parentID)) sessions.add(info.id)
            }
            if (typeof data.sessionID !== "string" || !sessions.has(data.sessionID)) return
            if (!["message.updated", "message.part.updated", "message.part.delta"].includes(event.type)) return
            progress = yield* Clock.currentTimeMillis
            if (event.type !== SessionV1.Event.PartUpdated.type) return
            const part = data.part as SessionV1.Part
            if (part.type !== "tool") return
            if (part.state.status !== "running") {
              tools.delete(part.id)
              return
            }
            if (part.tool === "task" && typeof part.state.metadata?.sessionId === "string")
              sessions.add(part.state.metadata.sessionId)
            const timeout = part.state.input.timeout
            // A quiet command with an explicit timeout is not stalled before its own deadline.
            if (typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0)
              tools.set(part.id, part.state.time.start + timeout + 30_000)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        while (true) {
          yield* Effect.sleep(CHECK_INTERVAL_MS)
          const approvals = yield* permission.list()
          const questions = yield* question.list()
          const now = yield* Clock.currentTimeMillis
          const elapsed = now - checked
          checked = now
          if ([...approvals, ...questions].some((request) => sessions.has(request.sessionID))) {
            progress = now
            for (const [id, deadline] of tools) tools.set(id, deadline + elapsed)
            continue
          }
          const statuses = yield* status.list()
          const retryAt = Math.max(
            0,
            ...Array.from(statuses, ([id, value]) => (sessions.has(id) && value.type === "retry" ? value.next : 0)),
          )
          const deadline = Math.max(progress + IDLE_TIMEOUT_MS, retryAt + IDLE_TIMEOUT_MS, ...tools.values())
          if (now < deadline) continue
          return yield* Effect.fail(
            new Error(
              `Subagent stopped responding (task_id: ${sessionID}): no progress for 5 minutes. ` +
                "Cancellation was requested. Completion of its actions is unconfirmed. " +
                "Report this to the user; do not automatically retry or delegate the same work again. " +
                "You may continue unrelated work.",
            ),
          )
        }
      }),
    )
})

export * as TaskWatchdog from "./task-watchdog"
