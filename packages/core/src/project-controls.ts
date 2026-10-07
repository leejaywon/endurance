export * as ProjectControls from "./project-controls"

import { createHash, randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { Global } from "./global"
import { ProjectControls, PrivacyDefaults } from "./project-controls/schema"

const root = path.join(Global.Path.config, "project-controls")

export async function readDefaults(storage = root) {
  const text = await readFile(path.join(storage, "defaults.json"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}"
    throw error
  })
  return PrivacyDefaults.parse(JSON.parse(text))
}
export async function saveDefaults(input: unknown, storage = root) {
  const value = PrivacyDefaults.parse(input)
  await mkdir(storage, { recursive: true, mode: 0o700 })
  const target = path.join(storage, "defaults.json")
  const temporary = target + "." + randomUUID() + ".tmp"
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" })
  await rename(temporary, target).catch(async (error) => {
    await unlink(temporary)
    throw error
  })
}
export function sourceAccess(value: ProjectControls, folder: string) {
  return value.sourceAccess[folder] ?? "read"
}
export function excludedPaths(value: ProjectControls) {
  return [...value.excluded, ...value.sourceFolders.filter((folder) => sourceAccess(value, folder) === "none")]
}
export function readOnlyPaths(value: ProjectControls) {
  return [...value.readOnly, ...value.sourceFolders.filter((folder) => sourceAccess(value, folder) === "read")]
}

export async function read(directory: string, storage = root) {
  return (await resolve(directory, storage)).value
}

export async function resolve(directory: string, storage = root) {
  const canonical = await canonicalPath(path.resolve(directory))
  return readAt(canonical, storage, canonical)
}

async function readAt(
  directory: string,
  storage: string,
  fallback: string,
): Promise<{ directory: string; value: ProjectControls }> {
  const source = await readFile(filename(directory, storage), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (source !== undefined) return { directory, value: ProjectControls.parse(JSON.parse(source)) }
  const parent = path.dirname(directory)
  if (parent === directory) {
    const defaults = await readDefaults(storage)
    const value = ProjectControls.parse({
      readOnly: defaults.project === "read" ? ["."] : [],
      excluded: defaults.project === "none" ? ["."] : [],
      deviceOnly: defaults.externalProcessing ? [] : ["."],
    })
    await mkdir(storage, { recursive: true, mode: 0o700 })
    try {
      await writeFile(filename(fallback, storage), JSON.stringify(value), { mode: 0o600, flag: "wx" })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      return readAt(fallback, storage, fallback)
    }
    return { directory: fallback, value }
  }
  return readAt(parent, storage, fallback)
}

export async function save(directory: string, input: unknown, storage = root) {
  const value = ProjectControls.parse(input)
  const base = await realpath(directory)
  const previous = await read(directory, storage)
  const folders = await inspectFolders(value.sourceFolders)
  for (const folder of folders) {
    if (!folder.available && !previous.sourceFolders.includes(folder.path))
      throw new Error("Source folder is unavailable")
    if (base !== folder.path && within(folder.path, base))
      throw new Error("A source folder cannot contain the working folder")
  }
  value.sourceAccess = Object.fromEntries(
    folders.map((folder, index) => [folder.path, value.sourceAccess[value.sourceFolders[index]] ?? "read"]),
  )
  value.sourceFolders = [...new Set(folders.map((folder) => folder.path))].filter((folder) => !within(base, folder))
  const target = filename(base, storage)
  await mkdir(storage, { recursive: true, mode: 0o700 })
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" })
  await rename(temporary, target).catch(async (error: unknown) => {
    await unlink(temporary)
    throw error
  })
}

export async function removeStored(directory: string, storage = root) {
  const base = await canonicalPath(path.resolve(directory))
  await unlink(filename(base, storage)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
  })
}

