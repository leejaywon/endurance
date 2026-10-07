import { and, eq, inArray, isNull, notExists, or, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { MessageTable, PartTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"

const INTERRUPTED =
  "Execution ended without a final result. Completion is unconfirmed. This work was not restarted automatically."

export interface Interface {
  /** Called before the directory admits work, or while its runner still owns the session. */
  readonly recover: (sessionID?: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRecovery") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const db = database.db

    const recover = Effect.fn("SessionRecovery.recover")(function* (sessionID?: SessionID) {
      const directory = yield* InstanceState.directory
      // Legacy transcripts only. V2 projections must be recovered by their own execution owner.
      const sessions = db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(
          and(
            eq(SessionTable.directory, directory),
            isNull(SessionTable.workspace_id),
            sessionID ? eq(SessionTable.id, sessionID) : undefined,
            notExists(
              db
                .select({ id: SessionMessageTable.id })
                .from(SessionMessageTable)
                .where(eq(SessionMessageTable.session_id, SessionTable.id)),
            ),
          ),
        )
      const messages = yield* db
        .select()
        .from(MessageTable)
        .where(
          and(
            inArray(MessageTable.session_id, sessions),
            sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`,
            or(
              sql`json_extract(${MessageTable.data}, '$.time.completed') IS NULL`,
              inArray(
                MessageTable.id,
                db
                  .select({ id: PartTable.message_id })
                  .from(PartTable)
                  .where(
                    and(
                      inArray(PartTable.session_id, sessions),
                      sql`json_extract(${PartTable.data}, '$.type') = 'tool'`,
                      sql`json_extract(${PartTable.data}, '$.state.status') IN ('pending', 'running')`,
                    ),
                  ),
              ),
            ),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      for (const message of messages) {
        const decoded = Schema.decodeUnknownOption(SessionV1.Info)({
          ...message.data,
          id: message.id,
          sessionID: message.session_id,
        })
        if (Option.isNone(decoded)) {
          yield* Effect.logWarning("Cannot recover invalid message", { messageID: message.id })
          continue
        }
        const info = decoded.value
        if (info.role !== "assistant") continue
        const parts = yield* db
          .select()
          .from(PartTable)
          .where(eq(PartTable.message_id, message.id))
          .all()
          .pipe(Effect.orDie)
        // After restart, the last observed activity is the only defensible end time.
        // Do not count hours spent with the application closed as thinking time.
        const end = sessionID ? Date.now() : Math.max(message.time_updated, ...parts.map((part) => part.time_updated))
        for (const row of parts) {
          const decoded = Schema.decodeUnknownOption(SessionV1.Part)({
            ...row.data,
            id: row.id,
            messageID: row.message_id,
            sessionID: row.session_id,
          })
          if (Option.isNone(decoded)) {
            yield* Effect.logWarning("Cannot recover invalid part", { partID: row.id })
            continue
          }
          const part = decoded.value
          if (part.type === "tool" && (part.state.status === "pending" || part.state.status === "running")) {
            yield* events.publish(SessionV1.Event.PartUpdated, {
              sessionID: part.sessionID,
              part: {
                ...part,
                state: {
                  status: "error",
                  input: part.state.input,
                  error: INTERRUPTED,
                  metadata: {
                    ...("metadata" in part.state ? part.state.metadata : {}),
                    interrupted: true,
                    recovery: "execution_lost",
                  },
                  time: { start: "time" in part.state ? part.state.time.start : row.time_created, end },
                },
              },
              time: Date.now(),
            })
          }
          if ((part.type === "text" || part.type === "reasoning") && part.time && part.time.end === undefined) {
            yield* events.publish(SessionV1.Event.PartUpdated, {
              sessionID: part.sessionID,
              part: { ...part, time: { ...part.time, end } },
              time: Date.now(),
            })
          }
        }
        if (info.time.completed === undefined) {
          yield* events.publish(SessionV1.Event.MessageUpdated, {
            sessionID: info.sessionID,
            info: {
              ...info,
              finish: "error",
              error: info.error ?? new SessionV1.AbortedError({ message: INTERRUPTED }).toObject(),
              time: { ...info.time, completed: Math.max(info.time.created, end) },
            },
          })
        }
      }
      if (messages.length)
        yield* Effect.logWarning("Recovered unfinished executions", { directory, sessionID, count: messages.length })
    })
    return Service.of({ recover })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Database.node, EventV2Bridge.node] })
export * as SessionRecovery from "./recovery"
