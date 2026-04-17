import { describe, it, expect } from "vitest"
import { CrawlQueue } from "../src/queue.js"

const SEED = "https://host.example"

describe("CrawlQueue", () => {
  it("enqueue seed then dequeue", () => {
    const q = new CrawlQueue({ maxDepth: 2, sameOrigin: true, seedOrigin: SEED })
    expect(q.enqueue(SEED + "/", 0)).toBe(true)
    const e = q.dequeue()
    expect(e?.url).toBe(SEED + "/")
    expect(e?.depth).toBe(0)
  })

  it("empty initially and after drain", () => {
    const q = new CrawlQueue({ maxDepth: 2, sameOrigin: true, seedOrigin: SEED })
    expect(q.isEmpty).toBe(true)
    expect(q.size).toBe(0)
    q.enqueue(SEED + "/a", 0)
    expect(q.isEmpty).toBe(false)
    q.dequeue()
    expect(q.isEmpty).toBe(true)
  })

  it("deduplicates repeated urls", () => {
    const q = new CrawlQueue({ maxDepth: 2, sameOrigin: true, seedOrigin: SEED })
    expect(q.enqueue(SEED + "/a", 0)).toBe(true)
    expect(q.enqueue(SEED + "/a", 0)).toBe(false)
    expect(q.size).toBe(1)
    expect(q.visitedCount).toBe(1)
  })

  it("rejects entries above maxDepth", () => {
    const q = new CrawlQueue({ maxDepth: 1, sameOrigin: true, seedOrigin: SEED })
    expect(q.enqueue(SEED + "/a", 0)).toBe(true)
    expect(q.enqueue(SEED + "/b", 1)).toBe(true)
    expect(q.enqueue(SEED + "/c", 2)).toBe(false)
  })

  it("filters foreign origin when sameOrigin=true", () => {
    const q = new CrawlQueue({ maxDepth: 5, sameOrigin: true, seedOrigin: SEED })
    expect(q.enqueue(SEED + "/a", 0)).toBe(true)
    expect(q.enqueue("https://other.example/a", 0)).toBe(false)
  })

  it("allows any http(s) origin when sameOrigin=false", () => {
    const q = new CrawlQueue({ maxDepth: 5, sameOrigin: false, seedOrigin: SEED })
    expect(q.enqueue("https://other.example/a", 0)).toBe(true)
    expect(q.enqueue("http://yet.another/b", 0)).toBe(true)
  })

  it("rejects non-http(s)", () => {
    const q = new CrawlQueue({ maxDepth: 5, sameOrigin: false, seedOrigin: SEED })
    expect(q.enqueue("mailto:a@b", 0)).toBe(false)
    expect(q.enqueue("ftp://x", 0)).toBe(false)
  })

  it("rejects invalid URLs", () => {
    const q = new CrawlQueue({ maxDepth: 5, sameOrigin: false, seedOrigin: SEED })
    expect(q.enqueue("not a url", 0)).toBe(false)
  })

  it("FIFO order preserved", () => {
    const q = new CrawlQueue({ maxDepth: 5, sameOrigin: true, seedOrigin: SEED })
    q.enqueue(SEED + "/a", 0)
    q.enqueue(SEED + "/b", 0)
    q.enqueue(SEED + "/c", 0)
    expect(q.dequeue()?.url).toBe(SEED + "/a")
    expect(q.dequeue()?.url).toBe(SEED + "/b")
    expect(q.dequeue()?.url).toBe(SEED + "/c")
  })
})
