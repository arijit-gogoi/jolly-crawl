import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { crawl } from "../src/crawl.js"
import type { CrawlOptions } from "../src/types.js"

type Page = { status: number; body: string }
const pages: Map<string, Page> = new Map()

let origFetch: typeof globalThis.fetch
beforeEach(() => {
  origFetch = globalThis.fetch
  pages.clear()
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url
    const p = pages.get(url) ?? pages.get(url.replace(/\/$/, "")) ?? pages.get(url + "/")
    if (!p) return new Response("not found", { status: 404 })
    return new Response(p.body, { status: p.status })
  }) as typeof globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = origFetch
})

const tmpDirs: string[] = []
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "jc-crawl-"))
  tmpDirs.push(d)
  return d
}

function baseOpts(over: Partial<CrawlOptions> = {}): CrawlOptions {
  return {
    seed: "https://test.local/",
    maxDepth: 2,
    concurrency: 4,
    deadlineMs: Date.now() + 10_000,
    perPageTimeoutMs: 5_000,
    out: undefined,
    userAgent: "jolly-crawl-test",
    sameOrigin: true,
    ...over,
  }
}

describe("crawl (integration)", () => {
  it("crawls a 3-page graph with correct depths", async () => {
    pages.set("https://test.local/", { status: 200, body: '<title>S</title><a href="/a">a</a>' })
    pages.set("https://test.local/a", { status: 200, body: '<title>A</title><a href="/b">b</a>' })
    pages.set("https://test.local/b", { status: 200, body: "<title>B</title>" })
    const outDir = mkTmp()
    const outPath = join(outDir, "out.ndjson")

    const res = await crawl(baseOpts({ out: outPath, maxDepth: 2 }))
    expect(res.stats.succeeded).toBe(3)
    expect(res.stats.failed).toBe(0)

    const lines = readFileSync(outPath, "utf8").trim().split("\n").map(l => JSON.parse(l))
    const byUrl = new Map(lines.map(l => [l.url, l]))
    expect(byUrl.get("https://test.local/")!.depth).toBe(0)
    expect(byUrl.get("https://test.local/a")!.depth).toBe(1)
    expect(byUrl.get("https://test.local/b")!.depth).toBe(2)
    expect(byUrl.get("https://test.local/")!.title).toBe("S")
  })

  it("fetch error on one URL does not cancel siblings", async () => {
    pages.set("https://test.local/", { status: 200, body: '<a href="/ok">o</a><a href="/fail">f</a>' })
    pages.set("https://test.local/ok", { status: 200, body: "<title>OK</title>" })
    pages.set("https://test.local/fail", { status: 500, body: "boom" })
    const outDir = mkTmp()
    const outPath = join(outDir, "out.ndjson")

    const res = await crawl(baseOpts({ out: outPath, maxDepth: 1 }))
    expect(res.stats.attempted).toBe(3)
    expect(res.stats.succeeded).toBe(2)
    expect(res.stats.failed).toBe(1)

    const lines = readFileSync(outPath, "utf8").trim().split("\n").map(l => JSON.parse(l))
    const failRec = lines.find(l => l.url === "https://test.local/fail")!
    expect(failRec.error).toBeDefined()
    expect(failRec.status).toBeUndefined()
  })

  it("respects maxDepth=0 (only seed)", async () => {
    pages.set("https://test.local/", { status: 200, body: '<a href="/a">a</a><a href="/b">b</a>' })
    pages.set("https://test.local/a", { status: 200, body: "<title>A</title>" })
    const res = await crawl(baseOpts({ maxDepth: 0 }))
    expect(res.stats.succeeded).toBe(1)
    expect(res.stats.attempted).toBe(1)
  })

  it("output file is closed on scope exit (writable again from outside)", async () => {
    pages.set("https://test.local/", { status: 200, body: "<title>S</title>" })
    const outDir = mkTmp()
    const outPath = join(outDir, "out.ndjson")
    await crawl(baseOpts({ out: outPath, maxDepth: 0 }))
    // readFileSync would throw EBUSY on Windows if the handle were still open.
    const text = readFileSync(outPath, "utf8")
    expect(text.length).toBeGreaterThan(0)
  })

  it("external abort stops the crawl, partial results are persisted", async () => {
    // Build a wide graph so we have work in flight.
    let body = ""
    for (let i = 0; i < 50; i++) body += `<a href="/p${i}">${i}</a>`
    pages.set("https://test.local/", { status: 200, body })
    for (let i = 0; i < 50; i++) {
      pages.set(`https://test.local/p${i}`, { status: 200, body: `<title>P${i}</title>` })
    }

    const outDir = mkTmp()
    const outPath = join(outDir, "out.ndjson")
    const abort = new AbortController()
    setTimeout(() => abort.abort(new Error("external")), 30)

    const res = await crawl(baseOpts({
      out: outPath,
      maxDepth: 1,
      concurrency: 2,
      signal: abort.signal,
    }))
    expect(res.endedBy).toBe("abort")

    const text = readFileSync(outPath, "utf8")
    // Should have some (but plausibly not all) records.
    expect(text.length).toBeGreaterThan(0)
  })

  it("deadline elapses cleanly with endedBy=deadline", async () => {
    // Slow fetch that won't complete before the deadline
    globalThis.fetch = (async () => {
      await new Promise(r => setTimeout(r, 200))
      return new Response("<title>slow</title>", { status: 200 })
    }) as typeof globalThis.fetch

    const outDir = mkTmp()
    const outPath = join(outDir, "out.ndjson")
    const res = await crawl(baseOpts({
      out: outPath,
      maxDepth: 0,
      deadlineMs: Date.now() + 50,
      perPageTimeoutMs: 20,
    }))
    expect(res.endedBy).toBe("deadline")
  })
})
