import path from "node:path"
import { createHash } from "node:crypto"
import { realpath, stat } from "node:fs/promises"
import { and, eq, inArray } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectDirectoryTable, ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { ProjectControls } from "@opencode-ai/core/project-controls"
import { stageProjectStorage } from "@opencode-ai/core/project-controls/storage"
import { ProjectRecords } from "@opencode-ai/core/project-controls/records"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { InstanceStore } from "@/project/instance-store"
import { InstanceRef } from "@/effect/instance-ref"
import { SessionStatus } from "@/session/status"
import { Project } from "@/project/project"
import { ConflictError, InvalidRequestError } from "@/server/routes/instance/httpapi/errors"

export type Input = {
  directory: string
  projectID?: string
  action: "preview" | "delete" | "relocate"
  target?: string
  token?: string
}

// This runs outside InstanceContextMiddleware: missing folders must never be
// recreated or rediscovered just to delete their app records.
const make = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const instances = yield* InstanceStore.Service
  const status = yield* SessionStatus.Service
  const execution = yield* SessionExecution.Service
  const project = yield* Project.Service
  const locks = new Set<string>()

  return (input: Input) =>
    Effect.gen(function* () {
      if (!path.isAbsolute(input.directory) || path.parse(input.directory).root === path.resolve(input.directory))
        return yield* new InvalidRequestError({ message: "Select a project folder, not a filesystem root." })
      const directory = yield* Effect.promise(() => ProjectControls.canonicalPath(path.resolve(input.directory)))
      if (locks.has(directory))
        return yield* new ConflictError({ message: "Project settings are being changed. Try again." })
      locks.add(directory)
      return yield* Effect.gen(function* () {
        const all = yield* db.select().from(SessionTable).all().pipe(Effect.orDie)
        // Non-Git projects can share the global ID. A project ID alone is never a deletion scope.
        const selected = new Set(
          all
            .filter((item) => item.directory === directory && (!input.projectID || item.project_id === input.projectID))
            .map((item) => item.id),
        )
        let previous = -1
        while (previous !== selected.size) {
          previous = selected.size
          for (const item of all) if (item.parent_id && selected.has(item.parent_id)) selected.add(item.id)
        }
        const sessions = all.filter((item) => selected.has(item.id))
        const token = createHash("sha256")
          .update(JSON.stringify(sessions.map((item) => [item.id, item.time_updated]).sort()))
          .digest("hex")
        const active = yield* execution.active
        const contexts = yield* instances.loaded([directory, ...sessions.map((item) => item.directory)])
        let busy = sessions.some((item) => active.has(item.id))
        for (const context of contexts) {
          const statuses = yield* status.list().pipe(Effect.provideService(InstanceRef, context))
          if ([...statuses].some(([id, value]) => selected.has(id) && value.type !== "idle")) busy = true
        }
        const result = { count: sessions.length, token, directory, busy, removedProjectID: "" }
        if (input.action === "preview") return result
        if (busy)
          return yield* new ConflictError({
            message: "Stop this project's running conversations before deleting or reconnecting it.",
          })
        if (input.token !== token)
          return yield* new ConflictError({
            message: "Project conversations changed. Review the project again before continuing.",
          })

        if (input.action === "relocate") {
          if (!input.target || !path.isAbsolute(input.target))
            return yield* new InvalidRequestError({ message: "Select the folder's new location." })
          const oldAvailable = yield* Effect.promise(() =>
            stat(directory).then(
              (value) => value.isDirectory(),
              () => false,
            ),
          )
          if (oldAvailable)
            return yield* new ConflictError({ message: "The original folder is available again. Refresh its status." })
          const next = yield* Effect.tryPromise({
            try: async () => {
              const target = await realpath(input.target!)
              if (!(await stat(target)).isDirectory()) throw new Error("Not a folder")
              return target
            },
            catch: () => new InvalidRequestError({ message: "The selected folder is unavailable." }),
          })
          if (next === directory || path.parse(next).root === next)
            return yield* new InvalidRequestError({ message: "Select a different project folder." })
          if (all.some((item) => item.directory === next))
            return yield* new ConflictError({ message: "The selected folder already has project conversations." })
          const known = yield* db
            .select()
            .from(ProjectDirectoryTable)
            .where(eq(ProjectDirectoryTable.directory, AbsolutePath.make(next)))
            .all()
            .pipe(Effect.orDie)
          if (known.length)
            return yield* new ConflictError({ message: "The selected folder is already connected to a project." })
          const copiedPolicy = yield* Effect.tryPromise({
            try: () => ProjectControls.relocateStored(directory, next),
            catch: () =>
              new ConflictError({
                message: "The selected folder already has settings or cannot store project settings.",
              }),
          })
          const copiedRecords = yield* Effect.tryPromise({
            try: () => ProjectRecords.relocate(directory, next),
            catch: () =>
              new ConflictError({ message: "Could not move saved project records. No source files were changed." }),
          }).pipe(
            Effect.tapError(() =>
              Effect.promise(async () => {
                if (copiedPolicy) await ProjectControls.removeStored(next)
              }),
            ),
          )
          yield* Effect.gen(function* () {
            const resolved = yield* project.fromDirectory(next)
            yield* db
              .transaction(
                (tx) =>
                  Effect.gen(function* () {
                    for (const session of sessions) {
                      const relocated =
                        session.directory === directory
                          ? next
                          : session.directory.startsWith(directory + path.sep)
                            ? next + session.directory.slice(directory.length)
                            : session.directory
                      yield* tx
                        .update(SessionTable)
                        .set({ directory: relocated, project_id: resolved.project.id })
                        .where(eq(SessionTable.id, session.id))
                        .run()
                    }
                    yield* tx
                      .delete(ProjectDirectoryTable)
                      .where(eq(ProjectDirectoryTable.directory, AbsolutePath.make(directory)))
                      .run()
                    if (resolved.project.id !== "global" && resolved.project.worktree === directory) {
                      yield* tx
                        .update(ProjectTable)
                        .set({
                          worktree: AbsolutePath.make(next),
                          sandboxes: resolved.project.sandboxes
                            .filter((item) => item !== next && item !== directory)
                            .map((item) => AbsolutePath.make(item)),
                        })
                        .where(eq(ProjectTable.id, resolved.project.id))
                        .run()
                    }
                  }),
                { behavior: "immediate" },
              )
              .pipe(Effect.orDie)
          }).pipe(
            Effect.onError(() =>
              Effect.promise(async () => {
                if (copiedPolicy) await ProjectControls.removeStored(next)
                if (copiedRecords) await ProjectRecords.removeAll(next)
              }),
            ),
          )
          yield* Effect.promise(async () => {
            await ProjectControls.removeStored(directory)
            await ProjectRecords.removeAll(directory)
          })
          for (const scope of new Set([directory, ...sessions.map((item) => item.directory)]))
            yield* instances.disposeDirectory(scope, true)
          return { ...result, directory: next }
        }

        // All filesystem removal is confined to hashed app storage paths.
        // Never unlink, rm, or modify the supplied project/source directory.
        const storage = yield* Effect.tryPromise({
          try: () => stageProjectStorage(directory),
          catch: () => new ConflictError({ message: "Could not remove saved project settings. Try again." }),
        })
        yield* db
          .transaction(
            (tx) =>
              Effect.gen(function* () {
                for (const session of sessions) {
                  yield* tx.delete(EventTable).where(eq(EventTable.aggregate_id, session.id)).run()
                  yield* tx.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, session.id)).run()
                }
                if (sessions.length)
                  yield* tx
                    .delete(SessionTable)
                    .where(inArray(SessionTable.id, [...selected]))
                    .run()
                yield* tx
                  .delete(ProjectDirectoryTable)
                  .where(eq(ProjectDirectoryTable.directory, AbsolutePath.make(directory)))
                  .run()
                if (input.projectID && input.projectID !== "global") {
                  const id = ProjectV2.ID.make(input.projectID)
                  const remaining = yield* tx.select().from(SessionTable).where(eq(SessionTable.project_id, id)).all()
                  const directories = yield* tx
                    .select()
                    .from(ProjectDirectoryTable)
                    .where(eq(ProjectDirectoryTable.project_id, id))
                    .all()
                  if (!remaining.length && !directories.length) {
                    const deleted = yield* tx
                      .delete(ProjectTable)
                      .where(and(eq(ProjectTable.id, id), eq(ProjectTable.worktree, AbsolutePath.make(directory))))
                      .returning()
                      .all()
                    if (deleted.length) {
                      yield* tx.delete(EventTable).where(eq(EventTable.aggregate_id, id)).run()
                      yield* tx.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, id)).run()
                      result.removedProjectID = id
                    }
                  }
                }
              }),
            { behavior: "immediate" },
          )
          .pipe(
            Effect.orDie,
            Effect.onError(() => Effect.promise(storage.restore)),
          )
        yield* Effect.promise(storage.commit)
        for (const scope of new Set([directory, ...sessions.map((item) => item.directory)]))
          yield* instances.disposeDirectory(scope, true)
        return result
      }).pipe(Effect.ensuring(Effect.sync(() => locks.delete(directory))))
    })
})

export class Service extends Context.Service<Service, { run: Effect.Success<typeof make> }>()(
  "@endurance/ProjectLifecycle",
) {}
export const node = LayerNode.make({
  service: Service,
  layer: Layer.effect(Service, make.pipe(Effect.map((run) => ({ run })))),
  deps: [Database.node, InstanceStore.node, SessionStatus.node, SessionExecution.node, Project.node],
})
export * as ProjectLifecycle from "./project-lifecycle"
