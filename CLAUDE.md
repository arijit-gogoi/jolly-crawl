# jolly-crawl

Structured-concurrency web crawler built on [jolly-coop](https://github.com/arijit-gogoi/jolly-coop-js).

## What this is

CLI tool. Target invocation:

```
jolly-crawl <url> --depth N --concurrency C --deadline 2m --out results.ndjson
```

Output: NDJSON, one record per crawled page. Progress to stderr. Exit 0 on graceful completion or deadline, non-zero on fatal error.

## Dependencies

- `jolly-coop@^0.3.0` — the structured concurrency runtime. Authoritative sources, in order of preference:
  - Local spec: `../jolly-coop-js/spec/jolly-coop.md` (if checked out as sibling)
  - Installed types: `node_modules/jolly-coop/dist/index.d.ts`
  - GitHub: https://github.com/arijit-gogoi/jolly-coop-js

## Jolly rules that matter for this codebase

**Signals are explicit. There is no ambient context.** Every await that should honor cancellation must receive a signal:

- `await sleep(ms, s.signal)` — always thread the signal
- `await yieldNow(s.signal)` — always thread the signal
- Nested scope: `scope({ signal: s.signal }, async inner => ...)` — inherit explicitly
- `fetch(url, { signal: s.signal })` — pass to any AbortSignal-aware API

Forgetting the signal does not fail loudly. The await runs to completion ignoring cancellation. Treat this as a lint-level rule: every `sleep`/`yieldNow`/nested-scope call in this codebase must thread a signal.

**Fail-fast on task errors.** Any uncaught throw from a `spawn()` body immediately cancels the scope. To recover from an expected failure, catch *inside* the task body and return an `{ ok, value | error }` result:

```ts
const t = s.spawn(async () => {
  try { return { ok: true, value: await fetchUrl(u) } }
  catch (err) { return { ok: false, error: err } }
})
const result = await t
if (!result.ok) { /* handle locally, scope still alive */ }
```

Catching *after* `await t` is too late — the scope has already started cancelling siblings.

**`cancel()` always rejects. `done()` resolves gracefully.** Use `done()` when shutdown is intentional (deadline reached, work complete); `cancel(err)` when something went wrong. Observers distinguish via `s.signal.reason instanceof ScopeDoneSignal` (renamed from `ScopeDoneError` in jolly-coop v0.3.1 — now a subclass of `ScopeCancelledError` with `cause: "done"`).

**Resource cleanup is LIFO.** Register via `s.resource(value, disposer)` in dependency order; cleanup runs in reverse on scope exit regardless of success, failure, or cancel. If resource B depends on resource A, register A first, B second.

**Nested scopes do not auto-inherit the parent signal.** You must pass `{ signal: parent.signal }` explicitly. Otherwise the nested scope is independent and keeps running even when the parent cancels.

## Architecture

The scope tree IS the app's architecture. Planned shape:

```
scope({ deadline, signal: SIGINT }) — root
├── resource: output file writer
├── resource: http.Agent (keep-alive)
├── spawn: queue driver
│   └── scope({ limit: concurrency, signal: s.signal }) — fetch pool
│       └── spawn: fetch(url)
│           └── scope({ timeout: 10s, signal: s.signal }) — per-page
│               └── spawn: parse → enqueue → write row
└── spawn: progress printer (sleep loop + refresh)
```

Each branch has a lifetime. Cancellation flows down. Resources clean up in reverse order. No fire-and-forget — if a task exists, its scope waits for it.

## Commands

- `npm test` — unit tests (vitest)
- `npm run build` — tsup → `dist/cli.js` (with shebang) + `dist/index.js`
- `npm run typecheck` — `tsc --noEmit`

## Commit discipline

- Conventional Commits: `<type>(scope): description` — same as jolly-coop
- The git log IS the history. Write commits that explain *why*, not just *what*.
- Pre-1.0 breaking changes go in the minor position (0.x.y).
