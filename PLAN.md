# jolly-crawl — v0.1.0 build plan

This is the execution roadmap for the first shippable version. Read `CLAUDE.md` first for project rules and the scope tree; this file says what to build and in what order. When something is already covered in `CLAUDE.md`, this file references it rather than duplicating.

## 1. Goal

A CLI that BFS-crawls a URL under concurrency and deadline constraints, emits NDJSON (to stdout or `--out`), shows progress on stderr, and exits cleanly. Exit 0 on graceful completion (queue drained, deadline reached, or Ctrl-C). Exit non-zero only on fatal/unexpected error.

## 2. CLI shape (frozen)

```
jolly-crawl <url> [--depth 2] [--concurrency 10] [--deadline 2m]
                  [--per-page-timeout 10s] [--out results.ndjson]
                  [--user-agent "jolly-crawl/0.1"] [--same-origin]
```

- Parse via `node:util/parseArgs` (built-in, no dep)
- Duration flags accept `"30s"`, `"2m"`, `"1h"` — parsed in `src/time.ts`
- `--same-origin` defaults on; only enqueue URLs whose origin matches the seed
- On bad args, print usage to stderr and exit with code 2

## 3. Output schema (NDJSON, frozen)

One JSON object per line, one line per URL attempted:

**Success:**
```json
{"url":"https://example.com/","depth":0,"status":200,"title":"Example Domain","links":["https://iana.org/"],"duration_ms":42,"ts":"2026-04-17T12:34:56.789Z"}
```

**Error:**
```json
{"url":"https://example.com/404","depth":1,"error":"HttpError","message":"404 Not Found","ts":"2026-04-17T12:34:57.010Z"}
```

Any schema change post-0.1.0 is a breaking change.

## 4. Scope tree

See `CLAUDE.md § Architecture`. That tree is the blueprint — implement it as stated.

## 5. File layout

Each file has a single responsibility; target < 200 LOC.

| File | Responsibility |
|---|---|
| `src/cli.ts` | arg parsing, SIGINT wiring, invoke `crawl()`, map result → exit code |
| `src/crawl.ts` | root scope assembly; owns the full scope tree |
| `src/fetch.ts` | fetch with per-page timeout + retry; returns `{ok, value \| error}` |
| `src/parse.ts` | HTML → `{title, links[]}` via pure regex (no deps) |
| `src/queue.ts` | BFS visited set + depth-aware enqueue/dequeue |
| `src/output.ts` | NDJSON writer; created as `s.resource` (open file / close file) |
| `src/progress.ts` | stderr progress printer task |
| `src/time.ts` | duration parsing (`"30s"` → 30000) |
| `src/index.ts` | re-export `crawl()` and types for library users |
| `test/*.test.ts` | vitest — one file per module plus integration |

## 6. Implementation milestones

Each milestone is a committable increment. Keep them in order.

### M1 — CLI + root scope skeleton
- `src/cli.ts` parses flags, validates, computes absolute deadline (`Date.now() + parseDuration(flag)`)
- `src/crawl.ts` exports `async function crawl(opts): Promise<CrawlResult>` that runs the root scope:
  `scope({ deadline, signal: externalAbort.signal }, async s => { ... })`
- SIGINT listener in `cli.ts` calls `externalAbort.abort()` (use `AbortController`)
- Exit codes: 0 on graceful (queue drained / deadline / SIGINT), 1 on unexpected error, 2 on bad args
- Graceful SIGINT is exit 130 (standard POSIX: 128 + SIGINT=2)
- **Reference:** `../jolly-coop-js/examples/cli/03-build-system.mjs` for CLI-as-scope shape

### M2 — Output file resource
- `src/output.ts` exports `createOutputWriter(pathOrUndefined): Promise<Writer>` where `Writer = { write(record), close(), stats() }`
- If path is undefined → writes to `process.stdout` (close is a no-op)
- If path is defined → open with `node:fs/promises.open(path, "a")`; close on disposer
- In `crawl.ts`: `await s.resource(await createOutputWriter(opts.out), w => w.close())`
- `write()` serializes `JSON.stringify(record) + "\n"` and writes; count lines written
- **Reference:** `../jolly-coop-js/examples/cli/02-concurrent-downloader.mjs` (resource registration)

### M3 — Fetch with timeout + retry
- `src/fetch.ts` exports `fetchPage(url, opts): Promise<FetchResult>` where
  `FetchResult = { ok: true, status, body, duration_ms } | { ok: false, error: Error }`
- Never throws. All errors become `{ok: false}`.
- Retry policy:
  - Max 2 retries (3 total attempts)
  - Backoff: 500ms, 1000ms
  - Retry on: network errors (TypeError from fetch), 5xx status, 429
  - Do NOT retry on: 4xx (except 429), abort, timeout
