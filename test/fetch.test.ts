import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { TimeoutError } from "jolly-coop"
import { fetchPage } from "../src/fetch.js"

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

let origFetch: typeof globalThis.fetch
beforeEach(() => { origFetch = globalThis.fetch })
afterEach(() => { globalThis.fetch = origFetch })

function setFetch(fn: FetchImpl) {
  globalThis.fetch = fn as unknown as typeof globalThis.fetch
}

function mkResponse(status: number, body = "ok") {
  return new Response(body, { status })
}

describe("fetchPage", () => {
  it("returns ok on 200", async () => {
    setFetch(async () => mkResponse(200, "<html>hi</html>"))
    const abort = new AbortController()
    const r = await fetchPage("https://x", {
      timeoutMs: 1000, userAgent: "t", signal: abort.signal, maxRetries: 0,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.status).toBe(200)
      expect(r.body).toContain("hi")
      expect(typeof r.duration_ms).toBe("number")
    }
  })

  it("404 returns error immediately with no retry", async () => {
    let calls = 0
    setFetch(async () => { calls++; return mkResponse(404) })
    const abort = new AbortController()
    const r = await fetchPage("https://x", {
      timeoutMs: 1000, userAgent: "t", signal: abort.signal,
    })
    expect(r.ok).toBe(false)
    expect(calls).toBe(1)
    if (!r.ok) expect(r.error.message).toMatch(/404/)
  })

  it("500 retries and gives up after max attempts", async () => {
    let calls = 0
    setFetch(async () => { calls++; return mkResponse(500) })
    const abort = new AbortController()
    const r = await fetchPage("https://x", {
      timeoutMs: 1000, userAgent: "t", signal: abort.signal, maxRetries: 2,
    })
    expect(r.ok).toBe(false)
    expect(calls).toBe(3)
  })

  it("429 retries", async () => {
    let calls = 0
    setFetch(async () => {
      calls++
      return calls < 3 ? mkResponse(429) : mkResponse(200, "ok")
    })
    const abort = new AbortController()
    const r = await fetchPage("https://x", {
      timeoutMs: 1000, userAgent: "t", signal: abort.signal, maxRetries: 2,
    })
    expect(r.ok).toBe(true)
    expect(calls).toBe(3)
  })

  it("network error retries then fails", async () => {
    let calls = 0
    setFetch(async () => { calls++; throw new TypeError("fetch failed") })
    const abort = new AbortController()
    const r = await fetchPage("https://x", {
      timeoutMs: 1000, userAgent: "t", signal: abort.signal, maxRetries: 2,
    })
    expect(r.ok).toBe(false)
    expect(calls).toBe(3)
  })

  it("timeout returns TimeoutError", async () => {
    setFetch((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (signal) {
          signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true })
        }
      })
    })
    const abort = new AbortController()
    const start = Date.now()
    const r = await fetchPage("https://x", {
      timeoutMs: 50, userAgent: "t", signal: abort.signal, maxRetries: 0,
    })
    const elapsed = Date.now() - start
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBeInstanceOf(TimeoutError)
    expect(elapsed).toBeLessThan(500)
  })

  it("abort mid-backoff returns immediately (not after full backoff)", async () => {
    let calls = 0
    setFetch(async () => { calls++; return mkResponse(500) })
    const abort = new AbortController()
    setTimeout(() => abort.abort(new Error("external")), 50)
    const start = Date.now()
    const r = await fetchPage("https://x", {
      timeoutMs: 1000, userAgent: "t", signal: abort.signal, maxRetries: 2,
    })
    const elapsed = Date.now() - start
    expect(r.ok).toBe(false)
    expect(elapsed).toBeLessThan(400)
  })
})
