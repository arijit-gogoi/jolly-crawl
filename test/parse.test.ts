import { describe, it, expect } from "vitest"
import { parsePage } from "../src/parse.js"

const BASE = "https://host.example/page"

describe("parsePage", () => {
  it("extracts title", () => {
    const r = parsePage("<html><head><title>Hello</title></head></html>", BASE)
    expect(r.title).toBe("Hello")
  })

  it("empty string when title missing", () => {
    const r = parsePage("<html><body>no title</body></html>", BASE)
    expect(r.title).toBe("")
  })

  it("decodes entities in title", () => {
    const r = parsePage("<title>Ben &amp; Jerry &#x27;s &#39; foo &lt;</title>", BASE)
    expect(r.title).toBe("Ben & Jerry 's ' foo <")
  })

  it("collapses whitespace in title", () => {
    const r = parsePage("<title>  multi\n  line   title  </title>", BASE)
    expect(r.title).toBe("multi line title")
  })

  it("extracts absolute http links", () => {
    const r = parsePage('<a href="https://other.example/x">x</a>', BASE)
    expect(r.links).toEqual(["https://other.example/x"])
  })

  it("resolves relative links against base", () => {
    const r = parsePage('<a href="/foo">foo</a><a href="bar">bar</a>', BASE)
    expect(r.links).toContain("https://host.example/foo")
    expect(r.links).toContain("https://host.example/bar")
  })

  it("drops mailto/javascript/tel and fragment-only", () => {
    const r = parsePage(
      '<a href="mailto:a@b">m</a>' +
      '<a href="javascript:void(0)">j</a>' +
      '<a href="tel:+1">t</a>' +
      '<a href="#top">top</a>',
      BASE,
    )
    expect(r.links).toEqual([])
  })

  it("strips fragment from real urls", () => {
    const r = parsePage('<a href="/foo#section">s</a>', BASE)
    expect(r.links).toEqual(["https://host.example/foo"])
  })

  it("deduplicates repeated links", () => {
    const r = parsePage('<a href="/a">1</a><a href="/a">2</a>', BASE)
    expect(r.links).toEqual(["https://host.example/a"])
  })

  it("handles single quotes", () => {
    const r = parsePage("<a href='/single'>s</a>", BASE)
    expect(r.links).toEqual(["https://host.example/single"])
  })

  it("survives malformed html", () => {
    const html = "<html><title>t<a href=\"/x\">unclosed"
    expect(() => parsePage(html, BASE)).not.toThrow()
  })

  it("returns sorted link list", () => {
    const r = parsePage(
      '<a href="/z">z</a><a href="/a">a</a><a href="/m">m</a>',
      BASE,
    )
    expect(r.links).toEqual([
      "https://host.example/a",
      "https://host.example/m",
      "https://host.example/z",
    ])
  })

  it("ignores invalid URLs without throwing", () => {
    const r = parsePage('<a href="http://[invalid">bad</a><a href="/ok">ok</a>', BASE)
    expect(r.links).toEqual(["https://host.example/ok"])
  })

  it("decodes entities in href before resolving", () => {
    const r = parsePage('<a href="/a?x=1&amp;y=2">q</a>', BASE)
    expect(r.links).toEqual(["https://host.example/a?x=1&y=2"])
  })
})
