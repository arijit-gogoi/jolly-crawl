# jolly-crawl roadmap

v0.1.0 shipped 2026-04-17. Items below were deliberately excluded from
v0.1.0 to keep the first release focused. They are candidates for v0.2.0+
once v0.1.0 gets real use and the priority among them becomes clear.

## v0.2.0+ candidates

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

## Known non-blocking issues carried forward from v0.1.0

- Progress printer writes to `process.stderr` during integration tests,
  producing noisy test output. A `writeLine` option threaded through
  `crawl()` → `runProgress` would let tests capture/suppress.
- `duration_ms` under mocked fetch is often 0 or 1. Harmless; real fetches
  produce realistic values.
