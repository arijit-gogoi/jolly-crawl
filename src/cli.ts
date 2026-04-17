#!/usr/bin/env node
import { parseArgs } from "node:util"
import { crawl } from "./crawl.js"
import { parseDuration } from "./time.js"
import { renderFinal } from "./progress.js"
import type { CrawlOptions, CrawlResult } from "./types.js"
import { VERSION } from "./index.js"

const USAGE = `jolly-crawl ${VERSION} — structured-concurrency web crawler

Usage:
  jolly-crawl <url> [options]

Options:
  --depth <n>              Max link-following depth (default: 2)
  --concurrency <n>        Max in-flight requests (default: 10)
  --deadline <dur>         Wall-clock deadline, e.g. 2m, 30s (default: 2m)
  --per-page-timeout <dur> Per-page timeout, e.g. 10s (default: 10s)
  --out <path>             Write NDJSON to file (default: stdout)
  --user-agent <str>       User-Agent header (default: jolly-crawl/${VERSION})
  --same-origin            Only follow same-origin links (default: on)
  --no-same-origin         Allow cross-origin links
  --help                   Show this help
  --version                Show version

Exit codes:
  0   graceful (queue drained, deadline reached, or SIGINT)
  1   fatal error
  2   bad arguments
  130 interrupted (SIGINT)
`

function usageExit(msg?: string): never {
  if (msg) process.stderr.write(`error: ${msg}\n\n`)
  process.stderr.write(USAGE)
  process.exit(2)
}

function parseOpts(argv: string[]): CrawlOptions {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        depth: { type: "string" },
        concurrency: { type: "string" },
        deadline: { type: "string" },
        "per-page-timeout": { type: "string" },
        out: { type: "string" },
        "user-agent": { type: "string" },
        "same-origin": { type: "boolean" },
        "no-same-origin": { type: "boolean" },
        help: { type: "boolean" },
        version: { type: "boolean" },
      },
    })
  } catch (err) {
    usageExit((err as Error).message)
  }

  if (parsed.values.help) {
    process.stdout.write(USAGE)
    process.exit(0)
  }
  if (parsed.values.version) {
    process.stdout.write(`jolly-crawl ${VERSION}\n`)
    process.exit(0)
  }

  const [seed, ...rest] = parsed.positionals
  if (!seed) usageExit("missing <url>")
  if (rest.length > 0) usageExit(`unexpected positional args: ${rest.join(" ")}`)

  let seedUrl: URL
  try {
    seedUrl = new URL(seed)
  } catch {
    usageExit(`invalid url: ${seed}`)
  }
  if (seedUrl.protocol !== "http:" && seedUrl.protocol !== "https:") {
    usageExit(`unsupported protocol: ${seedUrl.protocol} (only http/https)`)
  }

  const depth = parseIntFlag(parsed.values.depth, "depth", 2)
  const concurrency = parseIntFlag(parsed.values.concurrency, "concurrency", 10)
  if (depth < 0) usageExit("--depth must be >= 0")
  if (concurrency < 1) usageExit("--concurrency must be >= 1")

  const deadlineDur = parseDurFlag(parsed.values.deadline, "deadline", "2m")
  const perPageTimeout = parseDurFlag(parsed.values["per-page-timeout"], "per-page-timeout", "10s")

  if (parsed.values["same-origin"] && parsed.values["no-same-origin"]) {
    usageExit("--same-origin and --no-same-origin are mutually exclusive")
  }
  const sameOrigin = parsed.values["no-same-origin"] ? false : true

  return {
    seed: seedUrl.href,
    maxDepth: depth,
    concurrency,
    deadlineMs: Date.now() + deadlineDur,
    perPageTimeoutMs: perPageTimeout,
    out: parsed.values.out,
    userAgent: parsed.values["user-agent"] ?? `jolly-crawl/${VERSION}`,
    sameOrigin,
  }
}

function parseIntFlag(raw: string | undefined, name: string, def: number): number {
  if (raw === undefined) return def
  const n = Number(raw)
  if (!Number.isInteger(n)) usageExit(`--${name} must be an integer, got ${raw}`)
  return n
}

function parseDurFlag(raw: string | undefined, name: string, def: string): number {
  try {
    return parseDuration(raw ?? def)
  } catch (err) {
    usageExit(`--${name}: ${(err as Error).message}`)
  }
}

async function main() {
  const opts = parseOpts(process.argv.slice(2))
  const abort = new AbortController()
  let interrupted = false

  const onSignal = () => {
    interrupted = true
    abort.abort(new Error("SIGINT"))
  }
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)

  try {
    const result = await crawl({ ...opts, signal: abort.signal })
    writeSummary(result)
    process.exitCode = (result.endedBy === "abort" || interrupted) ? 130 : 0
  } catch (err) {
    process.stderr.write(`\nfatal: ${(err as Error).stack ?? String(err)}\n`)
    process.exitCode = 1
  } finally {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
  }
}

function writeSummary(result: CrawlResult): void {
  const suffix = result.endedBy === "drained"
    ? ""
    : ` (ended by ${result.endedBy})`
  process.stderr.write(renderFinal(result.stats) + suffix + "\n")
}

main()