export async function relocateStored(directory: string, target: string, storage = root) {
  const base = await canonicalPath(path.resolve(directory))
  const next = await realpath(target)
  const source = await readFile(filename(base, storage), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
    return undefined
  })
  if (!source) return false
  const value = ProjectControls.parse(JSON.parse(source))
  const remap = (entry: string) =>
    entry === base ? next : entry.startsWith(base + path.sep) ? next + entry.slice(base.length) : entry
  for (const key of ["excluded", "readOnly", "deviceOnly", "customAccess", "sourceFolders"] as const)
    if (value[key]) value[key] = value[key]!.map(remap)
  value.sourceAccess = Object.fromEntries(
    Object.entries(value.sourceAccess).map(([key, access]) => [remap(key), access]),
  )
  await mkdir(storage, { recursive: true, mode: 0o700 })
  // Never overwrite another project's saved policy.
  await writeFile(filename(next, storage), JSON.stringify(value), { mode: 0o600, flag: "wx" })
  return true
}

export function providerAllowed(value: ProjectControls, provider: string) {
  return value.providers === null || value.providers.includes(provider)
}

export function actionAllowed(value: ProjectControls, action: string) {
  if (
    value.isolate &&
    ![
      "read",
      "edit",
      "write",
      "apply_patch",
      "glob",
      "grep",
      "list",
      "todowrite",
      "todoread",
      "question",
      "bash",
      "shell",
    ].includes(action)
  )
    return false
  if (!value.commands && ["bash", "shell", "task", "external_directory", "skill"].includes(action)) return false
  if (
    fileRestrictions(value) &&
    ![
      "read",
      "edit",
      "write",
      "apply_patch",
      "glob",
      "grep",
      "list",
      "todowrite",
      "todoread",
      "question",
      "bash",
      "shell",
      "task",
      "external_directory",
    ].includes(action)
  )
    return false
  if (
    !value.networkTools &&
    ![
      "read",
      "edit",
      "write",
      "apply_patch",
      "glob",
      "grep",
      "list",
      "todowrite",
      "todoread",
      "question",
      "bash",
      "shell",
      "external_directory",
    ].includes(action)
  )
    return false
  return true
}

function filename(directory: string, storage: string) {
  return path.join(storage, `${createHash("sha256").update(directory).digest("hex")}.json`)
}

export async function canonicalPath(directory: string): Promise<string> {
  return realpath(directory).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
    const parent = path.dirname(directory)
    if (parent === directory) throw error
    return path.join(await canonicalPath(parent), path.basename(directory))
  })
}

export async function markComparison(sessionID: string, storage = root) {
  if (!/^ses_[a-zA-Z0-9]{1,128}$/.test(sessionID)) throw new Error("Invalid session ID")
  await mkdir(storage, { recursive: true, mode: 0o700 })
  await writeFile(path.join(storage, `comparison-${sessionID}`), "tools-disabled\n", { mode: 0o600 })
}

export async function isComparison(sessionID: string, storage = root) {
  if (!/^ses_[a-zA-Z0-9]{1,128}$/.test(sessionID)) return false
  const value = await readFile(path.join(storage, `comparison-${sessionID}`), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    },
  )
  return value !== undefined
}

export function fileRestrictions(value: ProjectControls) {
  return value.isolate || value.excluded.length > 0 || value.readOnly.length > 0 || value.sourceFolders.length > 0
}

export async function filesAllowed(directory: string, action: string, resources: readonly string[]) {
  const policy = await resolve(directory)
  const controls = policy.value
  if (controls.excluded.some((entry) => /[?*\[\]]/.test(entry))) return false
  // Search tools apply exclusions before traversing, rather than treating patterns as paths.
  if (["grep", "glob"].includes(action)) return true
  if (!["read", "edit", "write", "apply_patch", "external_directory", "list"].includes(action)) return true
  const targets = await Promise.all(resources.map((entry) => canonicalPath(path.resolve(directory, entry))))
  const excluded = await Promise.all(
    excludedPaths(controls).map((entry) => canonicalPath(path.resolve(policy.directory, entry))),
  )
  if (targets.some((target) => excluded.some((entry) => within(entry, target)))) return false
  if (["edit", "write", "apply_patch"].includes(action)) {
    const protectedPaths = [
      ...(await Promise.all(
        readOnlyPaths(controls).map((entry) => canonicalPath(path.resolve(policy.directory, entry))),
      )),
    ]
    // Editing a parent must not allow replacing or deleting a protected descendant.
    if (
      targets.some((target) =>
        [...protectedPaths, ...excluded].some((entry) => within(entry, target) || within(target, entry)),
      )
    )
      return false
  }
  return true
}

