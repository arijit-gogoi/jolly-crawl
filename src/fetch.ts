import { scope, sleep, TimeoutError } from "jolly-coop"

export interface FetchOptions {
  timeoutMs: number
  userAgent: string
  signal: AbortSignal
  maxRetries?: number
}

export type FetchResult =
  | { ok: true; status: number; body: string; duration_ms: number }
  | { ok: false; error: Error }

const DEFAULT_MAX_RETRIES = 2
const BACKOFF_MS = [500, 1000]

export async function fetchPage(url: string, opts: FetchOptions): Promise<FetchResult> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES
  const attempts = maxRetries + 1
  let lastError: Error = new Error("no attempts made")

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (opts.signal.aborted) {
      return { ok: false, error: new Error("aborted") }
    }

    const startedAt = Date.now()
    try {
      const result = await scope(
        { timeout: opts.timeoutMs, signal: opts.signal },
        async ps => {
          const res = await fetch(url, {
            signal: ps.signal,
            headers: { "user-agent": opts.userAgent, accept: "text/html,*/*" },
            redirect: "follow",
          })
          const body = await res.text()
          return { status: res.status, body }
        },
      )

      if (result.status >= 500 || result.status === 429) {
        lastError = new Error(`HTTP ${result.status}`)
        if (attempt < attempts - 1) {
          try {
            await sleep(BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!, opts.signal)
          } catch {
            return { ok: false, error: lastError }
          }
          continue
        }
        return { ok: false, error: lastError }
      }

      if (result.status >= 400) {
        return { ok: false, error: new Error(`HTTP ${result.status}`) }
      }

      return {
        ok: true,
        status: result.status,
        body: result.body,
        duration_ms: Date.now() - startedAt,
      }
    } catch (err) {
      const e = err as Error
      if (e instanceof TimeoutError) {
        return { ok: false, error: e }
      }
      if (opts.signal.aborted) {
        return { ok: false, error: e }
      }
      lastError = e
      if (attempt < attempts - 1) {
        try {
          await sleep(BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!, opts.signal)
        } catch {
          return { ok: false, error: lastError }
        }
        continue
      }
      return { ok: false, error: lastError }
    }
  }

  return { ok: false, error: lastError }
}
