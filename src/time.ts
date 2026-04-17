const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
}

export function parseDuration(input: string): number {
  const m = DURATION_RE.exec(input.trim())
  if (!m) throw new Error(`invalid duration: ${input} (expected like "30s", "2m", "1h", "500ms")`)
  const n = Number(m[1])
  const unit = m[2]
  const factor = UNIT_MS[unit]
  if (factor === undefined) throw new Error(`invalid duration unit: ${unit}`)
  return Math.round(n * factor)
}
