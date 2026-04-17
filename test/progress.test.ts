import { describe, it, expect } from "vitest"
import { scope } from "jolly-coop"
import { renderLine, renderFinal, runProgress } from "../src/progress.js"
import type { Stats } from "../src/types.js"

function mkStats(over: Partial<Stats> = {}): Stats {
  return {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    inFlight: 0,
    queued: 0,
    startedAt: Date.now(),
    ...over,
  }
}

describe("progress", () => {
  it("renderLine includes the key counters", () => {
    const s = mkStats({ attempted: 10, succeeded: 7, failed: 1, inFlight: 2, queued: 5 })
    const line = renderLine(s)
    expect(line).toMatch(/7\/10 ok/)
    expect(line).toMatch(/1 err/)
    expect(line).toMatch(/2 in-flight/)
    expect(line).toMatch(/5 queued/)
    expect(line.startsWith("\r")).toBe(true)
  })

  it("renderFinal summarizes totals", () => {
    const s = mkStats({ attempted: 10, succeeded: 8, failed: 2 })
    expect(renderFinal(s)).toMatch(/crawled 10 urls/)
    expect(renderFinal(s)).toMatch(/8 ok, 2 err/)
  })

  it("runProgress exits when signal aborts (via s.done())", async () => {
    const lines: string[] = []
    const s = mkStats()

    await scope({}, async rs => {
      rs.spawn(async () => {
        await runProgress(s, rs.signal, line => lines.push(line))
      })
      // Let it tick a couple of times, then graceful shutdown.
      await new Promise<void>(r => setTimeout(r, 250))
      rs.done()
    })

    // Should have written at least one status line + the final newline.
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines[lines.length - 1]).toBe("\n")
  })
})
