/** A cancellable FIFO for a single managed local worker. */
export function createWorkQueue(limit: () => number = () => 1) {
  const waiting: Array<{ start: () => void }> = []
  let active = 0
  function drain() {
    if (active >= limit()) return
    waiting.shift()?.start()
  }
  return {
    acquire(signal: AbortSignal): Promise<() => void> {
      return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason)
        const entry = {
          start() {
            active++
            signal.removeEventListener("abort", abort)
            let released = false
            resolve(() => {
              if (released) return
              released = true
              active--
              drain()
            })
          },
        }
        function abort() {
          const index = waiting.indexOf(entry)
          if (index !== -1) waiting.splice(index, 1)
          signal.removeEventListener("abort", abort)
          reject(signal.reason)
        }
        signal.addEventListener("abort", abort, { once: true })
        waiting.push(entry)
        drain()
      })
    },
  }
}
