import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { existsSync } from "node:fs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = resolve(__dirname, "../dist/cli.js")

if (!existsSync(CLI)) {
  throw new Error(`dist/cli.js not found — run \`npm run build\` (or rely on pretest hook)`)
}

function runCli(args: string[], timeoutMs = 10_000) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
  })
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
}

describe("cli", () => {
  it("exits 2 with usage on no args", () => {
    const r = runCli([])
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/Usage:/)
    expect(r.stderr).toMatch(/missing <url>/)
  })

  it("exits 2 on invalid duration", () => {
    const r = runCli(["https://example.com", "--deadline", "abc"])
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/--deadline/)
  })

  it("exits 2 on invalid url", () => {
    const r = runCli(["not-a-url"])
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/invalid url/)
  })

  it("exits 2 on unsupported protocol", () => {
    const r = runCli(["ftp://example.com"])
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/unsupported protocol/)
  })

  it("exits 2 on negative depth", () => {
    const r = runCli(["https://example.com", "--depth", "-1"])
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/--depth/)
  })

  it("exits 2 on zero concurrency", () => {
    const r = runCli(["https://example.com", "--concurrency", "0"])
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/--concurrency/)
  })

  it("exits 0 on --help", () => {
    const r = runCli(["--help"])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/Usage:/)
  })

  it("exits 0 on --version", () => {
    const r = runCli(["--version"])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/jolly-crawl /)
  })

  it("exits 0 when deadline elapses on an unreachable host", () => {
    // Non-routable TEST-NET-1 (RFC 5737); fetch will fail fast, retries will
    // burn some backoff, deadline fires — exit 0 (deadline is graceful).
    const r = runCli(
      ["http://192.0.2.1", "--depth", "0", "--deadline", "2s", "--per-page-timeout", "500ms"],
      15_000,
    )
    expect(r.code).toBe(0)
  }, 20_000)
})
