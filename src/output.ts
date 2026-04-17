import { open, type FileHandle } from "node:fs/promises"
import type { CrawlRecord } from "./types.js"

export interface Writer {
  write(record: CrawlRecord): Promise<void>
  close(): Promise<void>
  stats(): { linesWritten: number }
}

export async function createOutputWriter(path: string | undefined): Promise<Writer> {
  let linesWritten = 0

  if (path === undefined) {
    return {
      async write(record) {
        await new Promise<void>((resolve, reject) => {
          process.stdout.write(JSON.stringify(record) + "\n", err => err ? reject(err) : resolve())
        })
        linesWritten++
      },
      async close() {
        // stdout stays open
      },
      stats() {
        return { linesWritten }
      },
    }
  }

  const fh: FileHandle = await open(path, "a")
  let closed = false

  return {
    async write(record) {
      if (closed) throw new Error("writer closed")
      await fh.write(JSON.stringify(record) + "\n")
      linesWritten++
    },
    async close() {
      if (closed) return
      closed = true
      await fh.close()
    },
    stats() {
      return { linesWritten }
    },
  }
}
