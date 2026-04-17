# jolly-crawl

Structured-concurrency web crawler built on [jolly-coop](https://github.com/arijit-gogoi/jolly-coop-js).

## Install

```sh
npm install -g jolly-crawl
```

Requires Node 22+.

## Usage

```sh
jolly-crawl <url> [--depth 2] [--concurrency 10] [--deadline 2m]
                  [--per-page-timeout 10s] [--out results.ndjson]
                  [--user-agent "jolly-crawl/0.1"] [--no-same-origin]
```

BFS-crawls from `<url>` up to `--depth` hops, at most `--concurrency` in-flight,
honors a wall-clock `--deadline` and `Ctrl-C`, writes NDJSON (one record per URL
attempted) to stdout or `--out`, prints a live progress line to stderr.

### Example

```sh
$ jolly-crawl https://example.com --depth 1 --no-same-origin --out out.ndjson
[2.1s] 2/2 ok, 0 err, 0 in-flight, 0 queued
crawled 2 urls in 2.1s: 2 ok, 0 err

$ head -1 out.ndjson
{"url":"https://example.com/","depth":0,"status":200,"title":"Example Domain","links":["https://iana.org/domains/example"],"duration_ms":1049,"ts":"2026-04-17T10:46:51.532Z"}
```

### Output schema

One JSON object per line. Success records have `status`, `title`, `links`,
`duration_ms`. Error records have `error` and `message`. All records have
`url`, `depth`, `ts`.

```json
{"url":"...","depth":0,"status":200,"title":"...","links":["..."],"duration_ms":42,"ts":"2026-04-17T12:34:56.789Z"}
{"url":"...","depth":1,"error":"HttpError","message":"404 Not Found","ts":"2026-04-17T12:34:57.010Z"}
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | graceful — queue drained, deadline reached |
| 1 | fatal unexpected error |
| 2 | bad arguments |
| 130 | interrupted (SIGINT / Ctrl-C) |

## Library use

```ts
import { crawl } from "jolly-crawl"

const result = await crawl({
  seed: "https://example.com/",
  maxDepth: 2,
  concurrency: 10,
  deadlineMs: Date.now() + 60_000,
  perPageTimeoutMs: 10_000,
  out: undefined,
  userAgent: "my-bot/1.0",
  sameOrigin: true,
})
console.log(result.stats, result.endedBy)
```

## Out of scope for v0.1.0

robots.txt respect, rate limiting, cookies/session, JS rendering, resume-from-checkpoint,
multiple seed URLs, non-HTML content downloads. See [ROADMAP.md](ROADMAP.md) for candidates.

## License

MIT
