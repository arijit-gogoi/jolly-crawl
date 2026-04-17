const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i
const LINK_RE = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const cp = parseInt(body.slice(2), 16)
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) return String.fromCodePoint(cp)
      return match
    }
    if (body.startsWith("#")) {
      const cp = parseInt(body.slice(1), 10)
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) return String.fromCodePoint(cp)
      return match
    }
    const value = NAMED_ENTITIES[body.toLowerCase()]
    return value ?? match
  })
}

export interface ParsedPage {
  title: string
  links: string[]
}

export function parsePage(html: string, baseUrl: string): ParsedPage {
  const titleMatch = TITLE_RE.exec(html)
  const title = titleMatch ? decodeEntities(titleMatch[1]!).replace(/\s+/g, " ").trim() : ""

  const links = new Set<string>()
  LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LINK_RE.exec(html)) !== null) {
    const raw = (m[1] ?? m[2] ?? "").trim()
    if (!raw || raw.startsWith("#")) continue
    const decoded = decodeEntities(raw)
    let resolved: URL
    try {
      resolved = new URL(decoded, baseUrl)
    } catch {
      continue
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue
    resolved.hash = ""
    links.add(resolved.href)
  }

  return { title, links: [...links].sort() }
}
