export interface QueueEntry {
  url: string
  depth: number
}

export interface QueueOptions {
  maxDepth: number
  sameOrigin: boolean
  seedOrigin: string
}

export class CrawlQueue {
  private readonly visited = new Set<string>()
  private readonly fifo: QueueEntry[] = []
  private readonly maxDepth: number
  private readonly sameOrigin: boolean
  private readonly seedOrigin: string

  constructor(opts: QueueOptions) {
    this.maxDepth = opts.maxDepth
    this.sameOrigin = opts.sameOrigin
    this.seedOrigin = opts.seedOrigin
  }

  enqueue(url: string, depth: number): boolean {
    if (depth > this.maxDepth) return false
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
    if (this.sameOrigin && parsed.origin !== this.seedOrigin) return false
    const canonical = parsed.href
    if (this.visited.has(canonical)) return false
    this.visited.add(canonical)
    this.fifo.push({ url: canonical, depth })
    return true
  }

  dequeue(): QueueEntry | undefined {
    return this.fifo.shift()
  }

  get isEmpty(): boolean {
    return this.fifo.length === 0
  }

  get size(): number {
    return this.fifo.length
  }

  get visitedCount(): number {
    return this.visited.size
  }
}