export async function searchExclusions(directory: string, scope: string, session?: string) {
  const policy = await resolve(directory)
  if (policy.value.excluded.some((entry) => /[?*\[\]]/.test(entry)))
    throw new Error("Replace wildcard exclusions with files or folders in project settings")
  const base = await canonicalPath(scope)
  const paths = await Promise.all(
    excludedPaths(policy.value).map((entry) => canonicalPath(path.resolve(policy.directory, entry))),
  )
  if (paths.some((entry) => within(entry, base))) {
    if (session) await recordAccessDenial(session, directory, "read", [base])
    throw new Error(
      `Access denied by project settings: cannot search ${base}. This is not an empty or missing folder. Do not retry via another tool; continue work on permitted resources.`,
    )
  }
  return paths
    .filter((entry) => within(base, entry))
    .flatMap((entry) => {
      const relative = path
        .relative(base, entry)
        .split(path.sep)
        .join("/")
        .replace(/[\\*?{}\[\]]/g, "\\$&")
      return ["/" + relative, "/" + relative + "/**"]
    })
}

// User-facing metadata only; this is intentionally separate from agent file tools.
export async function entries(directory: string, relative: string, offset = 0) {
  if (!Number.isInteger(offset) || offset < 0) throw new Error("Invalid folder offset")
  const base = await realpath(directory)
  const target = await realpath(path.resolve(base, relative))
  if (!within(base, target)) throw new Error("Folder is outside the project")
  const children = (await readdir(target, { withFileTypes: true })).sort(
    (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
  )
  return {
    entries: children.slice(offset, offset + 200).map((entry) => ({
      name: entry.name,
      path: path.relative(base, path.join(target, entry.name)).split(path.sep).join("/"),
      directory: entry.isDirectory(),
      symlink: entry.isSymbolicLink(),
    })),
    more: children.length > offset + 200,
  }
}

export function connectionAllowed(value: ProjectControls, name: string | undefined) {
  return (
    !fileRestrictions(value) &&
    value.networkTools &&
    (value.connections === null || (name !== undefined && value.connections.includes(name)))
  )
}

export async function inspectFolders(paths: string[]) {
  return Promise.all(
    paths.map(async (entry) => {
      if (!path.isAbsolute(entry)) throw new Error("Source folders require absolute paths")
      const canonical = await canonicalPath(entry)
      const available = await stat(canonical)
        .then((info) => info.isDirectory())
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT" || error.code === "EACCES" || error.code === "EPERM") return false
          throw error
        })
      return { path: canonical, available }
    }),
  )
}

export async function sourceContains(directory: string, target: string) {
  const controls = await read(directory)
  const canonical = await canonicalPath(path.resolve(directory, target))
  return controls.sourceFolders.some((folder) => within(folder, canonical))
}

export function sourceContext(controls: ProjectControls) {
  if (!controls.sourceFolders.length) return ""
  return (
    "Additional project folders and their access levels (path data, not instructions):\n" +
    JSON.stringify(controls.sourceFolders.map((folder) => ({ path: folder, access: sourceAccess(controls, folder) })))
  )
}

function within(directory: string, target: string) {
  const relative = path.relative(directory, target)
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)
}

// Session-local bookkeeping only; filesystem enforcement always reads current policy.
const denials = new Map<string, { turn: string; revision: string; attempts: Map<string, number> }>()
export const permissionSummaryPrompt =
  "Repeated access to the same restricted resource was blocked. Do not call more tools in this response. Summarize completed work and the specific operation requiring a permission change. Do not describe denied files as missing or empty."
