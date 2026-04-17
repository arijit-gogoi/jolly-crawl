export interface CrawlOptions {
  seed: string
  maxDepth: number
  concurrency: number
  deadlineMs: number
  perPageTimeoutMs: number
  out: string | undefined
  userAgent: string
  sameOrigin: boolean
  signal?: AbortSignal
}

export interface Stats {
  attempted: number
  succeeded: number
  failed: number
  inFlight: number
  queued: number
  startedAt: number
}

export interface CrawlSuccessRecord {
  url: string
  depth: number
  status: number
  title: string
  links: string[]
  duration_ms: number
  ts: string
}

export interface CrawlErrorRecord {
  url: string
  depth: number
  error: string
  message: string
  ts: string
}

export type CrawlRecord = CrawlSuccessRecord | CrawlErrorRecord

export interface CrawlResult {
  stats: Stats
}
