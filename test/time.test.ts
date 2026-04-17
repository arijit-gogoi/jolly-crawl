import { describe, it, expect } from "vitest"
import { parseDuration } from "../src/time.js"

describe("parseDuration", () => {
  it("parses seconds", () => {
    expect(parseDuration("30s")).toBe(30_000)
  })
  it("parses minutes", () => {
    expect(parseDuration("2m")).toBe(120_000)
  })
  it("parses hours", () => {
    expect(parseDuration("1h")).toBe(3_600_000)
  })
  it("parses milliseconds", () => {
    expect(parseDuration("500ms")).toBe(500)
  })
  it("parses fractional values", () => {
    expect(parseDuration("0.5s")).toBe(500)
  })
  it("throws on bare number", () => {
    expect(() => parseDuration("30")).toThrow(/invalid duration/)
  })
  it("throws on nonsense", () => {
    expect(() => parseDuration("abc")).toThrow(/invalid duration/)
  })
  it("throws on empty", () => {
    expect(() => parseDuration("")).toThrow(/invalid duration/)
  })
  it("throws on unknown unit", () => {
    expect(() => parseDuration("30d")).toThrow(/invalid duration/)
  })
  it("tolerates leading/trailing whitespace", () => {
    expect(parseDuration("  2m  ")).toBe(120_000)
  })
})
