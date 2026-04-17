import { sleep } from "jolly-coop"
import type { Stats } from "./types.js"

const INTERVAL_MS = 100

export async function runProgress(
  stats: Stats,
  signal: AbortSignal,
  writeLine: (s: string) => void = s => process.stderr.write(s),
): Promise<void> {
  while (!signal.aborted) {
    writeLine(renderLine(stats))
    try {
      await sleep(INTERVAL_MS, signal)
    } catch {
      break
    }
  }
  writeLine("\n")
}

export function renderLine(stats: Stats): string {
  const elapsed = ((Date.now() - stats.startedAt) / 1000).toFixed(1)
  const line =
    `[${elapsed}s] ${stats.succeeded}/${stats.attempted} ok, ` +
    `${stats.failed} err, ${stats.inFlight} in-flight, ${stats.queued} queued`
  return "\r" + line.padEnd(80)
}

export function renderFinal(stats: Stats): string {
  const elapsed = ((Date.now() - stats.startedAt) / 1000).toFixed(1)
  return (
    `crawled ${stats.attempted} urls in ${elapsed}s: ` +
    `${stats.succeeded} ok, ${stats.failed} err`
  )
}
