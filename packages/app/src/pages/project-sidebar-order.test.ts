import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { groupSidebarSessions, sortSidebarSessions } from "./project-sidebar-order"

const session = (id: string, title: string, created: number, updated = created) =>
  ({ id, title, time: { created, updated } }) as Session

describe("project sidebar ordering", () => {
  test("sorts displayed names naturally and keeps chronological sorts distinct without mutating the cache", () => {
    const sessions = [session("b", "Chat 10", 30, 40), session("a", "Chat 2", 10, 50), session("c", "Alpha", 20, 60)]
    expect(sortSidebarSessions(sessions, "name").map((session) => session.id)).toEqual(["c", "a", "b"])
    expect(sortSidebarSessions(sessions, "created").map((session) => session.id)).toEqual(["b", "c", "a"])
    expect(sortSidebarSessions(sessions, "activity").map((session) => session.id)).toEqual(["c", "a", "b"])
    expect(sessions.map((session) => session.id)).toEqual(["b", "a", "c"])
  })

  test("groups by local calendar boundaries and uses creation dates when requested", () => {
    const now = new Date(2026, 9, 8, 12)
    const today = new Date(2026, 9, 8).getTime()
    const yesterday = new Date(2026, 9, 7).getTime()
    const sessions = [
      session("today", "Today", today),
      session("moved", "Moved", yesterday - 1, today),
      session("yesterday", "Yesterday", yesterday),
    ]
    expect(
      groupSidebarSessions(sessions, "activity", now).map((group) => [
        group.id,
        group.sessions.map((session) => session.id),
      ]),
    ).toEqual([
      ["today", ["today", "moved"]],
      ["yesterday", ["yesterday"]],
    ])
    expect(
      groupSidebarSessions(sessions, "created", now).map((group) => [
        group.id,
        group.sessions.map((session) => session.id),
      ]),
    ).toEqual([
      ["today", ["today"]],
      ["yesterday", ["yesterday"]],
      ["older", ["moved"]],
    ])
    expect(groupSidebarSessions([], "activity", now)).toEqual([])
  })

  test("breaks timestamp ties deterministically", () => {
    expect(
      sortSidebarSessions([session("b", "Same", 10), session("a", "Same", 10)], "created").map((session) => session.id),
    ).toEqual(["a", "b"])
  })
})
