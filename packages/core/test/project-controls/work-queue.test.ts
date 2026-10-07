import { expect, test } from "bun:test"
import { createWorkQueue } from "../../src/util/work-queue"

test("worker leases are FIFO and releasing twice cannot start overlapping work", async () => {
  const queue = createWorkQueue()
  const signal = new AbortController().signal
  const first = await queue.acquire(signal)
  const events: number[] = []
  const second = queue.acquire(signal).then((release) => {
    events.push(2)
    return release
  })
  const third = queue.acquire(signal).then((release) => {
    events.push(3)
    return release
  })
  await Promise.resolve()
  expect(events).toEqual([])
  first()
  const release = await second
  first()
  await Promise.resolve()
  expect(events).toEqual([2])
  release()
  ;(await third)()
  expect(events).toEqual([2, 3])
})

test("cancelling a queued job removes it without delaying the next job", async () => {
  const queue = createWorkQueue()
  const first = await queue.acquire(new AbortController().signal)
  const cancelled = new AbortController()
  const second = queue.acquire(cancelled.signal).catch((error: unknown) => error)
  const third = queue.acquire(new AbortController().signal)
  cancelled.abort(new Error("cancelled"))
  expect(await second).toEqual(new Error("cancelled"))
  first()
  ;(await third)()
  ;(await queue.acquire(new AbortController().signal))()
})
