/** One page of a multi-page HTML OER submission (OpenStax, Pressbooks), as stored in `documents.pages`. */
export interface OerPage {
  url?: string
  fingerprint: string | null
}

/**
 * Normalize `documents.pages` into the page list the HTML viewer expects.
 *
 * Single-page submissions store `null`, and some older rows store bare URL strings
 * instead of `{ url, fingerprint }` objects. Passing either straight to
 * `HtmlViewerCanvas` breaks it (`null` crashes the page; strings are silently dropped).
 * Mirrors the normalization the reviewer console does in `app/review/page.tsx`.
 */
export function toOerPages(pages: unknown): OerPage[] {
  if (!Array.isArray(pages)) return []
  return pages.flatMap((p): OerPage[] => {
    if (typeof p === 'string') return [{ url: p, fingerprint: null }]
    if (p && typeof p === 'object' && typeof (p as Record<string, unknown>).url === 'string') return [p as OerPage]
    return []
  })
}
