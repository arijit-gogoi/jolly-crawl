import { scope, sleep, ScopeCancelledError } from "jolly-coop"
import { createOutputWriter, type Writer } from "./output.js"
import { fetchPage } from "./fetch.js"
import { parsePage } from "./parse.js"
import { CrawlQueue } from "./queue.js"
import { runProgress } from "./progress.js"
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

  const seedOrigin = new URL(opts.seed).origin
  const queue = new CrawlQueue({
    maxDepth: opts.maxDepth,
    sameOrigin: opts.sameOrigin,
    seedOrigin,
  })
  queue.enqueue(opts.seed, 0)
  stats.queued = queue.size

  try {
    await scope({ deadline: opts.deadlineMs, signal: opts.signal }, async s => {
      const writer: Writer = await s.resource(
        await createOutputWriter(opts.out),
        w => w.close(),
      )

      s.spawn(async () => {
        try {
          await runProgress(stats, s.signal)
        } catch {
          // Defensive — runProgress swallows aborts internally.
        }
      })

      const driver = s.spawn(async () => {
        await scope({ limit: opts.concurrency, signal: s.signal }, async pool => {
          while (!queue.isEmpty || pool.active > 0) {
            if (queue.isEmpty || pool.active >= opts.concurrency) {
              try {
                await sleep(10, pool.signal)
              } catch {
                return
              }
              continue
            }
            const entry = queue.dequeue()!
            stats.queued = queue.size

            pool.spawn(async () => {
              stats.attempted++
              stats.inFlight++
              try {
                const result = await fetchPage(entry.url, {
                  timeoutMs: opts.perPageTimeoutMs,
                  userAgent: opts.userAgent,
                  signal: pool.signal,
                })
                const ts = new Date().toISOString()

                if (result.ok) {
                  const parsed = parsePage(result.body, entry.url)
                  await writer.write({
                    url: entry.url,
                    depth: entry.depth,
                    status: result.status,
                    title: parsed.title,
                    links: parsed.links,
                    duration_ms: result.duration_ms,
                    ts,
                  })
                  stats.succeeded++
                  if (entry.depth < opts.maxDepth) {
                    for (const link of parsed.links) {
                      if (queue.enqueue(link, entry.depth + 1)) {
                        stats.queued = queue.size
                      }
                    }
                  }
                } else {
                  await writer.write({
                    url: entry.url,
                    depth: entry.depth,
                    error: result.error.name || "Error",
                    message: result.error.message,
                    ts,
                  })
                  stats.failed++
                }
              } finally {
                stats.inFlight--
              }
            })
          }
        })
      })

      await driver
      s.done()
    })
  } catch (err) {
    // jolly-coop 0.3.3+: `deadline:` throws DeadlineError, `timeout:` throws
    // TimeoutError, both subclass ScopeCancelledError. We use `deadline:` in
    // the root scope, but catch the whole family and discriminate via `.cause`
    // so future additions (e.g. a "drained-with-errors" cause) keep compiling.
    if (err instanceof ScopeCancelledError) {
      if (err.cause === "timeout" || err.cause === "deadline") {
        return { stats, endedBy: "deadline" }
      }
      // "done" is unreachable via catch (done() resolves the scope), but
      // enumerating it keeps the switch exhaustive for future readers.
    }
    if (opts.signal?.aborted) {
      return { stats, endedBy: "abort" }
    }
    throw err
  }

  return { stats, endedBy: "drained" }
}
