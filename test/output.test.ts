import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOutputWriter } from "../src/output.js"
import type { CrawlSuccessRecord } from "../src/types.js"

const tmpDirs: string[] = []
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "jc-out-"))
  tmpDirs.push(d)
  return d
}

function rec(url: string): CrawlSuccessRecord {
  return {
    url,
    depth: 0,
    status: 200,
    title: "x",
    links: [],
    duration_ms: 1,
    ts: new Date().toISOString(),
  }
}

describe("createOutputWriter", () => {
  it("writes NDJSON to file and closes handle", async () => {
    const path = join(mkTmp(), "out.ndjson")
    const w = await createOutputWriter(path)
    await w.write(rec("https://a"))
    await w.write(rec("https://b"))
    expect(w.stats().linesWritten).toBe(2)
    await w.close()
    const text = readFileSync(path, "utf8")
    const lines = text.trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).url).toBe("https://a")
    expect(JSON.parse(lines[1]!).url).toBe("https://b")
  })

  it("rejects writes after close", async () => {
    const path = join(mkTmp(), "out.ndjson")
    const w = await createOutputWriter(path)
    await w.close()
    await expect(w.write(rec("https://a"))).rejects.toThrow(/closed/)
  })

  it("double close is a no-op", async () => {
    const path = join(mkTmp(), "out.ndjson")
    const w = await createOutputWriter(path)
    await w.close()
    await w.close()
  })

  it("stdout writer: close is a no-op and stats tracks lines", async () => {
    const w = await createOutputWriter(undefined)
    const origWrite = process.stdout.write.bind(process.stdout)
    const captured: string[] = []
    ;(process.stdout as any).write = (chunk: any, cb?: any) => {
      captured.push(String(chunk))
      if (typeof cb === "function") cb()
      return true
    }
    try {
      await w.write(rec("https://a"))
      await w.close()
      await w.write(rec("https://b"))
    } finally {
      ;(process.stdout as any).write = origWrite
    }
    expect(w.stats().linesWritten).toBe(2)
    expect(captured.join("")).toContain("https://a")
    expect(captured.join("")).toContain("https://b")
  })

  it("appends to existing file", async () => {
    const path = join(mkTmp(), "out.ndjson")
    const w1 = await createOutputWriter(path)
    await w1.write(rec("https://a"))
    await w1.close()
    const w2 = await createOutputWriter(path)
    await w2.write(rec("https://b"))
    await w2.close()
    const text = readFileSync(path, "utf8")
    expect(text.trim().split("\n")).toHaveLength(2)
  })
})
