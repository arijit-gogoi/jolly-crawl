import { scope } from "jolly-coop"
import type { CrawlOptions, CrawlResult, Stats } from "./types.js"

export async function crawl(opts: CrawlOptions): Promise<CrawlResult> {
  const stats: Stats = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    inFlight: 0,
    queued: 0,
    startedAt: Date.now(),
  }

  await scope({ deadline: opts.deadlineMs, signal: opts.signal }, async s => {
    // M2 will register the output writer resource here.
    // M5 will spawn the queue driver + fetch pool here.
    // M6 will spawn the progress printer here.
    // For now the scope resolves immediately — M1 only proves the wiring.
    s.done()
  })

  return { stats }
}