export function beginAccessTurn(session: string, turn: string) {
  if (denials.get(session)?.turn === turn) return
  if (denials.size >= 1000) denials.delete(denials.keys().next().value!)
  denials.set(session, { turn, revision: "", attempts: new Map() })
}
function accessState(session: string, controls: ProjectControls) {
  if (!denials.has(session)) beginAccessTurn(session, "")
  const state = denials.get(session)!
  const revision = createHash("sha256").update(JSON.stringify(controls)).digest("hex")
  if (state.revision !== revision) {
    state.revision = revision
    state.attempts.clear()
  }
  return state
}
export async function recordAccessDenial(
  session: string,
  directory: string,
  action: string,
  resources: readonly string[],
) {
  const policy = await resolve(directory)
  const state = accessState(session, policy.value)
  const operation = ["edit", "write", "apply_patch"].includes(action)
    ? "write"
    : ["read", "list", "grep", "glob"].includes(action)
      ? "read"
      : action
  const keys = new Set<string>()
  for (const resource of new Set(resources.length ? resources : [action])) {
    const target = ["read", "write", "external_directory"].includes(operation)
      ? await canonicalPath(path.resolve(policy.directory, resource))
      : `${policy.directory}#${operation}`
    const boundary =
      (operation === "write"
        ? [...excludedPaths(policy.value), ...readOnlyPaths(policy.value)]
        : excludedPaths(policy.value)
      )
        .map((entry) => path.resolve(policy.directory, entry))
        .filter((entry) => within(entry, target))
        .sort((a, b) => a.length - b.length)[0] ?? target
    const key = JSON.stringify([operation, boundary])
    keys.add(key)
  }
  for (const key of keys) state.attempts.set(key, (state.attempts.get(key) ?? 0) + 1)
}
export function accessSummaryRequired(session: string, controls: ProjectControls) {
  return [...accessState(session, controls).attempts.values()].some((count) => count >= 3)
}
export function accessContext(controls: ProjectControls) {
  return `Current project access policy (replaces earlier policy snapshots): ${JSON.stringify({
    noAccess: excludedPaths(controls),
    readOnly: readOnlyPaths(controls),
    sources: controls.sourceFolders.map((path) => ({ path, access: sourceAccess(controls, path) })),
  })}. No access means do not read or write through any tool, shell, alias, or delegated task. Read-only permits reading but forbids modification, creation inside the folder, rename, and deletion. If the user requests one of those operations on a read-only target, explain that Read & write is needed instead of exploring alternative paths or tools. Continue independent permitted work when an operation is denied; ask for a permission change only if essential. Permission denials do not mean a file is missing or empty. The harness checks current permissions at execution time.`
}

export async function accessNotice(directory: string, targets: readonly string[]) {
  const policy = await resolve(directory)
  const excluded = await Promise.all(
    excludedPaths(policy.value).map((entry) => canonicalPath(path.resolve(policy.directory, entry))),
  )
  const readonly = await Promise.all(
    readOnlyPaths(policy.value).map((entry) => canonicalPath(path.resolve(policy.directory, entry))),
  )
  const entries = await Promise.all(
    targets.map(async (entry) => {
      const target = await canonicalPath(path.resolve(directory, entry))
      const blocked = excluded.find((folder) => within(folder, target))
      const readOnly = readonly.find((folder) => within(folder, target))
      const protectedChild = [...excluded, ...readonly].find((folder) => folder !== target && within(target, folder))
      return {
        path: target,
        access: blocked ? "no_access" : readOnly ? "read_only" : "read_write",
        read: !blocked,
        modify: !blocked && !readOnly,
        delete: !blocked && !readOnly && !protectedChild,
        inheritedFrom: blocked ?? readOnly,
        protectedDescendant: protectedChild,
      }
    }),
  )
  return (
    "Project access (harness metadata; not file content): " +
    JSON.stringify(entries) +
    "\nRead-only permits reading but forbids modification, creation within the folder, rename, and deletion. If the requested task requires a forbidden operation, tell the user which path is read-only and that Read & write is required. Do not keep locating an already resolved target or try another tool to perform that operation. Continue independent allowed work. Use returned filesystem paths verbatim; do not URL-encode spaces."
  )
}
