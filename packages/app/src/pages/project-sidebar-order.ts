import type { Session } from "@opencode-ai/sdk/v2/client"
import { compareSessionTime } from "@/pages/layout/helpers"
import { sessionTitle } from "@/utils/session-title"

export type ProjectSidebarGroup = "date" | "folder"
export type ProjectSidebarSort = "name" | "created" | "activity"

export function sortSidebarSessions(sessions: Session[], sort: ProjectSidebarSort) {
  return sessions.toSorted((a, b) => {
    if (sort === "name")
      return (
        (sessionTitle(a.title) ?? "").localeCompare(sessionTitle(b.title) ?? "", undefined, { numeric: true }) ||
        compareSessionTime(a, b)
      )
    if (sort === "created") return b.time.created - a.time.created || compareSessionTime(a, b)
    return compareSessionTime(a, b)
  })
}

export function groupSidebarSessions(sessions: Session[], sort: ProjectSidebarSort, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime()
  return (["today", "yesterday", "older"] as const)
    .map((id) => ({
      id,
      sessions: sessions.filter((session) => {
        const time = sort === "created" ? session.time.created : (session.time.updated ?? session.time.created)
        if (id === "today") return time >= today
        if (id === "yesterday") return time >= yesterday && time < today
        return time < yesterday
      }),
    }))
    .filter((group) => group.sessions.length > 0)
}