- Per-attempt timeout via nested scope: `await scope({ timeout: opts.timeoutMs, signal: opts.signal }, async ps => { const res = await fetch(url, { signal: ps.signal, headers: {...} }); return res })`
- Between retries: `await sleep(backoffMs, opts.signal)` so abort stops retries immediately
- **Reference:** `../jolly-coop-js/examples/library/01-retry-with-backoff.mjs` — mirror the error-as-value structure verbatim

### M4 — HTML parser (pure regex, zero deps)
- `src/parse.ts` exports `parsePage(html: string, baseUrl: string): { title: string, links: string[] }`
- Title: `/<title[^>]*>([\s\S]*?)<\/title>/i` — first match, trim, HTML-decode basics (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#x?[0-9a-f]+;`)
- Links: `/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi` — all matches
- Resolve relative: `new URL(href, baseUrl).href` inside a try/catch (invalid URLs dropped)
- Filter: keep only `http:` / `https:` protocols; drop `mailto:`, `javascript:`, `tel:`, fragments
- Dedupe via `Set<string>`, return as sorted array
- Empty title → empty string, not undefined
- Malformed HTML never throws — returns best-effort

### M5 — BFS queue + concurrency pool
- `src/queue.ts` exports `class CrawlQueue` with:
  - `constructor({ maxDepth, sameOrigin, seedOrigin })`
  - `enqueue(url: string, depth: number): boolean` — returns false if visited, too deep, or foreign origin
  - `dequeue(): { url, depth } | undefined`
  - `get isEmpty(): boolean`
  - `get size(): number`
  - `get visitedCount(): number`
  - Internal: `visited: Set<string>`, array-backed FIFO
- In `crawl.ts`:
  - After M2 resource setup, create queue, enqueue seed at depth 0
  - Spawn driver task that owns the fetch pool:
    ```
    await scope({ limit: opts.concurrency, signal: s.signal }, async pool => {
      while (!queue.isEmpty || pool.active > 0) {
        if (queue.isEmpty) { await sleep(10, pool.signal); continue }
        const { url, depth } = queue.dequeue()!
        pool.spawn(async () => {
          const result = await fetchPage(url, { signal: pool.signal, ... })
          await writer.write(toRecord(url, depth, result))
          if (result.ok && depth < opts.maxDepth) {
            const { links } = parsePage(result.body, url)
            for (const link of links) queue.enqueue(link, depth + 1)
          }
        })
      }
    })
    ```
  - Thread `pool.signal` (== `s.signal`) into every sleep/fetch call
- When driver returns → queue is empty and pool drained → call `s.done()` for graceful exit
- **Reference:** `../jolly-coop-js/examples/library/02-async-pool.mjs`

### M6 — Progress printer + final summary
- `src/progress.ts` exports `runProgress(stats: Stats, signal: AbortSignal)`
- `Stats` is a shared object: `{ attempted, succeeded, failed, inFlight, queued, startedAt }`
- Spawned early in root scope alongside the driver
- Loop:
  ```
  while (!signal.aborted) {
    const elapsed = ((Date.now() - stats.startedAt) / 1000).toFixed(1)
    const line = `[${elapsed}s] ${stats.succeeded}/${stats.attempted} ok, ${stats.failed} err, ${stats.inFlight} in-flight, ${stats.queued} queued`
    process.stderr.write("\r" + line.padEnd(80))
    try { await sleep(100, signal) } catch { break }
  }
  process.stderr.write("\n")
  ```
- Final summary printed by `cli.ts` after `crawl()` returns, regardless of how it settled
- **Reference:** `../jolly-coop-js/examples/cli/02-concurrent-downloader.mjs`

## 7. Graceful shutdown wiring

| Condition | Mechanism | Exit code |
|---|---|---|
| Queue drained, pool idle | Driver returns → `s.done()` → scope resolves | 0 |
| Deadline elapsed | `scope({ deadline })` internal timer fires → rejects with `TimeoutError` | 0 (treat as graceful) |
| Ctrl-C | SIGINT → `externalAbort.abort()` → scope rejects with abort reason | 130 |
| Fatal unexpected error | Propagates from root scope | 1 |

CLI catches and distinguishes:
```ts
try { await crawl(opts); process.exit(0) }
catch (err) {
  if (err instanceof TimeoutError) process.exit(0)
  if (externalAbort.signal.aborted) process.exit(130)
  console.error(err); process.exit(1)
}
```

## 8. Jolly rules to honor

See `CLAUDE.md § Jolly rules that matter for this codebase`. The five:
1. Explicit signal on every `sleep` / `yieldNow` / nested `scope`
2. Fail-fast on uncaught throws
3. Error-as-value inside task bodies for expected failures
4. `done()` vs `cancel()` distinguishable via `ScopeDoneError` on `signal.reason`
5. LIFO resource cleanup

Do not re-derive these rules; they are load-bearing. If any of them feels inconvenient, that's a design signal to step back, not a reason to work around them.

## 9. Enumerated test cases

Write these as you complete each milestone. Use vitest. Mock `globalThis.fetch` where needed.

### `test/cli.test.ts`
- No args → exits 2, prints usage to stderr
- `--deadline abc` → exits 2 (invalid duration)
- `--depth 0` → crawls only the seed URL, no children
- SIGINT during crawl → exits 130, partial NDJSON has been flushed

### `test/time.test.ts`
- `parseDuration("30s")` → 30_000
- `parseDuration("2m")` → 120_000
- `parseDuration("1h")` → 3_600_000
- `parseDuration("abc")` throws

### `test/fetch.test.ts`
- 200 response → `{ok: true}` with body
- Persistent network error → `{ok: false, error}` after retries exhausted
- 500 → retries (backoff observed), then returns error if persistent
- 404 → `{ok: false}` immediately, no retry
- 429 → retries (backoff observed)
- Timeout fires → `{ok: false}` with `TimeoutError`
- Signal abort mid-backoff → returns `{ok: false}` immediately (not after full backoff)

### `test/parse.test.ts`
- Extract absolute links from `<a href="https://x.y">`
- Resolve relative links via base URL (`/foo` + base → `https://host/foo`)
- Deduplicate repeated links
- Drop non-http(s) (`mailto:`, `javascript:`, `tel:`, `#anchor`)
- Missing `<title>` → title is empty string
- Malformed HTML (unclosed tags, etc.) → returns best-effort, never throws
- HTML entity decode in title: `&amp;` → `&`

### `test/queue.test.ts`
- Deduplicate by URL (enqueue same URL twice → one entry)
- Respect max depth (enqueue at depth > max → returns false)
- `sameOrigin=true` filters foreign hosts
- `sameOrigin=false` allows any http(s) host
- Empty initial → `isEmpty` true immediately

### `test/crawl.test.ts` (integration, mocked fetch)
- 3-page graph (seed → A → B): all three crawled with correct depths
- Deadline exits early → partial NDJSON, exit 0 semantics
- Fetch error on one URL does NOT cancel siblings (error-as-value)
- Output file resource is closed on scope exit (verify via `stat().size > 0` and file handle state)
- Ctrl-C simulated (abort external signal) → scope rejects, partial output persisted

## 10. Out of scope for v0.1.0

Deliberately excluded to ship a focused v0.1.0:

- `robots.txt` / crawl-delay respect
- Per-host rate limiting
- Cookies / session state
- Custom redirect handling beyond fetch defaults
- JS rendering (headless browser)
- Depth-first mode
- Resume-from-checkpoint
- Multiple seed URLs
- Content-type filtering (assume HTML)
- Download of non-HTML responses

Any of these are candidates for v0.2.0+ once v0.1.0 ships and gets real use.

## 11. Definition of done

- [ ] All test cases in §9 implemented and passing
- [ ] `npm run typecheck` clean
- [ ] `npm run build` produces `dist/cli.js` with shebang (verify with `head -1`)
- [ ] `node dist/cli.js https://example.com --depth 1` produces valid NDJSON on stdout, exits 0
- [ ] `node dist/cli.js https://example.com --depth 2 --deadline 1s --out /tmp/crawl.ndjson` writes partial NDJSON, exits 0
- [ ] `Ctrl-C` during a longer crawl produces partial output, exits 130
- [ ] README updated with one usage example (skip until final commit of the milestone chain)

## 12. Verification commands

```bash
cd C:/Users/hp/claude-projects/jolly-crawl
npm run typecheck
npm test
npm run build

# Smoke tests
node dist/cli.js https://example.com --depth 1
node dist/cli.js https://example.com --depth 1 --out /tmp/crawl.ndjson
cat /tmp/crawl.ndjson | head -5
node dist/cli.js https://example.com --depth 2 --deadline 500ms  # should exit ~0.5s with partial results
```

## 13. Commit cadence suggestion

One commit per milestone, Conventional Commits:
- `feat(cli): parse args, root scope, SIGINT wiring (M1)`
- `feat(output): NDJSON writer as scope resource (M2)`
- `feat(fetch): error-as-value fetch with timeout + retry (M3)`
- `feat(parse): zero-dep HTML title + link extractor (M4)`
- `feat(crawl): BFS queue and concurrency-limited fetch pool (M5)`
- `feat(progress): stderr progress printer with final summary (M6)`
- `docs: README with usage and example output`
- `chore: bump version to 0.1.0`

After final commit: tag `v0.1.0`, push tag, `npm publish`.
