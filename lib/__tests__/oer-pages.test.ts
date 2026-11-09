import { describe, it, expect } from 'vitest'
import { toOerPages } from '@/lib/oer-pages'

describe('toOerPages', () => {
  it('returns an empty list for single-page documents (pages is null)', () => {
    // Regression: passing null to HtmlViewerCanvas crashed the report/revision split view.
    expect(toOerPages(null)).toEqual([])
    expect(toOerPages(undefined)).toEqual([])
  })

  it('keeps { url, fingerprint } page objects as-is', () => {
    const pages = [{ url: 'https://openstax.org/books/x/pages/1-1', fingerprint: 'abc123' }]
    expect(toOerPages(pages)).toEqual(pages)
  })

  it('converts legacy bare URL strings into page objects', () => {
    expect(toOerPages(['https://openstax.org/books/x/pages/1-2'])).toEqual([
      { url: 'https://openstax.org/books/x/pages/1-2', fingerprint: null },
    ])
  })

  it('drops entries without a usable url', () => {
    expect(toOerPages([42, null, { fingerprint: 'no-url' }, { url: 'https://x.org/p', fingerprint: null }])).toEqual([
      { url: 'https://x.org/p', fingerprint: null },
    ])
  })

  it('returns an empty list for non-array values', () => {
    expect(toOerPages({ url: 'https://x.org/p' })).toEqual([])
    expect(toOerPages('https://x.org/p')).toEqual([])
  })
})
