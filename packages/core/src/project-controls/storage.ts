import { createHash, randomUUID } from "node:crypto"
import { rename, rm } from "node:fs/promises"
import path from "node:path"
import { Global } from "../global"

// Stage only exact app-owned paths. A failed database operation can put them back.
export async function stageProjectStorage(directory: string) {
  const key = createHash("sha256").update(directory).digest("hex")
  const staged: { source: string; temporary: string }[] = []
  const restore = async () => {
    for (const entry of [...staged].reverse()) await rename(entry.temporary, entry.source)
  }
  try {
    for (const source of [
      path.join(Global.Path.config, "project-controls", key + ".json"),
      path.join(Global.Path.config, "project-records", key),
    ]) {
      const temporary = source + ".deleting-" + randomUUID()
      const moved = await rename(source, temporary).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false
          throw error
        },
      )
      if (moved) staged.push({ source, temporary })
    }
  } catch (error) {
    await restore()
    throw error
  }
  return {
    restore,
    commit: async () => {
      for (const entry of staged) await rm(entry.temporary, { recursive: true, force: true })
    },
  }
}
