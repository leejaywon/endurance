import { access, mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import os from "node:os"
import { Global } from "../global"
import { ProjectControls } from "../project-controls"

export async function command(input: {
  directory: string
  command: string
  args: readonly string[]
  env?: NodeJS.ProcessEnv
  shell?: boolean | string
}) {
  const policy = await ProjectControls.resolve(input.directory)
  const controls = policy.value
  if (!ProjectControls.fileRestrictions(controls))
    return { command: input.command, args: [...input.args], env: input.env, shell: input.shell }
  if (process.platform !== "darwin") throw new Error("Project isolation requires the macOS sandbox on this host")
  await access("/usr/bin/sandbox-exec")
  const directory = policy.directory
  const scratch = path.join(
    os.tmpdir(),
    `endurance-${createHash("sha256").update(directory).digest("hex").slice(0, 20)}`,
  )
  await mkdir(scratch, { recursive: true, mode: 0o700 })
  const quote = (value: string) => JSON.stringify(value)
  const profile = [
    "(version 1)",
    "(deny default)",
    "(allow process-exec)",
    "(allow process-fork)",
    ...(!controls.isolate && controls.deviceOnly.length === 0 ? ["(allow network*)"] : []),
    "(allow sysctl-read)",
    // dyld probes the root directory while starting system executables.
    // A literal rule does not grant access to files beneath it.
    '(allow file-read* (literal "/"))',
    `(allow file-read* (subpath ${quote(directory)}) (subpath ${quote(await realpath(scratch))}) (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/Library/Apple") (subpath "/opt/homebrew") (literal "/dev/null") (literal "/dev/tty") (literal "/dev/urandom"))`,
    `(allow file-read* (literal ${quote(path.join(Global.Path.bin, "rg"))}))`,
    ...controls.sourceFolders.map((folder) => `(allow file-read* (subpath ${quote(folder)}))`),
    ...controls.sourceFolders
      .filter((folder) => ProjectControls.sourceAccess(controls, folder) === "write")
      .map((folder) => `(allow file-write* (subpath ${quote(folder)}))`),
    `(allow file-write* (subpath ${quote(directory)}) (subpath ${quote(await realpath(scratch))}) (literal "/dev/null") (literal "/dev/tty"))`,
    ...(await Promise.all(
      ProjectControls.readOnlyPaths(controls).map(
        async (entry) =>
          `(deny file-write* (subpath ${quote(await ProjectControls.canonicalPath(path.resolve(directory, entry)))}))`,
      ),
    )),
    ...(await Promise.all(
      ProjectControls.excludedPaths(controls).map(async (entry) => {
        if (/[?*\[\]]/.test(entry)) throw new Error("Isolated file exclusions must name a file or directory")
        return `(deny file-read* file-write* (subpath ${quote(
          await ProjectControls.canonicalPath(path.resolve(directory, entry)),
        )}))`
      }),
    )),
  ].join("\n")
  const env = Object.fromEntries(
    Object.entries(input.env ?? process.env).filter(([key]) => /^(PATH|LANG|LC_[A-Z_]+|TERM|COLORTERM)$/.test(key)),
  )
  const shell = typeof input.shell === "string" ? input.shell : "/bin/sh"
  return {
    command: "/usr/bin/sandbox-exec",
    args: [
      "-p",
      profile,
      ...(input.shell ? [shell, "-c", [input.command, ...input.args].join(" ")] : [input.command, ...input.args]),
    ],
    env: { ...env, HOME: directory, TMPDIR: scratch },
    shell: false as const,
  }
}

export * as ProjectIsolation from "./isolation"
