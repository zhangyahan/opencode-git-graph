import { describe, expect, it } from "vitest"
import { LatestRequest } from "../src/gui/requests.js"

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

describe("LatestRequest", () => {
  it("aborts the previous request and discards its late response", async () => {
    const requests = new LatestRequest()
    const first = deferred<string>()
    const second = deferred<string>()
    let firstSignal: AbortSignal | undefined

    const firstRun = requests.run((signal) => {
      firstSignal = signal
      return first.promise
    })
    const secondRun = requests.run(() => second.promise)

    expect(firstSignal?.aborted).toBe(true)

    second.resolve("second")
    await expect(secondRun).resolves.toEqual({
      accepted: true,
      aborted: false,
      value: "second",
    })

    first.resolve("first")
    await expect(firstRun).resolves.toEqual({ accepted: false, aborted: true })
  })

  it("keeps the newest failure and ignores a stale failure", async () => {
    const requests = new LatestRequest()
    const first = deferred<string>()
    const second = deferred<string>()

    const firstRun = requests.run(() => first.promise)
    const secondRun = requests.run(() => second.promise)

    second.reject(new Error("current failure"))
    const failure = await secondRun
    expect(failure.accepted).toBe(false)
    expect(failure.aborted).toBe(false)
    if (!failure.accepted && !failure.aborted) {
      expect((failure.error as Error).message).toBe("current failure")
    }

    first.reject(new Error("stale failure"))
    await expect(firstRun).resolves.toEqual({ accepted: false, aborted: true })
  })

  it("discards in-flight work on cancel and dispose", async () => {
    const pending = deferred<number>()
    const requests = new LatestRequest()
    const run = requests.run(() => pending.promise)

    requests.cancel()
    pending.resolve(1)
    await expect(run).resolves.toEqual({ accepted: false, aborted: true })
    expect(requests.active).toBe(false)

    const disposed = new LatestRequest()
    disposed.dispose()
    await expect(disposed.run(async () => 2)).resolves.toEqual({
      accepted: false,
      aborted: true,
    })
  })
})
