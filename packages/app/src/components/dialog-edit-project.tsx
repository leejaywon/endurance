import { DialogEditProjectV2 } from "./dialog-edit-project-v2"
import type { LocalProject } from "@/context/layout"
import type { ServerConnection } from "@/context/server"

export function DialogEditProject(props: { project: LocalProject; server: ServerConnection.Any }) {
  return <DialogEditProjectV2 {...props} />
}
