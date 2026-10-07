import { createHash, randomUUID } from "node:crypto"
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { ProjectControls } from "../project-controls"
import { Global } from "../global"
import { EvaluationCase, EvaluationResult, RequestRecord } from "./schema"

async function directory(project: string, kind: "requests" | "cases" | "results") {
  return path.join(
    Global.Path.config,
    "project-records",
    createHash("sha256")
      .update((await ProjectControls.resolve(project)).directory)
      .digest("hex"),
    kind,
  )
}

export async function list(project: string, kind: "requests"): Promise<RequestRecord[]>
export async function list(project: string, kind: "cases"): Promise<EvaluationCase[]>
export async function list(project: string, kind: "results"): Promise<EvaluationResult[]>
export async function list(project: string, kind: "requests" | "cases" | "results") {
  const folder = await directory(project, kind)
  const names = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  const schema = kind === "requests" ? RequestRecord : kind === "cases" ? EvaluationCase : EvaluationResult
  const values = await Promise.all(
    names
      .filter((name) => /^[a-zA-Z0-9-]+\.json$/.test(name))
      .map(async (name) => {
        const text = await readFile(path.join(folder, name), "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined
          throw error
        })
        return text === undefined ? undefined : schema.parse(JSON.parse(text))
      }),
  )
  const records = values.filter((value) => value !== undefined).sort((a, b) => b.time - a.time)
  if (kind !== "requests") return records
  const expired = records.filter((item, index) => index >= 100 || item.time < Date.now() - 30 * 86400000)
  await Promise.all(expired.map((item) => remove(project, kind, item.id)))
  return records.filter((item) => !expired.includes(item))
}

export async function save(project: string, kind: "requests" | "cases" | "results", input: unknown) {
  const schema = kind === "requests" ? RequestRecord : kind === "cases" ? EvaluationCase : EvaluationResult
  const value = schema.parse(input)
  const folder = await directory(project, kind)
  await mkdir(folder, { recursive: true, mode: 0o700 })
  const temporary = path.join(folder, `${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 })
  await rename(temporary, path.join(folder, `${value.id}.json`))
  if (kind === "requests") {
    const records = await list(project, "requests")
    await Promise.all(
      records
        .filter((item, index) => index >= 100 || item.time < Date.now() - 30 * 86400000)
        .map((item) => remove(project, kind, item.id)),
    )
  }
  return value
}

export async function remove(project: string, kind: "requests" | "cases" | "results", id: string) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error("Invalid record ID")
  await rm(path.join(await directory(project, kind), `${id}.json`), { force: true })
}

export async function removeAll(project: string) {
  const base = await ProjectControls.canonicalPath(path.resolve(project))
  await rm(path.join(Global.Path.config, "project-records", createHash("sha256").update(base).digest("hex")), {
    recursive: true,
    force: true,
  })
}

export async function relocate(project: string, target: string) {
  const base = await ProjectControls.canonicalPath(path.resolve(project))
  const next = await ProjectControls.canonicalPath(path.resolve(target))
  const storage = path.join(Global.Path.config, "project-records")
  const source = path.join(storage, createHash("sha256").update(base).digest("hex"))
  const destination = path.join(storage, createHash("sha256").update(next).digest("hex"))
  const exists = await readdir(source).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
    return undefined
  })
  if (!exists) return false
  // mkdir without recursive fails if a target already owns records.
  await mkdir(destination, { mode: 0o700 })
  try {
    for (const kind of exists)
      await cp(path.join(source, kind), path.join(destination, kind), {
        recursive: true,
        errorOnExist: true,
        force: false,
      })
  } catch (error) {
    await rm(destination, { recursive: true })
    throw error
  }
  return true
}

export * as ProjectRecords from "./records"
