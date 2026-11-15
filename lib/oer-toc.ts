// Parse a book's table of contents so authors can submit whole chapters at once.
// Supports OpenStax (openstax.org) and Pressbooks on any domain. Pure functions only
// (safe to import from client code); the fetching lives in app/api/oer-toc/route.ts.

export interface TocPage {
  title: string
  url: string
}

export interface TocChapter {
  title: string
  pages: TocPage[]
}

export interface OerToc {
  bookTitle: string
  platform: 'OpenStax' | 'Pressbooks'
  chapters: TocChapter[]
}

/** Strip tags and decode the few entities that appear in TOC titles. */
function cleanTitle(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// ── OpenStax ────────────────────────────────────────────────────────────────
// Every OpenStax book page embeds the full book tree in window.__PRELOADED_STATE__.

interface OpenStaxNode {
  title: string
  slug?: string
  contents?: OpenStaxNode[]
}

export function parseOpenStaxToc(html: string, pageUrl: string): OerToc | null {
  const bookSlug = new URL(pageUrl).pathname.match(/^\/books\/([^/]+)/)?.[1]
  const marker = html.match(/__PRELOADED_STATE__\s*=\s*/)
  if (!bookSlug || !marker || marker.index === undefined) return null

  let tree: OpenStaxNode | undefined
  try {
    const start = marker.index + marker[0].length
    const end = html.indexOf('</script>', start)
    const json = html.slice(start, end).trim().replace(/;$/, '')
    tree = JSON.parse(json)?.content?.book?.tree
  } catch {
    return null
  }
  if (!tree?.contents) return null

  const pageOf = (n: OpenStaxNode): TocPage => ({
    title: cleanTitle(n.title),
    url: `https://openstax.org/books/${bookSlug}/pages/${n.slug}`,
  })
  const isLeaf = (n: OpenStaxNode) => !n.contents?.length

  // A chapter is a node whose children are all pages; units (chapters of chapters) are walked through.
  // Top-level pages such as the preface or index become one-page entries.
  const chapters: TocChapter[] = []
  const walk = (nodes: OpenStaxNode[]) => {
    for (const n of nodes) {
      if (isLeaf(n)) {
        if (n.slug) chapters.push({ title: cleanTitle(n.title), pages: [pageOf(n)] })
      } else if (n.contents!.every(isLeaf)) {
        // OpenStax chapter titles are just "2 Psychological Research"; spell out "Chapter 2:" so it can't be misread as a page.
        const title = cleanTitle(n.title).replace(/^(\d+)\s+/, 'Chapter $1: ')
        chapters.push({ title, pages: n.contents!.filter(c => c.slug).map(pageOf) })
      } else {
        walk(n.contents!)
      }
    }
  }
  walk(tree.contents)

  return chapters.length ? { bookTitle: cleanTitle(tree.title), platform: 'OpenStax', chapters } : null
}

// ── Pressbooks ──────────────────────────────────────────────────────────────
// Every Pressbooks book (any domain) serves its TOC at <book root>/wp-json/pressbooks/v2/toc.
// Parts group chapters; books without parts put everything in one untitled "Main Body" part.
// Front matter (overview, preface) and back matter (appendices) are single pages around the parts.

interface PressbooksItem {
  title?: string
  link?: string
}

export interface PressbooksToc {
  'front-matter'?: PressbooksItem[]
  parts?: { title?: string; chapters?: PressbooksItem[] }[]
  'back-matter'?: PressbooksItem[]
}

/** https://host/book/chapter/x/ → https://host/book/ (works for root-domain books too). */
export function pressbooksBookRoot(url: string): string {
  const u = new URL(url)
  const path = u.pathname.replace(/\/(chapter|part|front-matter|back-matter)\/.*$/, '/')
  return `${u.origin}${path.endsWith('/') ? path : `${path}/`}`
}

export function parsePressbooksToc(toc: PressbooksToc, bookTitle: string): OerToc | null {
  const toPages = (items: PressbooksItem[] = []) =>
    items.filter(c => c.link).map(c => ({ title: cleanTitle(c.title ?? ''), url: c.link! }))
  const singles = (items?: PressbooksItem[]) => toPages(items).map(p => ({ title: p.title, pages: [p] }))

  const chapters: TocChapter[] = singles(toc['front-matter'])
  for (const part of toc.parts ?? []) {
    const pages = toPages(part.chapters)
    if (!pages.length) continue
    const partTitle = cleanTitle(part.title ?? '')
    if (!partTitle || /^main body$/i.test(partTitle)) {
      // No real grouping: offer each page as its own entry.
      chapters.push(...pages.map(p => ({ title: p.title, pages: [p] })))
    } else {
      chapters.push({ title: partTitle, pages })
    }
  }
  chapters.push(...singles(toc['back-matter']))
  return chapters.length ? { bookTitle: cleanTitle(bookTitle), platform: 'Pressbooks', chapters } : null
}

/**
 * Put chapter pages into a submission's URL fields: the first picked page becomes the
 * main URL, the rest are appended after any extra pages already entered. No duplicates.
 */
export function mergeChapterPages(
  existingExtras: string[],
  pickedUrls: string[],
): { mainUrl: string; extraUrls: string[] } {
  const [mainUrl, ...rest] = pickedUrls
  const seen = new Set([mainUrl])
  const extraUrls = [...existingExtras.map(u => u.trim()).filter(Boolean), ...rest].filter(u => {
    if (seen.has(u)) return false
    seen.add(u)
    return true
  })
  return { mainUrl, extraUrls }
}
